import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RuntimeStore } from '../../src/data/budget/application-contracts';
import { runApplicationSuite } from '../../src/devtools/application/suite';
import { applicationFixture } from './fixture';

test('7D-3 full application suite: real deferred/WAL SQLite files exercise fencing, recovery and all screen contracts', async t => {
  const fixtures = new Map<string, Awaited<ReturnType<typeof applicationFixture>>>(), stores = new Map<string, RuntimeStore[]>();
  const report = await runApplicationSuite({ store: async key => {
    let f = fixtures.get(key); if (!f) { f = await applicationFixture(t); fixtures.set(key, f); }
    const store = await f.factory(), list = stores.get(key) ?? []; list.push(store); stores.set(key, list); return store;
  }, closeCase: async key => { for (const store of stores.get(key) ?? []) await store.close(); } });
  writeFileSync(join(tmpdir(), 'gunluk-butcem-7d3-node-suite.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(report.results.filter(row => row.status === 'failed'), []); assert.equal(report.passed, 10);
});
