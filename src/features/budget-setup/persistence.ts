import { calculateBudget } from '../../domain/budget';
import type { SavedBudget, SaveBudgetCommand } from '../../data/budget/contracts';

import { formatCalendarDate, formatMinorTRY } from './format';
import { createSetupPreview } from './preview';
import type { PreviewContext, SetupDraft, SetupErrors } from './types';

export type SavePreparation =
  | { status: 'invalid'; errors: SetupErrors }
  | { status: 'ready'; command: SaveBudgetCommand; result: SavedBudget['result'] };

export function savedBudgetToDraft(saved: SavedBudget): SetupDraft {
  const names = new Map(saved.paymentNames.map((row) => [row.id, row.name]));
  return {
    balance: formatMinorTRY(saved.input.balanceSnapshot.amountMinor).replace('₺', ''),
    payday: formatCalendarDate(saved.input.nextPayday),
    savings: formatMinorTRY(saved.input.savingsTargetMinor).replace('₺', ''),
    payments: saved.input.payments.map((row) => ({
      id: row.id, name: names.get(row.id) ?? '',
      amount: formatMinorTRY(row.amountMinor).replace('₺', ''), dueDate: formatCalendarDate(row.dueOn),
    })),
  };
}

export function prepareBudgetSave(draft: SetupDraft, context: PreviewContext, saved: SavedBudget | null, operationId: string): SavePreparation {
  const outcome = createSetupPreview(draft, { ...context, timeZone: saved?.input.timeZone ?? context.timeZone });
  if (outcome.status === 'invalid') return outcome;
  const input = {
    ...outcome.input,
    // Metadata edits must not silently turn an existing opening balance into today's new balance.
    balanceSnapshot: saved && saved.input.balanceSnapshot.amountMinor === outcome.input.balanceSnapshot.amountMinor
      ? saved.input.balanceSnapshot : outcome.input.balanceSnapshot,
  };
  if (saved?.expenses.length && (
    input.balanceSnapshot.amountMinor !== saved.input.balanceSnapshot.amountMinor ||
    input.nextPayday !== saved.input.nextPayday
  )) return { status: 'invalid', errors: { payments: [], general: 'Harcama geçmişi bulunan dönemde başlangıç bakiyesi ve maaş tarihi kilitlidir. Bu, harcamaların çift sayılmasını ve dönemlerin karışmasını önler.' } };
  let result: SavedBudget['result'];
  try { result = calculateBudget({ ...input, transactions: saved?.input.transactions ?? [] }); }
  catch { return { status: 'invalid', errors: { payments: [], general: 'Bu değişiklikler mevcut harcamalarla hesaplanamadı. Tutar sınırlarını ve cihaz tarihini kontrol edin.' } }; }
  return {
    status: 'ready', result,
    command: {
      operationId, expectedRevision: saved?.revision ?? null, input,
      paymentNames: draft.payments.map((row) => ({ id: row.id, name: row.name.trim() })),
    },
  };
}
