export function periodRoutes(mode: 'demo' | 'saved') {
  return mode === 'demo' ? { home: '/dev-periods' as const, history: '/dev-periods/history' as const,
    new: '/dev-periods/new' as const, archive: '/dev-periods/archive/[periodId]' as const } :
    { home: '/periods' as const, history: '/periods/history' as const,
      new: '/periods/new' as const, archive: '/periods/archive/[periodId]' as const };
}
