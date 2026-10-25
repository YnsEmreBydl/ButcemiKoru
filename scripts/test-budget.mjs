import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = mkdtempSync(join(tmpdir(), 'gunluk-butcem-budget-tests-'));

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const compileStatus = run([
    require.resolve('typescript/bin/tsc'),
    '--project', 'tsconfig.budget-tests.json',
    '--outDir', buildDirectory,
  ]);
  if (compileStatus !== 0) {
    process.exitCode = compileStatus;
  } else {
    function findTestFiles(directory) {
      return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) return findTestFiles(file);
        return entry.name.endsWith('.test.js') ? [file] : [];
      });
    }
    const testFiles = findTestFiles(join(buildDirectory, 'tests')).sort();
    if (testFiles.length === 0) throw new Error('No budget tests found.');
    process.exitCode = run([
      '--test',
      '--test-reporter=spec',
      '--experimental-test-coverage',
      '--test-coverage-exclude=**/tests/**',
      ...testFiles,
    ]);
  }
} finally {
  rmSync(buildDirectory, { recursive: true, force: true });
}
