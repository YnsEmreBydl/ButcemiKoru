import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { BudgetColors } from '@/constants/budget-theme';

const symbols = {
  wallet: { ios: 'wallet.pass', android: 'account_balance_wallet', web: 'account_balance_wallet' },
  calendar: { ios: 'calendar', android: 'calendar_today', web: 'calendar_today' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  question: { ios: 'questionmark', android: 'question_mark', web: 'question_mark' },
  arrow: { ios: 'arrow.up.right', android: 'north_east', web: 'north_east' },
  market: { ios: 'basket', android: 'shopping_basket', web: 'shopping_basket' },
  coffee: { ios: 'cup.and.saucer', android: 'coffee', web: 'coffee' },
  transport: { ios: 'bus', android: 'directions_bus', web: 'directions_bus' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
} as const satisfies Record<string, ComponentProps<typeof SymbolView>['name']>;

export type BudgetIconName = keyof typeof symbols;

type BudgetIconProps = {
  name: BudgetIconName;
  size?: number;
  color?: string;
};

export function BudgetIcon({ name, size = 22, color = BudgetColors.ink }: BudgetIconProps) {
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SymbolView
        name={symbols[name]}
        size={size}
        tintColor={color}
        style={{ width: size, height: size }}
      />
    </View>
  );
}
