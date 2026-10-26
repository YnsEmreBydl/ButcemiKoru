import { Link, Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetIcon } from '@/components/budget/budget-icon';
import { BudgetColors } from '@/constants/budget-theme';
import type { ScopedCancel } from '@/data/budget/application-contracts';
import { BudgetStorageError, storageErrorMessage } from '@/data/budget/errors';
import { useApplicationRepository } from '@/features/application/provider';
import { ExpenseHistoryRow } from '@/features/expenses/history-row';

import { BudgetSummary } from './budget-summary';
import { useSavedBudget } from './use-saved-budget';
import { shouldOpenSetup } from './load-state';

export default function SavedBudgetHomeScreen() {
  const repository = useApplicationRepository();
  const { state, refresh, acceptSaved } = useSavedBudget();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const attempts = useRef(new Map<string, ScopedCancel>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const saved = state.status === 'ready' ? state.saved : null;

  async function cancel(expenseId: string) {
    if (busy.current || !saved) return;
    busy.current = true; setBusyId(expenseId); setError(null);
    try {
      let command = attempts.current.get(expenseId);
      if (!command) {
        const operationId = await repository.newOperationId();
        const cancelledAt = new Date().toISOString();
        command = { operationId, periodId: saved.access.period?.id ?? 1, access: saved.access, expensePublicId: saved.expensePublicIds[expenseId],
          expectedRevision: saved.revision, expenseId, cancelledAt, asOf: cancelledAt };
        attempts.current.set(expenseId, command);
      }
      const next = await repository.cancelExpense({ ...command, asOf: new Date().toISOString() });
      attempts.current.delete(expenseId);
      if (mounted.current) {
        acceptSaved(next);
        AccessibilityInfo.announceForAccessibility('Harcama kaydı iptal edildi. Bütçe yeniden hesaplandı.');
      }
    } catch (reason) {
      if (reason instanceof BudgetStorageError && reason.code !== 'IO') attempts.current.delete(expenseId);
      if (mounted.current) setError(`${storageErrorMessage(reason)} Son okunan bütçe gösteriliyor; gerekirse yeniden hesaplayın.`);
    } finally { busy.current = false; if (mounted.current) setBusyId(null); }
  }

  function confirmCancel(expenseId: string) {
    if (busy.current) return;
    Alert.alert('Harcama kaydı iptal edilsin mi?', 'Kayıt geçmişte iptal durumuyla saklanır ve bütçeye etkisi geri alınır. Bankadan iade veya ödeme iptali başlatılmaz. Başlangıç bakiyesine dahil eski bir kaydın iptali bakiyeyi artırmaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Kaydı iptal et', style: 'destructive', onPress: () => { void cancel(expenseId); } },
    ]);
  }

  if (shouldOpenSetup(state)) return <Redirect href="/budget-setup" />;
  return <SafeAreaView style={styles.screen}>
    <FlatList
      data={saved?.expenses ?? []}
      keyExtractor={(expense) => expense.id}
      contentContainerStyle={styles.content}
      refreshing={state.status === 'ready' && Boolean(state.refreshing)}
      onRefresh={busyId ? undefined : refresh}
      ListHeaderComponent={<View style={styles.stack}>
        <View style={styles.header}><BudgetIcon name="wallet" color={BudgetColors.green} /><Text accessibilityRole="header" style={styles.title}>Günlük Bütçem</Text></View>
        {state.status === 'loading' && <Text accessibilityLiveRegion="polite" style={styles.note}>Yerel bütçe okunuyor…</Text>}
        {(state.status === 'error' || state.status === 'unsupported') && <View style={styles.card}>
          <Text style={styles.heading}>{state.status === 'unsupported' ? 'Mobil yerel kayıt' : 'Bütçe açılamadı'}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.error}>{state.message}</Text>
          {state.status === 'error' && <Pressable accessibilityRole="button" onPress={refresh} style={styles.retry}><Text style={styles.link}>Tekrar dene</Text></Pressable>}
          {state.status === 'unsupported' && <Link href="/budget-setup" style={styles.link}>Kaydetmeden web ön izlemesi</Link>}
        </View>}
        {state.status === 'ready' && state.message && <Text accessibilityLiveRegion="polite" style={styles.error}>{state.message} Son okunan bütçe gösteriliyor.</Text>}
        {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        {saved && <BudgetSummary saved={saved} busy={busyId !== null} onRefresh={refresh} />}
      </View>}
      ListEmptyComponent={saved ? <Text style={styles.note}>Henüz harcama kaydı yok. İlk gerçek harcamanızı Harcama ekle ile kaydedebilirsiniz.</Text> : undefined}
      renderItem={({ item }) => saved ? <ExpenseHistoryRow expense={item} timeZone={saved.input.timeZone} capturedAt={saved.input.balanceSnapshot.capturedAt}
        disabled={busyId !== null} busy={busyId === item.id} onCancel={confirmCancel} /> : null}
      ListFooterComponent={<View style={styles.stack}>
        {saved && <>
          <Text style={styles.note}>Yerel veritabanı varsayılan olarak şifreli değildir. Uygulama bulut yedeği veya cihazlar arası eşitleme yapmaz. Cihazınızın kendi yedekleme ayarları ayrıca geçerlidir.</Text>
          <Text style={styles.note}>Bu bir planlama önerisidir; kesin harcama güvenliği anlamına gelmez.</Text>
        </>}
        <Link href="/demo" style={styles.link}>Ayrı DEMO ekranını aç · örnek veriler</Link>
      </View>}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BudgetColors.background },
  content: { width: '100%', maxWidth: 560, padding: 20, gap: 20, alignSelf: 'center', flexGrow: 1 },
  stack: { gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: BudgetColors.ink, fontSize: 23, fontWeight: '700', flexShrink: 1 },
  heading: { color: BudgetColors.ink, fontSize: 18, lineHeight: 26, fontWeight: '700' },
  note: { color: BudgetColors.secondary, fontSize: 13, lineHeight: 21 },
  card: { backgroundColor: BudgetColors.surface, borderRadius: 24, padding: 20, gap: 12, borderWidth: 1, borderColor: BudgetColors.border },
  error: { color: '#922F2F', fontSize: 14, lineHeight: 22 },
  retry: { minHeight: 44, justifyContent: 'center' },
  link: { color: BudgetColors.green, fontSize: 13, lineHeight: 22, paddingVertical: 8 },
});
