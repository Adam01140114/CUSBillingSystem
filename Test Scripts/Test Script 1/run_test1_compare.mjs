#!/usr/bin/env node
/**
 * Run Susan master test (9 steps) and compare to test1_expected_output.txt.
 *
 *   npm start
 *   node "Test Scripts/Test Script 1/run_test1_compare.mjs"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, '..', '..');
const expectedPath = path.join(scriptDir, 'test1_expected_output.txt');
const resultsPath = path.join(scriptDir, 'test1_results.txt');
const consolePath = path.join(scriptDir, 'test1_console_logs.txt');
const legacyResultsPath = path.join(scriptDir, 'test_script_results.txt');

const test1Script = path.join(scriptDir, 'test1_script.mjs');
console.error('[run_test1_compare] Running Susan master test (live)…');
const result = spawnSync(process.execPath, [test1Script], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env
});

if (result.status !== 0) {
  console.error('[run_test1_compare] Master test run failed.');
  process.exit(result.status === null ? 1 : result.status);
}

if (fs.existsSync(resultsPath)) {
  const text = fs.readFileSync(resultsPath, 'utf8');
  fs.writeFileSync(legacyResultsPath, text, 'utf8');
}

const cmp = spawnSync(
  process.execPath,
  ['tools/compare-master-test-values.mjs', expectedPath, resultsPath],
  { cwd: repoRoot, encoding: 'utf8' }
);
console.log(cmp.stdout || '');
if (cmp.status !== 0) {
  console.error('[run_test1_compare] Results do not match expected.');
  console.error('Compare:', expectedPath, 'vs', resultsPath);
  console.error('Console:', consolePath);
  process.exit(2);
}
console.error('[run_test1_compare] PASS — test1_results.txt matches test1_expected_output.txt');
