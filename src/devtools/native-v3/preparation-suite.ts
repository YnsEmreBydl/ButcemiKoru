import { readV2Evidence, verifyV3Copy } from '../../data/budget/upgrade-evidence';
import { inspectPreparedCopy, prepareV3Copy, type PreparationFiles } from '../../data/budget/upgrade-preparation';
import { createBudgetRepository } from '../../data/budget/repository';
import { createBudgetRepositoryV3 } from '../../data/budget/repository-v3';
import { migrateDatabaseV3 } from '../../data/budget/migrations-v3';
import { createPeriodWorkspace } from '../../features/periods/workspace';
import { scopeOf } from '../../features/periods/contracts';
import { presentArchive } from '../../features/periods/presentation';
import { clock, faultAfter, payday, seedLegacy, snapshot } from './fixtures';
import { runLabSuite } from './suite';
import { ensure, safeError, type LabConfig, type LabConnection, type LabDriver, type LabReport, type LabResult } from './types';

export async function runPreparationSuite(driver: LabDriver, config: LabConfig, progress: (id: string) => void = () => {}): Promise<LabResult[]> {
  const results: LabResult[] = [];
  async function test(id: string, task: (source: LabConnection, before: string) => Promise<void>) {
    progress(id); let source: LabConnection | null = null;
    try {
      source = await driver.open(`${id}-src`); await seedLegacy(source, config.fixtures, 2);
      await source.query.exec('PRAGMA wal_autocheckpoint=0');
      await task(source, await snapshot(source.query)); results.push({ id, status: 'passed' });
    } catch (error) { results.push({ id, status: 'failed', detail: safeError(error) }); }
    finally { if (source) await source.close(); }
  }
  await test('prep-success', async (source, before) => {
    ensure((await source.query.all('PRAGMA journal_mode'))[0]?.journal_mode === 'wal', 'SOURCE_NOT_WAL');
    const result = await prepareV3Copy(source, driver, 'ok', clock);
    ensure(result.status === 'prepared' && !result.activationAllowed, 'PREPARATION_FAILED');
    ensure(result.counts.budget_expenses === 4 && result.counts.budget_save_operations === 1, 'ROW_COUNTS');
    ensure(await inspectPreparedCopy(source, driver, result, clock), 'REOPEN_INSPECTION_FAILED');
    ensure(await snapshot(source.query) === before, 'SOURCE_CHANGED');
  });
  for (const kind of ['missing', 'corrupt', 'write-error'] as const) await test(`prep-${kind}`, async (source, before) => {
    const files: PreparationFiles = { ...driver,
      reopen: async key => {
        if (key === `${kind}-backup` && kind === 'missing') throw Error('MISSING_BACKUP');
        const db = await driver.reopen(key);
        if (key === `${kind}-backup` && kind === 'corrupt') await db.query.run('UPDATE budget_payments SET amount_minor=? WHERE id=?', [200001, 'rent']);
        return db;
      },
      backup: async (from, to) => { if (kind === 'write-error') throw Error('INJECTED_BACKUP_WRITE'); await driver.backup(from, to); },
    };
    const result = await prepareV3Copy(source, files, kind, clock);
    ensure(result.status === 'blocked' && result.recovery === 'source-v2-verified', 'INVALID_BACKUP_ACCEPTED');
    ensure(result.stage === (kind === 'write-error' ? 'backup' : 'verify-backup'), 'WRONG_BLOCK_STAGE');
    ensure(await snapshot(source.query) === before, 'SOURCE_CHANGED');
  });
  await test('prep-bad-restore', async (source, before) => {
    const result = await prepareV3Copy(source, { ...driver, reopen: async key => {
      const db = await driver.reopen(key);
      if (key === 'bad-restore-restore') await db.query.run('UPDATE budget_payments SET amount_minor=? WHERE id=?', [200001, 'rent']);
      return db;
    } }, 'bad-restore', clock);
    ensure(result.status === 'blocked' && result.stage === 'verify-restore', 'INVALID_RESTORE_ACCEPTED');
    ensure(await snapshot(source.query) === before, 'SOURCE_CHANGED');
  });
  await test('prep-source-race', async source => {
    const result = await prepareV3Copy(source, { ...driver, backup: async (from, to) => {
      await driver.backup(from, to);
      // Simulate another writer; preparation must never silently restore an older source over it.
      await source.query.run('UPDATE budget_periods SET revision=revision+? WHERE id=?', [1, 1]);
    } }, 'source-race', clock);
    ensure(result.status === 'blocked' && result.stage === 'source-recheck' && result.recovery === 'manual-review-required', 'CHANGED_SOURCE_ACCEPTED');
    ensure((await source.query.all('SELECT revision FROM budget_periods'))[0]?.revision === 8, 'CONCURRENT_SOURCE_WAS_REVERTED');
    ensure((await source.query.all('PRAGMA user_version'))[0]?.user_version === 2, 'SOURCE_MIGRATED');
  });
  for (const label of ['copy', 'replace', 'guards', 'version'] as const) await test(`prep-rollback-${label}`, async (source, before) => {
    const prefix = `fail-${label}`, marker = label === 'version' ? 'PRAGMA user_version = 3' : `v3:${label}`;
    const result = await prepareV3Copy(source, driver, prefix, clock, db => migrateDatabaseV3(faultAfter(db, sql => sql.includes(marker), async () => { throw Error('INJECTED_MIGRATION'); })));
    ensure(result.status === 'blocked' && result.stage === 'migration' && result.recovery === 'source-v2-verified', 'FAILED_MIGRATION_ACCEPTED');
    const candidate = await driver.reopen(`${prefix}-candidate`);
    try { ensure(JSON.stringify(await readV2Evidence(candidate.database)) === JSON.stringify(await readV2Evidence(source.database)), 'ROLLBACK_DID_NOT_RESTORE_V2'); }
    finally { await candidate.close(); }
    ensure(await snapshot(source.query) === before, 'SOURCE_CHANGED');
  });
  await test('prep-postcommit', async (source, before) => {
    const result = await prepareV3Copy(source, driver, 'ack-lost', clock, async db => { await migrateDatabaseV3(db); throw Error('LOST_ACK'); });
    ensure(result.status === 'blocked' && !result.activationAllowed, 'LOST_ACK_WAS_SUCCESS');
    const candidate = await driver.reopen('ack-lost-candidate');
    try { await verifyV3Copy(candidate.database, await readV2Evidence(source.database), clock); }
    finally { await candidate.close(); }
    ensure(await snapshot(source.query) === before, 'SOURCE_CHANGED');
  });
  await test('prep-partial-open', async (source, before) => {
    const result = await prepareV3Copy(source, driver, 'partial', clock); ensure(result.status === 'prepared', 'SETUP_FAILED');
    const candidate = await driver.reopen(result.candidateKey);
    try { await candidate.query.exec('PRAGMA user_version=2'); } finally { await candidate.close(); }
    ensure(!await inspectPreparedCopy(source, driver, result, clock), 'PARTIAL_VERSION_ACCEPTED');
    ensure(await snapshot(source.query) === before, 'SOURCE_CHANGED');
  });
  await test('prep-v2-still-works', async source => {
    const result = await prepareV3Copy(source, driver, 'v2-works', clock); ensure(result.status === 'prepared', 'SETUP_FAILED');
    const repository = createBudgetRepository(source.database), saved = await repository.load(clock); ensure(saved, 'V2_UNREADABLE');
    ensure(saved.result.spentSinceSnapshotMinor === 101 && saved.expenses.length === 4, 'V2_FINANCIAL_CHANGE');
    const cancelled = await repository.cancelExpense({ operationId: 'v2-after-probe', expectedRevision: saved.revision, periodId: 1, expenseId: 'active-old', cancelledAt: clock, asOf: clock });
    ensure(cancelled.result.spentSinceSnapshotMinor === 0, 'V2_CANCEL_BROKEN');
    ensure(!await inspectPreparedCopy(source, driver, result, clock), 'STALE_SOURCE_ACCEPTED');
  });
  await test('prep-period-ui', async (source, before) => {
    const result = await prepareV3Copy(source, driver, 'ui', clock); ensure(result.status === 'prepared', 'SETUP_FAILED');
    const candidate = await driver.reopen(result.candidateKey);
    try {
      const repository = createBudgetRepositoryV3(candidate.database), active = await repository.loadActivePeriod(1, payday); ensure(active, 'NO_ACTIVE_PERIOD');
      const workspace = createPeriodWorkspace(repository, () => payday, 1), form = workspace.form(scopeOf(active)); await form.load();
      form.change('balance', '3.000,25'); form.change('payday', '04.12.2026'); form.change('savings', '500,00');
      form.changePayment('rent', { selected: true, dueDate: '28.11.2026' }); form.preview(); form.confirm('balanceConfirmed', true); form.confirm('archiveConfirmed', true);
      const first = form.save(), duplicate = form.save(); ensure(first === duplicate, 'DOUBLE_UI_COMMAND'); await first;
      ensure(form.getSnapshot().phase === 'success' && form.getSnapshot().result?.target.result.spendableMinor === 50025, 'UI_SAVE_WRONG');
      const archive = workspace.archive(scopeOf(active)); await archive.refresh(); const closed = archive.getSnapshot().data; ensure(closed, 'ARCHIVE_NOT_LOADED');
      const view = presentArchive(closed); ensure(view.expenses.some(row => row.cancelled), 'CANCELLATION_NOT_PRESENTED');
      const frozen = await snapshot(candidate.query); await archive.refresh(); ensure(await snapshot(candidate.query) === frozen, 'ARCHIVE_WROTE_DATA');
      const remounted = workspace.form(scopeOf(active)); ensure(remounted === form, 'FORM_INTENT_LOST'); await remounted.save();
      ensure(await snapshot(candidate.query) === frozen, 'REMOUNT_CREATED_PERIOD');
    } finally { await candidate.close(); }
    ensure(await snapshot(source.query) === before, 'UI_TOUCHED_V2');
  });
  await driver.closeAll(); return results;
}

export async function runFullLabSuite(driver: LabDriver, config: LabConfig, progress: (id: string) => void = () => {}): Promise<LabReport> {
  const old = await runLabSuite(driver, config, progress), added = await runPreparationSuite(driver, config, progress);
  const results = [...old.results, ...added];
  return { ...old, results, passed: results.filter(row => row.status === 'passed').length, failed: results.filter(row => row.status === 'failed').length };
}
