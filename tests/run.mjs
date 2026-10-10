/**
 * Minimal test runner.
 *
 * Each tests/*.test.ts is bundled with esbuild (already present via Vite, so no extra
 * dependency) and executed in Node. A suite fails if it prints "FAILURE" or exits non-zero.
 *
 * pdfExtractor sets pdfjs GlobalWorkerOptions at module scope, which needs a browser, so
 * pdfjs-dist is aliased to a stub. No test touches real PDF parsing — only the pure
 * geometry, tokenizing, scoring and diff logic.
 */
import { build } from 'esbuild';
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'slate-tests-'));

const suites = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort();

if (suites.length === 0) {
  console.error('No test suites found in tests/');
  process.exit(1);
}

let failed = 0;

for (const suite of suites) {
  const outfile = join(outDir, `${suite.replace(/\.ts$/, '')}.mjs`);

  await build({
    entryPoints: [join(testsDir, suite)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'error',
    alias: { 'pdfjs-dist': resolve(testsDir, 'pdfjs-stub.js') }
  });

  console.log(`\n=== ${suite} ===`);

  const before = failed;
  const originalLog = console.log;
  let output = '';
  console.log = (...args) => {
    output += args.join(' ') + '\n';
    originalLog(...args);
  };

  try {
    await import(pathToFileURL(outfile).href);
  } catch (err) {
    originalLog(`  crashed: ${err && err.message ? err.message : err}`);
    failed++;
  }

  console.log = originalLog;

  if (failed === before && /FAILURE|^FAIL /m.test(output)) failed++;
}

rmSync(outDir, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} suite(s) failed.`);
  process.exit(1);
}

console.log('\nAll suites passed.');
