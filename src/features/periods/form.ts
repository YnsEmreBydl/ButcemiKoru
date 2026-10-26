import type { ActivePeriodV3 } from '../../data/budget/v3-contracts';
import { calculateBudget } from '../../domain/budget';
import { formatCalendarDate, formatMinorTRY } from '../budget-setup/format';
import { createSetupPreview } from '../budget-setup/preview';
import type { PeriodDraft, PeriodPreparation } from './contracts';

export function emptyPeriodDraft(source: ActivePeriodV3): PeriodDraft {
  return { balance: '', payday: '', savings: '', balanceConfirmed: false, archiveConfirmed: false,
    payments: source.payments.map(payment => ({ sourcePaymentId: payment.id, selected: false, dueDate: formatCalendarDate(payment.dueOn) })) };
}

/** Reuse the TRY parser and the existing domain adapter. No source balance/transactions are copied. */
export function preparePeriodPreview(draft: PeriodDraft, source: ActivePeriodV3, asOf: string): PeriodPreparation {
  const seen = new Set<string>();
  for (const row of draft.payments) {
    if (seen.has(row.sourcePaymentId) || !source.payments.some(payment => payment.id === row.sourcePaymentId)) {
      return { status: 'invalid', errors: { payments: [], general: 'Fatura listesi kaynak dönemle eşleşmiyor. Değişiklikleri yeniden inceleyin.' } };
    }
    seen.add(row.sourcePaymentId);
  }
  const selected = draft.payments.filter(row => row.selected);
  const payments = selected.map(row => {
    const sourcePayment = source.payments.find(payment => payment.id === row.sourcePaymentId);
    if (!sourcePayment) throw Error('Source payment missing'); // Guarded above, no untyped conversion.
    return { id: sourcePayment.id, name: sourcePayment.name, amount: formatMinorTRY(sourcePayment.amountMinor).replace('₺', ''), dueDate: row.dueDate };
  });
  try {
    if (!calculateBudget({ ...source.input, asOf }).requiresNewPeriod) {
      return { status: 'invalid', errors: { payments: [], general: 'Bu bütçe dönemi henüz sona ermedi. Yeni dönem açılamaz.' } };
    }
    const outcome = createSetupPreview({ balance: draft.balance, payday: draft.payday, savings: draft.savings, payments }, { asOf, timeZone: source.input.timeZone });
    if (outcome.status === 'invalid') return { status: 'invalid', errors: { ...outcome.errors,
      payments: outcome.errors.payments.map(row => ({ id: row.id, dueDate: row.dueDate ?? row.amount ?? row.name ?? 'Fatura doğrulanamadı.' })) } };
    if (outcome.result.requiresNewPeriod) return { status: 'invalid', errors: { payments: [], payday: 'Sonraki maaş tarihi örnek bugünden ileride olmalıdır.' } };
    return { status: 'ready', preview: { input: outcome.input, result: outcome.result } };
  } catch {
    return { status: 'invalid', errors: { payments: [], general: 'Kaynak dönem ve tarih bilgileri doğrulanamadı. Yeniden inceleyin.' } };
  }
}
