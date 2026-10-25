import { BudgetInputError } from './errors';

/** Extend this registry only when the corresponding input/display adapters support the currency. */
export const budgetCurrencies = Object.freeze({
  TRY: Object.freeze({ code: 'TRY', minorUnitDigits: 2 } as const),
});

export type CurrencyCode = keyof typeof budgetCurrencies;
export type CurrencyDefinition = (typeof budgetCurrencies)[CurrencyCode];

export function resolveCurrency(value: unknown): CurrencyDefinition {
  if (typeof value !== 'string' || !Object.hasOwn(budgetCurrencies, value)) {
    throw new BudgetInputError('UNSUPPORTED_CURRENCY', 'currency', 'Only TRY is supported.');
  }
  return budgetCurrencies[value as CurrencyCode];
}
