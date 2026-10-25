import {
  BudgetInputError,
  calculateBudget,
  calendarDaysBetween,
  type BudgetInput,
  type ScheduledPayment,
} from '../../domain/budget';

import { parseCalendarInput, parseTurkishMoney } from './input';
import { emptySetupErrors, type PreviewContext, type PreviewOutcome, type SetupDraft } from './types';

/** Screen adapter: validate strings, construct the existing API input, then call the engine once. */
export function createSetupPreview(draft: SetupDraft, context: PreviewContext): PreviewOutcome {
  const errors = emptySetupErrors();
  const balance = parseTurkishMoney(draft.balance);
  const payday = parseCalendarInput(draft.payday);
  const savings = draft.savings.trim() === ''
    ? { ok: true as const, value: 0 }
    : parseTurkishMoney(draft.savings);

  if (!balance.ok) errors.balance = balance.message;
  if (!payday.ok) errors.payday = payday.message;
  if (!savings.ok) errors.savings = savings.message;
  else if (savings.value < 0) errors.savings = 'Birikim hedefi negatif olamaz.';

  const payments: ScheduledPayment[] = [];
  const ids = new Set<string>();
  for (const row of draft.payments) {
    const rowErrors = { id: row.id, name: '', amount: '', dueDate: '' };
    const amount = parseTurkishMoney(row.amount);
    const date = parseCalendarInput(row.dueDate);
    if (!row.name.trim()) rowErrors.name = 'Faturanın adını yazın veya satırı kaldırın.';
    else if (row.name.trim().length > 80) rowErrors.name = 'Fatura adı en fazla 80 karakter olabilir.';
    if (!amount.ok) rowErrors.amount = amount.message;
    else if (amount.value <= 0) rowErrors.amount = 'Fatura tutarı sıfırdan büyük olmalıdır.';
    if (!date.ok) rowErrors.dueDate = date.message;
    if (!row.id.trim() || row.id !== row.id.trim() || ids.has(row.id)) {
      errors.general = 'Fatura satırları doğrulanamadı. Tekrarlanan satırı kaldırıp yeniden ekleyin.';
    }
    ids.add(row.id);
    if (rowErrors.name || rowErrors.amount || rowErrors.dueDate) errors.payments.push(rowErrors);
    if (amount.ok && amount.value > 0 && date.ok) {
      payments.push({ id: row.id, amountMinor: amount.value, dueOn: date.value });
    }
  }

  if (!balance.ok || !payday.ok || !savings.ok || errors.savings || errors.payments.length || errors.general) {
    return { status: 'invalid', errors };
  }

  const input: BudgetInput = {
    currency: 'TRY',
    asOf: context.asOf,
    timeZone: context.timeZone,
    balanceSnapshot: { amountMinor: balance.value, capturedAt: context.asOf },
    nextPayday: payday.value,
    payments,
    savingsTargetMinor: savings.value,
    // Initial balance already includes previous spending; DEMO transactions must never enter here.
    transactions: [],
  };

  try {
    const result = calculateBudget(input);
    // Expired periods must show the engine's new-period state, not an invented future date.
    if (result.periodStatus === 'active') {
      for (const payment of payments) {
        if (calendarDaysBetween(payment.dueOn, input.nextPayday) <= 0) {
          errors.payments.push({ id: payment.id, dueDate: 'Bu fatura tarihi maaş gününden önce olmalıdır.' });
        }
      }
      if (errors.payments.length) return { status: 'invalid', errors };
    }
    return { status: 'ready', input, result };
  } catch (error) {
    if (!(error instanceof BudgetInputError)) throw error;
    if (error.code === 'AMOUNT_OVERFLOW') {
      errors.general = 'Tutarların toplamı desteklenen hesaplama sınırını aşıyor. Bakiyeyi ve rezervleri kontrol edin.';
    } else if (['INVALID_INSTANT', 'INVALID_TIME_ZONE', 'INVALID_CHRONOLOGY'].includes(error.code)) {
      errors.general = 'Cihazın tarih, saat veya saat dilimi doğrulanamadı. Ayarlarınızı kontrol edip tekrar deneyin.';
    } else {
      errors.general = 'Bütçe bilgileri doğrulanamadı. Tutarları, tarihleri ve fatura satırlarını kontrol edin.';
    }
    return { status: 'invalid', errors };
  }
}
