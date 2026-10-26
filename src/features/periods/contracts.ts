import type { BudgetInput, BudgetResult } from '../../domain/budget';
import type { BudgetRepositoryV3, PeriodScopeV3 } from '../../data/budget/v3-contracts';

export type PeriodPort = Pick<BudgetRepositoryV3, 'loadBook' | 'loadActivePeriod' | 'loadClosedPeriod' | 'listClosedPeriods' | 'newPublicId' | 'startPeriod'>;
export type ArchivePort = Pick<PeriodPort, 'loadClosedPeriod' | 'listClosedPeriods'>;
export type CarryDraft = Readonly<{ sourcePaymentId: string; selected: boolean; dueDate: string }>;
export type PeriodDraft = Readonly<{
  balance: string; payday: string; savings: string;
  payments: readonly CarryDraft[];
  balanceConfirmed: boolean; archiveConfirmed: boolean;
}>;
export type PeriodErrors = Readonly<{
  balance?: string; payday?: string; savings?: string; general?: string; confirmation?: string;
  payments: readonly Readonly<{ id: string; dueDate: string }>[];
}>;
export type PeriodPreview = Readonly<{ input: BudgetInput; result: BudgetResult }>;
export type PeriodPreparation = { status: 'invalid'; errors: PeriodErrors } | { status: 'ready'; preview: PeriodPreview };

export function scopeOf(period: { bookId: number; id: number; publicId: string }): PeriodScopeV3 {
  return { bookId: period.bookId, periodId: period.id, periodPublicId: period.publicId };
}
export function sameScope(a: PeriodScopeV3, b: PeriodScopeV3): boolean {
  return a.bookId === b.bookId && a.periodId === b.periodId && a.periodPublicId === b.periodPublicId;
}
export function periodScopeKey(scope: PeriodScopeV3): string { return `${scope.bookId}:${scope.periodId}:${scope.periodPublicId}`; }
export function previewEnabled(development: boolean): boolean { return development === true; }

/** Never accept repeated or malformed route params as a different period. */
export function parsePeriodScope(params: { bookId?: string | string[]; periodId?: string | string[]; publicId?: string | string[] }): PeriodScopeV3 | null {
  const positive = (text: string | string[] | undefined) => {
    if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text)) return null;
    const number = Number(text); return Number.isSafeInteger(number) ? number : null;
  };
  const bookId = positive(params.bookId), periodId = positive(params.periodId);
  if (!bookId || !periodId || typeof params.publicId !== 'string' || !/^[0-9a-f]{32}$/.test(params.publicId)) return null;
  return { bookId, periodId, periodPublicId: params.publicId };
}
