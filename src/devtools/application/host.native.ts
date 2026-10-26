import Constants from 'expo-constants';
import { isDevice } from 'expo-device';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import type { RuntimeStore } from '../../data/budget/application-contracts';
import { createApplicationRuntime } from '../../data/budget/application-runtime';
import { openNativeRuntimeStore } from '../../data/budget/runtime-store.native';
import { calendarDateAt } from '../../domain/budget';
import { seedLegacy } from '../native-v3/fixtures';
import { ensure, safeError, type LabConfig } from '../native-v3/types';
import { runApplicationSuite } from './suite';
import { integrationUI } from './ui-driver';
import { readRuntimeEntry } from '../../data/budget/runtime-catalog';
import { seedApplicationUIFixture } from './ui-fixture';

export function createIntegrationHost(config: LabConfig & { receiver?: { url: string; token: string } }) {
  const identity = { independentApp: Constants.expoConfig?.slug === 'gb-v3-integration', platform: Platform.OS,
    physicalDevice: isDevice, hermes: Reflect.get(globalThis,'HermesInternal') !== undefined, development: __DEV__, testBuild: Constants.expoConfig?.extra?.integrationTesting === true };
  ensure(identity.independentApp && (identity.development || identity.testBuild) && identity.hermes && ['ios','android'].includes(identity.platform), 'NOT_IN_INTEGRATION_APP');
  const primaryStore = async () => {
    const s = await openNativeRuntimeStore({ kind: 'integration', runId: config.runId });
    if ((await s.source.query.all('PRAGMA user_version'))[0]?.user_version === 0) {
      // Synthetic UI fixture has payday today; all historical records remain synthetic.
      const today = calendarDateAt(new Date().toISOString(), 'Europe/Istanbul');
      await seedApplicationUIFixture(s.source,config.fixtures,today);
    }
    return s;
  };
  const app = createApplicationRuntime({ store: primaryStore, allowV3: true, autoUpgrade: true, now: () => new Date().toISOString() });
  const executionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  type SuiteReport = Awaited<ReturnType<typeof runApplicationSuite>>;
  let state: { identity: typeof identity; app: ReturnType<typeof app.getSnapshot>; running: boolean; stage: string; report: SuiteReport | null; error: string | null } =
    { identity, app: app.getSnapshot(), running: false, stage: '', report: null, error: null };
  const listeners = new Set<() => void>(); const publish = () => listeners.forEach(fn => fn());
  app.subscribe(() => { state = { ...state, app: app.getSnapshot() }; publish(); });
  let pending: Promise<void> | null = null;
  return {
    app, ui: integrationUI, getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    navigate: (path: '/' | '/periods' | '/periods/history' | '/budget-setup' | '/expense-add' | '/explore') => router.push(path),
    run(): Promise<void> {
      if (pending) return pending;
      pending = Promise.resolve().then(async () => {
        ensure(app.getSnapshot().phase === 'ready', 'APP_NOT_READY');
        const ids = new Map<string,string>(), stores = new Map<string,RuntimeStore[]>();
        const report = await runApplicationSuite({ store: async label => {
          let id = ids.get(label), fresh = false;
          if (!id) {
            const metadata = await openNativeRuntimeStore({ kind: 'integration', runId: config.runId });
            try { const rows = await metadata.catalog.transaction(tx => tx.all('SELECT lower(hex(randomblob(16))) AS id'));
              ensure(typeof rows[0]?.id === 'string', 'NO_CASE_ID'); id = rows[0].id; ids.set(label,id); fresh = true;
            } finally { await metadata.close(); }
          }
          const s = await openNativeRuntimeStore({ kind: 'integration', runId: id });
          const list = stores.get(label) ?? []; list.push(s); stores.set(label,list);
          if (fresh) { ensure((await s.source.query.all('PRAGMA user_version'))[0]?.user_version === 0, 'CASE_FILE_EXISTS'); await seedLegacy(s.source,config.fixtures,2); }
          return s;
        }, closeCase: async label => { for (const s of stores.get(label) ?? []) await s.close(); } }, stage => { state = { ...state, stage }; publish(); });
        state = { ...state, report }; publish();
        if (config.receiver) {
          const metadata = await openNativeRuntimeStore({ kind: 'integration', runId: config.runId });
          try {
            const entry = await metadata.catalog.transaction(readRuntimeEntry);
            const sourceSchema = (await metadata.source.query.all('PRAGMA user_version'))[0]?.user_version;
            const sqliteVersion = (await metadata.source.query.all('SELECT sqlite_version() AS v'))[0]?.v;
            const transitionCount = (await metadata.catalog.transaction(tx => tx.all("SELECT count(*) AS n FROM runtime_transitions WHERE status='activated'")))[0]?.n;
            const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
            try {
              const response = await fetch(config.receiver.url, { method: 'POST', signal: abort.signal, headers: { 'content-type': 'application/json', 'x-gb-lab-token': config.receiver.token },
                body: JSON.stringify({ identity, executionId, report, bootProof: { sourceSchema, activeSchema: entry.schema, catalogEpoch: entry.epoch, transitionCount, sqliteVersion } }) });
              ensure(response.ok, 'REPORT_TRANSPORT_FAILED');
            } finally { clearTimeout(timer); }
          } finally { await metadata.close(); }
        }
        state = { ...state, report, running: false }; publish();
      }).catch(error => { state = { ...state, error: safeError(error), running: false }; publish(); }).finally(() => { pending = null; });
      state = { ...state, running: true, error: null, report: null }; publish(); return pending;
    },
  };
}
export type IntegrationHost = ReturnType<typeof createIntegrationHost>;
declare global { var __GB_V3_INTEGRATION__: IntegrationHost | undefined; }
