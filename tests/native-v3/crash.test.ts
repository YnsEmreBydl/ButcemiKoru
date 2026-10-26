import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {prepare,snapshot} from '../../src/devtools/native-v3/fixtures';
import {labFileName,type LabConfig} from '../../src/devtools/native-v3/types';
import {createNodeLabDriver} from './node-driver';

test('7D-1 Node process crash: SIGKILL before COMMIT recovers the independent WAL file unchanged', {timeout:10000},async t=>{
  const directory=mkdtempSync(join(tmpdir(),'gb-v3-lab-crash-'));
  const config:LabConfig={runId:randomBytes(16).toString('hex'),fixtures:{v1:readFileSync('tests/expenses/v1-schema.sql','utf8'),v2:readFileSync('tests/migrations-v3/fixtures/v2-schema.sql','utf8')}};
  const driver=createNodeLabDriver(directory,config),db=await driver.open('crash');
  t.after(async()=>{await driver.closeAll();rmSync(directory,{recursive:true,force:true});});
  await prepare(db,config);await db.query.exec('CREATE TABLE gb_lab_crash_probe(id INTEGER PRIMARY KEY) STRICT');
  const before=await snapshot(db.query);await db.close();
  const child=fork(join(process.cwd(),'tests/native-v3/crash-child.cjs'),[join(directory,labFileName(config.runId,'crash'))],{stdio:['ignore','ignore','ignore','ipc']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [message]=await once(child,'message');assert.deepEqual(message,{uncommitted:true});
  const ended=once(child,'exit');child.kill('SIGKILL');const[,signal]=await ended;assert.equal(signal,'SIGKILL');
  const reopened=await driver.reopen('crash');assert.equal(await snapshot(reopened.query),before);
});
