import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { prepareV3Copy } from '../../src/data/budget/upgrade-preparation';
import { runFullLabSuite } from '../../src/devtools/native-v3/preparation-suite';
import { clock, seedLegacy, snapshot } from '../../src/devtools/native-v3/fixtures';
import { labFileName, type LabConfig } from '../../src/devtools/native-v3/types';
import { createNodeLabDriver } from './node-driver';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'gb-v3-preparation-'));
  const config: LabConfig = { runId: randomBytes(16).toString('hex'), fixtures: { v1: readFileSync('tests/expenses/v1-schema.sql', 'utf8'), v2: readFileSync('tests/migrations-v3/fixtures/v2-schema.sql', 'utf8') } };
  const driver = createNodeLabDriver(directory, config); t.after(async () => { await driver.closeAll(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, config, driver };
}
test('7D-2 real SQLite: two complete lab runs preserve previous files and all 33 scenarios pass independently', async t => {
  const f = fixture(t), first = await runFullLabSuite(f.driver, f.config);
  assert.equal(first.failed, 0, JSON.stringify(first.results.filter(r => r.status === 'failed'))); assert.equal(first.passed, 33);
  const one = await f.driver.reopen('lifecycle'), before = await snapshot(one.query); await one.close();
  const secondConfig = { ...f.config, runId: randomBytes(16).toString('hex') }, secondDriver = createNodeLabDriver(f.directory, secondConfig);
  t.after(() => secondDriver.closeAll()); const second = await runFullLabSuite(secondDriver, secondConfig);
  assert.equal(second.failed, 0, JSON.stringify(second.results.filter(r => r.status === 'failed'))); assert.equal(second.passed, 33);
  const original = await f.driver.reopen('lifecycle'); assert.equal(await snapshot(original.query), before); await original.close();
  writeFileSync(join(tmpdir(), 'gunluk-butcem-7d2-node-suites.json'), JSON.stringify({ runtime: 'node:sqlite', first, second, previousRunPreserved: true }, null, 2));
});
test('7D-2 real SQLite: physically truncated backup blocks migration and leaves v2 intact', async t => {
  const f = fixture(t), source = await f.driver.open('truncated-source'); await seedLegacy(source, f.config.fixtures, 2);
  const before = await snapshot(source.query);
  const result = await prepareV3Copy(source, { ...f.driver, reopen: async key => {
    if (key === 'bad-backup') truncateSync(join(f.directory, labFileName(f.config.runId, key)), 23);
    return f.driver.reopen(key);
  } }, 'bad', clock);
  assert.equal(result.status, 'blocked'); if (result.status !== 'blocked') throw Error('Unexpected success');
  assert.equal(result.stage, 'verify-backup'); assert.equal(result.recovery, 'source-v2-verified'); assert.equal(await snapshot(source.query), before);
});
for (const version of [1, 3, 99]) test(`7D-2 real SQLite: source version ${version} is refused without reset`, async t => {
  const f = fixture(t), source = await f.driver.open('unsupported-source'); await seedLegacy(source, f.config.fixtures, 2);
  await source.query.exec(`PRAGMA user_version=${version}`); const before = await snapshot(source.query);
  const result = await prepareV3Copy(source, f.driver, 'unsupported', clock);
  assert.equal(result.status, 'blocked'); assert.equal(await snapshot(source.query), before);
});
test('7D-2 real SQLite: an empty v2 budget is backed up and migrated only in the independent candidate', async t => {
  const f = fixture(t), source = await f.driver.open('empty-v2');
  await source.query.exec(f.config.fixtures.v2); await source.query.exec('PRAGMA user_version=2');
  const result = await prepareV3Copy(source, f.driver, 'empty-copy', clock);
  assert.equal(result.status, 'prepared'); assert.equal((await source.query.all('PRAGMA user_version'))[0]?.user_version, 2);
});
test('7D-2 real SQLite: leftover staging tables are refused rather than silently dropped or resumed', async t => {
  const f = fixture(t), source = await f.driver.open('partial-v2'); await seedLegacy(source, f.config.fixtures, 2);
  await source.query.exec('CREATE TABLE v3_budget_partial(id INTEGER PRIMARY KEY) STRICT'); const before = await snapshot(source.query);
  const result = await prepareV3Copy(source, f.driver, 'partial-source', clock);
  assert.equal(result.status, 'blocked'); assert.equal(await snapshot(source.query), before);
});
