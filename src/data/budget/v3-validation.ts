import { BudgetInputError, calculateBudget, calendarDaysBetween, type BudgetInput, type BudgetResult } from '../../domain/budget';
import { BudgetStorageError } from './errors';
import { identifier, normalizeInstant } from './expense-validation';
import { integer, invalidData, stringValue } from './guards';
import type { MutationScopeV3, PeriodScopeV3, StartPeriodCommandV3 } from './v3-contracts';

export const CALCULATION_VERSION_V3 = 'budget-engine-v1';
export function positiveInteger(value: unknown): number {
  const number = integer(value); if (number < 1) invalidData(); return number;
}
function calendarDate(value: unknown): string {
  const text = stringValue(value);
  try { calendarDaysBetween(text, text); } catch { return invalidData(); }
  return text;
}
export function publicId(value: unknown): string {
  const text = stringValue(value); if (!/^[0-9a-f]{32}$/.test(text)) invalidData(); return text;
}
export function incrementRevision(value: number): number {
  const next = integer(value) + 1;
  if (!Number.isSafeInteger(next)) conflict('Kayıt sürümü sınırına ulaşıldı. İşlem tamamlanmadı.');
  return next;
}
export function conflict(message = 'Bütçe veya aktif dönem değişti. Güncel dönemi yeniden yükleyin; girdileriniz korunuyor.'): never {
  throw new BudgetStorageError('CONFLICT', message);
}
export function validateScope(scope: PeriodScopeV3): void {
  positiveInteger(scope.bookId); positiveInteger(scope.periodId); publicId(scope.periodPublicId);
}
export function validateMutationV3(command: MutationScopeV3): void {
  validateScope(command); identifier(command.operationId); positiveInteger(command.expectedRevision);
  if (integer(command.expectedActivationRevision) < 0) invalidData(); normalizeInstant(command.asOf);
}
export function checkedBudget(input: BudgetInput): BudgetResult {
  try {
    const result = calculateBudget(input);
    for (const payment of input.payments) if (calendarDaysBetween(payment.dueOn, input.nextPayday) <= 0) invalidData();
    return result;
  } catch (error) {
    if (error instanceof BudgetInputError && error.code === 'AMOUNT_OVERFLOW') {
      throw new BudgetStorageError('AMOUNT_OVERFLOW', 'Toplam tutar desteklenen kuruş sınırını aşıyor. İşlem kaydedilmedi.');
    }
    return invalidData();
  }
}

/** Runtime-safe structural equality: snapshot JSON is never cast to BudgetResult. */
export function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => sameJson(v, right[i]));
  if (!isRecord(left) || !isRecord(right)) return false;
  const keys = Object.keys(left).sort(), other = Object.keys(right).sort();
  return keys.length === other.length && keys.every((key, index) => key === other[index] && sameJson(left[key], right[key]));
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isSnapshot(value: unknown, expected: BudgetResult): value is BudgetResult { return sameJson(value, expected); }
export function decodeClosingResult(text: unknown, version: unknown, expected: BudgetResult): BudgetResult {
  if (version !== CALCULATION_VERSION_V3) throw new BudgetStorageError('UNSUPPORTED', 'Arşivin hesaplama sürümü desteklenmiyor. Kayıt değiştirilmedi.');
  if (typeof text !== 'string') invalidData();
  let value: unknown; try { value = JSON.parse(text); } catch { return invalidData(); }
  if (!isSnapshot(value, expected)) invalidData();
  return value;
}

export function captureStartCommand(request: StartPeriodCommandV3): StartPeriodCommandV3 {
  // Deep capture synchronously, before queueing or awaiting a transaction.
  if (!isRecord(request) || !Array.isArray(request.carryPayments)) invalidData();
  return { ...request, carryPayments: request.carryPayments.map(row => ({ ...row })) };
}
export function startPayload(command: StartPeriodCommandV3): string {
  identifier(command.operationId); positiveInteger(command.bookId); positiveInteger(command.sourcePeriodId);
  publicId(command.sourcePeriodPublicId); publicId(command.newPeriodPublicId); positiveInteger(command.expectedSourceRevision);
  if (integer(command.expectedActivationRevision) < 0 || command.availableBalanceConfirmed !== true) invalidData();
  integer(command.availableBalanceMinor); if (integer(command.savingsTargetMinor) < 0) invalidData();
  const capturedAt = normalizeInstant(command.balanceCapturedAt), clock = normalizeInstant(command.asOf);
  if (capturedAt > clock) invalidData();
  calendarDate(command.nextPayday);
  const ids = new Set<string>(), newIds = new Set<string>(), publicIds = new Set<string>();
  for (const item of command.carryPayments) {
    stringValue(item.sourcePaymentId); publicId(item.sourcePaymentPublicId); stringValue(item.newId); publicId(item.newPublicId);
    calendarDate(item.dueOn);
    if (ids.has(item.sourcePaymentId) || newIds.has(item.newId) || publicIds.has(item.newPublicId) ||
      item.newId === item.sourcePaymentId || item.newPublicId === item.sourcePaymentPublicId) invalidData();
    ids.add(item.sourcePaymentId); newIds.add(item.newId); publicIds.add(item.newPublicId);
  }
  return JSON.stringify({ kind: 'period-open', commandVersion: 1, bookId: command.bookId,
    sourcePeriodId: command.sourcePeriodId, sourcePeriodPublicId: command.sourcePeriodPublicId,
    expectedSourceRevision: command.expectedSourceRevision, expectedActivationRevision: command.expectedActivationRevision,
    newPeriodPublicId: command.newPeriodPublicId, availableBalanceConfirmed: command.availableBalanceConfirmed,
    availableBalanceMinor: command.availableBalanceMinor, balanceCapturedAt: capturedAt,
    nextPayday: command.nextPayday, savingsTargetMinor: command.savingsTargetMinor,
    carryPayments: [...command.carryPayments].sort((a, b) => a.sourcePaymentId < b.sourcePaymentId ? -1 : a.sourcePaymentId > b.sourcePaymentId ? 1 : 0)
      .map(item => ({ sourcePaymentId: item.sourcePaymentId, sourcePaymentPublicId: item.sourcePaymentPublicId,
        newId: item.newId, newPublicId: item.newPublicId, dueOn: item.dueOn })),
  });
}
