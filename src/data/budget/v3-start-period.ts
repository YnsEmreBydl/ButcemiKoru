import type { BudgetInput } from '../../domain/budget';
import type { SqlSession } from './contracts';
import { normalizeInstant } from './expense-validation';
import { invalidData } from './guards';
import { checkV3Integrity } from './integrity-v3';
import type { ActivePeriodV3, PaymentV3, StartPeriodCommandV3, StartPeriodResultV3 } from './v3-contracts';
import { advanceActivationV3, checkActivationV3, readOperationV3, writeOperationV3, type AtomicV3, type OperationV3 } from './v3-operations';
import { readBookV3, readPeriodV3, readRecordedPeriodV3, requireActiveV3 } from './v3-records';
import { CALCULATION_VERSION_V3, captureStartCommand, checkedBudget, conflict, incrementRevision, positiveInteger, startPayload } from './v3-validation';

async function resultForReceipt(tx: SqlSession, command: StartPeriodCommandV3, operation: OperationV3, replayed: boolean): Promise<StartPeriodResultV3> {
  if (operation.sourcePeriodId !== command.sourcePeriodId || operation.resultingRevision !== 1) invalidData();
  const source = await readPeriodV3(tx, { bookId: command.bookId, periodId: command.sourcePeriodId, periodPublicId: command.sourcePeriodPublicId });
  const target = await readRecordedPeriodV3(tx, { bookId: command.bookId, periodId: operation.periodId, periodPublicId: command.newPeriodPublicId }, command.asOf);
  const transitionRevision = incrementRevision(command.expectedActivationRevision);
  if (source.status !== 'closed' || source.revision !== incrementRevision(command.expectedSourceRevision) ||
    source.closedAt !== normalizeInstant(command.balanceCapturedAt) || target.previousPeriodId !== source.id ||
    target.openedAt !== source.closedAt || target.revision < operation.resultingRevision ||
    (await readBookV3(tx, command.bookId)).activationRevision < transitionRevision) invalidData();
  return { operationId: command.operationId, replayed, transitionActivationRevision: transitionRevision, source, target };
}

function carriedPayments(source: ActivePeriodV3, command: StartPeriodCommandV3): readonly PaymentV3[] {
  return [...command.carryPayments].sort((a, b) => a.newId < b.newId ? -1 : a.newId > b.newId ? 1 : 0).map(selection => {
    const payment = source.payments.find(row => row.id === selection.sourcePaymentId);
    if (!payment || payment.publicId !== selection.sourcePaymentPublicId) conflict('Taşınacak fatura kaynak dönemde bulunamadı veya kimliği değişti.');
    return { ...payment, id: selection.newId, publicId: selection.newPublicId, dueOn: selection.dueOn,
      carriedFrom: { periodId: source.id, paymentId: payment.id } };
  });
}

export function startPeriodOperationV3(atomic: AtomicV3) {
  return async (request: StartPeriodCommandV3): Promise<StartPeriodResultV3> => {
    const command = captureStartCommand(request);
    return atomic(async tx => {
      const payload = startPayload(command);
      // MUST precede active/revision checks. Old A->B retries never resolve against active C.
      const previous = await readOperationV3(tx, command.operationId, command.bookId, 'period-open', payload);
      if (previous) return resultForReceipt(tx, command, previous, true);
      await checkActivationV3(tx, command.bookId, command.expectedActivationRevision);
      const capturedAt = normalizeInstant(command.balanceCapturedAt);
      const source = await requireActiveV3(tx, {
        bookId: command.bookId, periodId: command.sourcePeriodId, periodPublicId: command.sourcePeriodPublicId,
      }, capturedAt);
      if (source.revision !== command.expectedSourceRevision) conflict();
      if (!source.result.requiresNewPeriod) conflict('Kaynak dönemin maaş günü henüz gelmedi. Yeni dönem açılmadı.');
      if ((await tx.all('SELECT id FROM budget_periods WHERE public_id = ?', [command.newPeriodPublicId])).length) conflict('Yeni dönem public ID değeri başka bir kayıt tarafından kullanılmış.');
      const payments = carriedPayments(source, command);
      for (const payment of payments) {
        if ((await tx.all('SELECT id FROM budget_payments WHERE public_id = ?', [payment.publicId])).length) conflict('Fatura kopyasının public ID değeri zaten kullanılmış.');
      }
      const input: BudgetInput = { currency: source.input.currency, timeZone: source.input.timeZone,
        asOf: normalizeInstant(command.asOf), balanceSnapshot: { amountMinor: command.availableBalanceMinor, capturedAt },
        nextPayday: command.nextPayday, savingsTargetMinor: command.savingsTargetMinor,
        payments: payments.map(row => ({ id: row.id, amountMinor: row.amountMinor, dueOn: row.dueOn })), transactions: [] };
      if (checkedBudget(input).requiresNewPeriod) conflict('Yeni maaş tarihi gelecekte olmalıdır. Yeni dönem açılmadı.');
      incrementRevision(command.expectedActivationRevision); // Check bounds before any writes.
      const closedRevision = incrementRevision(source.revision);
      const closed = await tx.run(`UPDATE budget_periods SET status='closed',closed_at=?,closing_result_json=?,calculation_version=?,revision=?
        WHERE id=? AND book_id=? AND revision=? AND status='active'`,
      [capturedAt, JSON.stringify(source.result), CALCULATION_VERSION_V3, closedRevision, source.id, command.bookId, command.expectedSourceRevision]);
      if (closed.changes !== 1) conflict();
      await tx.run(`INSERT INTO budget_periods
        (public_id,book_id,previous_period_id,status,opened_at,created_at,revision,currency,time_zone,balance_minor,balance_captured_at,next_payday,savings_minor)
        VALUES(?,?,?,'active',?,?,1,?,?,?,?,?,?)`,
      [command.newPeriodPublicId, command.bookId, source.id, capturedAt, input.asOf,
        input.currency, input.timeZone, command.availableBalanceMinor, capturedAt, command.nextPayday, command.savingsTargetMinor]);
      const targets = await tx.all('SELECT id FROM budget_periods WHERE book_id=? AND public_id=?', [command.bookId, command.newPeriodPublicId]);
      const targetId = positiveInteger(targets[0]?.id);
      for (const payment of payments) {
        if (payment.carriedFrom === null) invalidData();
        await tx.run(`INSERT INTO budget_payments(period_id,id,public_id,name,amount_minor,due_on,carried_from_period_id,carried_from_payment_id)
          VALUES(?,?,?,?,?,?,?,?)`, [targetId, payment.id, payment.publicId, payment.name, payment.amountMinor, payment.dueOn, source.id, payment.carriedFrom.paymentId]);
      }
      await advanceActivationV3(tx, command.bookId, command.expectedActivationRevision);
      await writeOperationV3(tx, { id: command.operationId, bookId: command.bookId, periodId: targetId,
        sourcePeriodId: source.id, kind: 'period-open', payload, resultingRevision: 1 });
      await checkV3Integrity(tx);
      const receipt = await readOperationV3(tx, command.operationId, command.bookId, 'period-open', payload);
      if (!receipt) invalidData();
      return resultForReceipt(tx, command, receipt, false);
    });
  };
}
