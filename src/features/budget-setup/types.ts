import type { BudgetInput, BudgetResult } from '../../domain/budget';

export type PaymentDraft = Readonly<{
  id: string;
  name: string;
  amount: string;
  dueDate: string;
}>;

export type SetupDraft = Readonly<{
  balance: string;
  payday: string;
  savings: string;
  payments: readonly PaymentDraft[];
}>;

export type PaymentErrors = {
  id: string;
  name?: string;
  amount?: string;
  dueDate?: string;
};

export type SetupErrors = {
  balance?: string;
  payday?: string;
  savings?: string;
  payments: PaymentErrors[];
  general?: string;
};

export type PreviewContext = Readonly<{ asOf: string; timeZone: string }>;

export type PreviewOutcome =
  | Readonly<{ status: 'invalid'; errors: SetupErrors }>
  | Readonly<{ status: 'ready'; input: BudgetInput; result: BudgetResult }>;

export type ParsedField<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; message: string }>;

export const emptySetupDraft = (): SetupDraft => ({
  balance: '', payday: '', savings: '', payments: [],
});

export const emptySetupErrors = (): SetupErrors => ({ payments: [] });
