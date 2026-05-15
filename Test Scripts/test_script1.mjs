#!/usr/bin/env node
/**
 * Test script 1 — standard billing walkthrough (Susan Young, CUS-3011000).
 * Runs the headless Playwright harness with public/dev-scenario.sample.json (or public/dev-scenario.json if present).
 *
 * Credentials (in order):
 *   1. FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD (+ optional BASE_URL)
 *   2. tools/billing-test.local.json (gitignored) — copy from tools/billing-test.local.example.json
 *
 * From repo root:
 *   npm run test_script1
 *   npm run test:billing-scenario:local   (same entry)
 *
 * Default output: test_output/test_script1.txt (does not overwrite the credit test file).
 * Optional: OUTPUT_PATH=./my-run.txt HEADED=1 TEST_ACCOUNT_NUMBER=CUS-3011000
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const defaultOut = path.join(repoRoot, 'test_output', 'test_script1.txt');
const localPath = path.join(repoRoot, 'tools', 'billing-test.local.json');

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
    console.error('[test_script1] Invalid JSON:', localPath, e.message);
    process.exit(1);
  }
}

if (!email || !password) {
  console.error(
    '[test_script1] Missing Firebase test login.\n' +
      'Set FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD, or fill tools/billing-test.local.json.\n'
  );
  process.exit(1);
}

if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
  console.error('[test_script1] Replace the placeholder password in tools/billing-test.local.json (or use env vars).');
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
    OUTPUT_PATH: outPath
  }
});

process.exit(result.status === null ? 1 : result.status);
