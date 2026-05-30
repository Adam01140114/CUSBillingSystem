#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, '..', '..');
const pkg = JSON.parse(
  fs.readFileSync(path.join(scriptDir, 'Test_3.master-test.json'), 'utf8')
);
const runner = path.join(repoRoot, 'tools', 'run-dynamic-master-test.mjs');
const jobFile = path.join(repoRoot, 'Test Scripts', '.master-test-jobs', 'cli-test3.json');

fs.mkdirSync(path.dirname(jobFile), { recursive: true });
fs.writeFileSync(jobFile, JSON.stringify({ status: 'pending' }), 'utf8');

const config = {
  testSlug: 'test3',
  accountNumber: pkg.customerId || 'CUS-679014',
  customerName: pkg.customerName || 'Test User',
  customerMode: pkg.customerMode || 'create',
  customerFirstName: pkg.customerFirstName || 'Test',
  customerLastName: pkg.customerLastName || 'User',
  customerCreatedDate: pkg.customerCreatedDate || '2026-01-15',
  advanceMode: 'walk',
  steps: pkg.stepDefs || []
};

const env = Object.assign({}, process.env, {
  MASTER_TEST_JOB_FILE: jobFile,
  MASTER_TEST_CONFIG: JSON.stringify(config),
  MASTER_TEST_TIMEOUT_MS: '900000',
  BASE_URL: process.env.BASE_URL || 'http://127.0.0.1:8000'
});

console.error('[run_test3] Running', config.steps.length, 'steps for', config.accountNumber, '…');
const result = spawnSync(process.execPath, [runner], {
  cwd: repoRoot,
  env,
  stdio: 'inherit'
});

const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const outDir = scriptDir;
const resultsPath = path.join(outDir, 'test_script_results.txt');
const expectedPath = path.join(outDir, 'test3_expected_output.txt');

if (job.resultsText) {
  fs.writeFileSync(resultsPath, job.resultsText.replace(/\n+$/, '') + '\n', 'utf8');
  fs.writeFileSync(path.join(outDir, 'test3_results.txt'), fs.readFileSync(resultsPath));
}
if (job.consoleText) {
  fs.writeFileSync(
    path.join(outDir, 'test3_console_logs.txt'),
    job.consoleText.replace(/\n+$/, '') + '\n',
    'utf8'
  );
}

if (result.status !== 0 || job.status !== 'complete') {
  console.error('[run_test3] Failed:', job.error || result.stderr || 'unknown');
  process.exit(result.status || 1);
}

const cmp = spawnSync(
  process.execPath,
  ['tools/compare-master-test-values.mjs', expectedPath, resultsPath],
  { cwd: repoRoot, encoding: 'utf8' }
);
console.log(cmp.stdout || '');
if (cmp.status !== 0) {
  console.error('[run_test3] Results do not match expected.');
  process.exit(2);
}
console.error('[run_test3] PASS — results match expected.');
