import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyPeriodDraft, preparePeriodPreview } from '../../src/features/periods/form';
import { fixture } from './fixtures';

test('7C form mock: opening balance is always empty, invoices unselected and confirmations false', async () => {
  const { source } = await fixture(); const draft = emptyPeriodDraft(source);
  assert.equal(draft.balance, ''); assert.equal(draft.payday, ''); assert.equal(draft.savings, '');
  assert.equal(draft.balanceConfirmed, false); assert.equal(draft.archiveConfirmed, false);
  assert.ok(draft.payments.every(row => !row.selected)); assert.notEqual(source.input.balanceSnapshot.amountMinor, 0);
});

for (const [text, minor] of [['0', 0], ['-100,25', -10025], ['1,01', 101], ['1.234,56', 123456],
  ['90.071.992.547.409,91', Number.MAX_SAFE_INTEGER]] as const) test(`7C form mock: exact TRY conversion ${text}`, async () => {
  const { source, now } = await fixture();
  const result = preparePeriodPreview({ ...emptyPeriodDraft(source), balance: text, payday: '04.12.2026' }, source, now());
  assert.equal(result.status, 'ready'); if (result.status !== 'ready') throw Error('fixture');
  assert.equal(result.preview.input.balanceSnapshot.amountMinor, minor); assert.equal(result.preview.result.remainingBalanceMinor, minor);
  assert.equal(result.preview.input.transactions.length, 0); assert.equal(result.preview.result.spentSinceSnapshotMinor, 0);
  if (minor < 0) { assert.equal(result.preview.result.budgetDeficitMinor, -minor); assert.equal(result.preview.result.daily?.recommendedDailyMinor, 0); }
});

for (const text of ['', ' ', 'NaN', 'Infinity', '1,001', '1.23', '1.23,45', '90.071.992.547.409,92']) test(`7C form mock: invalid or overflowing balance '${text}'`, async () => {
  const { source, now } = await fixture();
  const result = preparePeriodPreview({ ...emptyPeriodDraft(source), balance: text, payday: '04.12.2026' }, source, now());
  assert.equal(result.status, 'invalid'); if (result.status === 'invalid') assert.ok(result.errors.balance);
});

test('7C form mock: only selected invoices reserve money; edited date and unchanged source amount are preserved', async () => {
  const { source, now } = await fixture(); const draft = { ...emptyPeriodDraft(source), balance: '3.000,25', payday: '04.12.2026', savings: '500',
    payments: [{ sourcePaymentId: 'rent', selected: true, dueDate: '28.11.2026' }, { sourcePaymentId: 'electric', selected: false, dueDate: 'invalid' }] };
  const result = preparePeriodPreview(draft, source, now()); if (result.status !== 'ready') throw Error('fixture');
  assert.equal(result.preview.result.reservedPaymentsMinor, 200000); assert.equal(result.preview.result.spendableMinor, 50025);
  assert.equal(result.preview.result.daysUntilPayday, 30); assert.equal(result.preview.result.daily?.recommendedDailyMinor, 1667);
  assert.deepEqual(result.preview.input.payments, [{ id: 'rent', amountMinor: 200000, dueOn: '2026-11-28' }]);
  assert.equal(source.payments.find(p => p.id === 'rent')?.dueOn, '2026-10-28');
});

for (const date of ['', '31.11.2026', '04.11.2026', '03.11.2026']) test(`7C form mock: invalid or expired payday '${date}'`, async () => {
  const { source, now } = await fixture();
  const outcome = preparePeriodPreview({ ...emptyPeriodDraft(source), balance: '100', payday: date }, source, now());
  assert.equal(outcome.status, 'invalid'); if (outcome.status === 'invalid') assert.ok(outcome.errors.payday);
});

test('7C form mock: selected invoice needs a valid date before payday and savings cannot be negative', async () => {
  const { source, now } = await fixture(); const base = { ...emptyPeriodDraft(source), balance: '1000', payday: '04.12.2026' };
  for (const date of ['invalid', '04.12.2026']) {
    const result = preparePeriodPreview({ ...base, payments: [{ sourcePaymentId: 'rent', selected: true, dueDate: date }] }, source, now());
    assert.equal(result.status, 'invalid'); if (result.status === 'invalid') assert.ok(result.errors.payments.some(error => error.id === 'rent'));
  }
  const negative = preparePeriodPreview({ ...base, savings: '-1' }, source, now());
  assert.equal(negative.status, 'invalid'); if (negative.status === 'invalid') assert.ok(negative.errors.savings);
});

test('7C form mock: repeated or unknown invoice identities and aggregate deficit overflow are rejected', async () => {
  const { source, now } = await fixture(); const base = { ...emptyPeriodDraft(source), balance: '1000', payday: '04.12.2026' };
  for (const payments of [[{ sourcePaymentId: 'missing', selected: true, dueDate: '28.11.2026' }],
    [{ sourcePaymentId: 'rent', selected: true, dueDate: '28.11.2026' }, { sourcePaymentId: 'rent', selected: true, dueDate: '28.11.2026' }]]) {
    const result = preparePeriodPreview({ ...base, payments }, source, now()); assert.equal(result.status, 'invalid');
  }
  const result = preparePeriodPreview({ ...base, balance: '-90.071.992.547.409,91',
    payments: [{ sourcePaymentId: 'rent', selected: true, dueDate: '28.11.2026' }] }, source, now());
  assert.equal(result.status, 'invalid'); if (result.status === 'invalid') assert.ok(result.errors.general);
});
