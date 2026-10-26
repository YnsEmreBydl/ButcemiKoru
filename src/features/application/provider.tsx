import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ApplicationRepository } from '../../data/budget/application-contracts';
import { getApplicationRepository } from '../../data/budget/platform';
import { BudgetColors } from '../../constants/budget-theme';

const Context = createContext<ApplicationRepository | null>(null);
export function useApplicationRepository(): ApplicationRepository { return useContext(Context) ?? getApplicationRepository(); }

/** Screens cannot mount against an unverified schema. Existing drafts remain mounted under the gate. */
export function BudgetApplicationProvider({ repository, children }: { repository?: ApplicationRepository; children: ReactNode }) {
  const app = repository ?? getApplicationRepository();
  const state = useSyncExternalStore(app.subscribe, app.getSnapshot, app.getSnapshot);
  const web = Platform.OS === 'web';
  useEffect(() => { if (!web) void app.initialize().catch(() => {}); }, [app, web]);
  const gated = !web && state.phase !== 'ready';
  return <Context.Provider value={app}><View style={styles.page}>
    {(state.hasOpened || web) && <View pointerEvents={gated ? 'none' : 'auto'} accessibilityElementsHidden={gated}
      importantForAccessibility={gated ? 'no-hide-descendants' : 'auto'} style={[styles.page, gated && styles.hidden]}>{children}</View>}
    {gated && <View style={styles.gate}>
      <Text accessibilityRole="header" style={styles.title}>Günlük Bütçem</Text>
      {state.phase !== 'blocked' && <ActivityIndicator color={BudgetColors.green} />}
      <Text accessibilityLiveRegion="polite" style={styles.copy}>{state.message}</Text>
      {state.phase === 'blocked' && <Pressable accessibilityRole="button" style={styles.button} onPress={() => { void app.initialize().catch(() => {}); }}>
        <Text style={styles.buttonText}>Güvenli açılışı yeniden dene</Text>
      </Pressable>}
    </View>}
  </View></Context.Provider>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: BudgetColors.background }, hidden: { display: 'none' },
  gate: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 22 }, title: { color: BudgetColors.ink, fontSize: 25, fontWeight: '700' },
  copy: { color: BudgetColors.secondary, fontSize: 15, lineHeight: 24, textAlign: 'center' }, button: { minHeight: 52, borderRadius: 16, backgroundColor: BudgetColors.primary, padding: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 } });
