import type { AtomicDatabase, SqlSession } from './contracts';
import { migrateDatabaseV3 } from './migrations-v3';
import { readV2Evidence, verifyV2Copy, verifyV3Copy } from './upgrade-evidence';

export type PreparationConnection = Readonly<{ database: AtomicDatabase; query: SqlSession; close(): Promise<void> }>;
export interface PreparationFiles {
  open(key: string): Promise<PreparationConnection>;
  reopen(key: string): Promise<PreparationConnection>;
  backup(source: PreparationConnection, destination: PreparationConnection): Promise<void>;
}
export type PreparationStage = 'source' | 'backup' | 'verify-backup' | 'restore' | 'verify-restore' | 'candidate' | 'migration' | 'verify-candidate' | 'source-recheck';
export type PreparedCopy = Readonly<{
  status: 'prepared'; mode: 'rehearsal-only'; activationAllowed: false;
  backupKey: string; restoreKey: string; candidateKey: string;
  counts: Readonly<Record<string, number>>;
}>;
export type BlockedPreparation = Readonly<{
  status: 'blocked'; stage: PreparationStage; activationAllowed: false;
  recovery: 'source-v2-verified' | 'manual-review-required'; message: string;
}>;
export type PreparationResult = PreparedCopy | BlockedPreparation;

/**
 * NO production opener, file promotion, reset or source writes.
 * Caller owns a quiesced source and FRESH independent files for this attempt.
 * A future production adapter must pause ALL writers through verification + activation CAS.
 */
export async function prepareV3Copy(source: PreparationConnection, files: PreparationFiles, prefix: string, asOf: string,
  migrate: (database: AtomicDatabase) => Promise<void> = migrateDatabaseV3): Promise<PreparationResult> {
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(prefix)) throw Error('Invalid preparation identifier');
  const backupKey = `${prefix}-backup`, restoreKey = `${prefix}-restore`, candidateKey = `${prefix}-candidate`;
  let stage: PreparationStage = 'source';
  const connections: PreparationConnection[] = [];
  let expected: Awaited<ReturnType<typeof readV2Evidence>> | null = null;
  let result: PreparationResult;
  const open = async (key: string, fresh = true) => {
    const connection = await (fresh ? files.open(key) : files.reopen(key)); connections.push(connection); return connection;
  };
  try {
    expected = await readV2Evidence(source.database);
    stage = 'backup'; const backup = await open(backupKey); await files.backup(source, backup); await backup.close();
    stage = 'verify-backup'; const verifiedBackup = await open(backupKey, false); await verifyV2Copy(verifiedBackup.database, expected);
    stage = 'restore'; const restore = await open(restoreKey); await files.backup(verifiedBackup, restore); await restore.close();
    stage = 'verify-restore'; const verifiedRestore = await open(restoreKey, false); await verifyV2Copy(verifiedRestore.database, expected);
    stage = 'candidate'; const candidate = await open(candidateKey); await files.backup(verifiedBackup, candidate);
    stage = 'migration'; await migrate(candidate.database);
    stage = 'verify-candidate'; await candidate.close(); const reopened = await open(candidateKey, false);
    await verifyV3Copy(reopened.database, expected, asOf);
    stage = 'source-recheck'; await verifyV2Copy(source.database, expected);
    result = { status: 'prepared', mode: 'rehearsal-only', activationAllowed: false, backupKey, restoreKey, candidateKey, counts: expected.counts };
  } catch {
    let recovery: BlockedPreparation['recovery'] = 'manual-review-required';
    if (expected) { try { await verifyV2Copy(source.database, expected); recovery = 'source-v2-verified'; } catch { /* No unsafe fallback. */ } }
    result = { status: 'blocked', stage, activationAllowed: false, recovery,
      message: recovery === 'source-v2-verified'
        ? 'Geçiş hazırlığı tamamlanamadı. v2 kaynak doğrulandı ve değiştirilmedi. Kopyalar korundu; etkinleştirme yapılmadı.'
        : 'Kayıtlar doğrulanamadı. Etkinleştirme ve otomatik sıfırlama durduruldu. İnceleme gerekiyor.' };
  }
  // A failed close is also a preparation failure, never a falsely successful result.
  let closeFailed = false;
  for (const connection of connections) { try { await connection.close(); } catch { closeFailed = true; } }
  return closeFailed ? { status: 'blocked', stage, activationAllowed: false, recovery: 'manual-review-required',
    message: 'Test kopyasının bağlantısı güvenle kapatılamadı. Etkinleştirme yapılmadı; inceleme gerekiyor.' } : result;
}

/** Re-verify files after an interrupted startup; a remembered success flag is never enough. */
export async function inspectPreparedCopy(source: PreparationConnection, files: PreparationFiles, copy: PreparedCopy, asOf: string): Promise<boolean> {
  const connections: PreparationConnection[] = [];
  let valid = false;
  try {
    const expected = await readV2Evidence(source.database);
    for (const key of [copy.backupKey, copy.restoreKey]) {
      const db = await files.reopen(key); connections.push(db); await verifyV2Copy(db.database, expected);
    }
    const candidate = await files.reopen(copy.candidateKey); connections.push(candidate); await verifyV3Copy(candidate.database, expected, asOf);
    await verifyV2Copy(source.database, expected); valid = true;
  } catch { valid = false; }
  for (const db of connections) { try { await db.close(); } catch { valid = false; } }
  return valid;
}
