import type { AtomicDatabase, SqlSession } from './contracts';
import { identifier } from './expense-validation';
import { integer, invalidData } from './guards';
import { readBookV3, requireV3 } from './v3-records';
import { conflict, incrementRevision, isRecord, positiveInteger, publicId } from './v3-validation';

export type OperationKindV3 = 'budget-save' | 'period-open' | 'expense-add' | 'expense-cancel';
export type OperationV3 = Readonly<{
  id: string; publicId: string; bookId: number; periodId: number; sourcePeriodId: number | null;
  kind: OperationKindV3; payload: string; resultingRevision: number;
}>;
export type AtomicV3 = <T>(task: (tx: SqlSession) => Promise<T>) => Promise<T>;

function isBusy(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (typeof error.errcode === 'number' && [5, 6, 261, 517].includes(error.errcode)) ||
    (typeof error.code === 'string' && /^SQLITE_(BUSY|LOCKED)(_|$)/.test(error.code)) ||
    (typeof error.message === 'string' && /\b(?:database is (?:locked|busy)|SQLITE_BUSY(?:_SNAPSHOT)?|SQLITE_LOCKED)\b/i.test(error.message));
}

/** Serializes one connection, while SQL/CAS handles OTHER connections. Never retries unknown failures. */
export function atomicV3(database: AtomicDatabase): AtomicV3 {
  let tail = Promise.resolve();
  return <T>(task: (tx: SqlSession) => Promise<T>) => {
    const pending = tail.then(() => database.transaction(async tx => { await requireV3(tx); return task(tx); }));
    tail = pending.then(() => undefined, () => undefined);
    return pending.catch((error: unknown) => { if (isBusy(error)) conflict('Başka bir işlem veritabanına yazıyor. Güncel kaydı yükleyip aynı işlem kimliğiyle tekrar deneyin.'); throw error; });
  };
}
export async function readOperationV3(tx: SqlSession, operationId: string, bookId: number, kind: OperationKindV3, payload: string): Promise<OperationV3 | null> {
  identifier(operationId);
  const rows = await tx.all('SELECT * FROM budget_save_operations WHERE operation_id = ?', [operationId]);
  if (!rows.length) return null;
  const row = rows[0];
  if (row.book_id !== bookId || row.kind !== kind || row.command_version !== 1 || row.payload !== payload) {
    conflict('Bu işlem kimliği farklı bir içerik, işlem türü veya eski makbuz için kullanılmış.');
  }
  return { id: operationId, publicId: publicId(row.public_id), bookId: positiveInteger(row.book_id),
    periodId: positiveInteger(row.period_id), sourcePeriodId: row.source_period_id === null ? null : positiveInteger(row.source_period_id),
    kind, payload, resultingRevision: positiveInteger(row.resulting_revision) };
}
export async function writeOperationV3(tx: SqlSession, operation: Omit<OperationV3, 'publicId'>): Promise<void> {
  await tx.run(`INSERT INTO budget_save_operations
    (operation_id,book_id,period_id,source_period_id,kind,command_version,payload,resulting_revision) VALUES(?,?,?,?,?,1,?,?)`,
  [operation.id, operation.bookId, operation.periodId, operation.sourcePeriodId, operation.kind, operation.payload, operation.resultingRevision]);
}
export async function checkActivationV3(tx: SqlSession, bookId: number, expected: number): Promise<void> {
  if (integer(expected) < 0) invalidData();
  if ((await readBookV3(tx, bookId)).activationRevision !== expected) conflict();
}
export async function advanceActivationV3(tx: SqlSession, bookId: number, expected: number): Promise<number> {
  const next = incrementRevision(expected);
  const result = await tx.run('UPDATE budget_books SET activation_revision=? WHERE id=? AND activation_revision=?', [next, bookId, expected]);
  if (result.changes !== 1) conflict(); return next;
}
export async function advancePeriodV3(tx: SqlSession, bookId: number, periodId: number, expected: number): Promise<number> {
  const next = incrementRevision(positiveInteger(expected));
  const result = await tx.run("UPDATE budget_periods SET revision=? WHERE id=? AND book_id=? AND revision=? AND status='active'", [next, periodId, bookId, expected]);
  if (result.changes !== 1) conflict(); return next;
}
