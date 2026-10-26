import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BudgetStorageError } from '../../src/data/budget/errors';
import { budgetLoadFailure, shouldOpenSetup } from '../../src/features/saved-budget/load-state';
import { fixture } from './fixtures';

for (const code of ['MIGRATION', 'INVALID_DATA', 'IO'] as const) test(`7D-2 opening: ${code} is an error, never an empty budget/setup reset`, () => {
  const state = budgetLoadFailure({ status: 'loading' }, new BudgetStorageError(code, 'Synthetic failure'));
  assert.equal(state.status, 'error'); assert.equal(shouldOpenSetup(state), false);
  if (state.status !== 'error') throw Error('Unexpected state');
  if (code !== 'IO') assert.match(state.message, /silinmedi veya sıfırlanmadı/);
});
test('7D-2 opening: only a successful empty load can open setup; unsupported web is not empty data', () => {
  assert.equal(shouldOpenSetup({ status: 'ready', saved: null }), true);
  assert.equal(shouldOpenSetup({ status: 'loading' }), false);
  assert.equal(shouldOpenSetup(budgetLoadFailure({ status: 'loading' }, new BudgetStorageError('UNSUPPORTED', 'Native only'))), false);
});
test('7D-2 opening: failed refresh preserves the last good budget instead of replacing it with null', async () => {
  const f = await fixture();
  const saved = { revision: f.source.revision, input: f.source.input, result: f.source.result, paymentNames: [], expenses: [] };
  const state = budgetLoadFailure({ status: 'ready', saved }, new BudgetStorageError('MIGRATION', 'Synthetic failure'));
  assert.equal(state.status, 'ready'); if (state.status !== 'ready') throw Error('Unexpected state');
  assert.equal(state.saved, saved); assert.equal(shouldOpenSetup(state), false); assert.ok(state.message);
});
