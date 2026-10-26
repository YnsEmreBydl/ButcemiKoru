import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';

import type { ClosedPeriodV3, PeriodScopeV3 } from '@/data/budget/v3-contracts';
import { formatCalendarDate, formatMinorTRY } from '@/features/budget-setup/format';
import { parsePeriodScope } from '@/features/periods/contracts';
import { useFocusedPeriodResource } from '@/features/periods/hooks';
import { Action, Card, Metric, Notice, PeriodShell, ui } from '@/features/periods/period-ui';
import { presentArchive } from '@/features/periods/presentation';
import { usePeriodPreview } from '@/features/periods/preview-provider';

export default function ArchiveRoute() {
  const { routes } = usePeriodPreview();
  const params = useLocalSearchParams<{ bookId?: string; periodId?: string; publicId?: string }>();
  const scope = parsePeriodScope(params);
  if (!scope) return <PeriodShell title="Arşiv doğrulanamadı" subtitle="Dönem kimliği eksik veya geçersiz; başka kayıt gösterilmedi." back={() => router.replace(routes.history)}><Notice error>Arşivi dönem geçmişinden yeniden açın.</Notice></PeriodShell>;
  return <BoundArchive scope={scope} />;
}
function BoundArchive({ scope }: { scope: PeriodScopeV3 }) {
  const { workspace, routes } = usePeriodPreview(), resource = workspace.archive(scope), state = useFocusedPeriodResource(resource);
  return <PeriodShell title="Dönem arşivi" subtitle="Bu dönemin kaydedilmiş kapanışını ve harcama geçmişini inceleyin." back={() => router.replace(routes.history)}>
    {state.status === 'loading' && <View style={ui.row}><ActivityIndicator /><Text style={ui.small}>Kayıtlı kapanış okunuyor…</Text></View>}
    {state.error && <><Notice error>{state.error}</Notice><Action label="Dönemi tekrar yükle" secondary onPress={() => { void resource.refresh(); }} /></>}
    {state.data && <ReadonlyArchive period={state.data} />}
  </PeriodShell>;
}

/** No edit/cancel callback or mutable repository is available to this component. */
function ReadonlyArchive({ period }: { period: ClosedPeriodV3 }) {
  const view = presentArchive(period);
  return <>
    <Notice>ARŞİV · SALT OKUNUR. Kapanış: {view.closedAt}. Tutarlar bugünün tarihiyle yeniden hesaplanmadı.</Notice>
    <Card><Text style={ui.eyebrow}>KAYITLI KAPANIŞ SONUCU</Text><Text style={ui.sectionTitle}>{view.range}</Text>
      <Metric label="Başlangıç bakiyesi" amount={formatMinorTRY(period.input.balanceSnapshot.amountMinor)} negative={period.input.balanceSnapshot.amountMinor < 0} />
      <Metric label="Başlangıçtan sonraki harcama" amount={view.spent} />
      <Metric label="Kapanış bakiyesi" amount={view.balance} negative={period.result.remainingBalanceMinor < 0} />
      <Metric label="Fatura rezervi" amount={formatMinorTRY(period.result.reservedPaymentsMinor)} />
      <Metric label="Birikim için ayrılan" amount={formatMinorTRY(period.result.savingsReservedMinor)} />
      <Metric label="Kapanışta harcanabilir" amount={view.spendable} negative={period.result.spendableMinor < 0} />
      {period.result.budgetDeficitMinor > 0 && <Notice error>Kapanıştaki bütçe açığı: {view.deficit}</Notice>}
      <Text style={ui.small}>Toplam harcama, başlangıç bakiyesi anından sonraki aktif harcamadır. İptaller ve başlangıç bakiyesine dahil kayıtlar bu toplama dahil değildir.</Text>
    </Card>
    <Card><Text accessibilityRole="header" style={ui.sectionTitle}>Dönemin faturaları</Text>
      {period.payments.length === 0 && <Text style={ui.small}>Bu dönemde fatura kaydı yok.</Text>}
      {period.payments.map(payment => <View key={payment.publicId} style={{ gap: 5 }}><View style={ui.row}><Text style={ui.metricValue}>{payment.name}</Text><Text style={ui.metricValue}>{formatMinorTRY(payment.amountMinor)}</Text></View>
        <Text style={ui.small}>Vade: {formatCalendarDate(payment.dueOn)}{payment.carriedFrom ? ' · Önceki dönemden kopyalandı' : ''}</Text></View>)}
      <Text style={ui.small}>Faturalar dönem kaydındaki hâliyle gösterilir. Bu ekran ödeme veya düzenleme yapmaz.</Text>
    </Card>
    <Text accessibilityRole="header" style={ui.sectionTitle}>Harcama geçmişi</Text>
    {view.expenses.length === 0 && <Notice>Bu döneme ait harcama kaydı bulunmuyor.</Notice>}
    {view.expenses.map(expense => <Card key={expense.id}>
      <View style={ui.row}><Text style={ui.metricValue}>{expense.label}</Text><Text style={[ui.metricValue, expense.cancelled && { textDecorationLine: 'line-through' }]}>{expense.amount}</Text></View>
      {expense.description !== '' && <Text style={ui.description}>{expense.description}</Text>}
      <Text style={ui.small}>Gerçekleşme: {expense.occurredAt}</Text>
      {expense.createdAt !== expense.occurredAt && <Text style={ui.small}>Kayda giriş: {expense.createdAt}</Text>}
      <Text style={ui.badge}>{expense.cancelled ? `İPTAL EDİLDİ · ${expense.cancelledAt}` : 'GERÇEKLEŞEN HARCAMA'}</Text>
      {expense.includedInBalance && <Text style={ui.small}>Başlangıç bakiyesine dahil; ikinci kez düşülmedi.</Text>}
      {expense.cancelled && <Text style={ui.small}>Kayıt geçmişte korunur; harcama toplamına dahil edilmez.</Text>}
    </Card>)}
  </>;
}
