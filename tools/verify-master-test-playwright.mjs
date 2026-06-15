#!/usr/bin/env node
/**
 * Smoke test: ensure Playwright Chromium launches and master-test runner boots.
 * On-prem mode avoids Firebase credentials.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const jobsDir = path.join(repoRoot, 'Test Scripts', '.master-test-jobs');
const jobId = 'verify-playwright-' + Date.now();
const jobFile = path.join(jobsDir, jobId + '.json');
const runnerPath = path.join(repoRoot, 'tools', 'run-dynamic-master-test.mjs');
const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

const config = {
  storageMode: 'onprem',
  accountNumber: 'CUS-3011000',
  customerName: 'Susan Young',
  customerMode: 'existing',
  advanceMode: 'instant',
  steps: [
    {
      freshStart: true,
      advanceDateEnabled: true,
      advanceDate: '2026-01-01',
      billThem: false,
      payEnabled: false,
      payAmount: '',
      dataCaptures: ['Log what the amount breakdown shows']
    }
  ]
};

fs.mkdirSync(jobsDir, { recursive: true });
fs.writeFileSync(
  jobFile,
  JSON.stringify({
    status: 'queued',
    progress: 0,
    message: 'Queued…',
    config: config,
    startedAt: Date.now()
  }),
  'utf8'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const child = spawn(process.execPath, [runnerPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: Object.assign({}, process.env, {
      MASTER_TEST_JOB_FILE: jobFile,
      MASTER_TEST_CONFIG: JSON.stringify(config),
      BASE_URL: baseUrl,
      MASTER_TEST_TIMEOUT_MS: '120000'
    })
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
  });

  let job = {};
  try {
    job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  } catch (e) {
  }

  if (exitCode !== 0 || job.status === 'failed') {
    console.error('[verify-master-test-playwright] FAILED');
    console.error('exitCode:', exitCode);
    console.error('job.status:', job.status);
    console.error('job.error:', job.error || job.message || '(none)');
    process.exit(1);
  }

  if (job.status !== 'complete') {
    console.error('[verify-master-test-playwright] Unexpected job status:', job.status);
    process.exit(1);
  }

  console.log('[verify-master-test-playwright] OK — Playwright launched and on-prem master test completed.');
}

main().catch((err) => {
  console.error('[verify-master-test-playwright]', err);
  process.exit(1);
});
