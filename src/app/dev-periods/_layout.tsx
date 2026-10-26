import { Redirect, Stack } from 'expo-router';

import { previewEnabled } from '@/features/periods/contracts';
import { PeriodPreviewProvider } from '@/features/periods/preview-provider';

export default function DevelopmentPeriodsLayout() {
  if (!previewEnabled(__DEV__)) return <Redirect href="/" />;
  return <PeriodPreviewProvider><Stack screenOptions={{ headerShown: false }} /></PeriodPreviewProvider>;
}
