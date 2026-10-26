import { createBudgetRepositoryV3 } from '../../data/budget/repository-v3';
import { migrateDatabaseV3 } from '../../data/budget/migrations-v3';
import { checkV3Integrity } from '../../data/budget/integrity-v3';
import { isRecord } from '../../data/budget/v3-validation';
import { clock, faultAfter, nextPayday, oldData, payday, prepare, publicId, seedLegacy, snapshot, start } from './fixtures';
import { ensure, safeError, type LabConfig, type LabConnection, type LabDriver, type LabReport, type LabResult } from './types';

async function rejects(action: () => Promise<unknown>, code?: string): Promise<void> {
  let rejected = false;
  try { await action(); } catch (error) { rejected = true; if (code) ensure(isRecord(error) && error.code === code, 'WRONG_ERROR_CODE'); }
  ensure(rejected, 'EXPECTED_REJECTION');
}
const scope = (period: { id: number; bookId: number; publicId: string }) => ({ bookId: period.bookId, periodId: period.id, periodPublicId: period.publicId });

/** Same scenario code can run with Node or the actual Expo native driver. Runtime is reported separately. */
export async function runLabSuite(driver: LabDriver, config: LabConfig, progress: (id: string) => void = () => {}): Promise<LabReport> {
  const results: LabResult[] = []; let sqliteVersion: string | null = null;
  async function test(id: string, task: () => Promise<void>) {
    progress(id);
    try { await task(); results.push({ id, status: 'passed' }); }
    catch (error) { results.push({ id, status: 'failed', detail: safeError(error) }); }
  }
  async function withFile(key: string, task: (connection: LabConnection) => Promise<void>) {
    const connection = await driver.open(key); try { await task(connection); } finally { await connection.close(); }
  }
  await test('empty-to-v3-repeat-and-reopen', () => withFile('empty', async db => {
    const version = (await db.query.all('SELECT sqlite_version() AS v'))[0]?.v;
    ensure(typeof version === 'string', 'MISSING_SQLITE_VERSION'); sqliteVersion = version;
    await migrateDatabaseV3(db.database); ensure((await db.query.all('PRAGMA user_version'))[0]?.user_version === 3, 'SCHEMA_VERSION');
    const before = await snapshot(db.query); await migrateDatabaseV3(db.database); ensure(await snapshot(db.query) === before, 'REPEATED_MIGRATION_CHANGED_DATA');
    await db.close(); const reopened = await driver.reopen('empty');
    try { await migrateDatabaseV3(reopened.database); ensure(await snapshot(reopened.query) === before, 'REOPEN_CHANGED_DATA'); } finally { await reopened.close(); }
  }));
  for (const version of [1,2] as const) await test(`v${version}-to-v3-all-identities-and-receipts`, () => withFile(`legacy-${version}`, async db => {
    await seedLegacy(db,config.fixtures,version); const before = await oldData(db.query,version);
    await migrateDatabaseV3(db.database); ensure(await oldData(db.query,2) === before, 'LEGACY_DATA_CHANGED');
    const state = await snapshot(db.query); await db.close(); const reopened = await driver.reopen(`legacy-${version}`);
    try { await migrateDatabaseV3(reopened.database); ensure(await snapshot(reopened.query) === state, 'LEGACY_REOPEN_CHANGED');
      const saved = await createBudgetRepositoryV3(reopened.database).loadActivePeriod(1,clock); ensure(saved, 'MISSING_BUDGET');
      ensure(saved.result.spentSinceSnapshotMinor === (version === 2 ? 101 : 0), 'DOUBLE_DEBIT');
      ensure(saved.expenses.length === (version === 2 ? 4 : 0), 'EXPENSE_HISTORY_LOST');
      if (version === 2) ensure(saved.expenses.some(row=>row.id==='cancelled-old' && row.status==='cancelled'), 'CANCELLATION_LOST');
    } finally { await reopened.close(); }
  }));
  for (const version of [1,2] as const) for (const [label, marker] of [
    ['copy','v3:copy'],['replace','v3:replace'],['guards','v3:guards'],['version','PRAGMA user_version = 3'],
  ] as const) await test(`v${version}-migration-rollback-${label}`, () => withFile(`rollback-${version}-${label}`, async db => {
    await seedLegacy(db,config.fixtures,version); const before=await snapshot(db.query);
    const injected=faultAfter(db.database,sql=>sql.includes(marker),async()=>{throw Error('INJECTED_MIGRATION');});
    await rejects(()=>migrateDatabaseV3(injected)); ensure(await snapshot(db.query)===before,'MIGRATION_NOT_ROLLED_BACK');
    await db.close(); const reopened=await driver.reopen(`rollback-${version}-${label}`);
    try { ensure(await snapshot(reopened.query)===before,'FAILED_MIGRATION_REOPEN_CHANGED'); await migrateDatabaseV3(reopened.database); }
    finally { await reopened.close(); }
  }));
  await test('a-b-c-replay-isolation-and-selected-bills', () => withFile('lifecycle', async db => {
    const {repository,source}=await prepare(db,config); const command=start(source), ab=await repository.startPeriod(command);
    ensure(ab.target.result.remainingBalanceMinor===300000 && ab.target.result.spentSinceSnapshotMinor===0,'OLD_EXPENSES_REDEBITED');
    ensure(ab.target.payments.length===1 && ab.target.payments[0].carriedFrom?.paymentId==='rent' && ab.source.payments.length===2,'BILL_COPY_INCORRECT');
    ensure(ab.target.result.spendableMinor===50000,'NEW_BUDGET_WRONG'); ensure(ab.target.status==='active','B_NOT_ACTIVE');
    const archive=JSON.stringify(await repository.loadClosedPeriod(scope(source)));
    const b=await repository.addExpense({...scope(ab.target),operationId:'b-expense-op',expectedRevision:1,expectedActivationRevision:2,expensePublicId:publicId(300),
      asOf:'2026-11-05T09:00:00.000Z',expense:{id:'b-expense',amountMinor:10000,category:'market',description:'Synthetic',occurredAt:'2026-11-05T08:00:00.000Z',createdAt:'2026-11-05T09:00:00.000Z'}});
    ensure(b.status==='active','B_CLOSED_EARLY');
    const bc=await repository.startPeriod(start(b,{operationId:'b-c',expectedActivationRevision:2,newPeriodPublicId:publicId(101),
      availableBalanceMinor:450000,balanceCapturedAt:nextPayday,asOf:nextPayday,nextPayday:'2027-01-04',savingsTargetMinor:0,carryPayments:[]}));
    ensure(bc.target.result.remainingBalanceMinor===450000 && bc.target.expenses.length===0,'C_REDEBITED');
    const before=await snapshot(db.query), replay=await repository.startPeriod(command);
    ensure(replay.replayed && replay.target.id===ab.target.id && replay.target.status==='closed','WRONG_REPLAY_TARGET');
    ensure(await snapshot(db.query)===before,'OLD_REPLAY_MUTATED_C');
    ensure(JSON.stringify(await repository.loadClosedPeriod(scope(source)))===archive,'A_ARCHIVE_CHANGED');
    await rejects(()=>repository.addExpense({...scope(source),operationId:'closed-expense',expectedRevision:ab.source.revision,expectedActivationRevision:3,
      expensePublicId:publicId(301),asOf:nextPayday,expense:{id:'wrong-period',amountMinor:1,category:'other',description:'',occurredAt:payday,createdAt:payday}}),'CONFLICT');
    ensure(await snapshot(db.query)===before,'CLOSED_WRITE_CHANGED_DATA');
    await db.close();const reopened=await driver.reopen('lifecycle');
    try{ensure(await snapshot(reopened.query)===before,'LIFECYCLE_REOPEN_CHANGED');await migrateDatabaseV3(reopened.database);
      await reopened.query.exec('CREATE TABLE gb_lab_resume_marker(execution_id TEXT NOT NULL) STRICT');
      await reopened.query.run('INSERT INTO gb_lab_resume_marker(execution_id) VALUES(?)',[config.executionId ?? 'node-suite']);
    }finally{await reopened.close();}
  }));
  await test('revision-conflict-and-transaction-failure',()=>withFile('repository-rollback',async db=>{
    const{repository,source}=await prepare(db,config),before=await snapshot(db.query);
    await rejects(()=>repository.startPeriod(start(source,{expectedSourceRevision:4})),'CONFLICT');
    const broken=createBudgetRepositoryV3(faultAfter(db.database,sql=>sql.includes('INSERT INTO budget_save_operations'),async()=>{throw Error('INJECTED_RECEIPT');}));
    await rejects(()=>broken.startPeriod(start(source)));ensure(await snapshot(db.query)===before,'REPOSITORY_NOT_ROLLED_BACK');
    await repository.startPeriod(start(source));
  }));
  await test('two-independent-connections-start-race',()=>withFile('race',async db=>{
    const{repository,source}=await prepare(db,config),second=await driver.reopen('race');
    try{const competitor=createBudgetRepositoryV3(second.database); const results=await Promise.allSettled([
      repository.startPeriod(start(source)),competitor.startPeriod(start(source,{operationId:'competitor',newPeriodPublicId:publicId(102)}))]);
      ensure(results.filter(row=>row.status==='fulfilled').length===1,'TWO_START_WINNERS');
      const failure=results.find(row=>row.status==='rejected');ensure(failure?.status==='rejected'&&isRecord(failure.reason)&&failure.reason.code==='CONFLICT','RACE_WRONG_ERROR');
      ensure((await db.query.all("SELECT count(*) AS n FROM budget_periods WHERE status='active'"))[0]?.n===1,'TWO_ACTIVE_PERIODS');
      ensure((await db.query.all("SELECT count(*) AS n FROM budget_save_operations WHERE kind='period-open'"))[0]?.n===1,'DUPLICATE_RECEIPT');
    }finally{await second.close();}
  }));
  await test('readonly-write-error-rollback-and-retry',()=>withFile('readonly',async db=>{
    const{source}=await prepare(db,config),before=await snapshot(db.query);let observed=false;
    const readonly={transaction:<T>(task:Parameters<typeof db.database.transaction<T>>[0])=>db.database.transaction(async tx=>{
      await tx.exec('PRAGMA query_only=ON');
      try{return await task({...tx,run:async(sql,params)=>{try{return await tx.run(sql,params);}catch(error){observed=isRecord(error)&&typeof error.message==='string'&&/readonly|read-only|SQLITE_READONLY/i.test(error.message);throw error;}}});}
      finally{await tx.exec('PRAGMA query_only=OFF');}
    })};
    await rejects(()=>createBudgetRepositoryV3(readonly).startPeriod(start(source)));
    ensure(observed,'READONLY_ERROR_NOT_OBSERVED');ensure(await snapshot(db.query)===before,'READONLY_MUTATED_DATA');
    await createBudgetRepositoryV3(db.database).startPeriod(start(source));
  }));
  await test('bounded-sqlite-full-rolls-back-financial-write',()=>withFile('disk-full',async db=>{
    const{source}=await prepare(db,config);await db.query.exec('CREATE TABLE gb_lab_pressure(payload BLOB) STRICT');const before=await snapshot(db.query);let full=false;
    const broken=faultAfter(db.database,sql=>sql.includes("UPDATE budget_periods SET status='closed'"),async tx=>{
      const pages=(await tx.all('PRAGMA page_count'))[0]?.page_count,limit=(await tx.all('PRAGMA max_page_count'))[0]?.max_page_count;
      ensure(typeof pages==='number'&&Number.isSafeInteger(pages)&&typeof limit==='number'&&Number.isSafeInteger(limit),'INVALID_PAGE_LIMIT');
      try{await tx.exec(`PRAGMA max_page_count=${pages+1}`);await tx.run('INSERT INTO gb_lab_pressure(payload) VALUES(zeroblob(?))',[1048576]);}
      catch(error){full=isRecord(error)&&typeof error.message==='string'&&/database or disk is full|SQLITE_FULL/i.test(error.message);throw error;}
      finally{await tx.exec(`PRAGMA max_page_count=${limit}`);}
    });
    await rejects(()=>createBudgetRepositoryV3(broken).startPeriod(start(source)));ensure(full,'SQLITE_FULL_NOT_OBSERVED');
    ensure(await snapshot(db.query)===before,'FULL_ERROR_MUTATED_DATA');await createBudgetRepositoryV3(db.database).startPeriod(start(source));
  }));
  await test('close-with-uncommitted-transaction-and-reopen',()=>withFile('connection-loss',async db=>{
    await prepare(db,config);const before=await snapshot(db.query);
    await db.query.exec('BEGIN IMMEDIATE');await db.query.run('UPDATE budget_periods SET revision=? WHERE id=?',[99,1]);await db.close();
    await rejects(()=>db.query.all('SELECT 1'));
    const reopened=await driver.reopen('connection-loss');try{ensure(await snapshot(reopened.query)===before,'CLOSE_DID_NOT_ROLL_BACK');await migrateDatabaseV3(reopened.database);}finally{await reopened.close();}
  }));
  await test('wal-online-backup-restore-and-reopen',()=>withFile('wal-source',async sourceDb=>{
    const{repository,source}=await prepare(sourceDb,config);await sourceDb.query.exec('PRAGMA wal_autocheckpoint=0');
    await repository.startPeriod(start(source));ensure((await sourceDb.query.all('PRAGMA journal_mode'))[0]?.journal_mode==='wal','WAL_NOT_ENABLED');
    const before=await snapshot(sourceDb.query),backup=await driver.open('wal-backup'),restore=await driver.open('wal-restored');
    try{await driver.backup(sourceDb,backup);ensure(await snapshot(backup.query)===before,'BACKUP_INCONSISTENT');
      await sourceDb.query.exec('CREATE TABLE gb_lab_after_backup(id INTEGER PRIMARY KEY) STRICT');
      await driver.backup(backup,restore);ensure(await snapshot(restore.query)===before,'RESTORE_INCONSISTENT');
      await restore.database.transaction(checkV3Integrity);await restore.close();const reopened=await driver.reopen('wal-restored');
      try{ensure(await snapshot(reopened.query)===before,'RESTORE_REOPEN_CHANGED');}finally{await reopened.close();}
    }finally{await backup.close();await restore.close();}
  }));
  await test('owned-connections-closed',()=>driver.closeAll());
  return {scope:'independent-synthetic-files',runId:config.runId,results,passed:results.filter(row=>row.status==='passed').length,
    failed:results.filter(row=>row.status==='failed').length,sqliteVersion,
    notRun:['Physical whole-device disk exhaustion','OS process termination/power loss in shared Expo Go sandbox','Native cold application restart (separate from SQLite close/reopen)']};
}
