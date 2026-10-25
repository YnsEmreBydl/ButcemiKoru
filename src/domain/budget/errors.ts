export type BudgetErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_MONEY'
  | 'AMOUNT_OVERFLOW'
  | 'INVALID_DATE'
  | 'INVALID_INSTANT'
  | 'INVALID_TIME_ZONE'
  | 'UNSUPPORTED_CURRENCY'
  | 'INVALID_CHRONOLOGY'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_PAYMENT'
  | 'UNKNOWN_PAYMENT';

export class BudgetInputError extends Error {
  readonly code: BudgetErrorCode;
  readonly field: string;

  constructor(code: BudgetErrorCode, field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = 'BudgetInputError';
    this.code = code;
    this.field = field;
  }
}
