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
import { ConnectionError, type Connection, type Credentials, type SystemInfo } from "../connection.js";
import { toConnectionError } from "../errors.js";
import { LOGIN_TIMEOUT_SECONDS, loadJava, openJdbc, plain, readAllSync, type JavaObject, type Jt400Db } from "./bridge.js";
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

/**
 * Opens a connection with jt400: JDBC through node-jt400 for the SQL lists, and a
 * separate `AS400` object for the print services that read spooled files.
 * Every error is a `ConnectionError` without the password.
 */
export async function openJt400Connection(creds: Credentials): Promise<Connection> {
  const secrets = [creds.password];
  const fail = (err: unknown, context?: string): ConnectionError => toConnectionError(err, secrets, context);

  let db: Jt400Db;
  let system: JavaObject;
  let classes: { SpooledFile: JavaObject; PrintObject: JavaObject };
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
