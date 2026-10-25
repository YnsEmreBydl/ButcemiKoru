import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareBudgetSave, savedBudgetToDraft } from '../../src/features/budget-setup/persistence';
import { createBudgetRepository } from '../../src/data/budget/repository';
import { migrateDatabase } from '../../src/data/budget/migrations';
import { command, databaseFixture } from './sqlite-helper';

test('Persistence mapping: metadata edits preserve the old balance anchor and zone', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const saved = await createBudgetRepository(db).save(command());
  const draft = savedBudgetToDraft(saved);
  const prepared = prepareBudgetSave({ ...draft, savings: '500' }, { asOf: '2026-10-26T12:00:00Z', timeZone: 'America/New_York' }, saved, 'edit');
  assert.equal(prepared.status, 'ready');
  if (prepared.status === 'ready') {
    assert.equal(prepared.command.expectedRevision, 1);
    assert.deepEqual(prepared.command.input.balanceSnapshot, saved.input.balanceSnapshot);
    assert.equal(prepared.command.input.timeZone, 'Europe/Istanbul');
    assert.equal(prepared.command.input.savingsTargetMinor, 50000);
  }
});

test('Persistence mapping: changing balance establishes an explicit new snapshot, without fake expenses', async (t) => {
  const db = databaseFixture(t).open(); await migrateDatabase(db);
  const saved = await createBudgetRepository(db).save(command());
  const asOf = '2026-10-26T12:00:00Z';
  const prepared = prepareBudgetSave({ ...savedBudgetToDraft(saved), balance: '9.000,01' }, { asOf, timeZone: 'Europe/Istanbul' }, saved, 'edit');
  assert.equal(prepared.status, 'ready');
  if (prepared.status === 'ready') {
    assert.equal(prepared.command.input.balanceSnapshot.amountMinor, 900001);
    assert.equal(prepared.command.input.balanceSnapshot.capturedAt, asOf);
    assert.deepEqual(prepared.command.input.transactions, []);
  }
});
