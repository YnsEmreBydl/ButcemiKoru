import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BudgetColors, BudgetRadius } from '@/constants/budget-theme';
import { formatSpokenTRY, formatTRY } from '@/utils/currency';

import { BudgetIcon } from './budget-icon';

type BudgetOverviewProps = {
  dailyBudget: number;
  remainingBudget: number;
  daysUntilPayday: number;
  paydayLabel: string;
};

export function BudgetOverview({
  dailyBudget,
  remainingBudget,
  daysUntilPayday,
  paydayLabel,
}: BudgetOverviewProps) {
  const { fontScale } = useWindowDimensions();

  return (
    <View style={styles.card}>
      <View style={styles.eyebrowRow}>
        <View style={styles.dot} />
        <Text style={styles.eyebrow}>GÜNLÜK HARCAMA BÜTÇEN</Text>
      </View>
      <Text
        accessibilityLabel={`Demo günlük harcama bütçen: ${formatSpokenTRY(dailyBudget)}`}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        numberOfLines={1}
        style={styles.dailyAmount}>
        {formatTRY(dailyBudget)}
      </Text>
      <Text style={styles.description}>Bugün için kendine ayırdığın tutar.</Text>
      <View style={styles.divider} />
      <View style={styles.summary}>
        <View style={[styles.stat, fontScale > 1.3 && styles.fullWidth]}>
          <View style={styles.statLabelRow}>
            <BudgetIcon name="calendar" size={15} color={BudgetColors.secondary} />
            <Text style={styles.statLabel}>Maaş gününe</Text>
          </View>
          <Text style={styles.days}>
            {daysUntilPayday} <Text style={styles.daysUnit}>gün kaldı</Text>
          </Text>
          <Text style={styles.statNote}>{paydayLabel} · örnek tarih</Text>
        </View>
        <View style={[styles.stat, fontScale > 1.3 && styles.fullWidth]}>
          <View style={styles.statLabelRow}>
            <BudgetIcon name="wallet" size={15} color={BudgetColors.secondary} />
            <Text style={styles.statLabel}>Toplam kalan bütçe</Text>
          </View>
          <Text
            accessibilityLabel={`Demo toplam kalan bütçe: ${formatSpokenTRY(remainingBudget)}`}
            style={styles.remainingAmount}>
            {formatTRY(remainingBudget)}
          </Text>
          <Text style={styles.statNote}>Bu maaş dönemi için</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BudgetColors.greenSoft,
    borderColor: BudgetColors.greenBorder,
    borderWidth: 1,
    borderRadius: BudgetRadius.card,
    padding: 22
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BudgetColors.green
  },
  eyebrow: {
    color: BudgetColors.green,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    flexShrink: 1,
    lineHeight: 17
  },
  dailyAmount: {
    color: BudgetColors.green,
    fontSize: 52,
    fontWeight: '700',
    letterSpacing: -1.8,
    fontVariant: ['tabular-nums'],
    marginTop: 14,
    marginBottom: 5
  },
  description: {
    color: BudgetColors.secondary,
    fontSize: 13,
    lineHeight: 20
  },
  divider: {
    height: 1,
    backgroundColor: BudgetColors.greenBorder,
    marginVertical: 22
  },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 22
  },
  stat: {
    flexGrow: 1,
    flexBasis: 126,
    gap: 7
  },
  fullWidth: {
    flexBasis: '100%'
  },
  statLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  statLabel: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 1
  },
  days: {
    color: BudgetColors.ink,
    fontSize: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums']
  },
  daysUnit: {
    fontSize: 14,
    fontWeight: '500'
  },
  remainingAmount: {
    color: BudgetColors.ink,
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums']
  },
  statNote: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 18
  }
});
