#!/usr/bin/env node
/**
 * Runs npm run test:billing-scenario with credentials from (in order):
 *   1. Environment: FIREBASE_TEST_EMAIL, FIREBASE_TEST_PASSWORD, BASE_URL
 *   2. tools/billing-test.local.json (gitignored) — copy from billing-test.local.example.json
 *
 * Usage (from repo root):
 *   node tools/run-billing-scenario-local.mjs
 *   npm run test:billing-scenario:local
 *
 * Optional: OUTPUT_PATH=./test-results.txt HEADED=1
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const localPath = path.join(__dirname, 'billing-test.local.json');

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
    console.error('[run-billing-scenario-local] Invalid JSON:', localPath, e.message);
    process.exit(1);
  }
}

if (!email || !password) {
  console.error(
    '[run-billing-scenario-local] Missing Firebase test login.\n' +
      'Either set FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD in the environment,\n' +
      'or copy tools/billing-test.local.example.json → tools/billing-test.local.json (gitignored) and fill email/password.\n'
  );
  process.exit(1);
}

if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
  console.error('[run-billing-scenario-local] Replace the placeholder password in billing-test.local.json (or use env vars).');
  process.exit(1);
}

const result = spawnSync('npm', ['run', 'test:billing-scenario'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    FIREBASE_TEST_EMAIL: String(email).trim(),
    FIREBASE_TEST_PASSWORD: String(password),
    BASE_URL: baseUrl
  }
});

process.exit(result.status === null ? 1 : result.status);
