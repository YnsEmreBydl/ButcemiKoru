export type ResourceState<T> = Readonly<{ status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null; error: string | null }>;

/** Stable external store for screen reads. Late responses never replace a newer refresh. */
export function createResource<T>(load: () => Promise<T>, message: (error: unknown) => string) {
  let state: ResourceState<T> = { status: 'idle', data: null, error: null };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: ResourceState<T>) => { state = next; listeners.forEach(listener => listener()); };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async refresh(): Promise<void> {
      const request = ++generation; publish({ ...state, status: 'loading', error: null });
      try { const data = await load(); if (generation === request) publish({ status: 'ready', data, error: null }); }
      catch (error) { if (generation === request) publish({ ...state, status: 'error', error: message(error) }); }
    },
  };
}
