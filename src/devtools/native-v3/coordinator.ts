import { ensure, labFileName, safeError, type LabConfig, type LabReport } from './types';

export type LabIdentity = Readonly<{ development: boolean; independentApp: boolean; hermes: boolean; physicalDevice: boolean; platform: string }>;
export type ResumeResult = Readonly<{ passed: boolean; freshJavaScriptRuntime: boolean; nativeProcessRestartVerified: false }>;
export interface RunJournal {
  begin(): Promise<string>;
  finish(runId: string, passed: boolean): Promise<void>;
  lastCompleted(): Promise<string | null>;
}
type Dependencies = Readonly<{
  identity: LabIdentity; journal: RunJournal;
  run(config: LabConfig, progress: (stage: string) => void): Promise<LabReport>;
  resume(config: LabConfig): Promise<ResumeResult>;
}>;

/** One explicit click = a NEW file namespace. Concurrent clicks share one promise. No mount writes. */
export function createLabCoordinator(base: LabConfig, deps: Dependencies) {
  type State = Readonly<{
    status: 'ready' | 'running' | 'complete' | 'error'; stage: string; identity: LabIdentity;
    report: LabReport | null; history: readonly LabReport[]; error: string | null;
    resume: ResumeResult | null; activeRunId: string | null;
  }>;
  let state: State = { status: 'ready', stage: '', identity: deps.identity, report: null, history: [], error: null, resume: null, activeRunId: null };
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>(), allocated = new Set<string>();
  const publish = (next: State) => { state = next; listeners.forEach(listener => listener()); };
  function execute(task: () => Promise<void>): Promise<void> {
    if (pending) return pending;
    pending = Promise.resolve().then(task).catch(error => publish({ ...state, status: 'error', error: safeError(error) }))
      .finally(() => { pending = null; });
    publish({ ...state, status: 'running', error: null, resume: null }); return pending;
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    run(): Promise<void> {
      return execute(async () => {
        const runId = await deps.journal.begin(); labFileName(runId, 'guard');
        ensure(!allocated.has(runId), 'REUSED_RUN_ID'); allocated.add(runId);
        publish({ ...state, report: null, activeRunId: runId, stage: 'new-independent-run' });
        const report = await deps.run({ ...base, runId }, stage => publish({ ...state, stage }));
        ensure(report.runId === runId, 'WRONG_RUN_REPORT');
        await deps.journal.finish(runId, report.failed === 0);
        publish({ ...state, status: 'complete', report, history: [...state.history, report] });
      });
    },
    resume(): Promise<void> {
      return execute(async () => {
        const runId = await deps.journal.lastCompleted(); ensure(runId, 'NO_COMPLETED_LAB_RUN'); labFileName(runId, 'guard');
        publish({ ...state, report: state.history.find(report => report.runId === runId) ?? null, stage: 'resume-owned-checkpoints', activeRunId: runId });
        const resume = await deps.resume({ ...base, runId });
        publish({ ...state, status: resume.passed ? 'complete' : 'error', resume });
      });
    },
  };
}
