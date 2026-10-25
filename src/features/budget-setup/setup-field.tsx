import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { BudgetColors } from '@/constants/budget-theme';

type SetupFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  helper?: string;
  error?: string;
  keyboardType?: TextInputProps['keyboardType'];
  maxLength?: number;
  editable?: boolean;
};

export function SetupField({
  label, value, onChangeText, placeholder, helper, error, keyboardType, maxLength = 64, editable = true,
}: SetupFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        editable={editable}
        accessibilityState={{ disabled: !editable }}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={BudgetColors.secondary}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        textContentType="none"
        underlineColorAndroid="transparent"
        accessibilityLabel={`${label}${error ? `. Hata: ${error}` : ''}`}
        accessibilityHint={helper}
        style={[styles.input, Boolean(error) && styles.invalid, !editable && styles.locked]}
      />
      {helper && <Text style={styles.helper}>{helper}</Text>}
      {Boolean(error) && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 8
  },
  label: {
    color: BudgetColors.ink,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600'
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: BudgetColors.border,
    borderRadius: 12,
    backgroundColor: BudgetColors.background,
    color: BudgetColors.ink,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    fontVariant: ['tabular-nums']
  },
  invalid: {
    borderColor: '#A33434'
  },
  locked: { opacity: 0.65 },
  helper: {
    color: BudgetColors.secondary,
    fontSize: 12,
    lineHeight: 19
  },
  error: {
    color: '#922F2F',
    fontSize: 12,
    lineHeight: 19
  }
});
