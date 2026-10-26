import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BudgetStorageError } from '../../src/data/budget/errors';
import type { StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import { scopeOf } from '../../src/features/periods/contracts';
import { createPeriodFormController } from '../../src/features/periods/form-controller';
import { deferred, fill, fixture } from './fixtures';

test('7C controller mock: load, render subscription and preview never allocate IDs or write', async () => {
  const { controller, commands, idRequests } = await fixture(); const unsubscribe = controller.subscribe(() => {});
  fill(controller); assert.ok(controller.getSnapshot().preview); assert.equal(commands.length, 0); assert.equal(idRequests(), 0);
  unsubscribe(); await controller.load(); assert.equal(commands.length, 0);
  controller.change('balance', '4000'); assert.equal(controller.getSnapshot().preview, null); assert.equal(controller.getSnapshot().draft.archiveConfirmed, false);
});

test('7C controller mock: two confirmations are required before ID allocation and submission', async () => {
  const { controller, commands, idRequests } = await fixture(); fill(controller);
  controller.confirm('balanceConfirmed', false); await controller.save();
  assert.equal(commands.length, 0); assert.equal(idRequests(), 0); assert.ok(controller.getSnapshot().errors.confirmation);
  controller.confirm('balanceConfirmed', true); controller.confirm('archiveConfirmed', false); await controller.save(); assert.equal(commands.length, 0);
});

test('7C controller mock: double taps share one Promise, loading precedes IDs and success awaits commit resolution', async () => {
  const f = await fixture(); const ids = deferred<void>(), entered = deferred<void>(), commit = deferred<void>(); let idCalls = 0, success = 0;
  const controller = createPeriodFormController({ ...f.port,
    newPublicId: async () => { idCalls++; await ids.promise; return f.port.newPublicId(); },
    startPeriod: async command => { entered.resolve(); await commit.promise; return f.port.startPeriod(command); },
  }, scopeOf(f.source), f.now, () => { success++; }); await controller.load(); fill(controller);
  const first = controller.save(), second = controller.save(); assert.equal(first, second);
  assert.equal(controller.getSnapshot().phase, 'saving'); assert.equal(controller.getSnapshot().result, null); assert.equal(success, 0);
  controller.change('balance', '999'); assert.equal(controller.getSnapshot().draft.balance, '3.000,25');
  ids.resolve(); await entered.promise; assert.equal(success, 0); assert.equal(controller.getSnapshot().phase, 'saving');
  commit.resolve(); await first; assert.equal(success, 1); assert.equal(idCalls, 3); assert.equal(f.commands.length, 1);
  await controller.save(); assert.equal(f.commands.length, 1);
});

test('7C controller mock: IO failure preserves fields, preview, confirmations and immutable attempt identity', async () => {
  const f = await fixture(); fill(f.controller); const draft = f.controller.getSnapshot().draft, preview = f.controller.getSnapshot().preview;
  f.setScenario('io'); await f.controller.save(); assert.equal(f.controller.getSnapshot().phase, 'failed');
  assert.deepEqual(f.controller.getSnapshot().draft, draft); assert.equal(f.controller.getSnapshot().preview, preview);
  f.controller.change('balance', '1'); assert.deepEqual(f.controller.getSnapshot().draft, draft);
  await f.controller.save(); assert.equal(f.controller.getSnapshot().phase, 'success'); assert.equal(f.commands.length, 2);
  assert.equal(f.commands[0].operationId, f.commands[1].operationId); assert.deepEqual(f.commands[0], f.commands[1]); assert.equal(f.idRequests(), 3);
});

test('7C controller mock: lost post-commit acknowledgement retries the same ID and creates only one target', async () => {
  const f = await fixture(); fill(f.controller); f.setScenario('lost-ack'); await f.controller.save();
  assert.equal(f.controller.getSnapshot().phase, 'failed'); assert.equal(f.controller.getSnapshot().result, null);
  await f.controller.save(); assert.equal(f.controller.getSnapshot().result?.replayed, true);
  assert.equal(f.commands[0].newPeriodPublicId, f.commands[1].newPeriodPublicId);
  assert.equal((await f.port.listClosedPeriods(1)).length, 2); assert.equal(f.idRequests(), 3);
});

test('7C controller mock: failure during ID allocation retains an already allocated operation ID', async () => {
  const f = await fixture(); let calls = 0; const allocated: string[] = [];
  const controller = createPeriodFormController({ ...f.port, newPublicId: async () => {
    if (++calls === 2) throw new BudgetStorageError('IO', 'ID allocation failed');
    const value = await f.port.newPublicId(); allocated.push(value); return value;
  } }, scopeOf(f.source), f.now); await controller.load(); fill(controller);
  await controller.save(); assert.equal(controller.getSnapshot().phase, 'failed'); assert.equal(f.commands.length, 0);
  await controller.save(); assert.equal(f.commands[0].operationId, allocated[0]); assert.equal(calls, 4);
});

test('7C controller mock: CONFLICT does not silently replace source or draft; explicit review resets choices and confirmations', async () => {
  const f = await fixture(); fill(f.controller); const original = f.controller.getSnapshot();
  f.setScenario('conflict'); await f.controller.save(); assert.equal(f.controller.getSnapshot().phase, 'conflict');
  assert.equal(f.controller.getSnapshot().source, original.source); assert.equal(f.controller.getSnapshot().preview, original.preview);
  assert.deepEqual(f.controller.getSnapshot().draft, original.draft); await f.controller.save(); assert.equal(f.commands.length, 1);
  await f.controller.reviewChanges(); assert.equal(f.controller.getSnapshot().source?.revision, original.source?.revision);
  assert.equal(f.controller.getSnapshot().review?.source?.revision, (original.source?.revision ?? 0) + 1);
  assert.equal(f.controller.acceptReview(), true); assert.equal(f.controller.getSnapshot().draft.balance, '3.000,25');
  assert.ok(f.controller.getSnapshot().draft.payments.every(row => !row.selected)); assert.equal(f.controller.getSnapshot().draft.archiveConfirmed, false);
  assert.equal(f.controller.getSnapshot().preview, null); await f.controller.save(); assert.equal(f.commands.length, 1);
  fill(f.controller); await f.controller.save(); assert.equal(f.controller.getSnapshot().phase, 'success');
  assert.notEqual(f.commands[0].operationId, f.commands[1].operationId); assert.equal(f.commands[1].expectedSourceRevision, 4);
});

test('7C controller mock: invalidated period on load never silently binds a stale route to the new active period', async () => {
  const f = await fixture(); fill(f.controller); await f.controller.save();
  const old = createPeriodFormController(f.port, scopeOf(f.source), f.now); await old.load();
  assert.equal(old.getSnapshot().phase, 'conflict'); assert.equal(old.getSnapshot().source, null); assert.equal(old.getSnapshot().draft.balance, '');
  await old.reviewChanges(); assert.equal(old.acceptReview(), false); assert.equal(f.commands.length, 1);
});

test('7C controller mock: delayed original command keeps its source identity after a period change', async () => {
  const f = await fixture(); fill(f.controller);
  const other = createPeriodFormController(f.port, scopeOf(f.source), f.now); await other.load(); fill(other); await other.save();
  await f.controller.save(); assert.equal(f.controller.getSnapshot().phase, 'conflict');
  const delayed: StartPeriodCommandV3 = f.commands[f.commands.length - 1]; assert.equal(delayed.sourcePeriodId, f.source.id);
  await f.controller.reviewChanges(); assert.equal(f.controller.acceptReview(), false); assert.equal(f.controller.getSnapshot().draft.balance, '3.000,25');
});

test('7C controller mock: failed async source load can be retried without creating a command', async () => {
  const f = await fixture(); let reads = 0;
  const controller = createPeriodFormController({ ...f.port, loadActivePeriod: async (...args) => {
    if (++reads === 1) throw new BudgetStorageError('IO', 'Örnek okuma hatası'); return f.port.loadActivePeriod(...args);
  } }, scopeOf(f.source), f.now);
  const first = controller.load(); assert.equal(controller.getSnapshot().loading, true); assert.equal(controller.load(), first); await first;
  assert.equal(controller.getSnapshot().loaded, false); assert.ok(controller.getSnapshot().message);
  await controller.load(); assert.equal(controller.getSnapshot().loaded, true); assert.equal(controller.getSnapshot().draft.balance, '');
  assert.equal(f.commands.length, 0);
});

test('7C controller mock: an old focus read arriving after commit cannot downgrade successful UI state', async () => {
  const f = await fixture(); let hold = false; const gate = deferred<ReturnType<typeof f.port.loadActivePeriod> extends Promise<infer T> ? T : never>();
  const controller = createPeriodFormController({ ...f.port, loadActivePeriod: async (...args) => hold ? gate.promise : f.port.loadActivePeriod(...args) }, scopeOf(f.source), f.now);
  await controller.load(); fill(controller); hold = true; const checking = controller.checkFreshness(); await controller.save();
  assert.equal(controller.getSnapshot().phase, 'success'); gate.resolve({ ...f.source, revision: 99 }); await checking;
  assert.equal(controller.getSnapshot().phase, 'success'); assert.equal(f.commands.length, 1);
});
