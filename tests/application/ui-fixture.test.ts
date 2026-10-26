import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { seedApplicationUIFixture, fixtureDay } from '../../src/devtools/application/ui-fixture';
import { readV2Evidence } from '../../src/data/budget/upgrade-evidence';
import { createApplicationRuntime } from '../../src/data/budget/application-runtime';
import { applicationFixture } from './fixture';

for (const today of ['2026-10-26','2026-01-01','2028-03-01']) test(`7D-3 native UI regression: payday-today fixture is domain-valid and bootable on ${today}`,async t=>{
  const f=await applicationFixture(t,true),source=await f.factory();
  await seedApplicationUIFixture(source.source,{v1:readFileSync('tests/expenses/v1-schema.sql','utf8'),v2:readFileSync('tests/migrations-v3/fixtures/v2-schema.sql','utf8')},today);
  await readV2Evidence(source.source.database);
  const app=createApplicationRuntime({store:f.factory,allowV3:true,autoUpgrade:true,now:()=>`${today}T12:00:00.000Z`});await app.initialize();
  const saved=await app.load(`${today}T12:00:00.000Z`);assert.equal(saved?.access.schema,3);assert.equal(saved?.result.requiresNewPeriod,true);
  assert.equal(saved?.result.spentSinceSnapshotMinor,101);assert.equal(saved?.input.payments[0]?.dueOn,fixtureDay(today,-1));
});
