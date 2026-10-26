import { router } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import { formatMinorTRY } from '@/features/budget-setup/format';
import { useFocusedPeriodResource } from '@/features/periods/hooks';
import { Action, Card, Metric, Notice, PeriodShell, ui } from '@/features/periods/period-ui';
import { periodRange } from '@/features/periods/presentation';
import { usePeriodPreview } from '@/features/periods/preview-provider';

export default function PeriodPreviewHome() {
  const { workspace, routes, mode } = usePeriodPreview();
  const state = useFocusedPeriodResource(workspace.active), active = state.data?.period;
  return <PeriodShell title="Yeni bir döneme, temiz bir başlangıç." subtitle={mode === 'demo' ? 'Dönem geçişini ve arşivi gerçek bütçenize dokunmadan deneyin.' : 'Yeni döneminizi oluşturun veya kayıtlı dönemlerinizi inceleyin.'} back={() => router.replace('/')}>
    {state.status === 'loading' && <View style={ui.row}><ActivityIndicator /><Text style={ui.small}>Örnek dönem yükleniyor…</Text></View>}
    {state.error && <Notice error>{state.error}</Notice>}
    {active && <Card>
      <View style={ui.row}><Text style={ui.eyebrow}>{active.result.requiresNewPeriod ? 'DÖNEM SONA ERDİ' : (mode === 'demo' ? 'AKTİF ÖRNEK DÖNEM' : 'AKTİF DÖNEM')}</Text><Text style={ui.badge}>{mode === 'demo' ? 'ÖRNEK' : 'BU CİHAZDA'}</Text></View>
      <Text style={ui.sectionTitle}>{periodRange(active)}</Text>
      <Text style={ui.description}>{active.result.requiresNewPeriod ? 'Maaş günü geldi. Yeni dönem için güncel bakiyenizi siz belirleyin; geçmiş kayıtlar arşivde kalsın.' : 'Yeni döneminiz hazır. Önceki dönem kapanış sonucuyla birlikte arşivde korunuyor.'}</Text>
      <Metric label="Dönemde kalan bakiye" amount={formatMinorTRY(active.result.remainingBalanceMinor)} negative={active.result.remainingBalanceMinor < 0} />
      <Notice>Bu tutar yeni dönemin bakiye alanına otomatik aktarılmaz. Maaşın yattığı varsayılmaz.</Notice>
      <Action label={mode === 'demo' ? 'Yeni dönem oluştur · Ön izleme' : 'Yeni dönem oluştur'} disabled={!active.result.requiresNewPeriod || state.status === 'loading'} onPress={() => router.push({ pathname: routes.new, params: { bookId: String(active.bookId), periodId: String(active.id), publicId: active.publicId } })} />
      {!active.result.requiresNewPeriod && <Text style={ui.small}>Bu dönem henüz sona ermedi; ikinci bir dönem açma işlemi kapalıdır.</Text>}
    </Card>}
    <Action label="Dönem geçmişini görüntüle" secondary onPress={() => router.push(routes.history)} />
    {state.status === 'error' && <Action label="Yüklemeyi tekrar dene" secondary onPress={() => { void workspace.active.refresh(); }} />}
  </PeriodShell>;
}
