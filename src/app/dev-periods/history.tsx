import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { formatMinorTRY } from '@/features/budget-setup/format';
import { useFocusedPeriodResource } from '@/features/periods/hooks';
import { Action, Metric, Notice, PeriodShell, ui } from '@/features/periods/period-ui';
import { periodRange } from '@/features/periods/presentation';
import { usePeriodPreview } from '@/features/periods/preview-provider';

export default function PeriodHistoryScreen() {
  const { workspace, routes } = usePeriodPreview(); const state = useFocusedPeriodResource(workspace.history);
  return <PeriodShell title="Dönem geçmişiniz" subtitle="Her dönem kendi bakiyesi, harcamaları ve kayıtlı kapanış sonucuyla korunur." back={() => router.replace(routes.home)}>
    {state.status === 'loading' && <View style={ui.row}><ActivityIndicator /><Text style={ui.small}>Örnek arşiv yükleniyor…</Text></View>}
    {state.error && <><Notice error>{state.error} Önceki liste varsa aşağıda korunuyor.</Notice><Action label="Arşivi tekrar yükle" secondary onPress={() => { void workspace.history.refresh(); }} /></>}
    {state.status === 'ready' && state.data?.length === 0 && <Notice>Henüz arşivlenmiş dönem yok. Yeni dönem oluşturulduğunda önceki dönem burada görünecek.</Notice>}
    {state.data?.map(period => <Pressable key={period.publicId} accessibilityRole="link" accessibilityLabel={`${periodRange(period)} arşiv dönemini aç`}
      onPress={() => router.push({ pathname: routes.archive, params: { periodId: String(period.id), bookId: String(period.bookId), publicId: period.publicId } })}
      style={({ pressed }) => [ui.card, pressed && ui.pressed]}>
      <View style={ui.row}><Text style={ui.eyebrow}>KAPALI DÖNEM</Text><Text style={ui.small}>İncele ›</Text></View>
      <Text style={ui.sectionTitle}>{periodRange(period)}</Text>
      <Metric label="Kapanış bakiyesi" amount={formatMinorTRY(period.result.remainingBalanceMinor)} negative={period.result.remainingBalanceMinor < 0} />
      <Metric label="Başlangıçtan sonraki harcama" amount={formatMinorTRY(period.result.spentSinceSnapshotMinor)} />
      <View style={ui.divider} /><Text style={ui.small}>{period.payments.length} fatura · {period.expenses.length} harcama kaydı · {period.expenses.filter(row => row.status === 'cancelled').length} iptal</Text>
      <Text style={ui.small}>Kapanış sonucu sabittir. Düzenleme yapılamaz.</Text>
    </Pressable>)}
  </PeriodShell>;
}
