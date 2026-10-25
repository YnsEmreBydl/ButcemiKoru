import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BudgetColors } from '@/constants/budget-theme';
import type { SavedExpense } from '@/data/budget/contracts';
import { formatMinorTRY } from '@/features/budget-setup/format';

import { categoryLabels, formatExpenseTime } from './adapter';

type Props = { expense: SavedExpense; timeZone: string; capturedAt: string; disabled: boolean; busy: boolean; onCancel: (id: string) => void };

export function ExpenseHistoryRow({ expense, timeZone, capturedAt, disabled, busy, onCancel }: Props) {
  const cancelled = expense.status === 'cancelled';
  const occurred = formatExpenseTime(expense.occurredAt, timeZone);
  const created = formatExpenseTime(expense.createdAt, timeZone);
  const included = Date.parse(expense.occurredAt) <= Date.parse(capturedAt);
  return <View style={styles.card}>
    <View style={styles.row}>
      <Text style={styles.category}>{categoryLabels[expense.category]}</Text>
      <Text style={[styles.amount, cancelled && styles.cancelled]}>{formatMinorTRY(-expense.amountMinor)}</Text>
    </View>
    {expense.description !== '' && <Text style={styles.description}>{expense.description}</Text>}
    <Text style={styles.note}>{occurred}</Text>
    {created !== occurred && <Text style={styles.note}>Kayda giriş: {created}</Text>}
    {included && <Text style={styles.note}>Başlangıç bakiyesine dahil; tekrar düşülmedi. İptal bakiyeyi artırmaz.</Text>}
    {cancelled ? <Text style={styles.status}>İptal edildi{expense.cancelledAt ? ` · ${formatExpenseTime(expense.cancelledAt, timeZone)}` : ''}</Text>
      : <Pressable accessibilityRole="button" accessibilityLabel={`${categoryLabels[expense.category]} harcamasını iptal et`}
        accessibilityState={{ disabled, busy }} disabled={disabled} onPress={() => onCancel(expense.id)} style={styles.cancelButton}>
        <Text style={styles.cancelText}>{busy ? 'İptal ediliyor…' : 'Hatalı kaydı iptal et'}</Text>
      </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: BudgetColors.surface, borderRadius: 20, padding: 18, gap: 10, borderWidth: 1, borderColor: BudgetColors.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
  category: { color: BudgetColors.ink, fontSize: 16, fontWeight: '600' },
  amount: { color: BudgetColors.ink, fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
  cancelled: { color: BudgetColors.secondary, textDecorationLine: 'line-through' },
  description: { color: BudgetColors.ink, fontSize: 14, lineHeight: 21 },
  note: { color: BudgetColors.secondary, fontSize: 12, lineHeight: 20 },
  status: { color: BudgetColors.secondary, fontSize: 13, lineHeight: 21, fontWeight: '600' },
  cancelButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  cancelText: { color: '#922F2F', fontSize: 13, lineHeight: 21 },
});
