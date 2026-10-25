import { BudgetInputError } from './errors';

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export function requireMinor(
  value: unknown,
  field: string,
  constraint: 'signed' | 'nonnegative' | 'positive',
): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new BudgetInputError('INVALID_MONEY', field, 'Expected safe integer minor units.');
  }
  if ((constraint === 'nonnegative' && value < 0) || (constraint === 'positive' && value <= 0)) {
    throw new BudgetInputError('INVALID_MONEY', field, `Expected a ${constraint} amount.`);
  }
  return BigInt(value);
}

export function checkedMinor(value: bigint, field: string): number {
  if (value > MAX_MINOR || value < -MAX_MINOR) {
    throw new BudgetInputError('AMOUNT_OVERFLOW', field, 'Result exceeds safe integer minor units.');
  }
  return Number(value);
}

export const positivePart = (value: bigint): bigint => (value > 0n ? value : 0n);
export const minimum = (a: bigint, b: bigint): bigint => (a < b ? a : b);
