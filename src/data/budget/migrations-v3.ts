import type { AtomicDatabase } from './contracts';
import { BudgetStorageError } from './errors';
import { normalizeInstant } from './expense-validation';
import { integer } from './guards';
import { checkCopiedData, checkLegacyData, checkV3Integrity } from './integrity-v3';
import { migrations } from './migrations';
import { copyV2Books, copyV2Period, copyV2ToV3, createV3Tables, installV3Guards, replaceV2Tables } from './schema-v3';

export const V3_SCHEMA_VERSION = 3;

/**
 * STAGE 7A: explicit opt-in for independent test databases ONLY.
 * Not imported by platform.native.ts; the live application remains on schema v2.
 * The caller must supply a real atomic transaction and resolve only after COMMIT.
 */
export async function migrateDatabaseV3(database: AtomicDatabase): Promise<void> {
  await database.transaction(async (tx) => {
    const version = (await tx.all('PRAGMA user_version'))[0]?.user_version;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 || version > V3_SCHEMA_VERSION) {
      throw new BudgetStorageError('MIGRATION', 'Veritabanı sürümü desteklenmiyor. Kayıtlarınız silinmedi.');
    }
    // Renames must update FK references even when foreign_keys is OFF.
    // Refuse legacy mode rather than changing connection state behind the caller's back.
    if ((await tx.all('PRAGMA legacy_alter_table'))[0]?.legacy_alter_table !== 0) {
      throw new BudgetStorageError('MIGRATION', 'Eski SQLite tablo yeniden adlandırma modu desteklenmiyor. Kayıtlar değiştirilmedi.');
    }
    if (version === V3_SCHEMA_VERSION) {
      await checkV3Integrity(tx);
      return;
    }
    // v1 -> v2 -> v3 is ONE transaction. A v3 failure also rolls back v2 DDL.
    for (const migration of migrations) {
      if (migration.version > version) await tx.exec(migration.sql);
    }
    await checkLegacyData(tx);
    await tx.exec(createV3Tables);
    await tx.exec(copyV2Books);
    for (const period of await tx.all('SELECT id, balance_captured_at FROM budget_periods')) {
      await tx.run(copyV2Period, [normalizeInstant(period.balance_captured_at), integer(period.id)]);
    }
    await tx.exec(copyV2ToV3);
    await checkCopiedData(tx);
    await tx.exec(replaceV2Tables);
    await tx.exec(installV3Guards);
    await checkV3Integrity(tx);
    // This constant is trusted SQL, never user input. Still inside the atomic transaction.
    await tx.exec('PRAGMA user_version = 3');
  });
}
