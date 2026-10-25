import type { BudgetInput } from '../../src/domain/budget';

export function budget(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    currency: 'TRY',
    asOf: '2026-10-25T12:00:00+03:00',
    timeZone: 'Europe/Istanbul',
    balanceSnapshot: { amountMinor: 1_000_000, capturedAt: '2026-10-20T09:00:00+03:00' },
    nextPayday: '2026-11-04',
    payments: [{ id: 'rent', amountMinor: 200_000, dueOn: '2026-10-28' }],
    savingsTargetMinor: 100_000,
    transactions: [],
    ...overrides,
  };
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
