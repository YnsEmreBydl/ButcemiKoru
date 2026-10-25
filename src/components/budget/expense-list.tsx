import { StyleSheet, Text, View } from 'react-native';

import { BudgetColors, BudgetRadius } from '@/constants/budget-theme';
import type { DemoExpense } from '@/data/demo-budget';
import { formatSpokenTRY, formatTRY } from '@/utils/currency';

import { BudgetIcon } from './budget-icon';

const categoryColors = {
  market: { background: BudgetColors.greenSoft, icon: BudgetColors.green },
  coffee: { background: BudgetColors.coffeeBackground, icon: BudgetColors.coffeeIcon },
  transport: { background: BudgetColors.transportBackground, icon: BudgetColors.transportIcon },
} as const;

export function ExpenseList({ expenses }: { expenses: readonly DemoExpense[] }) {
  return (
    <View style={styles.card}>
      {expenses.map((expense, index) => {
        const colors = categoryColors[expense.category];
        return (
          <View key={expense.id}>
            {index > 0 && <View style={styles.divider} />}
            <View
              accessible
              accessibilityLabel={`Demo harcama. ${expense.title}. ${expense.categoryLabel}. ${expense.timeLabel}. ${formatSpokenTRY(expense.amount)}.`}
              style={styles.row}>
              <View style={[styles.icon, { backgroundColor: colors.background }]}>
                <BudgetIcon name={expense.category} size={21} color={colors.icon} />
              </View>
              <View style={styles.details}>
                <Text style={styles.title}>{expense.title}</Text>
                <Text style={styles.metadata}>{expense.timeLabel}</Text>
              </View>
              <Text style={styles.amount}>{formatTRY(expense.amount)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: BudgetColors.surface,
    borderWidth: 1,
    borderColor: BudgetColors.border,
    borderRadius: BudgetRadius.card,
    paddingHorizontal: 16,
    overflow: 'hidden'
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    gap: 12,
    flexWrap: 'wrap'
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center'
  },
  details: {
    flex: 1,
    minWidth: 96,
    gap: 5
  },
  title: {
    color: BudgetColors.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600'
  },
  metadata: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 18
  },
  amount: {
    color: BudgetColors.ink,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    flexShrink: 1
  },
  divider: {
    height: 1,
    backgroundColor: BudgetColors.border,
    marginLeft: 56
  }
});
