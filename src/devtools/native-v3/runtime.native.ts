import { checkV3Integrity } from '../../data/budget/integrity-v3';
import { createBudgetRepositoryV3 } from '../../data/budget/repository-v3';
import { inspectPreparedCopy } from '../../data/budget/upgrade-preparation';
import { nextPayday, payday, publicId } from './fixtures';
import { assertNativeLab, createNativeLabDriver, nativeLabIdentity } from './driver.native';
import { createLabCoordinator } from './coordinator';
import { createNativeRunJournal } from './journal.native';
import { runFullLabSuite } from './preparation-suite';
import { ensure, type LabConfig } from './types';

export function createNativeLabRuntime(input:LabConfig){
  assertNativeLab();
  const executionId=`${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const config={...input,executionId};
  return createLabCoordinator(config, {
    identity: nativeLabIdentity(), journal: createNativeRunJournal(input.runId),
    run: (runConfig, progress) => runFullLabSuite(createNativeLabDriver(runConfig), runConfig, progress),
    resume: async runConfig => {
      const driver=createNativeLabDriver(runConfig,true);
      try { const db=await driver.reopen('lifecycle'); await db.database.transaction(checkV3Integrity);
        const marker=(await db.query.all('SELECT execution_id FROM gb_lab_resume_marker'))[0]?.execution_id;
        ensure(typeof marker==='string','RESUME_MARKER_MISSING');
        const repository=createBudgetRepositoryV3(db.database),active=await repository.loadActivePeriod(1,nextPayday),history=await repository.listClosedPeriods(1);
        ensure(active?.publicId===publicId(101)&&active.result.remainingBalanceMinor===450000&&history.length===2,'RESUME_LIFECYCLE_CHANGED');
        const restored=await driver.reopen('wal-restored');await restored.database.transaction(checkV3Integrity);
        ensure((await createBudgetRepositoryV3(restored.database).loadActivePeriod(1,payday))?.publicId===publicId(100),'RESTORED_CHECKPOINT_CHANGED');
        const source=await driver.reopen('prep-success-src');
        ensure(await inspectPreparedCopy(source,driver,{status:'prepared',mode:'rehearsal-only',activationAllowed:false,
          backupKey:'ok-backup',restoreKey:'ok-restore',candidateKey:'ok-candidate',counts:{}},'2026-10-25T09:00:00.000Z'),'UPGRADE_CHECKPOINT_CHANGED');
        return {passed:true,freshJavaScriptRuntime:marker!==executionId,nativeProcessRestartVerified:false};
      } finally {await driver.closeAll();}
    },
  });
}
export type NativeLabRuntime=ReturnType<typeof createNativeLabRuntime>;
declare global { var __GB_V3_NATIVE_LAB__: NativeLabRuntime | undefined; }
