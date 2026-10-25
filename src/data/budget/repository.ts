import type { AtomicDatabase, BudgetRepository, SaveBudgetCommand } from './contracts';
import { BudgetStorageError } from './errors';
import { createExpenseOperations } from './expense-repository';
import { assertCalculation } from './expense-validation';
import { readBudget } from './records';
import { integer, invalidData, stringValue, validateCommand } from './validation';

export function createBudgetRepository(database: AtomicDatabase): BudgetRepository {
  let tail = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const operation = tail.then(task);
    tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
  return {
    ...createExpenseOperations(database, serial),
    load: (asOf) => serial(() => database.transaction((tx) => readBudget(tx, asOf))),
    newOperationId: () => serial(() => database.transaction(async (tx) => {
      const rows = await tx.all('SELECT lower(hex(randomblob(16))) AS id');
      return stringValue(rows[0]?.id);
    })),
    save: async (request: SaveBudgetCommand) => {
      // Capture the caller's request before any await or queue delay; never write mutable caller data.
      const command: SaveBudgetCommand = {
        ...request,
        input: {
          ...request.input,
          balanceSnapshot: { ...request.input.balanceSnapshot },
          payments: request.input.payments.map((row) => ({ ...row })),
          transactions: [...request.input.transactions],
        },
        paymentNames: request.paymentNames.map((row) => ({ ...row })),
      };
      return serial(async () => {
        const { payload, requiresNewPeriod } = validateCommand(command);
        return database.transaction(async (tx) => {
          const current = await readBudget(tx, command.input.asOf);
          const operations = await tx.all('SELECT payload, resulting_revision FROM budget_save_operations WHERE operation_id = ?', [command.operationId]);
          if (operations.length) {
            const previous = operations[0];
            if (previous.payload !== payload || current === null || integer(previous.resulting_revision) !== current.revision) {
              throw new BudgetStorageError('CONFLICT', 'Bu işlem başka bir içerikle veya eski bir kayıtla ilişkili. Bilgileri yeniden açın.');
            }
            return current;
          }
          if (requiresNewPeriod) throw new BudgetStorageError('NEW_PERIOD_REQUIRED', 'Kaydetmeden önce sonraki maaş tarihini ve güncel bakiyeyi düzenleyin.');
          if (command.expectedRevision === null && current !== null) {
            throw new BudgetStorageError('ALREADY_EXISTS', 'Zaten kayıtlı bir bütçe var. Yeni başlangıç oluşturmak yerine mevcut kaydı düzenleyin.');
          }
          if (command.expectedRevision !== (current?.revision ?? null)) {
            throw new BudgetStorageError('CONFLICT', 'Bütçe başka bir işlemde değişti. Girdileriniz duruyor; kaydı yeniden açıp kontrol edin.');
          }
          const revision = (current?.revision ?? 0) + 1;
          if (!Number.isSafeInteger(revision)) invalidData();
          const input = command.input;
          if (current?.expenses.length && (
            input.balanceSnapshot.amountMinor !== current.input.balanceSnapshot.amountMinor ||
            input.balanceSnapshot.capturedAt !== current.input.balanceSnapshot.capturedAt ||
            input.currency !== current.input.currency || input.timeZone !== current.input.timeZone ||
            input.nextPayday !== current.input.nextPayday
          )) throw new BudgetStorageError('BALANCE_LOCKED', 'Harcama geçmişi bulunan dönemde başlangıç bakiyesi, başlangıç anı, saat dilimi ve maaş tarihi değiştirilemez. Kayıtlar silinmedi.');
          assertCalculation({ ...input, transactions: current?.input.transactions ?? [] });
          const parameters = [revision, input.currency, input.timeZone, input.balanceSnapshot.amountMinor, input.balanceSnapshot.capturedAt, input.nextPayday, input.savingsTargetMinor];
          if (current === null) {
            await tx.run('INSERT INTO budget_periods (id, revision, currency, time_zone, balance_minor, balance_captured_at, next_payday, savings_minor) VALUES (1, ?, ?, ?, ?, ?, ?, ?)', parameters);
          } else {
            const update = await tx.run('UPDATE budget_periods SET revision = ?, currency = ?, time_zone = ?, balance_minor = ?, balance_captured_at = ?, next_payday = ?, savings_minor = ? WHERE id = 1 AND revision = ?', [...parameters, current.revision]);
            if (update.changes !== 1) throw new BudgetStorageError('CONFLICT', 'Bütçe kaydı aynı anda değiştirildi.');
            await tx.run('DELETE FROM budget_payments WHERE period_id = ?', [1]);
          }
          const names = new Map(command.paymentNames.map((row) => [row.id, row.name]));
          for (const payment of input.payments) {
            const name = names.get(payment.id);
            if (name === undefined) invalidData();
            await tx.run('INSERT INTO budget_payments (period_id, id, name, amount_minor, due_on) VALUES (?, ?, ?, ?, ?)', [1, payment.id, name, payment.amountMinor, payment.dueOn]);
          }
          await tx.run('INSERT INTO budget_save_operations (operation_id, period_id, payload, resulting_revision) VALUES (?, ?, ?, ?)', [command.operationId, 1, payload, revision]);
          const saved = await readBudget(tx, input.asOf);
          if (saved === null) invalidData();
          return saved;
        });
      });
    },
  };
}
