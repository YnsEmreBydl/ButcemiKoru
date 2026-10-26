import type { AtomicDatabase, SqlRow, SqlSession } from './contracts';
import { BudgetStorageError } from './errors';
import { checkLegacyData, checkV3Integrity, legacyColumns } from './integrity-v3';
import { createBudgetRepositoryV3 } from './repository-v3';

/** Private financial evidence. Never return it to UI, telemetry or console. No lossy numeric hashes. */
export type LegacyEvidence = Readonly<{ schema: string; rows: string; counts: Readonly<Record<string, number>> }>;

async function legacyRows(tx: SqlSession): Promise<{ rows: string; counts: Record<string, number> }> {
  const rows: Record<string, SqlRow[]> = {}, counts: Record<string, number> = {};
  for (const [table, columns] of Object.entries(legacyColumns)) {
    rows[table] = await tx.all(`SELECT ${columns} FROM ${table} ORDER BY 1,2`);
    counts[table] = rows[table].length;
  }
  return { rows: JSON.stringify(rows), counts };
}
function invalid(): never { throw new BudgetStorageError('INVALID_DATA', 'Yedek veya geçiş kopyası doğrulanamadı. Sıfırlama yapılmadı.'); }

export async function readV2Evidence(database: AtomicDatabase): Promise<LegacyEvidence> {
  return database.transaction(async tx => {
    if ((await tx.all('PRAGMA user_version'))[0]?.user_version !== 2) invalid();
    const tables = await tx.all("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if (JSON.stringify(tables.map(row => row.name)) !== JSON.stringify(Object.keys(legacyColumns).sort())) invalid();
    await checkLegacyData(tx);
    const schema = JSON.stringify(await tx.all("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"));
    return { schema, ...await legacyRows(tx) };
  });
}

export async function verifyV2Copy(database: AtomicDatabase, expected: LegacyEvidence): Promise<void> {
  const actual = await readV2Evidence(database);
  if (actual.rows !== expected.rows || actual.schema !== expected.schema) invalid();
}

/** Also decode all financial rows through the existing v3 repository/domain contract. */
export async function verifyV3Copy(database: AtomicDatabase, expected: LegacyEvidence, asOf: string): Promise<void> {
  await database.transaction(async tx => {
    if ((await tx.all('PRAGMA user_version'))[0]?.user_version !== 3) invalid();
    await checkV3Integrity(tx);
    if ((await legacyRows(tx)).rows !== expected.rows) invalid();
  });
  const repository = createBudgetRepositoryV3(database);
  const book = await repository.loadBook(1), active = await repository.loadActivePeriod(book.id, asOf);
  if ((active === null) !== (expected.counts.budget_periods === 0)) invalid();
  if ((await repository.listClosedPeriods(book.id)).length !== 0) invalid();
}
