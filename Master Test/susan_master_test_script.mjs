#!/usr/bin/env node
/**
 * Susan Young — Master Test (8-step billing walk: 4/1 advance, $10 check, and bill are separate steps).
 * Runs the Playwright harness in tools/run-susan-master-test-headless.mjs.
 *
 * Credentials: same as Test Scripts/test_script1.mjs — env vars or tools/billing-test.local.json
 *
 * From repo root:
 *   npm run test:master:susan
 *
 * Optional:
 *   BASE_URL=http://127.0.0.1:8000
 *   MASTER_TEST_RESULTS=./Master\ Test/test_script_results.txt
 *   MASTER_TEST_CONSOLE=./Master\ Test/test_script_console_logs.txt
 *   TEST_ACCOUNT_NUMBER=CUS-3011000
 *   MASTER_TEST_ADVANCE=instant|walk
 *   MASTER_TEST_CHECK_AMOUNT=10
 *   MASTER_TEST_CHECK_NUMBER=MT-10
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const localPath = path.join(repoRoot, 'tools', 'billing-test.local.json');
const defaultResults = path.join(repoRoot, 'Master Test', 'test_script_results.txt');
const defaultConsole = path.join(repoRoot, 'Master Test', 'test_script_console_logs.txt');

let email = process.env.FIREBASE_TEST_EMAIL || process.env.DEV_TEST_EMAIL;
let password = process.env.FIREBASE_TEST_PASSWORD || process.env.DEV_TEST_PASSWORD;
let baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

if (fs.existsSync(localPath)) {
  try {
    const raw = fs.readFileSync(localPath, 'utf8');
    const j = JSON.parse(raw);
    email = email || j.email || j.FIREBASE_TEST_EMAIL;
    password = password || j.password || j.FIREBASE_TEST_PASSWORD;
    if (!process.env.BASE_URL && (j.baseUrl || j.BASE_URL)) {
      baseUrl = String(j.baseUrl || j.BASE_URL).replace(/\/$/, '');
    }
  } catch (e) {
    console.error('[susan_master_test_script] Invalid JSON:', localPath, e.message);
    process.exit(1);
  }
}

if (!email || !password) {
  console.error(
    '[susan_master_test_script] Missing Firebase test login.\n' +
      'Use tools/billing-test.local.json or FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD.\n'
  );
  process.exit(1);
}

if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
  console.error('[susan_master_test_script] Replace the placeholder password in tools/billing-test.local.json.');
  process.exit(1);
}

const outResults = process.env.MASTER_TEST_RESULTS
  ? path.resolve(process.cwd(), process.env.MASTER_TEST_RESULTS)
  : defaultResults;
const outConsole = process.env.MASTER_TEST_CONSOLE
  ? path.resolve(process.cwd(), process.env.MASTER_TEST_CONSOLE)
  : defaultConsole;
fs.mkdirSync(path.dirname(outResults), { recursive: true });
fs.mkdirSync(path.dirname(outConsole), { recursive: true });

const runner = path.join(repoRoot, 'tools', 'run-susan-master-test-headless.mjs');
const result = spawnSync(process.execPath, [runner], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FIREBASE_TEST_EMAIL: String(email).trim(),
    FIREBASE_TEST_PASSWORD: String(password),
    BASE_URL: baseUrl,
    MASTER_TEST_RESULTS: outResults,
    MASTER_TEST_CONSOLE: outConsole
  }
});

process.exit(result.status === null ? 1 : result.status);
