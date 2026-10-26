import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BudgetStorageError } from '../../src/data/budget/errors';
import type { StartPeriodCommandV3 } from '../../src/data/budget/v3-contracts';
import { startPayload } from '../../src/data/budget/v3-validation';
import { scopeOf } from '../../src/features/periods/contracts';
import { createPeriodFormController } from '../../src/features/periods/form-controller';
import { deferred, fill, fixture } from './fixtures';

test('7D-1 retry mock: transient CONFLICT has an explicit same-attempt retry with unchanged ID and payload',async()=>{
  const f=await fixture();let first=true,current=f.now();const commands:StartPeriodCommandV3[]=[];
  const controller=createPeriodFormController({...f.port,startPeriod:async command=>{
    commands.push(command);if(first){first=false;throw new BudgetStorageError('CONFLICT','Synthetic busy');}return f.port.startPeriod(command);
  }},scopeOf(f.source),()=>current);await controller.load();fill(controller);await controller.save();
  assert.equal(controller.getSnapshot().phase,'conflict');const draft=controller.getSnapshot().draft;
  // Runtime guard allows the regression to run against the original public API, before the fix.
  const retry:unknown=Reflect.get(controller,'retrySameAttempt');assert.equal(typeof retry,'function');
  if(typeof retry!=='function')throw Error('MISSING_SAME_ATTEMPT_RETRY');
  current='2026-11-04T09:01:00.000Z';
  const a:unknown=Reflect.apply(retry,controller,[]),b:unknown=Reflect.apply(retry,controller,[]);assert.equal(a,b);await a;
  assert.equal(controller.getSnapshot().phase,'success');assert.deepEqual(controller.getSnapshot().draft,draft);
  assert.equal(commands.length,2);assert.equal(commands[0].operationId,commands[1].operationId);
  assert.equal(startPayload(commands[0]),startPayload(commands[1]));assert.equal(f.idRequests(),3);
});

test('7D-1 retry mock: explicit changed form/reconfirmation creates a new ID and never reuses one ID for two payloads',async()=>{
  const f=await fixture();fill(f.controller);f.setScenario('conflict');await f.controller.save();
  await f.controller.reviewChanges();assert.equal(f.controller.acceptReview(),true);
  fill(f.controller);f.controller.change('balance','4.000,50');f.controller.preview();
  f.controller.confirm('balanceConfirmed',true);f.controller.confirm('archiveConfirmed',true);await f.controller.save();
  assert.equal(f.controller.getSnapshot().phase,'success');assert.equal(f.commands.length,2);
  assert.notEqual(f.commands[0].operationId,f.commands[1].operationId);assert.equal(f.commands[1].availableBalanceMinor,400050);
  const seen=new Map<string,string>();for(const command of f.commands){const payload=startPayload(command);if(seen.has(command.operationId))assert.equal(seen.get(command.operationId),payload);seen.set(command.operationId,payload);}
});

test('7D-1 retry mock: a delayed conflict review cannot overwrite a committed retry',async()=>{
  const f=await fixture(),read=deferred<void>();let conflict=true,holdReview=false;
  const controller=createPeriodFormController({...f.port,
    loadActivePeriod:async(...args)=>{const value=await f.port.loadActivePeriod(...args);if(holdReview)await read.promise;return value;},
    startPeriod:async command=>{if(conflict){conflict=false;throw new BudgetStorageError('CONFLICT','Synthetic busy');}return f.port.startPeriod(command);},
  },scopeOf(f.source),f.now);
  await controller.load();fill(controller);await controller.save();holdReview=true;
  const reviewing=controller.reviewChanges();await controller.retrySameAttempt();
  assert.equal(controller.getSnapshot().phase,'success');read.resolve();await reviewing;
  assert.equal(controller.getSnapshot().phase,'success');assert.equal(controller.getSnapshot().reviewing,false);
  assert.equal(controller.acceptReview(),false);assert.equal(f.commands.length,1);
});
