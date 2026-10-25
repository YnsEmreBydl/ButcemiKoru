import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { BudgetColors } from '@/constants/budget-theme';

import { SetupField } from './setup-field';
import type { PaymentDraft, PaymentErrors } from './types';

type PaymentFormProps = {
  payment: PaymentDraft;
  index: number;
  errors?: PaymentErrors;
  onChange: (id: string, field: 'name' | 'amount' | 'dueDate', value: string) => void;
  onRemove: (id: string) => void;
};

export function PaymentForm({ payment, index, errors, onChange, onRemove }: PaymentFormProps) {
  return (
    <View style={styles.payment}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Fatura {index + 1}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${payment.name.trim() || `Fatura ${index + 1}`} satırını kaldır`}
          onPress={() => onRemove(payment.id)}
          style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
          <Text style={styles.removeText}>Kaldır</Text>
        </Pressable>
      </View>
      <SetupField
        label={`Fatura ${index + 1} adı`}
        value={payment.name}
        onChangeText={(value) => onChange(payment.id, 'name', value)}
        placeholder="Örn. Elektrik"
        maxLength={80}
        error={errors?.name}
      />
      <SetupField
        label={`Fatura ${index + 1} tutarı (TL)`}
        value={payment.amount}
        onChangeText={(value) => onChange(payment.id, 'amount', value)}
        placeholder="Örn. 450,50"
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        error={errors?.amount}
      />
      <SetupField
        label={`Fatura ${index + 1} ödeme tarihi`}
        value={payment.dueDate}
        onChangeText={(value) => onChange(payment.id, 'dueDate', value)}
        placeholder="GG.AA.YYYY"
        helper="Maaş gününden önceki ödeme tarihini yazın."
        maxLength={10}
        keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
        error={errors?.dueDate}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  payment: {
    borderTopWidth: 1,
    borderTopColor: BudgetColors.border,
    paddingTop: 12,
    gap: 16
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  title: {
    color: BudgetColors.ink,
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1
  },
  remove: {
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center'
  },
  removeText: {
    color: '#922F2F',
    fontSize: 13,
    fontWeight: '600'
  },
  pressed: {
    opacity: 0.65
  }
});
