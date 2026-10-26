import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { ApplicationBudget } from '@/data/budget/application-contracts';
import { useApplicationRepository } from '@/features/application/provider';
import { budgetLoadFailure, type BudgetLoadState } from './load-state';

export function useSavedBudget() {
  const repository = useApplicationRepository();
  const [state, setState] = useState<BudgetLoadState<ApplicationBudget>>({ status: 'loading' });
  const request = useRef(0);
  const reload = useRef<() => void>(() => {});
  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      const ticket = ++request.current;
      setState((current) => current.status === 'ready' ? { ...current, refreshing: true, message: undefined } : { status: 'loading' });
      try {
        const saved = await repository.load(new Date().toISOString());
        if (active && ticket === request.current) setState({ status: 'ready', saved });
      } catch (error) {
        if (active && ticket === request.current) {
          setState((current) => budgetLoadFailure(current, error));
        }
      }
    }
    void load();
    reload.current = () => { void load(); };
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active') void load(); });
    return () => { active = false; listener.remove(); reload.current = () => {}; };
  }, [repository]));
  function acceptSaved(saved: ApplicationBudget) {
    request.current += 1;
    setState({ status: 'ready', saved });
  }
  return { state, refresh: () => reload.current(), acceptSaved };
}
