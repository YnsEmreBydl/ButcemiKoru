import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { ApplicationRepository } from '../../data/budget/application-contracts';
import { useApplicationRepository } from '../application/provider';
import { periodRoutes } from './routes';

import { previewEnabled } from './contracts';
import { createFixturePeriodPort } from './fixture-port';
import { createPeriodWorkspace } from './workspace';

function createSession() {
  const fixture = createFixturePeriodPort();
  return { mode: 'demo' as const, routes: periodRoutes('demo'), workspace: createPeriodWorkspace(fixture.port, fixture.now, fixture.bookId), setScenario: fixture.setScenario, scenario: fixture.scenario };
}
type DemoSession = ReturnType<typeof createSession>;
type SavedSession = { mode: 'saved'; routes: ReturnType<typeof periodRoutes>; workspace: ReturnType<typeof createPeriodWorkspace> };
type Session = DemoSession | SavedSession;
let developmentSession: DemoSession | null = null;
const Context = createContext<Session | null>(null);

function getDevelopmentSession(): DemoSession {
  if (!previewEnabled(__DEV__)) throw Error('Development preview is disabled.');
  developmentSession ??= createSession();
  return developmentSession;
}
const savedSessions = new WeakMap<ApplicationRepository, Map<number, Promise<SavedSession>>>();
async function savedSession(app: ApplicationRepository): Promise<SavedSession> {
  const opened = await app.open(new Date().toISOString());
  if (opened.access.schema !== 3) throw Error('Dönem ekranları yalnız doğrulanmış geçişten sonra kullanılabilir.');
  let cache = savedSessions.get(app); if (!cache) { cache = new Map(); savedSessions.set(app, cache); }
  const existing = cache.get(opened.access.epoch); if (existing) return existing;
  const session = app.periods().then(port => ({ mode: 'saved' as const, routes: periodRoutes('saved'),
    workspace: createPeriodWorkspace(port, () => new Date().toISOString(), opened.access.bookId, 'saved') }))
    .catch(error => { cache.delete(opened.access.epoch); throw error; });
  cache.set(opened.access.epoch, session); return session;
}
export function SavedPeriodsProvider({ children }: { children: ReactNode }) {
  const app = useApplicationRepository();
  const appState = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const [state, setState] = useState<{ session?: SavedSession; error?: string }>({});
  useEffect(() => { let active = true; if (appState.phase !== 'ready') return;
    void savedSession(app).then(session => { if (active) setState({ session }); },
    () => { if (active) setState({ error: 'Dönem ekranları açılamadı. Güvenli geçişin tamamlandığını ve yerel kayıtların okunabildiğini kontrol edin.' }); });
    return () => { active = false; }; }, [app, appState.phase]);
  if (state.session) return <Context.Provider value={state.session}>{children}</Context.Provider>;
  return <View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 20 }}>
    {state.error ? <Text accessibilityLiveRegion="polite">{state.error}</Text> : <><ActivityIndicator /><Text>Dönem kayıtları doğrulanıyor…</Text></>}
    <Pressable accessibilityRole="button" onPress={() => router.replace('/')}><Text>Ana ekrana dön</Text></Pressable>
  </View>;
}
export function PeriodPreviewProvider({ children }: { children: ReactNode }) {
  const [session] = useState(getDevelopmentSession);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function usePeriodPreview(): Session {
  const value = useContext(Context); if (!value) throw Error('Period preview provider missing.'); return value;
}
