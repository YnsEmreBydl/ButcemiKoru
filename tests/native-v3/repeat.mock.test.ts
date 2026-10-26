import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLabCoordinator, type RunJournal } from '../../src/devtools/native-v3/coordinator';
import type { LabConfig, LabReport } from '../../src/devtools/native-v3/types';
import { deferred } from '../period-ui/fixtures';

const base: LabConfig = { runId: 'f'.repeat(32), fixtures: { v1: '', v2: '' } };
const identity = { development: true, independentApp: true, hermes: true, physicalDevice: true, platform: 'ios' };
function setup() {
  let counter = 0, last: string | null = null; const calls: string[] = [];
  const journal: RunJournal = { begin: async () => (++counter).toString(16).padStart(32, '0'), finish: async (id, passed) => { if (passed) last = id; }, lastCompleted: async () => last };
  const report = (id: string): LabReport => ({ scope: 'independent-synthetic-files', runId: id, results: [], passed: 1, failed: 0, sqliteVersion: 'test-mock', notRun: [] });
  const deps = { identity, journal, run: async (config: LabConfig) => { calls.push(config.runId); return report(config.runId); },
    resume: async (config: LabConfig) => { calls.push(`resume:${config.runId}`); return { passed: true, freshJavaScriptRuntime: true, nativeProcessRestartVerified: false as const }; } };
  return { deps, calls };
}
test('7D-2 lab mock: successive runs and a remounted coordinator allocate new file namespaces without deletion', async () => {
  const f = setup(), lab = createLabCoordinator(base, f.deps); assert.equal(f.calls.length, 0);
  await lab.run(); await lab.run(); assert.equal(new Set(f.calls).size, 2); assert.equal(lab.getSnapshot().history.length, 2);
  const remounted = createLabCoordinator(base, f.deps); await remounted.resume(); assert.equal(f.calls[2], `resume:${f.calls[1]}`);
  await remounted.run(); assert.notEqual(f.calls[3], f.calls[0]); assert.notEqual(f.calls[3], f.calls[1]);
});
test('7D-2 lab mock: double taps share one pending Promise and success awaits the durable journal', async () => {
  const f = setup(), gate = deferred<void>(); let finished = false;
  const lab = createLabCoordinator(base, { ...f.deps, journal: { ...f.deps.journal, finish: async (...args) => { await gate.promise; await f.deps.journal.finish(...args); finished = true; } } });
  const a = lab.run(), b = lab.run(); assert.equal(a, b); assert.equal(lab.getSnapshot().status, 'running');
  await Promise.resolve(); await Promise.resolve(); assert.equal(lab.getSnapshot().report, null); assert.equal(finished, false);
  gate.resolve(); await a; assert.equal(f.calls.length, 1); assert.equal(lab.getSnapshot().status, 'complete');
});
test('7D-2 lab mock: failed run is not a resumable checkpoint and a fresh retry uses another ID', async () => {
  const f = setup(); let first = true;
  const lab = createLabCoordinator(base, { ...f.deps, run: async config => { if (first) { first = false; throw Error('INJECTED_RUN_FAILURE'); } return f.deps.run(config); } });
  await lab.run(); assert.equal(lab.getSnapshot().status, 'error'); await lab.resume(); assert.equal(lab.getSnapshot().error, 'NO_COMPLETED_LAB_RUN');
  await lab.run(); assert.equal(lab.getSnapshot().status, 'complete'); assert.equal(f.calls[0], '2'.padStart(32, '0'));
});
test('7D-2 lab mock: a reused run ID is refused before a second suite starts', async () => {
  const f = setup(), lab = createLabCoordinator(base, { ...f.deps, journal: { ...f.deps.journal, begin: async () => 'a'.repeat(32) } });
  await lab.run(); await lab.run(); assert.equal(lab.getSnapshot().error, 'REUSED_RUN_ID'); assert.equal(f.calls.length, 1);
});
