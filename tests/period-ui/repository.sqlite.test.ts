import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateDatabaseV3 } from '../../src/data/budget/migrations-v3';
import { createBudgetRepositoryV3 } from '../../src/data/budget/repository-v3';
import type { StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import { scopeOf } from '../../src/features/periods/contracts';
import { createPeriodFormController } from '../../src/features/periods/form-controller';
import { presentArchive } from '../../src/features/periods/presentation';
import { snapshot } from '../migrations-v3/fixtures';
import { fixture, inject, nextPayday, payday, pid, start } from '../periods-v3/fixtures';
import { databaseFixture } from '../storage/sqlite-helper';
import { fill } from './fixtures';

test('7C real SQLite: new history read returns empty safely and never migrates or invents periods', async t => {
  const db = databaseFixture(t).open(); await migrateDatabaseV3(db); const before = snapshot(db);
  assert.deepEqual(await createBudgetRepositoryV3(db).listClosedPeriods(1), []); assert.deepEqual(snapshot(db), before);
});

test('7C real SQLite: history lists newest first, stays book-scoped and uses frozen closing results', async t => {
  const f = await fixture(t); const b = (await f.repo.startPeriod(start(f.active))).target; if (b.status !== 'active') throw Error('fixture');
  await f.repo.startPeriod(start(b, { operationId: 'b-c', expectedActivationRevision: 2, newPeriodPublicId: pid(3),
    balanceCapturedAt: nextPayday, asOf: nextPayday, nextPayday: '2027-01-04', carryPayments: [] }));
  f.db.db.exec('INSERT INTO budget_books(id,activation_revision) VALUES(2,0)'); const before = snapshot(f.db);
  const rows = await f.repo.listClosedPeriods(1); assert.deepEqual(rows.map(row => row.id), [b.id, f.active.id]);
  assert.equal(rows[0].result.today, '2026-12-04'); assert.equal(rows[1].result.today, '2026-11-04');
  assert.deepEqual(await f.repo.listClosedPeriods(2), []); assert.deepEqual(snapshot(f.db), before);
  const view = presentArchive(rows[1]); assert.equal(view.spent, '₺1,01'); assert.ok(view.expenses.some(row => row.includedInBalance));
  assert.ok(view.expenses.some(row => row.cancelled)); assert.deepEqual(snapshot(f.db), before);
});

test('7C real SQLite: screen controller sends exact TRY values and selected invoice identities to startPeriod', async t => {
  const f = await fixture(t); const controller = createPeriodFormController(f.repo, scopeOf(f.active), () => payday); await controller.load(); fill(controller);
  assert.equal(controller.getSnapshot().preview?.input.balanceSnapshot.amountMinor, 300025); await controller.save();
  const state = controller.getSnapshot(); assert.equal(state.phase, 'success'); assert.equal(state.result?.target.result.remainingBalanceMinor, 300025);
  assert.equal(state.result?.target.result.reservedPaymentsMinor, 200000); assert.equal(state.result?.target.result.spendableMinor, 50025);
  assert.equal(state.result?.target.expenses.length, 0); assert.equal(state.result?.target.payments[0].carriedFrom?.paymentId, 'rent');
  assert.equal(f.db.db.prepare("SELECT count(*) AS n FROM budget_save_operations WHERE kind='period-open'").get()?.n, 1);
});

test('7C real SQLite: delayed old form cannot write to the new active period, even after explicit review', async t => {
  const f = await fixture(t); const controller = createPeriodFormController(f.repo, scopeOf(f.active), () => payday); await controller.load(); fill(controller);
  const other = await f.repo.startPeriod(start(f.active)); const before = snapshot(f.db); await controller.save();
  assert.equal(controller.getSnapshot().phase, 'conflict'); assert.equal(controller.getSnapshot().draft.balance, '3.000,25'); assert.deepEqual(snapshot(f.db), before);
  await controller.reviewChanges(); assert.equal(controller.getSnapshot().review?.source?.id, other.target.id);
  assert.equal(controller.acceptReview(), false); assert.deepEqual(snapshot(f.db), before);
});

test('7C real SQLite: controller preserves one operation through SQL rollback and a later successful retry', async t => {
  const f = await fixture(t); let fail = true; const calls: StartPeriodCommandV3[] = [];
  const repository = createBudgetRepositoryV3(inject(f.db, async sql => {
    if (fail && sql.includes('INSERT INTO budget_payments')) { fail = false; throw Error('Injected SQL failure'); }
  }));
  const controller = createPeriodFormController({ ...repository, startPeriod: async command => { calls.push(command); return repository.startPeriod(command); } }, scopeOf(f.active), () => payday);
  await controller.load(); fill(controller); const before = snapshot(f.db); await controller.save();
  assert.equal(controller.getSnapshot().phase, 'failed'); assert.deepEqual(snapshot(f.db), before);
  await controller.save(); assert.equal(controller.getSnapshot().phase, 'success'); assert.equal(calls[0].operationId, calls[1].operationId);
  assert.equal(calls[0].newPeriodPublicId, calls[1].newPeriodPublicId);
  assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
});

test('7C real SQLite: corrupt archive is surfaced as error rather than skipped, repaired or recalculated as today', async t => {
  const f = await fixture(t); await f.repo.startPeriod(start(f.active)); f.db.db.exec("DROP TRIGGER period_protect_update; UPDATE budget_periods SET calculation_version='unknown-version' WHERE id=1");
  const before = snapshot(f.db); await assert.rejects(f.repo.listClosedPeriods(1), { code: 'UNSUPPORTED' }); assert.deepEqual(snapshot(f.db), before);
});
