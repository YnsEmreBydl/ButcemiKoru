/** DEVELOPMENT UI MOCK ONLY. No SQLite, file, network, native bridge or production opener. */
import { BudgetStorageError } from '../../data/budget/errors';
import type { ActivePeriodV3, BudgetBookV3, ClosedPeriodV3, ExpenseV3, PaymentV3, SavedPeriodV3, StartPeriodResultV3 } from '../../data/budget/v3-contracts';
import { CALCULATION_VERSION_V3, checkedBudget, conflict, startPayload } from '../../data/budget/v3-validation';
import type { BudgetInput } from '../../domain/budget';
import { type PeriodPort, sameScope, scopeOf } from './contracts';

export const fixtureNow = '2026-11-04T09:00:00.000Z';
export type FixtureScenario = 'normal' | 'io' | 'conflict' | 'lost-ack';
const id = (n: number) => n.toString(16).padStart(32, '0');
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function period(number: number, openedAt: string, payday: string, balance: number, payments: readonly PaymentV3[], expenses: readonly ExpenseV3[], asOf: string): ActivePeriodV3 {
  const input: BudgetInput = { currency: 'TRY', timeZone: 'Europe/Istanbul', asOf, balanceSnapshot: { amountMinor: balance, capturedAt: openedAt },
    nextPayday: payday, savingsTargetMinor: 100000,
    payments: payments.map(p => ({ id: p.id, amountMinor: p.amountMinor, dueOn: p.dueOn })),
    transactions: expenses.filter(e => e.status === 'active').map(e => ({ id: e.id, kind: 'expense', amountMinor: e.amountMinor, occurredAt: e.occurredAt })) };
  return freeze({ id: number, publicId: id(number), bookId: 1, previousPeriodId: number === 1 ? null : number - 1,
    revision: 3, openedAt, createdAt: openedAt, input, result: checkedBudget(input), payments, expenses,
    status: 'active', closedAt: null, calculationVersion: null });
}
function expense(number: number, periodId: number, amount: number, occurredAt: string, cancelledAt: string | null): ExpenseV3 {
  return { id: `fixture-expense-${number}`, publicId: id(100 + number), periodId, amountMinor: amount,
    category: number % 2 === 0 ? 'food' : 'market', description: number % 2 === 0 ? 'Örnek öğle yemeği' : 'Örnek market alışverişi',
    occurredAt, createdAt: occurredAt, status: cancelledAt ? 'cancelled' : 'active', cancelledAt };
}

export function createFixturePeriodPort(options: { wait?: () => Promise<void> } = {}) {
  const wait = options.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 650)));
  let book: BudgetBookV3 = freeze({ id: 1, publicId: id(500), activationRevision: 2 });
  const earlier = period(1, '2026-09-04T09:00:00.000Z', '2026-10-04', 1000000,
    [{ id: 'old-rent', publicId: id(20), name: 'Kira', amountMinor: 200000, dueOn: '2026-09-28', carriedFrom: null }],
    [expense(1, 1, 180000, '2026-09-18T09:00:00.000Z', null), expense(2, 1, 15000, '2026-09-19T09:00:00.000Z', '2026-09-20T09:00:00.000Z')], '2026-10-04T09:00:00.000Z');
  const archived: ClosedPeriodV3 = freeze({ ...earlier, status: 'closed', closedAt: '2026-10-04T09:00:00.000Z', calculationVersion: CALCULATION_VERSION_V3 });
  const initial = period(2, archived.closedAt, '2026-11-04', 750000,
    [{ id: 'rent', publicId: id(21), name: 'Kira', amountMinor: 200000, dueOn: '2026-10-28', carriedFrom: null },
      { id: 'electric', publicId: id(22), name: 'Elektrik', amountMinor: 55000, dueOn: '2026-10-29', carriedFrom: null }],
    [expense(3, 2, 100000, '2026-10-12T09:00:00.000Z', null), expense(4, 2, 15000, '2026-10-13T09:00:00.000Z', '2026-10-15T09:00:00.000Z')], fixtureNow);
  const periods = new Map<number, SavedPeriodV3>([[1, archived], [2, initial]]);
  let activeId = 2, sequence = 1000, scenario: FixtureScenario = 'normal';
  const scenarioListeners = new Set<() => void>();
  const setScenario = (value: FixtureScenario) => { scenario = value; scenarioListeners.forEach(listener => listener()); };
  const receipts = new Map<string, { payload: string; sourceId: number; targetId: number; activation: number }>();
  const requireBook = (bookId: number) => { if (bookId !== book.id) throw new BudgetStorageError('NOT_FOUND', 'Örnek defter bulunamadı.'); };
  const resultFor = (operationId: string, receipt: { sourceId: number; targetId: number; activation: number }, replayed: boolean): StartPeriodResultV3 => {
    const source = periods.get(receipt.sourceId), target = periods.get(receipt.targetId);
    if (!source || source.status !== 'closed' || !target) throw Error('Fixture receipt mismatch');
    return freeze({ operationId, source, target, replayed, transitionActivationRevision: receipt.activation });
  };
  const port: PeriodPort = {
    async loadBook(bookId) { await wait(); requireBook(bookId); return book; },
    async loadActivePeriod(bookId, asOf) {
      await wait(); requireBook(bookId); const current = periods.get(activeId);
      if (!current || current.status !== 'active') return null;
      const input = { ...current.input, asOf };
      return freeze({ ...current, input, result: checkedBudget(input) });
    },
    async loadClosedPeriod(scope) {
      await wait(); requireBook(scope.bookId); const stored = periods.get(scope.periodId);
      if (!stored || !sameScope(scope, scopeOf(stored)) || stored.status !== 'closed') throw new BudgetStorageError('NOT_FOUND', 'Örnek arşiv dönemi bulunamadı.');
      return stored; // Stored snapshot; no wall clock or recalculation here.
    },
    async listClosedPeriods(bookId) {
      await wait(); requireBook(bookId);
      return [...periods.values()].filter((p): p is ClosedPeriodV3 => p.status === 'closed').sort((a, b) => b.closedAt.localeCompare(a.closedAt) || b.id - a.id);
    },
    async newPublicId() { return id(++sequence); },
    async startPeriod(command) {
      await wait(); requireBook(command.bookId); const payload = startPayload(command);
      const receipt = receipts.get(command.operationId);
      if (receipt) { if (receipt.payload !== payload) conflict(); return resultFor(command.operationId, receipt, true); }
      const current = periods.get(activeId), mode = scenario; setScenario('normal');
      if (mode === 'io') throw new BudgetStorageError('IO', 'Örnek kayıt hatası üretildi; işlem uygulanmadı.');
      if (!current || current.status !== 'active') conflict();
      if (mode === 'conflict') { periods.set(current.id, freeze({ ...current, revision: current.revision + 1 })); conflict(); }
      if (!sameScope(scopeOf(current), { bookId: command.bookId, periodId: command.sourcePeriodId, periodPublicId: command.sourcePeriodPublicId }) ||
        current.revision !== command.expectedSourceRevision || book.activationRevision !== command.expectedActivationRevision) conflict();
      const closingInput = { ...current.input, asOf: command.balanceCapturedAt }, closingResult = checkedBudget(closingInput);
      if (!closingResult.requiresNewPeriod) conflict();
      if ([...periods.values()].some(p => p.publicId === command.newPeriodPublicId)) conflict();
      const targetId = activeId + 1;
      const payments: PaymentV3[] = command.carryPayments.map(selection => {
        const source = current.payments.find(p => p.id === selection.sourcePaymentId && p.publicId === selection.sourcePaymentPublicId);
        if (!source) conflict();
        return { ...source, id: selection.newId, publicId: selection.newPublicId, dueOn: selection.dueOn, carriedFrom: { periodId: current.id, paymentId: source.id } };
      });
      const input: BudgetInput = { currency: current.input.currency, timeZone: current.input.timeZone, asOf: command.asOf,
        balanceSnapshot: { amountMinor: command.availableBalanceMinor, capturedAt: command.balanceCapturedAt }, nextPayday: command.nextPayday,
        savingsTargetMinor: command.savingsTargetMinor, payments: payments.map(p => ({ id: p.id, amountMinor: p.amountMinor, dueOn: p.dueOn })), transactions: [] };
      const result = checkedBudget(input); if (result.requiresNewPeriod) conflict();
      const closed: ClosedPeriodV3 = freeze({ ...current, revision: current.revision + 1, input: closingInput, result: closingResult,
        status: 'closed', closedAt: command.balanceCapturedAt, calculationVersion: CALCULATION_VERSION_V3 });
      const target: ActivePeriodV3 = freeze({ id: targetId, publicId: command.newPeriodPublicId, bookId: book.id, previousPeriodId: current.id,
        revision: 1, openedAt: command.balanceCapturedAt, createdAt: command.asOf, input, result, payments, expenses: [],
        status: 'active', closedAt: null, calculationVersion: null });
      // In-memory simulation only. Atomic SQLite/CAS guarantees belong to the tested v3 repository.
      periods.set(current.id, closed); periods.set(targetId, target); activeId = targetId;
      book = freeze({ ...book, activationRevision: book.activationRevision + 1 });
      const saved = { payload, sourceId: current.id, targetId, activation: book.activationRevision };
      receipts.set(command.operationId, saved);
      if (mode === 'lost-ack') throw new BudgetStorageError('IO', 'Örnek yanıt kaybı üretildi. Aynı işlemi tekrar kontrol edin.');
      return resultFor(command.operationId, saved, false);
    },
  };
  return { port, now: () => fixtureNow, bookId: book.id,
    setScenario, scenario: { getSnapshot: () => scenario,
      subscribe: (listener: () => void) => { scenarioListeners.add(listener); return () => { scenarioListeners.delete(listener); }; } } };
}
