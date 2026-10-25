import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BudgetIcon } from '@/components/budget/budget-icon';
import { BudgetColors, BudgetRadius } from '@/constants/budget-theme';
import type { BudgetResult } from '@/domain/budget';

import { formatCalendarDate, formatMinorTRY } from './format';

function SummaryRow({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, negative && styles.negative]}>{value}</Text>
    </View>
  );
}

export function PreviewResult({ result, onEdit, notice, editingDisabled = false }: { result: BudgetResult; onEdit: () => void; notice?: string; editingDisabled?: boolean }) {
  return (
    <View style={styles.content}>
      <View style={styles.unsaved}>
        <BudgetIcon name="info" size={20} color={BudgetColors.green} />
        <Text accessibilityLiveRegion="polite" style={styles.unsavedText}>
          {notice ?? 'Bu bir ön izlemedir, bilgileriniz henüz kaydedilmiyor'}
        </Text>
      </View>
      <Text accessibilityRole="header" style={styles.heading}>Bütçe ön izlemeniz</Text>
      <Text style={styles.caption}>
        {formatCalendarDate(result.today)} itibarıyla · {result.timeZone}
      </Text>

      {result.periodStatus === 'active' ? (
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>GÜNLÜK ÖNERİLEN HARCAMA</Text>
          <Text
            accessibilityLabel={`Günlük önerilen harcama ${formatMinorTRY(result.daily.recommendedDailyMinor)}`}
            style={styles.heroAmount}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            numberOfLines={1}>
            {formatMinorTRY(result.daily.recommendedDailyMinor)}
          </Text>
          <Text style={styles.caption}>Bugün dahil kalan günlere eşit dağıtım önerisi.</Text>
        </View>
      ) : (
        <View accessibilityLiveRegion="polite" style={styles.warning}>
          <Text accessibilityRole="header" style={styles.warningTitle}>Yeni bütçe dönemi gerekiyor</Text>
          <Text style={styles.warningText}>
            {result.periodStatus === 'payday-today'
              ? 'Maaş tarihi bugün. Bu tarihle günlük öneri hesaplanmaz.'
              : 'Girdiğiniz maaş tarihi geçmişte. Tarih otomatik olarak ileri taşınmadı.'}
          </Text>
          <Text style={styles.warningText}>
            Maaşınız hesaba geçtiyse güncel kullanılabilir bakiyenizi ve sonraki maaş tarihinizi düzenleyin. Bu ön izleme maaş geliri eklemez.
          </Text>
          <Text style={styles.warningText}>Aşağıdaki rezervler girilen maaş tarihiyle sınırlıdır. Güncel bir harcama planı için tarihi düzeltin.</Text>
        </View>
      )}

      <View style={styles.card}>
        <SummaryRow
          label={result.periodStatus === 'active' ? 'Toplam harcanabilir tutar' : 'Harcanabilir tutar (girilen dönem)'}
          value={formatMinorTRY(result.spendableMinor)}
          negative={result.spendableMinor < 0}
        />
        <View style={styles.divider} />
        <SummaryRow
          label="Maaşa kalan gün"
          value={`${result.daysUntilPayday} gün${result.daysUntilPayday < 0 ? ' (tarih geçti)' : ''}`}
        />
        <Text style={styles.caption}>Maaş tarihi: {formatCalendarDate(result.nextPayday)}</Text>
      </View>

      {result.budgetDeficitMinor > 0 && (
        <View accessibilityLiveRegion="polite" style={styles.warning}>
          <Text accessibilityRole="header" style={styles.warningTitle}>Bütçede açık var</Text>
          <Text style={styles.warningAmount}>{formatMinorTRY(result.budgetDeficitMinor)}</Text>
          <Text style={styles.warningText}>
            Bakiye, bekleyen ödemeler ve birikim hedefini karşılamıyor. Eksi harcanabilir tutar yukarıda korunuyor; bu açık yeni harcama bütçesi değildir.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.cardTitle}>Hesabın özeti</Text>
        <SummaryRow label="Şu anki hesap bakiyesi" value={formatMinorTRY(result.remainingBalanceMinor)} negative={result.remainingBalanceMinor < 0} />
        <SummaryRow label="Faturalar için ayrılan" value={formatMinorTRY(result.reservedPaymentsMinor)} />
        <SummaryRow label="Birikim için ayrılan" value={formatMinorTRY(result.savingsReservedMinor)} />
      </View>

      <Text style={styles.caption}>
        Bu bir planlama ön izlemesidir; kesin harcama güvenliği anlamına gelmez. Bilgileri düzenleyebilir veya kaydetmeden çıkabilirsiniz.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={editingDisabled}
        accessibilityState={{ disabled: editingDisabled }}
        onPress={onEdit}
        style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}>
        <Text style={styles.editText}>Bilgileri düzenle</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18
  },
  unsaved: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: BudgetColors.greenSoft,
    borderRadius: 16,
    padding: 16
  },
  unsavedText: {
    flex: 1,
    color: BudgetColors.green,
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '600'
  },
  heading: {
    color: BudgetColors.ink,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6
  },
  caption: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 20
  },
  hero: {
    padding: 22,
    borderRadius: BudgetRadius.card,
    backgroundColor: BudgetColors.greenSoft,
    borderColor: BudgetColors.greenBorder,
    borderWidth: 1,
    gap: 12
  },
  heroLabel: {
    color: BudgetColors.green,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1
  },
  heroAmount: {
    color: BudgetColors.green,
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1.2,
    fontVariant: ['tabular-nums']
  },
  card: {
    backgroundColor: BudgetColors.surface,
    borderWidth: 1,
    borderColor: BudgetColors.border,
    borderRadius: BudgetRadius.card,
    padding: 20,
    gap: 16
  },
  cardTitle: {
    color: BudgetColors.ink,
    fontSize: 16,
    fontWeight: '700'
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8
  },
  rowLabel: {
    color: BudgetColors.secondary,
    fontSize: 13,
    lineHeight: 21,
    flexGrow: 1,
    flexBasis: 150
  },
  rowValue: {
    color: BudgetColors.ink,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    flexShrink: 1
  },
  negative: {
    color: '#922F2F'
  },
  divider: {
    height: 1,
    backgroundColor: BudgetColors.border
  },
  warning: {
    padding: 20,
    gap: 12,
    backgroundColor: '#FFF3EC',
    borderColor: '#E9CDBB',
    borderWidth: 1,
    borderRadius: 20
  },
  warningTitle: {
    color: '#803A24',
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700'
  },
  warningText: {
    color: '#803A24',
    fontSize: 13,
    lineHeight: 21
  },
  warningAmount: {
    color: '#922F2F',
    fontSize: 27,
    fontWeight: '700',
    fontVariant: ['tabular-nums']
  },
  editButton: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: BudgetColors.primary
  },
  editText: {
    color: BudgetColors.surface,
    fontSize: 15,
    fontWeight: '600'
  },
  pressed: {
    opacity: 0.75
  }
});
