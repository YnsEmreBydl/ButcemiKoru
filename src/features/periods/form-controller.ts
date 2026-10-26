import { BudgetStorageError, storageErrorMessage } from '../../data/budget/errors';
import type { ActivePeriodV3, BudgetBookV3, PeriodScopeV3, StartPeriodCommandV3, StartPeriodResultV3 } from '../../data/budget/v3-contracts';
import { type PeriodDraft, type PeriodErrors, type PeriodPort, type PeriodPreview, sameScope, scopeOf } from './contracts';
import { emptyPeriodDraft, preparePeriodPreview } from './form';

type Review = Readonly<{ source: ActivePeriodV3 | null; book: BudgetBookV3 }>;
export type PeriodFormState = Readonly<{
  loading: boolean; loaded: boolean; reviewing: boolean;
  phase: 'editing' | 'saving' | 'failed' | 'conflict' | 'review' | 'success';
  source: ActivePeriodV3 | null; book: BudgetBookV3 | null; draft: PeriodDraft;
  errors: PeriodErrors; preview: PeriodPreview | null; message: string | null;
  review: Review | null; result: StartPeriodResultV3 | null;
  canRetrySameAttempt: boolean;
}>;

/** Testable screen state. Writes occur ONLY in save(), never in render/focus/load. */
export function createPeriodFormController(port: PeriodPort, boundScope: PeriodScopeV3, now: () => string, onCommitted = () => {}, mode: 'demo' | 'saved' = 'demo') {
  const scope = { ...boundScope };
  let state: PeriodFormState = { loading: false, loaded: false, reviewing: false, phase: 'editing', source: null, book: null,
    draft: { balance: '', payday: '', savings: '', payments: [], archiveConfirmed: false, balanceConfirmed: false },
    errors: { payments: [] }, preview: null, message: null, review: null, result: null, canRetrySameAttempt: false };
  const listeners = new Set<() => void>();
  const publish = (next: PeriodFormState) => { state = next; listeners.forEach(listener => listener()); };
  let loading: Promise<void> | null = null, pending: Promise<void> | null = null;
  let reviewRequest = 0;
  let attempt: StartPeriodCommandV3 | null = null;
  let operationId: string | null = null, targetId: string | null = null;
  const copyIds = new Map<string, string>();
  const editable = () => state.phase === 'editing' && !state.loading && state.loaded;
  const resetIntent = () => { attempt = null; operationId = null; targetId = null; copyIds.clear(); };

  async function saveOnce(): Promise<void> {
    try {
      if (!state.source || !state.book || !state.preview) throw new BudgetStorageError('INVALID_DATA', 'Önce ön izlemeyi hesaplayın.');
      if (!attempt) {
        operationId ??= await port.newPublicId();
        targetId ??= await port.newPublicId();
        const selected = state.draft.payments.filter(row => row.selected);
        for (const row of selected) if (!copyIds.has(row.sourcePaymentId)) copyIds.set(row.sourcePaymentId, await port.newPublicId());
        const preview = state.preview, source = state.source;
        const carryPayments = selected.map(row => {
          const sourcePayment = source.payments.find(payment => payment.id === row.sourcePaymentId), id = copyIds.get(row.sourcePaymentId);
          const payment = preview.input.payments.find(payment => payment.id === row.sourcePaymentId);
          if (!sourcePayment || !id || !payment) throw new BudgetStorageError('INVALID_DATA', 'Seçilen faturalar doğrulanamadı.');
          return { sourcePaymentId: sourcePayment.id, sourcePaymentPublicId: sourcePayment.publicId, newId: `carry-${id}`, newPublicId: id, dueOn: payment.dueOn };
        });
        attempt = { operationId, newPeriodPublicId: targetId, bookId: scope.bookId, sourcePeriodId: scope.periodId,
          sourcePeriodPublicId: scope.periodPublicId, expectedSourceRevision: source.revision,
          expectedActivationRevision: state.book.activationRevision, availableBalanceConfirmed: true,
          availableBalanceMinor: preview.input.balanceSnapshot.amountMinor, balanceCapturedAt: preview.input.balanceSnapshot.capturedAt,
          nextPayday: preview.input.nextPayday, savingsTargetMinor: preview.input.savingsTargetMinor, carryPayments, asOf: preview.input.asOf };
      }
      // Keep all economic fields/IDs; only the read clock advances on retry.
      const result = await port.startPeriod({ ...attempt, asOf: now() });
      publish({ ...state, phase: 'success', result, canRetrySameAttempt: false, message: mode === 'saved'
        ? (result.replayed ? 'Bu işlem daha önce tamamlanmış. Kayıtlı dönem gösteriliyor.' : 'Yeni dönem kaydedildi. Önceki dönem arşivde korundu.')
        : result.replayed ? 'Bu örnek işlem daha önce tamamlanmış. Kayıtlı dönem gösteriliyor.' : 'Örnek dönem oluşturuldu. Gerçek bilgileriniz kaydedilmedi.' });
      onCommitted();
    } catch (error) {
      const conflict = error instanceof BudgetStorageError && error.code === 'CONFLICT';
      publish({ ...state, phase: conflict ? 'conflict' : 'failed', canRetrySameAttempt: attempt !== null || operationId !== null, message: conflict ?
        'Bütçe verileri veya aktif dönem değişmiş olabilir. Bu form yeni döneme aktarılmadı. Değişiklikleri inceleyip yeniden onaylayın.' :
        `${storageErrorMessage(error)} Girdileriniz ve bu denemenin kimliği korundu. Sonucu aynı işlemle tekrar kontrol edin.` });
    }
  }

  function beginSave(): Promise<void> {
    // A review read started before this attempt must not overwrite its eventual result.
    reviewRequest++;
    publish({ ...state, phase: 'saving', reviewing: false, message: null });
    pending = saveOnce().finally(() => { pending = null; });
    return pending;
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(): Promise<void> {
      if (loading) return loading;
      if (state.loaded) return Promise.resolve();
      publish({ ...state, loading: true, message: null });
      loading = (async () => {
        try {
          const [book, source] = await Promise.all([port.loadBook(scope.bookId), port.loadActivePeriod(scope.bookId, now())]);
          if (!source || !sameScope(scope, scopeOf(source))) {
            publish({ ...state, loading: false, loaded: true, phase: 'conflict', book,
              message: 'Bu bağlantının dönemi artık aktif değil. Eski form başka döneme aktarılmadı.' });
          } else publish({ ...state, loading: false, loaded: true, source, book, draft: emptyPeriodDraft(source) });
        } catch (error) { publish({ ...state, loading: false, message: storageErrorMessage(error) }); }
      })().finally(() => { loading = null; });
      return loading;
    },
    async checkFreshness(): Promise<void> {
      if (!state.loaded || !state.source || state.phase !== 'editing') return;
      const source = state.source;
      try {
        const [book, current] = await Promise.all([port.loadBook(scope.bookId), port.loadActivePeriod(scope.bookId, now())]);
        if (state.phase !== 'editing' || state.source !== source) return;
        if (!current || !sameScope(scope, scopeOf(current)) || current.revision !== source.revision || book.activationRevision !== state.book?.activationRevision) {
          publish({ ...state, phase: 'conflict', message: 'Siz bu ekrandan ayrılmışken bütçe verileri değişti. Formunuz korundu; değişiklikleri incelemeden kayıt yapılmaz.' });
        }
      } catch (error) { if (state.phase === 'editing') publish({ ...state, message: storageErrorMessage(error) }); }
    },
    change(field: 'balance' | 'payday' | 'savings', value: string) {
      if (!editable()) return;
      publish({ ...state, draft: { ...state.draft, [field]: value, balanceConfirmed: false, archiveConfirmed: false }, preview: null, errors: { payments: [] }, message: null });
    },
    changePayment(id: string, change: Partial<Pick<PeriodDraft['payments'][number], 'selected' | 'dueDate'>>) {
      if (!editable()) return;
      publish({ ...state, draft: { ...state.draft, payments: state.draft.payments.map(row => row.sourcePaymentId === id ? { ...row, ...change } : row),
        balanceConfirmed: false, archiveConfirmed: false }, preview: null, errors: { payments: [] }, message: null });
    },
    confirm(field: 'balanceConfirmed' | 'archiveConfirmed', value: boolean) {
      if (!editable()) return;
      publish({ ...state, draft: { ...state.draft, [field]: value }, errors: { ...state.errors, confirmation: undefined } });
    },
    preview() {
      if (!editable() || !state.source) return;
      const outcome = preparePeriodPreview(state.draft, state.source, now());
      publish({ ...state, preview: outcome.status === 'ready' ? outcome.preview : null,
        errors: outcome.status === 'invalid' ? outcome.errors : { payments: [] }, message: null });
    },
    save(): Promise<void> {
      if (pending) return pending;
      if (!['editing', 'failed'].includes(state.phase) || !state.preview) return Promise.resolve();
      if (!state.draft.balanceConfirmed || !state.draft.archiveConfirmed) {
        publish({ ...state, errors: { ...state.errors, confirmation: 'Güncel bakiyeyi ve eski dönemin arşivlenmesini ayrı ayrı onaylayın.' } }); return Promise.resolve();
      }
      // Synchronous lock precedes the first ID request or any await. Double taps share this Promise.
      return beginSave();
    },
    retrySameAttempt(): Promise<void> {
      if (pending) return pending;
      if (!['conflict', 'review'].includes(state.phase) || !state.canRetrySameAttempt || !state.preview) return Promise.resolve();
      // Read the existing receipt or retry the SAME economic command. Never adopt reviewed data here.
      return beginSave();
    },
    async reviewChanges(): Promise<void> {
      if (pending || state.reviewing || state.phase === 'success') return;
      const request = ++reviewRequest;
      publish({ ...state, reviewing: true });
      try {
        const [book, source] = await Promise.all([port.loadBook(scope.bookId), port.loadActivePeriod(scope.bookId, now())]);
        if (request !== reviewRequest) return;
        publish({ ...state, reviewing: false, phase: 'review', review: { book, source } });
      } catch (error) { if (request === reviewRequest) publish({ ...state, reviewing: false, message: storageErrorMessage(error) }); }
    },
    acceptReview(): boolean {
      if (pending || state.reviewing || state.phase !== 'review') return false;
      const review = state.review;
      if (!review?.source || !sameScope(scope, scopeOf(review.source)) || !review.source.result.requiresNewPeriod) return false;
      const old = state.draft, fresh = emptyPeriodDraft(review.source);
      resetIntent();
      publish({ ...state, phase: 'editing', source: review.source, book: review.book, review: null, preview: null, canRetrySameAttempt: false,
        draft: { ...fresh, balance: old.balance, payday: old.payday, savings: old.savings,
          payments: fresh.payments.map(row => ({ ...row, dueDate: old.payments.find(previous => previous.sourcePaymentId === row.sourcePaymentId)?.dueDate ?? row.dueDate })) },
        errors: { payments: [] }, message: 'Girdileriniz korundu. Güncel faturaları yeniden seçin; ön izlemeyi ve iki onayı yenileyin.' });
      return true;
    },
  };
}
