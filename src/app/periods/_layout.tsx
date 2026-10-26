import { Stack } from 'expo-router';
import { SavedPeriodsProvider } from '@/features/periods/preview-provider';
export default function PeriodsLayout() { return <SavedPeriodsProvider><Stack screenOptions={{ headerShown: false }} /></SavedPeriodsProvider>; }
