'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { jobSpecSchema, specsDiffer, type DraftPatch, type JobSpec } from '@/lib/job-spec';
import { api, errorText, shownError, type ShownError } from '@/lib/client/api';
import type { Step } from '@/lib/client/job-steps';
import { withLatestCall, type LatestCall } from '@/lib/client/server-state';
import type { DestinationView, JobDetail, ServerView } from '@/lib/types';

/** Which spec the builder shows: the draft, or a saved version (read-only). */
export type Viewing = 'draft' | number;

export type { Step } from '@/lib/client/job-steps';

type SaveState = 'saved' | 'saving' | 'error';

export interface JobState {
  job: JobDetail;
  /** The spec shown: the draft, or the version picked in the version select. */
  spec: JobSpec;
  viewing: Viewing;
  setViewing(viewing: Viewing): Promise<void>;
  readOnly: boolean;
  /** The spec of the active version, when there is one (to tell whether the draft differs). */
  activeSpec: JobSpec | null;
  draftDiffers: boolean;
  /** Change parts of the draft. Text parts are saved after a pause in typing, others at once. */
  updateDraft(patch: DraftPatch, options?: { debounce?: boolean }): void;
  /** Rename the job, or pause and resume it. */
  updateJob(change: { name?: string; paused?: boolean }): Promise<void>;
  /** Fetch the job again, for example after the chat wrote the draft. */
  refresh(): Promise<void>;
  /** Save pending draft edits now. */
  flush(): Promise<void>;
  saveState: SaveState;
  saveError: string | null;
  step: Step;
  setStep(step: Step): void;
  servers: ServerView[];
  /** Why the servers could not be loaded, if they could not. */
  serversError: ShownError | null;
  /** Load the servers again, for example after Reconnect changed the state of one. */
  reloadServers(): void;
  /**
   * Say what a call to a server came to, so its status shows it at once: an error from
   * the call, or null when it worked. The servers are not loaded again.
   */
  noteServerCall(serverId: string, error: ShownError | null): void;
  destinations: DestinationView[];
  /** Why the destinations could not be loaded, or null. */
  destinationsError: string | null;
}

const JobContext = createContext<JobState | null>(null);

const TEXT_PARTS = new Set<keyof DraftPatch>(['extract', 'lookups', 'render', 'source']);
const DEBOUNCE_MS = 800;

/**
 * The job being built: its draft (saved as it changes), its versions, the servers and
 * destinations to pick from, and which pipeline step is selected.
 */
export function JobProvider({ initial, children }: { initial: JobDetail; children: ReactNode }) {
  const [job, setJob] = useState(initial);
  const [viewing, setViewingState] = useState<Viewing>('draft');
  const [versionSpec, setVersionSpec] = useState<JobSpec | null>(null);
  const [active, setActive] = useState<{ version: number; spec: JobSpec } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(initial.draft.source.serverId && initial.draft.source.queue ? 'extract' : 'source');
  const [loadedServers, setServers] = useState<ServerView[]>([]);
  // The latest call to each server since the servers loaded.
  const [calls, setCalls] = useState<Record<string, LatestCall>>({});
  const [serversError, setServersError] = useState<ShownError | null>(null);
  const [destinations, setDestinations] = useState<DestinationView[]>([]);
  const [destinationsError, setDestinationsError] = useState<string | null>(null);
  const pending = useRef<DraftPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(0);

  const reloadServers = useCallback(() => {
    api<{ servers: ServerView[] }>('/api/servers').then(
      (data) => {
        setServers(data.servers);
        setCalls({});
        setServersError(null);
      },
      (err) => setServersError(shownError(err)),
    );
  }, []);

  const noteServerCall = useCallback((serverId: string, error: ShownError | null) => {
    setCalls((current) => {
      const last = current[serverId];
      if (last && last.error?.message === error?.message && last.error?.code === error?.code) return current;
      return { ...current, [serverId]: { error, at: new Date().toISOString() } };
    });
  }, []);
  // The servers as they read after the latest calls. Nothing fetches on `servers`, so this starts no call.
  const servers = useMemo(() => loadedServers.map((server) => withLatestCall(server, calls[server.id])), [loadedServers, calls]);

  useEffect(() => {
    reloadServers();
    api<{ destinations: DestinationView[] }>('/api/destinations').then(
      (data) => setDestinations(data.destinations),
      (err) => setDestinationsError(errorText(err)),
    );
  }, [reloadServers]);

  // The active version's spec, to show whether the draft has changes that are not saved as a version.
  useEffect(() => {
    const version = job.activeVersion;
    if (version === null) {
      return;
    }
    api<{ spec: JobSpec }>(`/api/jobs/${job.id}/versions/${version}`).then(
      (data) => setActive({ version, spec: jobSpecSchema.parse(data.spec) }),
      () => undefined,
    );
  }, [job.id, job.activeVersion]);
  const activeSpec = active && active.version === job.activeVersion ? active.spec : null;

  const chain = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback(async () => {
    const patch = pending.current;
    if (Object.keys(patch).length === 0) {
      return;
    }
    pending.current = {};
    inFlight.current++;
    setSaveState('saving');
    try {
      const updated = await api<JobDetail>(`/api/jobs/${job.id}`, { method: 'PATCH', body: { draft: patch } });
      // Keep local edits made while this request was on its way.
      setJob((current) => ({ ...updated, draft: { ...updated.draft, ...pickParts(current.draft, pending.current) } }));
      setSaveError(null);
      if (--inFlight.current === 0 && Object.keys(pending.current).length === 0) {
        setSaveState('saved');
      }
    } catch (err) {
      inFlight.current--;
      pending.current = { ...patch, ...pending.current };
      setSaveError(errorText(err));
      setSaveState('error');
    }
  }, [job.id]);

  // Saves run one after another, so a later edit never lands before an earlier one.
  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    chain.current = chain.current.then(save);
    return chain.current;
  }, [save]);

  const updateDraft = useCallback(
    (patch: DraftPatch, options: { debounce?: boolean } = {}) => {
      setJob((current) => ({ ...current, draft: { ...current.draft, ...patch } }));
      pending.current = { ...pending.current, ...patch };
      setSaveState('saving');
      const debounce = options.debounce ?? Object.keys(patch).every((key) => TEXT_PARTS.has(key as keyof DraftPatch));
      if (timer.current) {
        clearTimeout(timer.current);
      }
      if (debounce) {
        timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
      } else {
        void flush();
      }
    },
    [flush],
  );

  // Save what is pending when the page goes away.
  useEffect(() => {
    const onHide = () => {
      if (Object.keys(pending.current).length > 0) {
        void fetch(`/api/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draft: pending.current }),
          keepalive: true,
        });
        pending.current = {};
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      onHide();
    };
  }, [job.id]);

  const refresh = useCallback(async () => {
    try {
      const fresh = await api<JobDetail>(`/api/jobs/${job.id}`);
      // A tool wrote the draft on the server: drop pending edits of the parts it changed.
      for (const key of Object.keys(pending.current) as (keyof DraftPatch)[]) {
        if (JSON.stringify(fresh.draft[key]) !== JSON.stringify(job.draft[key])) {
          delete pending.current[key];
        }
      }
      setJob({ ...fresh, draft: { ...fresh.draft, ...pending.current } });
    } catch (err) {
      // Keep what is shown; the next change saves again.
      toast.error('Could not reload the job', { description: errorText(err) });
    }
  }, [job.id, job.draft]);

  const updateJob = useCallback(
    async (change: { name?: string; paused?: boolean }) => {
      await flush();
      const updated = await api<JobDetail>(`/api/jobs/${job.id}`, { method: 'PATCH', body: change });
      setJob((current) => ({ ...updated, draft: current.draft }));
    },
    [flush, job.id],
  );

  const setViewing = useCallback(
    async (next: Viewing) => {
      if (next === 'draft') {
        setVersionSpec(null);
        setViewingState('draft');
        return;
      }
      await flush();
      const data = await api<{ spec: JobSpec }>(`/api/jobs/${job.id}/versions/${next}`);
      // Versions do not keep a preview file; show them on the draft's.
      setVersionSpec({ ...jobSpecSchema.parse(data.spec), preview: job.draft.preview });
      setViewingState(next);
    },
    [flush, job.id, job.draft.preview],
  );

  const spec = viewing === 'draft' ? job.draft : (versionSpec ?? job.draft);
  const draftDiffers = activeSpec ? specsDiffer(job.draft, activeSpec) : true;

  const value = useMemo<JobState>(
    () => ({
      job,
      spec,
      viewing,
      setViewing,
      readOnly: viewing !== 'draft',
      activeSpec,
      draftDiffers,
      updateDraft,
      updateJob,
      refresh,
      flush,
      saveState,
      saveError,
      step,
      setStep,
      servers,
      serversError,
      reloadServers,
      noteServerCall,
      destinations,
      destinationsError,
    }),
    [
      job,
      spec,
      viewing,
      setViewing,
      activeSpec,
      draftDiffers,
      updateDraft,
      updateJob,
      refresh,
      flush,
      saveState,
      saveError,
      step,
      servers,
      serversError,
      reloadServers,
      noteServerCall,
      destinations,
      destinationsError,
    ],
  );

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

function pickParts(draft: JobSpec, patch: DraftPatch): Partial<JobSpec> {
  const out: Partial<JobSpec> = {};
  for (const key of Object.keys(patch) as (keyof JobSpec)[]) {
    (out as Record<string, unknown>)[key] = draft[key];
  }
  return out;
}

/** The job being built. */
export function useJob(): JobState {
  const value = useContext(JobContext);
  if (!value) {
    throw new Error('useJob needs a JobProvider');
  }
  return value;
}
