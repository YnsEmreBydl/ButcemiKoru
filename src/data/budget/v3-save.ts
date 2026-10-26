import type { SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { identifier, normalizeInstant } from './expense-validation';
import { integer, invalidData } from './guards';
import type { SaveBudgetCommandV3, SavedPeriodV3 } from './v3-contracts';
import { advanceActivationV3, checkActivationV3, readOperationV3, writeOperationV3, type AtomicV3 } from './v3-operations';
import { readActiveV3, readRecordedPeriodV3, requireActiveV3 } from './v3-records';
import { checkedBudget, conflict, incrementRevision, positiveInteger, publicId } from './v3-validation';
import { validateCommand } from './validation';

async function replaceActivePayments(tx: SqlSession, periodId: number, command: SaveBudgetCommandV3): Promise<void> {
  const current = await tx.all('SELECT id FROM budget_payments WHERE period_id=?', [periodId]);
  for (const payment of current) {
    if (!command.input.payments.some(row => row.id === payment.id)) await tx.run('DELETE FROM budget_payments WHERE period_id=? AND id=?', [periodId, typeof payment.id === 'string' ? payment.id : invalidData()]);
  }
  const names = new Map(command.paymentNames.map(row => [row.id, row.name]));
  for (const payment of command.input.payments) {
    const name = names.get(payment.id); if (name === undefined) invalidData();
    if (current.some(row => row.id === payment.id)) {
      // Keep public ID and carry provenance. Never DELETE + recreate surviving invoices.
      await tx.run('UPDATE budget_payments SET name=?,amount_minor=?,due_on=? WHERE period_id=? AND id=?', [name, payment.amountMinor, payment.dueOn, periodId, payment.id]);
    } else await tx.run('INSERT INTO budget_payments(period_id,id,name,amount_minor,due_on) VALUES(?,?,?,?,?)', [periodId, payment.id, name, payment.amountMinor, payment.dueOn]);
  }
}

export function saveBudgetOperationV3(atomic: AtomicV3) {
  return async (request: SaveBudgetCommandV3): Promise<SavedPeriodV3> => {
    const command: SaveBudgetCommandV3 = { ...request, target: { ...request.target }, input: {
      ...request.input, balanceSnapshot: { ...request.input.balanceSnapshot },
      payments: request.input.payments.map(row => ({ ...row })), transactions: request.input.transactions.map(row => ({ ...row })),
    }, paymentNames: request.paymentNames.map(row => ({ ...row })) };
    return atomic(async tx => {
      identifier(command.operationId); positiveInteger(command.bookId); publicId(command.target.publicId);
      if (integer(command.expectedActivationRevision) < 0) invalidData();
      if (command.target.kind === 'existing') { positiveInteger(command.target.periodId); positiveInteger(command.target.expectedRevision); }
      else if (command.target.kind !== 'initial') invalidData();
      const validated = validateCommand({ operationId: command.operationId,
        expectedRevision: command.target.kind === 'initial' ? null : command.target.expectedRevision,
        input: command.input, paymentNames: command.paymentNames });
      const payload = JSON.stringify({ kind: 'budget-save', commandVersion: 1, bookId: command.bookId,
        expectedActivationRevision: command.expectedActivationRevision, target: command.target.kind === 'initial' ?
          { kind: 'initial', publicId: command.target.publicId } : { kind: 'existing', periodId: command.target.periodId,
            publicId: command.target.publicId, expectedRevision: command.target.expectedRevision }, form: validated.payload });
      const receipt = await readOperationV3(tx, command.operationId, command.bookId, 'budget-save', payload);
      if (receipt) {
        if (receipt.sourcePeriodId !== null || (command.target.kind === 'existing' && receipt.periodId !== command.target.periodId)) invalidData();
        const saved = await readRecordedPeriodV3(tx, { bookId: command.bookId, periodId: receipt.periodId, periodPublicId: command.target.publicId }, command.input.asOf);
        if (saved.revision < receipt.resultingRevision) invalidData(); return saved;
      }
      await checkActivationV3(tx, command.bookId, command.expectedActivationRevision);
      if (validated.requiresNewPeriod) throw new BudgetStorageError('NEW_PERIOD_REQUIRED', 'Sona ermiş dönem saveBudget ile yeniden başlatılamaz. startPeriod kullanılmalıdır.');
      const input = command.input;
      let periodId: number, revision: number;
      if (command.target.kind === 'initial') {
        const active = await readActiveV3(tx, command.bookId, input.asOf);
        if (active || (await tx.all('SELECT id FROM budget_periods WHERE book_id=? LIMIT 1', [command.bookId])).length) {
          throw new BudgetStorageError('ALREADY_EXISTS', 'Bu defterin geçmişi var. Yeni dönem için startPeriod kullanılmalıdır.');
        }
        if ((await tx.all('SELECT id FROM budget_periods WHERE public_id=?', [command.target.publicId])).length) conflict('Dönem public ID değeri zaten kullanılmış.');
        await tx.run(`INSERT INTO budget_periods(public_id,book_id,status,opened_at,created_at,revision,currency,time_zone,balance_minor,balance_captured_at,next_payday,savings_minor)
          VALUES(?,?,'active',?,?,1,?,?,?,?,?,?)`, [command.target.publicId, command.bookId, normalizeInstant(input.balanceSnapshot.capturedAt),
          normalizeInstant(input.asOf), input.currency, input.timeZone, input.balanceSnapshot.amountMinor, input.balanceSnapshot.capturedAt, input.nextPayday, input.savingsTargetMinor]);
        const rows = await tx.all('SELECT id FROM budget_periods WHERE public_id=? AND book_id=?', [command.target.publicId, command.bookId]);
        periodId = positiveInteger(rows[0]?.id); revision = 1;
        await advanceActivationV3(tx, command.bookId, command.expectedActivationRevision);
      } else {
        const current = await requireActiveV3(tx, { bookId: command.bookId, periodId: command.target.periodId, periodPublicId: command.target.publicId }, input.asOf);
        if (current.revision !== command.target.expectedRevision) conflict();
        if (current.result.requiresNewPeriod) throw new BudgetStorageError('NEW_PERIOD_REQUIRED', 'Sona ermiş dönem saveBudget ile uzatılamaz. startPeriod kullanılmalıdır.');
        if (current.expenses.length && (input.balanceSnapshot.amountMinor !== current.input.balanceSnapshot.amountMinor ||
          input.balanceSnapshot.capturedAt !== current.input.balanceSnapshot.capturedAt || input.currency !== current.input.currency ||
          input.timeZone !== current.input.timeZone || input.nextPayday !== current.input.nextPayday)) {
          throw new BudgetStorageError('BALANCE_LOCKED', 'Harcama geçmişi olan dönemin başlangıç bilgileri değiştirilemez. Yeni dönem ayrı açılmalıdır.');
        }
        if (normalizeInstant(input.balanceSnapshot.capturedAt) < current.openedAt) invalidData();
        checkedBudget({ ...input, transactions: current.input.transactions });
        revision = incrementRevision(current.revision); periodId = current.id;
        const changed = await tx.run(`UPDATE budget_periods SET revision=?,currency=?,time_zone=?,balance_minor=?,balance_captured_at=?,next_payday=?,savings_minor=?
          WHERE id=? AND book_id=? AND revision=? AND status='active'`, [revision, input.currency, input.timeZone, input.balanceSnapshot.amountMinor,
          input.balanceSnapshot.capturedAt, input.nextPayday, input.savingsTargetMinor, periodId, command.bookId, current.revision]);
        if (changed.changes !== 1) conflict();
      }
      await replaceActivePayments(tx, periodId, command);
      await writeOperationV3(tx, { id: command.operationId, bookId: command.bookId, periodId, sourcePeriodId: null,
        kind: 'budget-save', payload, resultingRevision: revision });
      return requireActiveV3(tx, { bookId: command.bookId, periodId, periodPublicId: command.target.publicId }, input.asOf);
    });
  };
}
