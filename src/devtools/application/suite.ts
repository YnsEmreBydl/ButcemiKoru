import type { AtomicDatabase, SqlSession } from '../../data/budget/contracts';
import type { RuntimeStore } from '../../data/budget/application-contracts';
import { createApplicationRuntime } from '../../data/budget/application-runtime';
import { readRuntimeEntry } from '../../data/budget/runtime-catalog';
import { migrateDatabaseV3 } from '../../data/budget/migrations-v3';
import { prepareExpense } from '../../features/expenses/adapter';
import { prepareBudgetSave, savedBudgetToDraft } from '../../features/budget-setup/persistence';
import { createPeriodWorkspace } from '../../features/periods/workspace';
import { scopeOf } from '../../features/periods/contracts';
import { clock, payday, snapshot } from '../native-v3/fixtures';
import { ensure, safeError, type LabResult } from '../native-v3/types';

export interface ApplicationTestHarness {
  store(caseId: string): Promise<RuntimeStore>;
  closeCase(caseId: string): Promise<void>;
}
function latch() { let release: () => void = () => {}; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function rejects(task: () => Promise<unknown>, code?: string) {
  try { await task(); } catch (error) {
    if (code) ensure(typeof error === 'object' && error !== null && 'code' in error && error.code === code, 'WRONG_REJECTION'); return;
  }
  throw Error('EXPECTED_REJECTION');
}
export async function runApplicationSuite(h: ApplicationTestHarness, progress: (id: string) => void = () => {}) {
  const results: LabResult[] = [];
  async function test(id: string, task: (factory: () => Promise<RuntimeStore>) => Promise<void>) {
    progress(id);
    try { await task(() => h.store(id)); results.push({ id, status: 'passed' }); }
    catch (error) { results.push({ id, status: 'failed', detail: safeError(error) }); }
    finally { await h.closeCase(id); }
  }
  await test('app-startup-persistence', async store => {
    let count = 0; const create = () => createApplicationRuntime({ store, allowV3: true, autoUpgrade: true, now: () => clock,
      migrate: async db => { count++; await migrateDatabaseV3(db); } });
    const files = await store(), before = await snapshot(files.source.query), app = create(); await app.initialize();
    const loaded = await app.load(clock); ensure(loaded?.expenses.length === 4 && loaded.result.spentSinceSnapshotMinor === 101, 'HISTORY_CHANGED');
    ensure(loaded.access.schema === 3, 'NOT_V3'); ensure(await snapshot(files.source.query) === before, 'SOURCE_MUTATED');
    await app.close(); const reopened = create(); await reopened.initialize(); ensure(count === 1 && (await reopened.open(clock)).access.schema === 3, 'MIGRATED_TWICE');
    await reopened.close();
  });
  await test('app-fence-concurrent-handles', async store => {
    const entered = latch(), release = latch();
    const a = createApplicationRuntime({ store, allowV3: true, now: () => clock, migrate: async db => { entered.release(); await release.promise; await migrateDatabaseV3(db); } });
    const b = createApplicationRuntime({ store, allowV3: true, now: () => clock }); await a.initialize(); await b.initialize();
    const old = await b.open(clock); ensure(old.saved, 'NO_BUDGET'); const files = await store(), before = await snapshot(files.source.query);
    const pending = a.upgrade(); await entered.promise;
    try { await rejects(() => a.newOperationId(), 'MIGRATION'); await rejects(() => b.newOperationId(), 'MIGRATION'); }
    finally { release.release(); }
    await pending; ensure(await snapshot(files.source.query) === before, 'CONCURRENT_WRITE');
    const prepared = prepareBudgetSave(savedBudgetToDraft(old.saved), { asOf: clock, timeZone: 'Europe/Istanbul' }, old.saved, 'a'.repeat(32));
    ensure(prepared.status === 'ready', 'INVALID_FIXTURE');
    await rejects(() => b.save({ ...prepared.command, access: old.access }), 'CONFLICT');
    await rejects(() => b.save(prepared.command), 'CONFLICT'); await a.close(); await b.close();
  });
  await test('app-inflight-drained', async store => {
    const entered = latch(), release = latch(); let hold = true;
    const guardedStore = async () => {
      const files = await store(); const source = { ...files.source, database: {
        transaction: <T>(task: (tx: SqlSession) => Promise<T>) => files.source.database.transaction(tx => task({ ...tx,
          run: async (sql, args) => { const result = await tx.run(sql, args); if (hold && sql.includes('INSERT INTO budget_expenses')) { hold = false; entered.release(); await release.promise; } return result; },
        })),
      } }; return { ...files, source, backup: (a: Parameters<RuntimeStore['backup']>[0], b: Parameters<RuntimeStore['backup']>[1]) => files.backup(a === source ? files.source : a, b === source ? files.source : b) };
    };
    const app = createApplicationRuntime({ store: guardedStore, allowV3: true, now: () => clock }); await app.initialize();
    const session = await app.open(clock); ensure(session.saved, 'NO_BUDGET'); const id = await app.newOperationId();
    const operation = app.addExpense({ access: session.access, operationId: id, periodId: 1, expectedRevision: session.saved.revision, asOf: clock,
      expense: { id, category: 'market', amountMinor: 25001, description: '', occurredAt: clock, createdAt: clock } });
    await entered.promise; const upgrade = app.upgrade(); ensure(app.getSnapshot().phase === 'upgrading', 'NO_UI_FENCE'); release.release();
    await operation; await upgrade; ensure((await app.load(clock))?.result.spentSinceSnapshotMinor === 25102, 'INFLIGHT_WRITE_LOST'); await app.close();
  });
  for (const failure of ['bad-backup','migration','before-activation','lost-commit-ack'] as const) await test(`app-${failure}`, async store => {
    let armed = true, migrations = 0;
    const faultStore = async () => {
      const files = await store();
      const catalog: AtomicDatabase = { transaction: async task => {
        let activating = false;
        const value = await files.catalog.transaction(tx => task({ ...tx, run: async (sql, args) => {
          const result = await tx.run(sql, args);
          if (armed && sql.includes('schema_version=3')) { activating = true; if (failure === 'before-activation') { armed = false; throw Error('INJECTED_ACTIVATION'); } }
          return result;
        } }));
        if (armed && activating && failure === 'lost-commit-ack') { armed = false; throw Error('LOST_CATALOG_ACK'); }
        return value;
      } };
      return { ...files, catalog, backup: async (from: Parameters<RuntimeStore['backup']>[0], to: Parameters<RuntimeStore['backup']>[1]) => {
        await files.backup(from, to);
        if (failure === 'bad-backup' && armed) { armed = false; await to.query.run('UPDATE budget_payments SET amount_minor=? WHERE id=?', [200001, 'rent']); }
      } };
    };
    const files = await store(), before = await snapshot(files.source.query);
    const app = createApplicationRuntime({ store: faultStore, allowV3: true, autoUpgrade: true, now: () => clock, migrate: async db => {
      migrations++; if (failure === 'migration') throw Error('INJECTED_MIGRATION'); await migrateDatabaseV3(db);
    } });
    await rejects(() => app.initialize()); ensure(app.getSnapshot().phase === 'blocked', 'FALSE_SUCCESS'); ensure(await snapshot(files.source.query) === before, 'SOURCE_MUTATED');
    await app.close(); const reopened = createApplicationRuntime({ store, allowV3: true, autoUpgrade: true, now: () => clock }); await reopened.initialize();
    ensure(reopened.getSnapshot().schema === (failure === 'lost-commit-ack' ? 3 : 2), 'WRONG_RECOVERY_SCHEMA');
    ensure(await snapshot(files.source.query) === before, 'RECOVERY_OVERWROTE_SOURCE'); ensure(migrations <= 1, 'MIGRATION_REPLAYED'); await reopened.close();
  });
  await test('app-forms-expenses-archive', async store => {
    let now = clock; const app = createApplicationRuntime({ store, allowV3: true, autoUpgrade: true, now: () => now }); await app.initialize();
    const initial = await app.open(now); ensure(initial.saved, 'NO_BUDGET'); const id = await app.newOperationId();
    const expense = prepareExpense({ amount: '250,01', category: 'market', description: 'Synthetic' }, initial.saved, { operationId: id, asOf: now, createdAt: now, occurredAt: now });
    ensure(expense.status === 'ready', 'EXPENSE_FORM_INVALID'); const command = { ...expense.command, access: initial.access };
    const saved = await app.addExpense(command); ensure((await app.addExpense(command)).revision === saved.revision, 'DUPLICATE_EXPENSE');
    const cancel = { operationId: await app.newOperationId(), access: saved.access, expensePublicId: saved.expensePublicIds[id],
      periodId: saved.access.period?.id ?? 0, expectedRevision: saved.revision, expenseId: id, asOf: now, cancelledAt: now };
    const cancelled = await app.cancelExpense(cancel); ensure((await app.cancelExpense(cancel)).revision === cancelled.revision, 'DUPLICATE_CANCEL');
    await rejects(() => app.addExpense({ ...command, operationId: 'b'.repeat(32), expense: { ...command.expense, id: 'stale' } }), 'CONFLICT');
    now = payday; const workspace = createPeriodWorkspace(await app.periods(), () => now, 1, 'saved'); await workspace.active.refresh();
    const source = workspace.active.getSnapshot().data?.period; ensure(source, 'NO_SOURCE'); const form = workspace.form(scopeOf(source)); await form.load();
    form.change('balance', '3.000,25'); form.change('payday', '04.12.2026'); form.change('savings', '500,00'); form.changePayment('rent', { selected: true, dueDate: '28.11.2026' });
    form.preview(); form.confirm('balanceConfirmed', true); form.confirm('archiveConfirmed', true); const first = form.save(), second = form.save(); ensure(first === second, 'DOUBLE_START'); await first;
    ensure(form.getSnapshot().phase === 'success', 'PERIOD_FORM_FAILED'); const active = await app.load(now);
    ensure(active?.result.spendableMinor === 50025 && active.expenses.length === 0, 'OLD_EXPENSES_REDEBITED');
    await rejects(() => app.addExpense({ ...command, operationId: 'c'.repeat(32), asOf: now }), 'CONFLICT');
    const archive = workspace.archive(scopeOf(source)); await archive.refresh(); const closed = archive.getSnapshot().data; ensure(closed?.expenses.some(row => row.id === id && row.status === 'cancelled'), 'ARCHIVE_LOST');
    const files = await store(), pointer = await files.catalog.transaction(readRuntimeEntry), candidate = await files.reopen(pointer.activeKey), frozen = await snapshot(candidate.query);
    await archive.refresh(); ensure(await snapshot(candidate.query) === frozen, 'ARCHIVE_WRITES'); await candidate.close(); await app.close();
  });
  await test('app-policy-closed', async store => {
    const app = createApplicationRuntime({ store, allowV3: false, now: () => clock }); await app.initialize(); await rejects(() => app.upgrade(), 'UNSUPPORTED');
    const session = await app.open(clock); ensure(session.access.schema === 2 && session.saved, 'PRODUCTION_ENABLED');
    const prepared = prepareBudgetSave({ ...savedBudgetToDraft(session.saved), savings: '1.000,01' },
      { asOf: clock, timeZone: 'Europe/Istanbul' }, session.saved, await app.newOperationId());
    ensure(prepared.status === 'ready', 'V2_SETTINGS_INVALID');
    const settings = { ...prepared.command, access: session.access }, updated = await app.save(settings);
    ensure(updated.input.savingsTargetMinor === 100001 && updated.result.spentSinceSnapshotMinor === 101, 'V2_SETTINGS_CHANGED');
    ensure((await app.save(settings)).revision === updated.revision, 'V2_SETTINGS_REPLAY');
    const expenseId = await app.newOperationId(), expense = prepareExpense({ amount: '100,01', category: 'market', description: 'Synthetic v2' }, updated,
      { operationId: expenseId, asOf: clock, createdAt: clock, occurredAt: clock });
    ensure(expense.status === 'ready', 'V2_EXPENSE_INVALID');
    const command = { ...expense.command, access: updated.access }, spent = await app.addExpense(command);
    ensure(spent.result.spentSinceSnapshotMinor === 10102 && (await app.addExpense(command)).revision === spent.revision, 'V2_EXPENSE_CHANGED');
    const cancellation = { operationId: await app.newOperationId(), access: spent.access, periodId: 1, expectedRevision: spent.revision,
      expenseId, asOf: clock, cancelledAt: clock };
    const cancelled = await app.cancelExpense(cancellation);
    ensure(cancelled.result.spentSinceSnapshotMinor === 101 && (await app.cancelExpense(cancellation)).revision === cancelled.revision, 'V2_CANCEL_CHANGED');
    await rejects(() => app.periods(), 'MIGRATION'); await app.close();
    const reopened = createApplicationRuntime({ store, allowV3: false, now: () => clock }); await reopened.initialize();
    const persisted = await reopened.load(clock);
    ensure(persisted?.access.schema === 2 && persisted.input.savingsTargetMinor === 100001 && persisted.expenses.some(row => row.id === expenseId && row.status === 'cancelled'), 'V2_PERSISTENCE_CHANGED');
    await reopened.close();
  });
  await test('app-unknown-schema', async store => {
    const files = await store(); await files.source.query.exec('PRAGMA user_version=99'); const before = await snapshot(files.source.query);
    const app = createApplicationRuntime({ store, allowV3: true, now: () => clock }); await rejects(() => app.initialize(), 'MIGRATION');
    ensure(await snapshot(files.source.query) === before, 'UNKNOWN_SCHEMA_RESET'); await app.close();
  });
  return { results, passed: results.filter(row => row.status === 'passed').length, failed: results.filter(row => row.status === 'failed').length };
}
