#!/usr/bin/env node
/**
 * Test script 2 — April pre-bill $10 credit scenario (BILL AVEY, CUS-3000500 by default in dev-scenario-credit.json).
 * Same Playwright harness as script 1; points DEV_SCENARIO_JSON at public/dev-scenario-credit.json and
 * defaults OUTPUT_PATH to test_output/test_script2_credit.txt (separate from script 1).
 * Each validation snapshot includes `ledgerPaymentsChargesTsv` (full Payments/Charges table at that simulated step).
 *
 * Credentials: same as test_script1 (env or tools/billing-test.local.json).
 *
 * From repo root:
 *   npm run test_script2
 *   npm run test_credit   (same entry)
 *
 * Optional: OUTPUT_PATH=./my-results.txt TEST_ACCOUNT_NUMBER=CUS-3000500
 *   Run the same credit milestones on Susan Young: TEST_ACCOUNT_NUMBER=CUS-3011000
 *   CONSOLE_LOG_PATH=./public/console_log.txt  — writes only the BillDiag/browser console block (same lines as under "=== Console capture ===" in OUTPUT_PATH).
 *
 * After a run, regenerate the markdown validation digest (defaults: test_output/test_script2_credit_susan_ledger_per_step.txt → test_output/validation_report_susan_credit.md):
 *   npm run format:validation-report
 *   npm run format:validation-report -- path/to/export.txt path/to/report.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const localPath = path.join(repoRoot, 'tools', 'billing-test.local.json');
const scenarioPath = path.join(repoRoot, 'public', 'dev-scenario-credit.json');
const defaultOut = path.join(repoRoot, 'test_output', 'test_script2_credit.txt');

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
    console.error('[test_script2] Invalid JSON:', localPath, e.message);
    process.exit(1);
  }
}

if (!email || !password) {
  console.error(
    '[test_script2] Missing Firebase test login.\n' +
      'Use tools/billing-test.local.json or FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD.\n'
  );
  process.exit(1);
}

if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
  console.error('[test_script2] Replace the placeholder password in tools/billing-test.local.json.');
  process.exit(1);
}

const outPath = process.env.OUTPUT_PATH
  ? path.resolve(process.cwd(), process.env.OUTPUT_PATH)
  : defaultOut;
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const result = spawnSync('npm', ['run', 'test:billing-scenario'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FIREBASE_TEST_EMAIL: String(email).trim(),
    FIREBASE_TEST_PASSWORD: String(password),
    BASE_URL: baseUrl,
    DEV_SCENARIO_JSON: scenarioPath,
    OUTPUT_PATH: outPath
  }
});

process.exit(result.status === null ? 1 : result.status);
