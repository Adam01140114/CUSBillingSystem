#!/usr/bin/env node
/**
 * Headless run of Susan Young "Master Test" (window.runSusanMasterTest).
 *
 * Prerequisites: npm install, npx playwright install chromium, npm start (server on BASE_URL).
 * Credentials: FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD (or tools/billing-test.local.json via susan_master_test_script.mjs).
 *
 * Writes:
 *   MASTER_TEST_RESULTS   (default: Master Test/test_script_results.txt)
 *   MASTER_TEST_CONSOLE   (default: Master Test/test_script_console_logs.txt)
 *
 * Env:
 *   BASE_URL, TEST_ACCOUNT_NUMBER, MASTER_TEST_ADVANCE=instant|walk,
 *   MASTER_TEST_CHECK_AMOUNT (default 10)
 *   MASTER_TEST_CHECK_NUMBER (default MT-10)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const masterDir = path.join(repoRoot, 'Master Test');

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    console.error(
      'Could not load "playwright". Run: npm install && npx playwright install chromium'
    );
    process.exit(1);
  }
}

function startWaitTicker(label, intervalMs) {
  const id = setInterval(() => {
    console.error('[susan-master-test] …still waiting (' + label + ') — check login / server / Firestore.');
  }, intervalMs);
  return () => clearInterval(id);
}

async function main() {
  const { chromium } = await loadPlaywright();
  const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const email = process.env.FIREBASE_TEST_EMAIL || process.env.DEV_TEST_EMAIL;
  const password = process.env.FIREBASE_TEST_PASSWORD || process.env.DEV_TEST_PASSWORD;
  if (!email || !password) {
    console.error(
      'Missing credentials. Set FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD (or run via Master Test/susan_master_test_script.mjs with billing-test.local.json).'
    );
    process.exit(1);
  }
  if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
    console.error('[susan-master-test] Replace placeholder password in tools/billing-test.local.json.');
    process.exit(1);
  }

  fs.mkdirSync(masterDir, { recursive: true });
  const outResults = path.resolve(
    process.cwd(),
    process.env.MASTER_TEST_RESULTS || path.join(masterDir, 'test_script_results.txt')
  );
  const outConsole = path.resolve(
    process.cwd(),
    process.env.MASTER_TEST_CONSOLE || path.join(masterDir, 'test_script_console_logs.txt')
  );
  const shotPath = path.resolve(process.cwd(), process.env.SCREENSHOT_PATH || path.join(masterDir, 'master-test-error.png'));
  const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';

  const scenario = {
    /** walk = one simulated calendar day at a time (required for 60-day deposit trigger on 3/2, not 4/1). */
    advanceMode: process.env.MASTER_TEST_ADVANCE === 'instant' ? 'instant' : 'walk',
    accountNumber: (process.env.TEST_ACCOUNT_NUMBER || 'CUS-3011000').trim(),
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false,
    scopeDiagnosticConsole: true,
    masterCheckAmount:
      process.env.MASTER_TEST_CHECK_AMOUNT != null && !isNaN(parseFloat(process.env.MASTER_TEST_CHECK_AMOUNT))
        ? parseFloat(process.env.MASTER_TEST_CHECK_AMOUNT)
        : 10,
    masterCheckNumber: process.env.MASTER_TEST_CHECK_NUMBER != null ? String(process.env.MASTER_TEST_CHECK_NUMBER) : 'MT-10'
  };

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  let exitCode = 0;

  try {
    page.on('console', (msg) => {
      try {
        const t = msg.type();
        if (t === 'error' || t === 'warning') {
          console.error('[browser ' + t + ']', msg.text());
        }
      } catch (e) {
        /* ignore */
      }
    });

    const url = `${baseUrl}/index.html`;
    console.error('[susan-master-test] Opening', url);
    await page.goto(url, { waitUntil: 'load' });

    let stopBootTick = startWaitTicker('bootstrap (auth or customers)', 12000);
    try {
      await page.waitForFunction(
        () => {
          const modal = document.getElementById('firebaseAuthModal');
          const modalShown = modal && !modal.classList.contains('hidden');
          const n = document.querySelectorAll('#customerTableBody tr').length;
          return modalShown || n > 0;
        },
        { timeout: 120000 }
      );
    } catch (e) {
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      console.error('[susan-master-test] Screenshot:', shotPath);
      throw new Error('Timed out waiting for login modal or customer rows. Is the server running?');
    } finally {
      stopBootTick();
    }

    const authModalShown = await page
      .locator('#firebaseAuthModal')
      .evaluate((el) => el && !el.classList.contains('hidden'))
      .catch(() => false);

    if (authModalShown) {
      console.error('[susan-master-test] Signing in …');
      await page.locator('#firebaseEmail').fill(email);
      await page.locator('#firebasePassword').fill(password);
      await page.locator('#firebaseAuthSubmit').click();
      stopBootTick = startWaitTicker('Firebase sign-in', 12000);
      try {
        await page.waitForFunction(
          () => {
            const m = document.getElementById('firebaseAuthModal');
            const err = document.getElementById('firebaseAuthError');
            const errShown =
              err && !err.classList.contains('hidden') && String(err.textContent || '').trim().length > 0;
            return (m && m.classList.contains('hidden')) || errShown;
          },
          { timeout: 120000 }
        );
      } finally {
        stopBootTick();
      }
      const errVisible = await page
        .locator('#firebaseAuthError')
        .evaluate((el) => el && !el.classList.contains('hidden') && String(el.textContent || '').trim().length > 0)
        .catch(() => false);
      if (errVisible) {
        const msg = await page.locator('#firebaseAuthError').innerText().catch(() => '');
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        throw new Error('Firebase sign-in failed: ' + String(msg).trim());
      }
    }

    stopBootTick = startWaitTicker('customer rows', 12000);
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('#customerTableBody tr').length > 0,
        { timeout: 120000 }
      );
    } finally {
      stopBootTick();
    }

    const drawerModal = page.locator('#drawerSelectionModal');
    const drawerVisible = await drawerModal
      .evaluate((el) => el && !el.classList.contains('hidden'))
      .catch(() => false);
    if (drawerVisible) {
      console.error('[susan-master-test] Drawer modal open; picking first drawer …');
      await page.evaluate(async () => {
        const modal = document.getElementById('drawerSelectionModal');
        if (!modal || modal.classList.contains('hidden')) return;
        try {
          if (
            typeof drawers !== 'undefined' &&
            Array.isArray(drawers) &&
            drawers.length > 0 &&
            typeof window.selectDrawer === 'function'
          ) {
            await window.selectDrawer(drawers[0]);
          }
        } catch (e) {
          console.error('[susan-master-test] drawer', e);
        }
      });
      await new Promise((r) => setTimeout(r, 800));
    }

    console.error('[susan-master-test] Running window.runSusanMasterTest …');
    const result = await page.evaluate(async (cfgJson) => {
      if (typeof window.runSusanMasterTest !== 'function') {
        return { ok: false, error: 'runSusanMasterTest is not defined', masterTestReport: '', consoleLines: [] };
      }
      const cfg = JSON.parse(cfgJson);
      return await window.runSusanMasterTest(cfg);
    }, JSON.stringify(scenario));

    const report = result && typeof result.masterTestReport === 'string' ? result.masterTestReport : '';
    fs.mkdirSync(path.dirname(outResults), { recursive: true });
    const reportBody = report || JSON.stringify(result, null, 2);
    fs.writeFileSync(outResults, reportBody.replace(/\n+$/, ''), 'utf8');
    console.error('[susan-master-test] Wrote', outResults);

    const lines = result && Array.isArray(result.consoleLines) ? result.consoleLines : [];
    fs.writeFileSync(outConsole, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    console.error('[susan-master-test] Wrote', outConsole, '(' + lines.length + ' lines)');

    if (!result || !result.ok) {
      console.error('[susan-master-test] Failed:', result && result.error ? result.error : '(no detail)');
      exitCode = 2;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
