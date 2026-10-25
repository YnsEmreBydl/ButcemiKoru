import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { SavedBudget } from '@/data/budget/contracts';
import { BudgetStorageError, storageErrorMessage } from '@/data/budget/errors';
import { getBudgetRepository } from '@/data/budget/platform';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; saved: SavedBudget | null; refreshing?: boolean; message?: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

export function useSavedBudget() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const request = useRef(0);
  const reload = useRef<() => void>(() => {});
  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      const ticket = ++request.current;
      setState((current) => current.status === 'ready' ? { ...current, refreshing: true, message: undefined } : { status: 'loading' });
      try {
        const repository = await getBudgetRepository();
        const saved = await repository.load(new Date().toISOString());
        if (active && ticket === request.current) setState({ status: 'ready', saved });
      } catch (error) {
        if (active && ticket === request.current) {
          const message = storageErrorMessage(error);
          setState((current) => current.status === 'ready'
            ? { ...current, refreshing: false, message }
            : { status: error instanceof BudgetStorageError && error.code === 'UNSUPPORTED' ? 'unsupported' : 'error', message });
        }
      }
    }
    void load();
    reload.current = () => { void load(); };
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    return () => { active = false; listener.remove(); reload.current = () => {}; };
  }, []));
  function acceptSaved(saved: SavedBudget) {
    request.current += 1;
    setState({ status: 'ready', saved });
  }
  return { state, refresh: () => reload.current(), acceptSaved };
}
