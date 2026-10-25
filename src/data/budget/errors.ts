export type StorageErrorCode = 'UNSUPPORTED' | 'INVALID_DATA' | 'CONFLICT' | 'ALREADY_EXISTS' | 'NEW_PERIOD_REQUIRED' | 'MIGRATION' | 'IO' | 'BALANCE_LOCKED' | 'NOT_FOUND' | 'ALREADY_CANCELLED' | 'AMOUNT_OVERFLOW';
export class BudgetStorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'BudgetStorageError';
    this.code = code;
  }
}
export function storageErrorMessage(error: unknown): string {
  if (error instanceof BudgetStorageError) return error.message;
  return 'Yerel kayıt okunamadı veya yazılamadı. Bilgileriniz korunuyor; tekrar deneyin. Cihazda boş alan bulunduğunu kontrol edin.';
}
