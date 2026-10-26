import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

export function usePeriodStore<T>(store: { subscribe: (listener: () => void) => () => void; getSnapshot: () => T }): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export function useFocusedPeriodResource<T>(resource: { subscribe: (listener: () => void) => () => void; getSnapshot: () => T; refresh: () => Promise<void> }): T {
  const state = usePeriodStore(resource);
  useFocusEffect(useCallback(() => { void resource.refresh(); }, [resource]));
  return state;
}
