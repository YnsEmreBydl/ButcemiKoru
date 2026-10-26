import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { test, type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import type { StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import { isRecord } from '../../src/data/budget/v3-validation';
import { fixture, pid, start } from './fixtures';

type Outcome = { status: 'fulfilled'; periodId: number; replayed: boolean } | { status: 'rejected'; code: string };

/** Two independent threads execute actual BEGIN IMMEDIATE / COMMIT against the same WAL file. */
function job(t: TestContext, file: string, command: StartPeriodCommandV3, hold = false, deferred = false) {
  const signals = new EventEmitter();
  const worker = new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const {RealSQLite}=require(workerData.helper);
    const {createBudgetRepositoryV3}=require(workerData.repository);
    const db=new RealSQLite(workerData.file); db.db.exec('PRAGMA busy_timeout=5000');
    const immediate={transaction: task => db.transaction(async tx => {
      if(workerData.hold){parentPort.postMessage({phase:'locked'});await new Promise(resolve=>parentPort.once('message',resolve));}
      return task(tx);
    })};
    let held=false;
    const deferred={transaction:async task=>{
      db.db.exec('BEGIN');
      try {
        const result=await task({
          exec:async sql=>db.db.exec(sql),
          run:async(sql,params)=>({changes:Number(db.db.prepare(sql).run(...params).changes)}),
          all:async(sql,params=[])=>{
            const rows=db.db.prepare(sql).all(...params);
            if(!held && sql.startsWith('SELECT * FROM budget_periods WHERE id =')){
              held=true;parentPort.postMessage({phase:'snapshot'});
              await new Promise(resolve=>parentPort.once('message',resolve));
            }
            return rows;
          }
        });
        db.db.exec('COMMIT');return result;
      } catch(error){if(db.db.isTransaction)db.db.exec('ROLLBACK');throw error;}
    }};
    const adapter=workerData.deferred?deferred:immediate;
    const repo=createBudgetRepositoryV3(adapter);
    parentPort.once('message',async ()=>{
      parentPort.postMessage({phase:'attempt'});
      let outcome;
      try {const result=await repo.startPeriod(workerData.command); outcome={status:'fulfilled',periodId:result.target.id,replayed:result.replayed};}
      catch(error){outcome={status:'rejected',code:typeof error.code==='string'?error.code:'unexpected'};}
      finally {db.close();}
      parentPort.postMessage({phase:'done',outcome}); parentPort.close();
    });
    parentPort.postMessage({phase:'ready'});
  `, { eval: true, workerData: { file, command, hold, deferred, helper: require.resolve('../storage/sqlite-helper'), repository: require.resolve('../../src/data/budget/repository-v3') } });
  const ready = once(signals, 'ready');
  const outcome = new Promise<Outcome>((resolve, reject) => {
    worker.on('error', reject);
    worker.on('message', (message: unknown) => {
      if (!isRecord(message) || typeof message.phase !== 'string') { reject(Error('Invalid worker response')); return; }
      if (message.phase !== 'done') { signals.emit(message.phase); return; }
      const value = message.outcome;
      if (!isRecord(value)) { reject(Error('Invalid worker outcome')); return; }
      if (value.status === 'fulfilled' && typeof value.periodId === 'number' && typeof value.replayed === 'boolean') {
        resolve({ status: 'fulfilled', periodId: value.periodId, replayed: value.replayed });
      } else if (value.status === 'rejected' && typeof value.code === 'string') resolve({ status: 'rejected', code: value.code });
      else reject(Error('Invalid worker status'));
    });
  });
  t.after(async () => { await worker.terminate(); });
  return { ready, outcome, worker, signals };
}

for (const sameCommand of [false, true]) test(`v3 repository real worker race: ${sameCommand ? 'identical commands replay' : 'distinct commands have one CAS winner'}`, { timeout: 15000 }, async t => {
  const { db, files, active } = await fixture(t); const command = start(active);
  const first = job(t, files.file, command, true);
  const second = job(t, files.file, sameCommand ? command : start(active, { operationId: 'competitor', newPeriodPublicId: pid(99) }));
  await Promise.all([first.ready, second.ready]);
  const locked = once(first.signals, 'locked'); first.worker.postMessage('start'); await locked;
  const attempted = once(second.signals, 'attempt'); second.worker.postMessage('start'); await attempted;
  first.worker.postMessage('release');
  const results = await Promise.all([first.outcome, second.outcome]);
  assert.equal(results[0].status, 'fulfilled');
  if (sameCommand) {
    assert.equal(results[1].status, 'fulfilled');
    if (results[1].status === 'fulfilled') { assert.equal(results[1].periodId, 2); assert.equal(results[1].replayed, true); }
  } else assert.deepEqual(results[1], { status: 'rejected', code: 'CONFLICT' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM budget_save_operations WHERE kind='period-open'").get()?.n, 1);
  assert.equal(db.db.prepare('SELECT activation_revision FROM budget_books WHERE id=1').get()?.activation_revision, 2);
});

test('v3 repository real DEFERRED race: two readers of A produce one commit and one SQLITE_BUSY_SNAPSHOT conflict', { timeout: 15000 }, async t => {
  const { db, files, active } = await fixture(t);
  const first = job(t, files.file, start(active), false, true);
  const second = job(t, files.file, start(active, { operationId: 'deferred-competitor', newPeriodPublicId: pid(99) }), false, true);
  await Promise.all([first.ready, second.ready]);
  const firstRead = once(first.signals, 'snapshot'), secondRead = once(second.signals, 'snapshot');
  first.worker.postMessage('start'); second.worker.postMessage('start'); await Promise.all([firstRead, secondRead]);
  first.worker.postMessage('release'); assert.equal((await first.outcome).status, 'fulfilled');
  second.worker.postMessage('release'); assert.deepEqual(await second.outcome, { status: 'rejected', code: 'CONFLICT' });
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM budget_periods').get()?.n, 2);
  assert.equal(db.db.prepare("SELECT count(*) AS n FROM budget_save_operations WHERE kind='period-open'").get()?.n, 1);
});
