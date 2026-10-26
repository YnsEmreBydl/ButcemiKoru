import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BudgetColors } from '@/constants/budget-theme';
import type { ApplicationBudget } from '@/data/budget/application-contracts';
import { formatCalendarDate, formatMinorTRY } from '@/features/budget-setup/format';

export function BudgetSummary({ saved, busy, onRefresh }: { saved: ApplicationBudget; busy: boolean; onRefresh: () => void }) {
  const { result } = saved;
  return <View style={styles.content}>
    <Text style={styles.note}>BU CİHAZDA KAYITLI · {formatCalendarDate(result.today)}</Text>
    <Text style={styles.note}>Bütçenin saat dilimi: {result.timeZone}</Text>
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>GÜNLÜK ÖNERİLEN HARCAMA</Text>
      {result.periodStatus === 'active'
        ? <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6}>{formatMinorTRY(result.daily.recommendedDailyMinor)}</Text>
        : <Text style={styles.heading}>Yeni bütçe dönemi gerekiyor</Text>}
      <Text style={styles.note}>Maaşa kalan: {result.daysUntilPayday} gün · {formatCalendarDate(result.nextPayday)}</Text>
    </View>
    {result.requiresNewPeriod && <Text style={styles.warning}>{saved.access.schema === 3 ? 'Bu dönem sona erdi. Yeni dönemde güncel kullanılabilir bakiyenizi açıkça girin; maaş geliri otomatik eklenmez.' : saved.expenses.length
      ? 'Bu dönem sona erdi; yeni harcama eklenmez. Hatalı kayıtları iptal edebilirsiniz. Harcama geçmişi korunduğu için başlangıç ve maaş tarihi kilitlidir; yeni dönem açılışı bu sürümde sunulmaz.'
      : 'Maaş tarihi bugün veya geçmişte. Maaş geliri otomatik eklenmedi. Güncel kullanılabilir bakiyeyi ve sonraki maaş tarihini düzenleyin.'}</Text>}
    <View style={styles.card}>
      <Text style={styles.note}>Toplam harcanabilir tutar{result.requiresNewPeriod ? ' (girilen dönem)' : ''}</Text>
      <Text style={[styles.total, result.spendableMinor < 0 && styles.negative]}>{formatMinorTRY(result.spendableMinor)}</Text>
      <Text style={styles.note}>Harcamalar sonrası hesap bakiyesi: {formatMinorTRY(result.remainingBalanceMinor)}</Text>
      <Text style={styles.note}>Bekleyen faturalar: {formatMinorTRY(result.reservedPaymentsMinor)}</Text>
      <Text style={styles.note}>Birikim hedefi: {formatMinorTRY(result.savingsReservedMinor)}</Text>
    </View>
    {result.periodStatus === 'active' && <View style={styles.card}>
      <Text style={styles.heading}>Bugünün hedefi</Text>
      <Text style={styles.note}>Gün başlangıcı: {formatMinorTRY(result.daily.todayStartTargetMinor)}</Text>
      <Text style={[styles.total, result.daily.todayRemainingMinor < 0 && styles.negative]}>{formatMinorTRY(result.daily.todayRemainingMinor)}</Text>
      <Text style={styles.note}>Bugünkü hedeften kalan. Eksi tutar hedefin aşıldığını gösterir.</Text>
      <Text style={styles.note}>{result.daily.forwardDailyAverageMinor === null ? 'Bu dönemin son bütçe günü.' : `Yarından itibaren günlük ortalama: ${formatMinorTRY(result.daily.forwardDailyAverageMinor)}`}</Text>
      <Text style={styles.note}>Bu hedef, yukarıdaki güncel eşit dağıtım önerisinden ayrıdır; tutarlar birbirine eklenmez.</Text>
    </View>}
    {result.budgetDeficitMinor > 0 && <Text accessibilityLiveRegion="polite" style={styles.warning}>Bütçe açığı: {formatMinorTRY(result.budgetDeficitMinor)}. Eksi tutar gizlenmedi; açık yeni harcama bütçesi değildir.</Text>}
    <Link href="/expense-add" asChild>
      <Pressable accessibilityRole="button" disabled={busy || result.requiresNewPeriod}
        accessibilityState={{ disabled: busy || result.requiresNewPeriod }}
        style={StyleSheet.flatten([styles.button, (busy || result.requiresNewPeriod) && styles.disabled])}>
        <Text style={styles.buttonText}>Harcama ekle</Text>
      </Pressable>
    </Link>
    {saved.access.schema === 3 && <>
      <Link href="/periods" style={styles.link}>{result.requiresNewPeriod ? 'Yeni bütçe dönemi oluştur' : 'Dönem bilgilerini aç'}</Link>
      <Link href="/periods/history" style={styles.link}>Dönem geçmişi ve arşiv</Link>
    </>}
    <Link href="/budget-setup" asChild><Pressable accessibilityRole="button" disabled={busy} style={styles.secondary}><Text style={styles.link}>Bütçe bilgilerimi düzenle</Text></Pressable></Link>
    {saved.expenses.length > 0 && <Text style={styles.note}>Harcama geçmişi olan dönemde başlangıç bakiyesi ve maaş tarihi değiştirilemez. Banka bakiyesi otomatik güncellenmez.</Text>}
    <View style={styles.card}>
      <Text style={styles.heading}>Bekleyen faturalar</Text>
      {saved.input.payments.length === 0 && <Text style={styles.note}>Kayıtlı fatura yok.</Text>}
      {saved.input.payments.map((payment) => <View key={payment.id} style={styles.content}>
        <Text style={styles.name}>{saved.paymentNames.find((row) => row.id === payment.id)?.name}</Text>
        <Text style={styles.note}>{formatMinorTRY(payment.amountMinor)} · {formatCalendarDate(payment.dueOn)}</Text>
      </View>)}
    </View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={onRefresh} style={styles.secondary}><Text style={styles.link}>Bütçeyi yeniden hesapla</Text></Pressable>
    <Text accessibilityRole="header" style={styles.heading}>Harcama geçmişi</Text>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: 16 },
  heading: { color: BudgetColors.ink, fontSize: 18, lineHeight: 26, fontWeight: '700' },
  name: { color: BudgetColors.ink, fontSize: 14, fontWeight: '600' },
  note: { color: BudgetColors.secondary, fontSize: 13, lineHeight: 21 },
  card: { backgroundColor: BudgetColors.surface, borderRadius: 24, padding: 20, gap: 12, borderWidth: 1, borderColor: BudgetColors.border },
  hero: { backgroundColor: BudgetColors.greenSoft, borderRadius: 26, padding: 22, gap: 14 },
  heroLabel: { color: BudgetColors.green, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  amount: { color: BudgetColors.green, fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  total: { color: BudgetColors.ink, fontSize: 29, fontWeight: '700', fontVariant: ['tabular-nums'] },
  negative: { color: '#922F2F' },
  warning: { color: '#803A24', backgroundColor: '#FFF3EC', padding: 18, borderRadius: 18, fontSize: 14, lineHeight: 23 },
  button: { backgroundColor: BudgetColors.primary, minHeight: 54, padding: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: BudgetColors.surface, fontSize: 15, fontWeight: '600' },
  secondary: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: 0.5 },
  link: { color: BudgetColors.green, fontSize: 13, lineHeight: 22 },
});
