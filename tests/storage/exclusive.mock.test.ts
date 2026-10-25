import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exclusiveAdapter, type ExclusiveConnection, type NativeSession } from '../../src/data/budget/exclusive-adapter';
import { getBudgetRepository } from '../../src/data/budget/platform';

function fakeSession(calls: string[]): NativeSession {
  return { execAsync: async (sql) => { calls.push(sql); }, runAsync: async (sql) => { calls.push(sql); return { changes: 1 }; }, getAllAsync: async (sql) => { calls.push(sql); return []; } };
}

test('Mock native API: every query uses the transaction callback connection', async () => {
  const calls: string[] = [];
  const connection: ExclusiveConnection = { withExclusiveTransactionAsync: async (task) => { calls.push('BEGIN'); await task(fakeSession(calls)); calls.push('COMMIT'); } };
  const value = await exclusiveAdapter(connection).transaction(async (tx) => {
    await tx.exec('DDL'); await tx.run('INSERT', [1]); await tx.all('SELECT', []); return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(calls, ['BEGIN', 'DDL', 'INSERT', 'SELECT', 'COMMIT']);
});

test('Mock native API: callback completion does not resolve before commit completion', async () => {
  let committed = false;
  let releaseCommit: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { releaseCommit = resolve; });
  const connection: ExclusiveConnection = { withExclusiveTransactionAsync: async (task) => { await task(fakeSession([])); await gate; committed = true; } };
  let resolved = false;
  const pending = exclusiveAdapter(connection).transaction(async () => 1).then(() => { resolved = true; assert(committed); });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(resolved, false);
  releaseCommit?.(); await pending;
});

test('Mock native API: commit rejection never reports a saved result', async () => {
  const connection: ExclusiveConnection = { withExclusiveTransactionAsync: async (task) => { await task(fakeSession([])); throw new Error('commit failed'); } };
  await assert.rejects(exclusiveAdapter(connection).transaction(async () => 1), /commit failed/);
});

test('Web capability: unsupported storage rejects instead of returning an in-memory fake', async () => {
  await assert.rejects(getBudgetRepository(), { code: 'UNSUPPORTED' });
});
