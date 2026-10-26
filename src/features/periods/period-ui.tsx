import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BudgetColors as C, BudgetRadius } from '@/constants/budget-theme';
import type { BudgetResult } from '@/domain/budget';
import { formatMinorTRY } from '@/features/budget-setup/format';
import { usePeriodPreview } from './preview-provider';

export function PeriodShell({ title, subtitle, back, children }: { title: string; subtitle: string; back: () => void; children: ReactNode }) {
  const { mode } = usePeriodPreview();
  return <SafeAreaView style={ui.screen}>
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={ui.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentInsetAdjustmentBehavior="never">
        <View style={ui.content}>
          <View style={ui.navigation}>
            <Pressable accessibilityRole="button" accessibilityLabel="Önceki ön izleme ekranına dön" onPress={back} style={ui.back}><Text style={ui.backText}>‹ Geri</Text></Pressable>
            <Text style={ui.badge}>{mode === 'demo' ? 'V3 · ÖN İZLEME' : 'DÖNEMLER'}</Text>
          </View>
          <View style={ui.heading}><Text style={ui.eyebrow}>GÜNLÜK BÜTÇEM</Text><Text accessibilityRole="header" style={ui.title}>{title}</Text><Text style={ui.description}>{subtitle}</Text></View>
          {mode === 'demo' && <View style={ui.fixtureNotice}><Text style={ui.noticeTitle}>Yalnızca örnek veriler</Text><Text style={ui.small}>Gerçek bütçenize erişilmez, cihazınıza kayıt yapılmaz. Örnek gün: 04.11.2026. Uygulama yeniden yüklendiğinde bu deneme sıfırlanır.</Text></View>}
          {children}
          <Text style={ui.footer}>{mode === 'demo' ? 'Geliştirme ön izlemesi · Gerçek kullanıma açık değildir.' : 'Yerel dönem kayıtları · Banka bağlantısı veya bulut senkronizasyonu yoktur.'}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export function Card({ children }: { children: ReactNode }) { return <View style={ui.card}>{children}</View>; }
export function Action({ label, onPress, secondary = false, disabled = false, busy = false }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [ui.action, secondary && ui.secondaryAction, (disabled || busy) && ui.disabled, pressed && ui.pressed]}>
    {busy && <ActivityIndicator color={secondary ? C.green : '#fff'} />}
    <Text style={[ui.actionText, secondary && ui.secondaryActionText]}>{label}</Text>
  </Pressable>;
}
export function Check({ label, helper, checked, onChange, disabled = false }: { label: string; helper?: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityHint={helper} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onChange}
    style={({ pressed }) => [ui.checkRow, disabled && ui.disabled, pressed && ui.pressed]}>
    <View style={[ui.checkBox, checked && ui.checked]}><Text accessible={false} style={ui.checkMark}>{checked ? '✓' : ''}</Text></View>
    <View style={ui.checkCopy}><Text style={ui.checkLabel}>{label}</Text>{helper && <Text style={ui.small}>{helper}</Text>}</View>
  </Pressable>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <View style={[ui.notice, error && ui.errorNotice]}><Text accessibilityLiveRegion="polite" style={[ui.small, error && ui.errorText]}>{children}</Text></View>;
}
export function Metric({ label, amount, negative = false }: { label: string; amount: string; negative?: boolean }) {
  return <View style={ui.metricRow}><Text style={ui.small}>{label}</Text><Text style={[ui.metricValue, negative && ui.errorText]}>{amount}</Text></View>;
}
export function PreviewSummary({ result }: { result: BudgetResult }) {
  return <View style={ui.summary}>
    <Text style={ui.eyebrow}>YENİ DÖNEMİN ÖN İZLEMESİ</Text>
    <Text style={ui.summaryLabel}>Günlük harcama önerisi</Text>
    <Text adjustsFontSizeToFit minimumFontScale={0.5} numberOfLines={1} style={ui.bigAmount}>{formatMinorTRY(result.daily?.recommendedDailyMinor ?? 0)}</Text>
    <Text style={ui.summaryHint}>{result.daysUntilPayday} takvim günü · Maaş geliri eklenmedi</Text>
    <View style={ui.summaryDivider} />
    <Metric label="Kullanılabilir bakiye" amount={formatMinorTRY(result.remainingBalanceMinor)} negative={result.remainingBalanceMinor < 0} />
    <Metric label="Faturalar için ayrılan" amount={formatMinorTRY(result.reservedPaymentsMinor)} />
    <Metric label="Birikim hedefi" amount={formatMinorTRY(result.savingsReservedMinor)} />
    <Metric label="Toplam harcanabilir" amount={formatMinorTRY(result.spendableMinor)} negative={result.spendableMinor < 0} />
    {result.budgetDeficitMinor > 0 && <Notice error>Bütçe açığı: {formatMinorTRY(result.budgetDeficitMinor)}. Negatif tutar korunur; günlük öneri kesin harcama güvenliği anlamına gelmez.</Notice>}
  </View>;
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.background }, scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 36, alignItems: 'center' },
  content: { width: '100%', maxWidth: 560, gap: 20 }, navigation: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  back: { minHeight: 44, justifyContent: 'center', paddingRight: 12 }, backText: { color: C.green, fontSize: 15, fontWeight: '600' },
  badge: { color: C.green, backgroundColor: C.greenSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  heading: { gap: 10 }, eyebrow: { color: C.green, fontSize: 10, letterSpacing: 1.6, fontWeight: '700', lineHeight: 17 },
  title: { color: C.ink, fontSize: 32, lineHeight: 39, fontWeight: '700', letterSpacing: -0.8 }, description: { color: C.secondary, fontSize: 15, lineHeight: 23 },
  fixtureNotice: { backgroundColor: '#F5F0E5', borderColor: '#E8DDC9', borderWidth: 1, borderRadius: 16, padding: 14, gap: 5 },
  noticeTitle: { color: '#755E35', fontWeight: '700', fontSize: 12, lineHeight: 18 }, small: { color: C.secondary, fontSize: 12, lineHeight: 19 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: BudgetRadius.card, padding: 20, gap: 18 },
  sectionTitle: { color: C.ink, fontSize: 19, lineHeight: 27, fontWeight: '700', flexShrink: 1 }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  action: { minHeight: 54, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: C.primary, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  actionText: { fontWeight: '700', color: '#fff', fontSize: 15, textAlign: 'center', lineHeight: 22, flexShrink: 1 },
  secondaryAction: { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface }, secondaryActionText: { color: C.green }, disabled: { opacity: 0.55 }, pressed: { opacity: 0.7 },
  checkRow: { minHeight: 52, flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 6 }, checkCopy: { flex: 1, gap: 5 },
  checkBox: { borderRadius: 8, borderWidth: 1.5, borderColor: C.secondary, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checked: { backgroundColor: C.green, borderColor: C.green }, checkMark: { color: '#fff', fontSize: 16, fontWeight: '700' }, checkLabel: { color: C.ink, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  notice: { padding: 14, borderRadius: 14, backgroundColor: C.greenSoft, gap: 8 }, errorNotice: { backgroundColor: '#FBEFEC' }, errorText: { color: '#922F2F' },
  metricRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }, metricValue: { fontSize: 15, lineHeight: 23, fontWeight: '600', color: C.ink, fontVariant: ['tabular-nums'], flexShrink: 1 },
  summary: { backgroundColor: C.greenSoft, borderRadius: BudgetRadius.card, borderColor: C.greenBorder, borderWidth: 1, padding: 22, gap: 12 },
  summaryLabel: { fontSize: 15, color: C.ink, lineHeight: 23 }, bigAmount: { color: C.primary, fontSize: 43, lineHeight: 56, fontWeight: '700', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  summaryHint: { fontSize: 12, lineHeight: 20, color: C.green }, summaryDivider: { height: 1, backgroundColor: C.greenBorder, marginVertical: 4 },
  divider: { height: 1, backgroundColor: C.border }, footer: { color: C.secondary, textAlign: 'center', fontSize: 11, lineHeight: 18 },
});
