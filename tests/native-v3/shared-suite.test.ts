import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runLabSuite } from '../../src/devtools/native-v3/suite';
import { labFileName, type LabConfig } from '../../src/devtools/native-v3/types';
import { createNodeLabDriver } from './node-driver';

test('7D-1 Node SQLite: native-lab shared scenarios execute on real temporary files',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'gb-v3-lab-node-'));
  const config:LabConfig={runId:randomBytes(16).toString('hex'),fixtures:{v1:readFileSync('tests/expenses/v1-schema.sql','utf8'),v2:readFileSync('tests/migrations-v3/fixtures/v2-schema.sql','utf8')}};
  const driver=createNodeLabDriver(directory,config);t.after(async()=>{await driver.closeAll();rmSync(directory,{recursive:true,force:true});});
  const report=await runLabSuite(driver,config);
  writeFileSync(join(tmpdir(),'gunluk-butcem-7d1-node-suite.json'),JSON.stringify({runtime:'node:sqlite',report},null,2)+'\n');
  assert.deepEqual(report.results.filter(row=>row.status==='failed'),[]);
  assert.ok(report.passed>=19);assert.equal(report.failed,0);assert.equal(report.scope,'independent-synthetic-files');
  // Native test numbers will be reported independently; Node is not Hermes.
});
test('7D-1 file guard: production names, paths, foreign run IDs and reused allocation are rejected',async t=>{
  for(const key of ['../gunluk-butcem','gunluk-butcem.db','/absolute','a/b','a.db','A'])assert.throws(()=>labFileName('a'.repeat(32),key));
  assert.throws(()=>labFileName('bad','test'));assert.match(labFileName('a'.repeat(32),'test'),/^gb-v3lab-/);
  const directory=mkdtempSync(join(tmpdir(),'gb-v3-lab-guard-'));
  const config:LabConfig={runId:'b'.repeat(32),fixtures:{v1:'',v2:''}},driver=createNodeLabDriver(directory,config);
  t.after(async()=>{await driver.closeAll();rmSync(directory,{recursive:true,force:true});});
  await assert.rejects(driver.reopen('not-owned'));await driver.open('test');await assert.rejects(driver.open('test'));
});
