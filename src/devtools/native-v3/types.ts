import type { AtomicDatabase, SqlSession } from '../../data/budget/contracts';

export const LAB_SLUG = 'gb-v3-native-lab';
export type LabConfig = Readonly<{ runId: string; fixtures: Readonly<{ v1: string; v2: string }>; executionId?: string }>;
export type LabConnection = Readonly<{ database: AtomicDatabase; query: SqlSession; close: () => Promise<void> }>;
export interface LabDriver {
  open(key: string): Promise<LabConnection>;
  reopen(key: string): Promise<LabConnection>;
  backup(source: LabConnection, destination: LabConnection): Promise<void>;
  closeAll(): Promise<void>;
}
export type LabResult = Readonly<{ id: string; status: 'passed' | 'failed'; detail?: string }>;
export type LabReport = Readonly<{
  scope: 'independent-synthetic-files'; runId: string; results: readonly LabResult[];
  passed: number; failed: number; sqliteVersion: string | null;
  notRun: readonly string[];
}>;

/** No caller-selected path or production database name ever reaches a driver. */
export function labFileName(runId: string, key: string): string {
  if (!/^[0-9a-f]{32}$/.test(runId) || !/^[a-z][a-z0-9-]{0,47}$/.test(key)) throw Error('Unsafe lab file identifier');
  return `gb-v3lab-${runId}-${key}.db`;
}
export function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw Error(code);
}
export function safeError(error: unknown): string {
  // Never emit a raw SQLite message/path/SQL or a financial row in diagnostics.
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)) return error.message;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z_0-9]{1,48}$/.test(error.code)) return error.code;
  return error instanceof Error ? error.name : 'UnknownFailure';
}
