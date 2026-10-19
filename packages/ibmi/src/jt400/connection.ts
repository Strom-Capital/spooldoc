import type { SpooledFileAttributes, SpooledFileId } from "@spooldoc/core";
import {
  ATTRIBUTE_DEFAULTS,
  parseChrid,
  parseOutqPath,
  positiveInt,
  spoolDateTime,
  toNumber,
  toText,
} from "../attributes.js";
import {
  ConnectionError,
  type CommandResult,
  type Connection,
  type Credentials,
  type QueueRef,
  type SystemInfo,
} from "../connection.js";
import { toConnectionError } from "../errors.js";
import { javaBytes, LOGIN_TIMEOUT_SECONDS, loadJava, openJdbc, plain, readAllSync, type JavaObject, type Jt400Db } from "./bridge.js";
import { mapQueueRow, mapSpooledFileRow, outputQueuesQuery, spooledFilesQuery, type Row } from "./sql.js";

type AttrKind = "int" | "float" | "string";
const GETTERS: Record<AttrKind, string> = {
  int: "getIntegerAttributeSync",
  float: "getFloatAttributeSync",
  string: "getStringAttributeSync",
};

/** Reads a print object attribute with the getter for `kind`, then the others; null when none works. */
function attribute(splf: JavaObject, id: number, kind: AttrKind): string | number | null {
  const order: AttrKind[] = [kind, ...(["int", "float", "string"] as const).filter((k) => k !== kind)];
  for (const k of order) {
    try {
      const value = plain(splf[GETTERS[k]](id));
      if (value !== null) return value;
    } catch {
      // Wrong type for this attribute or not set: try the next getter.
    }
  }
  return null;
}

/** The IFS path of a library object, such as `/QSYS.LIB/MYLIB.LIB/FORMS.OUTQ`. */
export function ifsPath(ref: QueueRef, type: "OUTQ" | "DTAQ"): string {
  return `/QSYS.LIB/${ref.library.trim().toUpperCase()}.LIB/${ref.name.trim().toUpperCase()}.${type}`;
}

/**
 * Opens a connection with jt400: JDBC through node-jt400 for the SQL lists, and a
 * separate `AS400` object for the print services that read spooled files.
 * Every error is a `ConnectionError` without the password.
 */
export async function openJt400Connection(creds: Credentials): Promise<Connection> {
  const secrets = [creds.password];
  const fail = (err: unknown, context?: string): ConnectionError => toConnectionError(err, secrets, context, { host: creds.host, user: creds.user });

  let db: Jt400Db;
  let system: JavaObject;
  let classes: {
    SpooledFile: JavaObject;
    PrintObject: JavaObject;
    OutputQueue: JavaObject;
    DataQueue: JavaObject;
    CommandCall: JavaObject;
  };
  try {
    db = await openJdbc(creds.host, creds.user, creds.password);
  } catch (err) {
    throw fail(err);
  }
  try {
    const java = loadJava();
    const AS400 = java.import("com.ibm.as400.access.AS400");
    system = new AS400(creds.host, creds.user, creds.password);
    system.setGuiAvailableSync(false);
    const socketProperties = new (java.import("com.ibm.as400.access.SocketProperties"))();
    socketProperties.setLoginTimeoutSync(LOGIN_TIMEOUT_SECONDS * 1000);
    system.setSocketPropertiesSync(socketProperties);
    classes = {
      SpooledFile: java.import("com.ibm.as400.access.SpooledFile"),
      PrintObject: java.import("com.ibm.as400.access.PrintObject"),
      OutputQueue: java.import("com.ibm.as400.access.OutputQueue"),
      DataQueue: java.import("com.ibm.as400.access.DataQueue"),
      CommandCall: java.import("com.ibm.as400.access.CommandCall"),
    };
  } catch (err) {
    await db.close().catch(() => undefined);
    throw fail(err);
  }

  const query = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
    try {
      return await db.query<Row>(sql, params);
    } catch (err) {
      throw fail(err);
    }
  };

  let info: Promise<SystemInfo> | undefined;
  const describe = (): Promise<SystemInfo> => {
    info ??= (async () => {
      const [ccsid] = await query(
        "SELECT CCSID FROM TABLE(QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '*', DETAILED_INFO => 'ALL')) X",
      );
      const [os] = await query("SELECT OS_VERSION, OS_RELEASE FROM SYSIBMADM.ENV_SYS_INFO");
      return {
        host: creds.host,
        user: creds.user.toUpperCase(),
        jobCcsid: toNumber(ccsid?.CCSID) ?? 0,
        vrm: os ? `V${toText(os.OS_VERSION)}R${toText(os.OS_RELEASE)}` : "",
      };
    })();
    info.catch(() => {
      info = undefined;
    });
    return info;
  };

  const readSpooledFile = async (id: SpooledFileId): Promise<{ bytes: Uint8Array; attributes: SpooledFileAttributes }> => {
    const { jobCcsid } = await describe();
    const what = `Spooled file ${id.name} number ${id.number} of job ${id.jobNumber}/${id.jobUser}/${id.jobName}`;
    try {
      const java = loadJava();
      const { SpooledFile, PrintObject: P } = classes;
      const splf = new SpooledFile(system, id.name, id.number, id.jobName, id.jobUser, id.jobNumber);
      const a = (attr: string, kind: AttrKind): string | number | null => attribute(splf, Number(P[attr]), kind);
      const queue = parseOutqPath(a("ATTR_OUTPUT_QUEUE", "string")) ?? { library: "", name: "" };
      const attributes: SpooledFileAttributes = {
        queue,
        userData: toText(a("ATTR_USERDATA", "string")),
        formType: toText(a("ATTR_FORMTYPE", "string")),
        deviceType: toText(a("ATTR_PRTDEVTYPE", "string")),
        pages: Math.max(0, Math.round(toNumber(a("ATTR_PAGES", "int")) ?? 0)),
        pageWidth: positiveInt(a("ATTR_PAGEWIDTH", "float"), ATTRIBUTE_DEFAULTS.pageWidth),
        pageLength: positiveInt(a("ATTR_PAGELEN", "float"), ATTRIBUTE_DEFAULTS.pageLength),
        cpi: toNumber(a("ATTR_CPI", "float")) ?? ATTRIBUTE_DEFAULTS.cpi,
        lpi: toNumber(a("ATTR_LPI", "float")) ?? ATTRIBUTE_DEFAULTS.lpi,
        chrid: parseChrid(a("ATTR_CHAR_ID", "string"), a("ATTR_CODEPAGE", "string")),
        jobCcsid: jobCcsid > 0 ? jobCcsid : null,
        created: spoolDateTime(a("ATTR_DATE", "string"), a("ATTR_TIME", "string")),
      };
      const bytes = readAllSync(java, splf.getInputStreamSync());
      return { bytes, attributes };
    } catch (err) {
      throw fail(err, what);
    }
  };

  const splfName = (id: SpooledFileId): string =>
    `Spooled file ${id.name} number ${id.number} of job ${id.jobNumber}/${id.jobUser}/${id.jobName}`;
  const spooledFile = (id: SpooledFileId): JavaObject =>
    new classes.SpooledFile(system, id.name, id.number, id.jobName, id.jobUser, id.jobNumber);
  // The methods without the Sync suffix return promises and run on a worker thread, so a
  // slow IBM i does not block the event loop.
  const onSpooledFile = async (id: SpooledFileId, act: (splf: JavaObject) => Promise<unknown>): Promise<void> => {
    try {
      await act(spooledFile(id));
    } catch (err) {
      throw fail(err, splfName(id));
    }
  };

  const readDataQueue = async (dataQueue: QueueRef, waitSeconds: number): Promise<Uint8Array | null> => {
    const what = `Data queue ${dataQueue.library}/${dataQueue.name}`;
    try {
      const dq = new classes.DataQueue(system, ifsPath(dataQueue, "DTAQ"));
      const entry = await dq.read(Math.max(0, Math.round(waitSeconds)));
      if (!entry) return null;
      return javaBytes(entry.getDataSync());
    } catch (err) {
      throw fail(err, what);
    }
  };

  const runCommand = async (command: string): Promise<CommandResult> => {
    try {
      const call = new classes.CommandCall(system);
      const ok = Boolean(await call.run(command));
      const list: JavaObject[] = call.getMessageListSync() ?? [];
      const messages = Array.from(list, (m: JavaObject) => ({ id: toText(plain(m.getIDSync())), text: toText(plain(m.getTextSync())) }));
      return { ok, messages };
    } catch (err) {
      throw fail(err, "The command");
    }
  };

  let closed = false;
  return {
    describe,
    async listOutputQueues(filter) {
      const { sql, params } = outputQueuesQuery(filter);
      return (await query(sql, params)).map(mapQueueRow);
    },
    async listSpooledFiles(queue, filter) {
      const { sql, params } = spooledFilesQuery(queue, filter);
      return (await query(sql, params)).map((row) => mapSpooledFileRow(row, queue));
    },
    readSpooledFile,
    // CPF3337: the file is held already, which is what was asked for.
    holdSpooledFile: (id) =>
      onSpooledFile(id, async (splf) => {
        try {
          await splf.hold("*IMMED");
        } catch (err) {
          if (!/CPF3337/.test(String((err as Error)?.message ?? err))) throw err;
        }
      }),
    moveSpooledFile: (id, queue) =>
      onSpooledFile(id, (splf) => splf.move(new classes.OutputQueue(system, ifsPath(queue, "OUTQ")))),
    deleteSpooledFile: (id) => onSpooledFile(id, (splf) => splf.delete()),
    readDataQueue,
    runCommand,
    async close() {
      if (closed) return;
      closed = true;
      try {
        system.disconnectAllServicesSync();
      } catch {
        // Already disconnected.
      }
      await db.close().catch(() => undefined);
    },
  };
}
