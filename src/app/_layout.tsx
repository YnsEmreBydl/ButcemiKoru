import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { BudgetColors } from '@/constants/budget-theme';

const previewTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: BudgetColors.background },
};

export default function RootLayout() {
  return (
    <ThemeProvider value={previewTheme}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: BudgetColors.background },
        }}>
        <Stack.Screen name="index" options={{ title: 'Günlük Bütçem' }} />
        <Stack.Screen name="demo" options={{ title: 'Günlük Bütçem · DEMO' }} />
        <Stack.Screen name="budget-setup" options={{ title: 'Bütçe kurulumu ve düzenleme' }} />
        <Stack.Screen name="expense-add" options={{ title: 'Harcama ekle' }} />
        <Stack.Screen name="explore" options={{ headerShown: true, title: 'Başlangıç şablonu' }} />
      </Stack>
    </ThemeProvider>
  );
}
