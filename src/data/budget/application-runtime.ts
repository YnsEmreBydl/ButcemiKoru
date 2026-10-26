import type { AtomicDatabase } from './contracts';
import type { ApplicationRepository, ApplicationState, BudgetAccess, RuntimeStore, ScopedSave } from './application-contracts';
import { captureAccess, v2View, v3View } from './application-view';
import { BudgetStorageError } from './errors';
import { checkV3Integrity } from './integrity-v3';
import { migrateDatabase } from './migrations';
import { createBudgetRepository } from './repository';
import { createBudgetRepositoryV3 } from './repository-v3';
import { catalogWriterMutex, initializeCatalog, readRuntimeEntry, runtimeBlocked, type RuntimeEntry } from './runtime-catalog';
import { readV2Evidence } from './upgrade-evidence';
import { prepareV3Copy } from './upgrade-preparation';
import { migrateDatabaseV3 } from './migrations-v3';
import { publicId } from './v3-validation';

type Options = Readonly<{
  store(): Promise<RuntimeStore>;
  /** Explicit host capability. The production host hardcodes false in this stage. */
  allowV3: boolean; autoUpgrade?: boolean; now(): string;
  initializeV2?: (database: AtomicDatabase) => Promise<void>;
  migrate?: (database: AtomicDatabase) => Promise<void>;
}>;
function conflict(): never { throw new BudgetStorageError('CONFLICT', 'Formun dönemi veya erişim sürümü değişti. Girdiler yeni döneme uygulanmadı. Yeniden inceleyin.'); }
function versioned(database: AtomicDatabase, schema: 2 | 3): AtomicDatabase {
  return { transaction: task => database.transaction(async tx => {
    if ((await tx.all('PRAGMA user_version'))[0]?.user_version !== schema) runtimeBlocked('Repository ile dosya şeması eşleşmiyor. Yazım durduruldu.');
    return task(tx);
  }) };
}

/** Shared startup + durable fencing. No filename, native API, reset or promotion by rename. */
export function createApplicationRuntime(options: Options): ApplicationRepository & { upgrade(): Promise<void>; close(): Promise<void> } {
  let state: ApplicationState = { phase: 'idle', schema: null, message: 'Yerel kayıt hazırlanıyor…', hasOpened: false };
  let store: RuntimeStore | null = null, booting: Promise<void> | null = null, upgrading: Promise<void> | null = null;
  let openingFailure: unknown = null;
  let tail = Promise.resolve();
  const listeners = new Set<() => void>();
  function publish(phase: ApplicationState['phase'], schema: 2 | 3 | null, message: string) { state = { phase, schema, message, hasOpened: state.hasOpened || phase === 'ready' }; listeners.forEach(fn => fn()); }
  function serial<T>(task: () => Promise<T>): Promise<T> { const work = tail.then(task); tail = work.then(() => {}, () => {}); return work; }
  function requireStore(): RuntimeStore { if (!store) runtimeBlocked(); return store; }
  const ready = (schema: 2 | 3, message = '') => publish('ready', schema, message);
  async function verifyActive(entry: RuntimeEntry) {
    const s = requireStore();
    if (entry.schema === 2) {
      const version = (await s.source.query.all('PRAGMA user_version'))[0]?.user_version;
      if (version !== 0 && version !== 1 && version !== 2) runtimeBlocked('Kaynak sürümü desteklenmiyor; v2 açıcısı yeni şemayı kullanamaz.');
      await (options.initializeV2 ?? migrateDatabase)(s.source.database); await readV2Evidence(s.source.database);
    } else {
      if (!options.allowV3) runtimeBlocked('v3 bu uygulama girişinde etkin değil. Kayıtlar sıfırlanmadı.');
      const db = await s.reopen(entry.activeKey);
      try {
        await versioned(db.database, 3).transaction(checkV3Integrity);
        const repo = createBudgetRepositoryV3(versioned(db.database, 3));
        await repo.loadActivePeriod(1, options.now()); await repo.listClosedPeriods(1);
      } finally { await db.close(); }
    }
  }
  async function recover(): Promise<void> {
    const s = requireStore(); publish('recovering', null, 'Yarım kalan geçiş inceleniyor. Finansal yazım kapalı.');
    await s.catalog.transaction(async tx => {
      const entry = await readRuntimeEntry(tx);
      if (entry.phase !== 'pending') { await verifyActive(entry); return; }
      // Never restore an old backup over a possibly newer live file.
      await readV2Evidence(s.source.database);
      await tx.run("UPDATE runtime_transitions SET status='recovered' WHERE operation_id=? AND status='pending'", [entry.operationId]);
      const changed = await tx.run("UPDATE runtime_state SET phase='ready',operation_id=NULL,prefix=NULL WHERE id=1 AND phase='pending' AND epoch=? AND operation_id=?", [entry.epoch, entry.operationId]);
      if (changed.changes !== 1) conflict();
    });
  }
  async function transition(): Promise<void> {
    const s = requireStore();
    if (!options.allowV3) runtimeBlocked('Gerçek kullanıcı verisinde v3 etkinleştirme izni bu sürümde kapalı.');
    publish('upgrading', 2, 'Yedek doğrulanıyor ve bütçe geçişi hazırlanıyor. Finansal yazım kapalı.');
    // Commit the fence BEFORE backup. Existing financial catalog transactions drain first.
    const intent = await s.catalog.transaction(async tx => {
      const entry = await readRuntimeEntry(tx);
      if (entry.phase !== 'ready' || entry.schema !== 2) conflict();
      const id = publicId((await tx.all('SELECT lower(hex(randomblob(16))) AS id'))[0]?.id), prefix = `up-${id.slice(0,16)}`;
      await tx.run('INSERT INTO runtime_transitions VALUES(?,?,?,?,?)', [id, entry.epoch, prefix, 'pending', `${prefix}-candidate`]);
      const update = await tx.run("UPDATE runtime_state SET phase='pending',operation_id=?,prefix=? WHERE id=1 AND phase='ready' AND epoch=? AND schema_version=2", [id, prefix, entry.epoch]);
      if (update.changes !== 1) conflict(); return { ...entry, operationId: id, prefix };
    });
    // Hold the catalog writer lock throughout preparation + pointer CAS. A process crash
    // releases the lock but leaves the previously committed fence for recovery on reopen.
    await s.catalog.transaction(async tx => {
      const entry = await readRuntimeEntry(tx);
      if (entry.phase !== 'pending' || entry.operationId !== intent.operationId || entry.epoch !== intent.epoch) conflict();
      const prepared = await prepareV3Copy(s.source, s, intent.prefix, options.now(), options.migrate ?? migrateDatabaseV3);
      if (prepared.status !== 'prepared') runtimeBlocked(prepared.message);
      const next = entry.epoch + 1; if (!Number.isSafeInteger(next)) conflict();
      await tx.run("UPDATE runtime_transitions SET status='activated' WHERE operation_id=? AND status='pending'", [intent.operationId]);
      const updated = await tx.run("UPDATE runtime_state SET epoch=?,schema_version=3,active_key=?,phase='ready',operation_id=NULL,prefix=NULL WHERE id=1 AND epoch=? AND operation_id=?", [next, prepared.candidateKey, entry.epoch, intent.operationId]);
      if (updated.changes !== 1) conflict();
      await readRuntimeEntry(tx);
    });
    ready(3); // Only reached after the catalog COMMIT, including native callback completion.
  }
  function initialize(): Promise<void> {
    if (state.phase === 'ready') return Promise.resolve();
    if (booting) return booting;
    if (upgrading) return upgrading;
    publish('opening', null, 'Yerel kayıt ve şema doğrulanıyor…');
    openingFailure = null;
    booting = serial(async () => {
      if (store) { await store.close(); store = null; }
      store = await options.store();
      const catalogVersion = await store.catalog.transaction(async tx => (await tx.all('PRAGMA user_version'))[0]?.user_version);
      const sourceVersion = (await store.source.query.all('PRAGMA user_version'))[0]?.user_version;
      if (catalogVersion !== 0 && sourceVersion === 0) runtimeBlocked('Daha önce açılmış kaynağın dosyası eksik veya başlatılmamış. Boş bütçe oluşturulmadı.');
      await initializeCatalog(store.catalog);
      store = { ...store, catalog: catalogWriterMutex(store.catalog) };
      let entry = await store.catalog.transaction(readRuntimeEntry), recovered = false;
      if (entry.phase === 'pending') { await recover(); recovered = true; entry = await store.catalog.transaction(readRuntimeEntry); }
      entry = await store.catalog.transaction(async tx => { const current = await readRuntimeEntry(tx); if (current.phase !== 'ready') runtimeBlocked(); await verifyActive(current); return current; });
      if (entry.schema === 2 && options.autoUpgrade && !recovered) await transition();
      else ready(entry.schema, recovered ? 'Geçiş tamamlanmamıştı. Doğrulanmış v2 kaynak korundu; yeni geçiş başlatılmadı.' : '');
    }).catch((error: unknown) => { openingFailure = error; publish('blocked', null, 'Yerel açılış veya geçiş tamamlanamadı. Otomatik silme veya sıfırlama yapılmadı. Güvenli yeniden açılış gerekiyor.'); throw error; })
      .finally(() => { booting = null; });
    return booting;
  }
  async function finance<T>(access: BudgetAccess | undefined, task: (lease: {
    entry: RuntimeEntry; v2: ReturnType<typeof createBudgetRepository>; v3: ReturnType<typeof createBudgetRepositoryV3>;
  }) => Promise<T>): Promise<T> {
    if (state.phase === 'blocked' && openingFailure instanceof BudgetStorageError && openingFailure.code === 'UNSUPPORTED') throw openingFailure;
    if (['upgrading','recovering','blocked'].includes(state.phase)) runtimeBlocked(state.message);
    await initialize();
    return serial(async () => {
      if (state.phase !== 'ready') runtimeBlocked(state.message);
      const s = requireStore();
      try {
        return await s.catalog.transaction(async tx => {
          const entry = await readRuntimeEntry(tx);
          if (entry.phase !== 'ready') runtimeBlocked();
          if (entry.schema === 3 && !options.allowV3) runtimeBlocked();
          if (access && (access.epoch !== entry.epoch || access.schema !== entry.schema)) conflict();
          const db = entry.activeKey === 'source' ? s.source : await s.reopen(entry.activeKey);
          try {
            const checked = versioned(db.database, entry.schema);
            const value = await task({ entry, v2: createBudgetRepository(checked), v3: createBudgetRepositoryV3(checked) });
            if (state.schema !== entry.schema) ready(entry.schema);
            return value;
          } finally { if (db !== s.source) await db.close(); }
        });
      } catch (error) {
        if (error instanceof Error && /SQLITE_BUSY|database is (locked|busy)/i.test(error.message)) runtimeBlocked();
        throw error;
      }
    });
  }
  function v3Scope(access: BudgetAccess | undefined) {
    if (!access || access.schema !== 3 || !access.period) conflict();
    return { bookId: access.bookId, periodId: access.period.id, periodPublicId: access.period.publicId,
      expectedRevision: access.period.revision, expectedActivationRevision: access.activationRevision };
  }
  const api: ApplicationRepository & { upgrade(): Promise<void>; close(): Promise<void> } = {
    initialize, getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open: asOf => finance(undefined, async ({ entry, v2, v3 }) => entry.schema === 2 ? v2View(await v2.load(asOf), entry.epoch) :
      v3View(await v3.loadActivePeriod(1, asOf), await v3.loadBook(1), entry.epoch)),
    load: async asOf => (await api.open(asOf)).saved,
    newOperationId: () => finance(undefined, ({ entry, v2, v3 }) => entry.schema === 2 ? v2.newOperationId() : v3.newPublicId()),
    save: request => {
      const access = captureAccess(request.access), command: ScopedSave = { ...request, access, input: { ...request.input,
        balanceSnapshot: { ...request.input.balanceSnapshot }, payments: request.input.payments.map(p => ({ ...p })), transactions: request.input.transactions.map(t => ({ ...t })) },
        paymentNames: request.paymentNames.map(p => ({ ...p })) };
      return finance(access, async ({ entry, v2, v3 }) => {
        if (entry.schema === 2) { const result = v2View(await v2.save(command), entry.epoch).saved; if (!result) conflict(); return result; }
        if (!access || access.schema !== 3 || command.expectedRevision !== (access.period?.revision ?? null)) conflict();
        const target = access.period ? { kind: 'existing' as const, periodId: access.period.id, publicId: access.period.publicId, expectedRevision: access.period.revision } :
          { kind: 'initial' as const, publicId: publicId(command.operationId) };
        const saved = await v3.saveBudget({ operationId: command.operationId, bookId: access.bookId, expectedActivationRevision: access.activationRevision,
          target, input: command.input, paymentNames: command.paymentNames });
        const result = v3View(saved, await v3.loadBook(access.bookId), entry.epoch).saved; if (!result) conflict(); return result;
      });
    },
    addExpense: request => {
      const access = captureAccess(request.access), command = { ...request, access, expense: { ...request.expense } };
      return finance(access, async ({ entry, v2, v3 }) => {
        if (entry.schema === 2) { const result = v2View(await v2.addExpense(command), entry.epoch).saved; if (!result) conflict(); return result; }
        const scope = v3Scope(access); if (scope.periodId !== command.periodId || scope.expectedRevision !== command.expectedRevision) conflict();
        const saved = await v3.addExpense({ ...scope, operationId: command.operationId, expensePublicId: publicId(command.operationId), asOf: command.asOf, expense: command.expense });
        const result = v3View(saved, await v3.loadBook(scope.bookId), entry.epoch).saved; if (!result) conflict(); return result;
      });
    },
    cancelExpense: request => {
      const access = captureAccess(request.access), command = { ...request, access };
      return finance(access, async ({ entry, v2, v3 }) => {
        if (entry.schema === 2) { const result = v2View(await v2.cancelExpense(command), entry.epoch).saved; if (!result) conflict(); return result; }
        const scope = v3Scope(access); if (scope.periodId !== command.periodId || scope.expectedRevision !== command.expectedRevision || !command.expensePublicId) conflict();
        const saved = await v3.cancelExpense({ ...scope, operationId: command.operationId, asOf: command.asOf, expenseId: command.expenseId,
          expensePublicId: command.expensePublicId, cancelledAt: command.cancelledAt });
        const result = v3View(saved, await v3.loadBook(scope.bookId), entry.epoch).saved; if (!result) conflict(); return result;
      });
    },
    periods: async () => {
      const access = (await api.open(options.now())).access; if (access.schema !== 3) runtimeBlocked('Dönem ekranları doğrulanmış v3 açılışından sonra kullanılabilir.');
      const bound = <T>(task: (repo: ReturnType<typeof createBudgetRepositoryV3>) => Promise<T>) => finance(access, lease => task(lease.v3));
      return { loadBook: id => bound(repo => repo.loadBook(id)), loadActivePeriod: (id, now) => bound(repo => repo.loadActivePeriod(id, now)),
        listClosedPeriods: id => bound(repo => repo.listClosedPeriods(id)), loadClosedPeriod: scope => { const captured = { ...scope }; return bound(repo => repo.loadClosedPeriod(captured)); },
        newPublicId: () => bound(repo => repo.newPublicId()), startPeriod: command => {
          const captured = { ...command, carryPayments: command.carryPayments.map(p => ({ ...p })) };
          return bound(repo => repo.startPeriod(captured));
        } };
    },
    upgrade: () => {
      if (!options.allowV3) return Promise.reject(new BudgetStorageError('UNSUPPORTED', 'Gerçek veride v3 etkinleştirmesi bu aşamada kapalı.'));
      if (upgrading) return upgrading;
      if (state.phase !== 'ready') return Promise.reject(new BudgetStorageError('MIGRATION', 'Önce güvenli açılışı tamamlayın.'));
      publish('upgrading', state.schema, 'Geçiş sürüyor. Finansal yazım kapalı.');
      upgrading = serial(transition).catch((error: unknown) => { publish('blocked', null, 'Geçiş kesinleşmedi. Güvenli yeniden açılışla kontrol edin; veriler sıfırlanmadı.'); throw error; }).finally(() => { upgrading = null; });
      return upgrading;
    },
    close: () => serial(async () => { publish('blocked', null, 'Yerel oturum kapatıldı.'); if (store) await store.close(); store = null; }),
  };
  return api;
}
