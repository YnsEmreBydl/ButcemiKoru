import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BudgetColors, BudgetRadius } from '@/constants/budget-theme';

import { BudgetIcon, type BudgetIconName } from './budget-icon';

type QuickActionProps = {
  title: string;
  icon: BudgetIconName;
  primary?: boolean;
  onPress: () => void;
};

export function QuickAction({ title, icon, primary = false, onPress }: QuickActionProps) {
  const { fontScale } = useWindowDimensions();
  const foreground = primary ? BudgetColors.surface : BudgetColors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, demo`}
      accessibilityHint="Bu özelliğin demo açıklamasını açar. Gerçek işlem yapmaz."
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.primary,
        fontScale > 1.3 && styles.fullWidth,
        pressed && styles.pressed,
      ]}>
      <View style={styles.iconRow}>
        <BudgetIcon name={icon} size={24} color={foreground} />
        <BudgetIcon name="arrow" size={15} color={foreground} />
      </View>
      <Text style={[styles.label, { color: foreground }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
    flexBasis: 132,
    minHeight: 104,
    padding: 18,
    borderRadius: BudgetRadius.control,
    borderWidth: 1,
    borderColor: BudgetColors.border,
    backgroundColor: BudgetColors.surface,
    justifyContent: 'space-between',
    gap: 18
  },
  primary: {
    backgroundColor: BudgetColors.primary,
    borderColor: BudgetColors.primary
  },
  fullWidth: {
    flexBasis: '100%'
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  label: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600'
  },
  pressed: {
    opacity: 0.8,
    transform: [{
      scale: 0.98
    }]
  }
});
