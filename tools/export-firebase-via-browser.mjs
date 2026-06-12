#!/usr/bin/env node
/**
 * Export billing Firestore data via browser (client SDK + anonymous/auth session).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const {
  saveStateToDisk,
  writeOnPremConfig,
  DEFAULT_LOGIN_USERS,
  emptyState,
  JSON_PATH,
  XLSX_PATH
} = require('./system-data-store.cjs');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/storage/mode`);
      if (res.ok) return true;
    } catch (e) {
      /* retry */
    }
    await sleep(500);
  }
  return false;
}

function rawToState(raw) {
  const state = emptyState();
  state.meta.exportedAt = new Date().toISOString();
  state.meta.onPremEnabled = true;
  state.customers = raw.customers || [];
  state.locations = raw.locations || [];
  state.codes = raw.codes || [];
  state.users = raw.users && raw.users.length ? raw.users : [];
  state.drawers = raw.drawers || [];
  state.paymentProcessingSessions = raw.paymentProcessingSessions || [];
  state.billingCycles = raw.billingCycles || [];
  if (raw.settings) Object.assign(state.settings, raw.settings);
  if (!state.users.length) state.users = [...DEFAULT_LOGIN_USERS];
  else {
    const names = new Set(state.users.map((u) => (u.fullName || '').toLowerCase()));
    for (const du of DEFAULT_LOGIN_USERS) {
      if (!names.has(du.fullName.toLowerCase())) state.users.push(du);
    }
  }
  if (state.settings.toggles) state.settings.toggles.onPremModeEnabled = true;
  else state.settings.toggles = { onPremModeEnabled: true };
  return state;
}

async function main() {
  const port = process.env.EXPORT_PORT || '8799';
  const baseUrl = (process.env.BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
  let child = null;
  let startedServer = false;

  const up = await waitForServer(baseUrl, 3000);
  if (!up) {
    console.error('[export-browser] Starting temporary server on', port, '…');
    child = spawn(process.execPath, ['server.js'], {
      cwd: repoRoot,
      env: Object.assign({}, process.env, { PORT: port, ON_PREM_MODE: '0' }),
      stdio: 'ignore'
    });
    startedServer = true;
    const ready = await waitForServer(baseUrl, 30000);
    if (!ready) throw new Error('Server did not start for browser export');
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);

  try {
    console.error('[export-browser] Loading billing app…');
    await page.goto(`${baseUrl}/index.html?exportTs=${Date.now()}`, {
      waitUntil: 'load',
      timeout: 120000
    });

    await page.waitForFunction(
      () => typeof window.exportAllFirestoreCollections === 'function',
      { timeout: 180000 }
    );

    console.error('[export-browser] Reading Firestore via client SDK…');
    const raw = await page.evaluate(async () => {
      try {
        return await window.exportAllFirestoreCollections();
      } catch (e) {
        return { error: e && e.message ? e.message : String(e) };
      }
    });

    if (!raw || raw.error) {
      throw new Error(raw && raw.error ? raw.error : 'Firestore export failed');
    }

    const state = rawToState(raw);
    const saved = saveStateToDisk(state);
    writeOnPremConfig({ onPremEnabled: true });

    console.error('[export-browser] Done.');
    console.error(`  JSON: ${JSON_PATH}`);
    console.error(`  XLSX: ${XLSX_PATH}`);
    console.error(`  Customers: ${saved.customers.length}`);
    console.error(`  Users: ${saved.users.length}`);
    console.error(`  Codes: ${saved.codes.length}`);
    console.error(`  Locations: ${saved.locations.length}`);
    console.error(`  Drawers: ${saved.drawers.length}`);
  } finally {
    await browser.close().catch(() => {});
    if (startedServer && child) child.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('[export-browser] Failed:', err.stack || err);
  process.exit(1);
});
