#!/usr/bin/env node
/**
 * Same as run-billing-scenario-local.mjs but runs the April pre-bill $10 credit scenario
 * (public/dev-scenario-credit.json) and writes test-results-credit.txt by default.
 *
 * Usage: npm run test_credit
 * Optional: OUTPUT_PATH=./my-credit-results.txt npm run test_credit
 * Optional: TEST_ACCOUNT_NUMBER=CUS-1234567 npm run test_credit
 *   (same as adding "accountNumber": "CUS-1234567" to dev-scenario-credit.json; must exist in your customer list)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const localPath = path.join(__dirname, 'billing-test.local.json');
const scenarioPath = path.join(repoRoot, 'public', 'dev-scenario-credit.json');
const defaultOut = path.join(repoRoot, 'test-results-credit.txt');

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
    console.error('[run-billing-scenario-credit-local] Invalid JSON:', localPath, e.message);
    process.exit(1);
  }
}

if (!email || !password) {
  console.error(
    '[run-billing-scenario-credit-local] Missing Firebase test login.\n' +
      'Use billing-test.local.json or FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD.\n'
  );
  process.exit(1);
}

if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
  console.error('[run-billing-scenario-credit-local] Replace the placeholder password in billing-test.local.json.');
  process.exit(1);
}

const outPath = process.env.OUTPUT_PATH
  ? path.resolve(process.cwd(), process.env.OUTPUT_PATH)
  : defaultOut;

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
