import { BudgetStorageError } from './errors';

export function invalidData(): never {
  throw new BudgetStorageError('INVALID_DATA', 'Bütçe verisi doğrulanamadı. Cihazın tarihini ve kayıtları kontrol edin; veriler silinmedi.');
}

export function stringValue(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) return invalidData();
  return value;
}

export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return invalidData();
  return value;
}
