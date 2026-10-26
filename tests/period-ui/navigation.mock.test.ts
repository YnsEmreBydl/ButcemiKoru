import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePeriodScope, previewEnabled, scopeOf } from '../../src/features/periods/contracts';
import { presentArchive } from '../../src/features/periods/presentation';
import { createResource } from '../../src/features/periods/resource';
import { createPeriodWorkspace } from '../../src/features/periods/workspace';
import { deferred, fill, fixture } from './fixtures';

test('7C navigation mock: route identity is strict and development gate is closed in production', () => {
  const valid = { bookId: '1', periodId: '2', publicId: '00000000000000000000000000000002' };
  assert.deepEqual(parsePeriodScope(valid), { bookId: 1, periodId: 2, periodPublicId: valid.publicId });
  for (const patch of [{ bookId: '0' }, { periodId: '-1' }, { periodId: '1.5' }, { periodId: '1e3' }, { periodId: '02' },
    { periodId: '9007199254740992' }, { publicId: 'BAD' }, { bookId: ['1', '2'] }, { publicId: [valid.publicId] }]) {
    assert.equal(parsePeriodScope({ ...valid, ...patch }), null);
  }
  assert.equal(parsePeriodScope({}), null); assert.equal(previewEnabled(false), false); assert.equal(previewEnabled(true), true);
});

test('7C navigation mock: back/remount returns the same pending form and never creates a second command', async () => {
  const f = await fixture(); const entered = deferred<void>(), release = deferred<void>();
  const workspace = createPeriodWorkspace({ ...f.port, startPeriod: async command => { entered.resolve(); await release.promise; return f.port.startPeriod(command); } }, f.now, 1);
  const first = workspace.form(scopeOf(f.source)); await first.load(); fill(first);
  const unsubscribe = first.subscribe(() => {}), saving = first.save(); await entered.promise; unsubscribe();
  const remounted = workspace.form(scopeOf(f.source)); assert.equal(remounted, first); await remounted.load();
  assert.equal(remounted.getSnapshot().phase, 'saving'); assert.equal(remounted.getSnapshot().draft.balance, '3.000,25');
  assert.equal(remounted.save(), saving); release.resolve(); await saving; assert.equal(f.commands.length, 1);
  await remounted.load(); await remounted.save(); assert.equal(f.commands.length, 1);
});

test('7C navigation mock: a focus refresh flags period changes without moving old fields into a new form', async () => {
  const f = await fixture(), workspace = createPeriodWorkspace(f.port, f.now, 1);
  const old = workspace.form(scopeOf(f.source)); await old.load(); old.change('balance', '123,45');
  fill(f.controller); await f.controller.save(); await old.checkFreshness();
  assert.equal(old.getSnapshot().phase, 'conflict'); assert.equal(old.getSnapshot().draft.balance, '123,45');
  const active = await f.port.loadActivePeriod(1, f.now()); if (!active) throw Error('fixture');
  const fresh = workspace.form(scopeOf(active)); await fresh.load(); assert.notEqual(fresh, old); assert.equal(fresh.getSnapshot().draft.balance, '');
  assert.equal(workspace.form(scopeOf(f.source)), old); assert.equal(f.commands.length, 1);
});

test('7C navigation mock: late read response cannot overwrite a more recent refresh', async () => {
  const first = deferred<string[]>(), second = deferred<string[]>(); let call = 0;
  const resource = createResource(() => (++call === 1 ? first.promise : second.promise), () => 'Read failed');
  const a = resource.refresh(), b = resource.refresh(); second.resolve(['new']); await b;
  first.resolve(['old']); await a; assert.deepEqual(resource.getSnapshot().data, ['new']); assert.equal(resource.getSnapshot().status, 'ready');
});

test('7C navigation mock: failed read keeps the previous data and empty archive is a ready state', async () => {
  let fail = false;
  const resource = createResource(async () => { if (fail) throw Error('read'); return []; }, () => 'Arşiv okunamadı');
  await resource.refresh(); assert.equal(resource.getSnapshot().status, 'ready'); assert.deepEqual(resource.getSnapshot().data, []);
  fail = true; await resource.refresh(); assert.equal(resource.getSnapshot().status, 'error'); assert.deepEqual(resource.getSnapshot().data, []);
  assert.equal(resource.getSnapshot().error, 'Arşiv okunamadı');
});

test('7C navigation mock: archive resources are period-scoped, clock-free and read-only', async () => {
  const f = await fixture(); fill(f.controller); await f.controller.save();
  const closed = await f.port.listClosedPeriods(1), current = await f.port.loadActivePeriod(1, f.now()); if (!current) throw Error('fixture');
  let writes = 0; const workspace = createPeriodWorkspace({ ...f.port, startPeriod: async () => { writes++; throw Error('Unexpected write'); } }, () => '2040-01-01T00:00:00.000Z', 1);
  const a = workspace.archive(scopeOf(closed[0])), b = workspace.archive(scopeOf(closed[1])); assert.notEqual(a, b);
  assert.equal(workspace.archive(scopeOf(closed[0])), a); await Promise.all([a.refresh(), b.refresh(), workspace.history.refresh()]);
  assert.equal(a.getSnapshot().data?.id, closed[0].id); assert.equal(b.getSnapshot().data?.id, closed[1].id); assert.equal(writes, 0);
  const model = presentArchive(closed[0]); assert.equal(model.spent, '₺1.000,00');
  assert.equal(model.expenses[0].id, 'fixture-expense-4');
  assert.ok(model.expenses.some(expense => expense.cancelled && expense.cancelledAt));
  assert.equal(closed[0].result.today, '2026-11-04'); assert.ok(Object.isFrozen(closed[0]));
  assert.deepEqual(presentArchive(closed[0]), model); assert.equal(current.status, 'active');
});
