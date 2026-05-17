#!/usr/bin/env node
/**
 * LIVE Susan Young master test — real Firebase login, real Firestore, real POS/billing UI.
 * Changes persist: after the run you can open the billing app and see Susan's updated ledger.
 *
 * NOT the offline runner (tools/run-master-test-offline.mjs) — that uses fake injected data.
 *
 * Prerequisites:
 *   npm start  (server on BASE_URL, default http://127.0.0.1:8000)
 *   npx playwright install chromium
 *   tools/billing-test.local.json  OR  FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD
 *
 * Settings → Toggles (in Firestore, set in the app before running):
 *   - Testing Drawer ON
 *   - Skip POS initial register count ON
 *
 * Env:
 *   BASE_URL, TEST_ACCOUNT_NUMBER (default CUS-3011000)
 *   MASTER_TEST_ADVANCE=walk|instant  (default walk — overlay day-by-day)
 *   MASTER_TEST_TIMEOUT_MS (default 900000 for walk)
 *   HEADED=1  (show browser)
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
    console.error('[master-test-live] …still waiting (' + label + ')');
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
      '[master-test-live] Missing credentials.\n' +
        '  tools/billing-test.local.json  OR  FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD\n' +
        '  Run: npm run test:master:susan'
    );
    process.exit(1);
  }
  if (String(password).trim() === 'your-password-here' || String(password).trim() === 'your-firebase-password-here') {
    console.error('[master-test-live] Replace placeholder password in tools/billing-test.local.json.');
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
    liveMode: true,
    advanceMode: process.env.MASTER_TEST_ADVANCE === 'instant' ? 'instant' : 'walk',
    accountNumber: (process.env.TEST_ACCOUNT_NUMBER || 'CUS-3011000').trim(),
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false,
    scopeDiagnosticConsole: process.env.MASTER_TEST_SCOPE_DIAG === '1',
    walkStepDelayMs: 0,
    masterCheckAmount:
      process.env.MASTER_TEST_CHECK_AMOUNT != null && !isNaN(parseFloat(process.env.MASTER_TEST_CHECK_AMOUNT))
        ? parseFloat(process.env.MASTER_TEST_CHECK_AMOUNT)
        : 10,
    masterCheckNumber: process.env.MASTER_TEST_CHECK_NUMBER != null ? String(process.env.MASTER_TEST_CHECK_NUMBER) : 'MT-10'
  };

  const masterTestTimeoutMs =
    process.env.MASTER_TEST_TIMEOUT_MS != null && !isNaN(parseInt(process.env.MASTER_TEST_TIMEOUT_MS, 10))
      ? parseInt(process.env.MASTER_TEST_TIMEOUT_MS, 10)
      : scenario.advanceMode === 'walk'
        ? 900000
        : 180000;

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);
  let exitCode = 0;
  let progressTimer = null;

  page.on('console', (msg) => {
    const text = msg.text();
    if (
      text.indexOf('[MasterTest]') !== -1 ||
      msg.type() === 'error' ||
      msg.type() === 'warning'
    ) {
      console.error('[browser:' + msg.type() + ']', text);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[browser:pageerror]', err && err.message ? err.message : String(err));
  });

  try {
    const url = `${baseUrl}/index.html?masterTestLive=${Date.now()}`;
    console.error('[master-test-live] Opening', url, '(LIVE — Firestore + real billing UI)');
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });

    let stopBootTick = startWaitTicker('login or customers', 15000);
    try {
      await page.waitForFunction(
        () => {
          const modal = document.getElementById('firebaseAuthModal');
          const modalShown = modal && !modal.classList.contains('hidden');
          const n = document.querySelectorAll('#customerTableBody tr').length;
          return modalShown || n > 0;
        },
        { timeout: 180000 }
      );
    } catch (e) {
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      console.error('[master-test-live] Screenshot:', shotPath);
      throw new Error('Timed out waiting for login modal or customer rows. Is npm start running?');
    } finally {
      stopBootTick();
    }

    const authModalShown = await page
      .locator('#firebaseAuthModal')
      .evaluate((el) => el && !el.classList.contains('hidden'))
      .catch(() => false);

    if (authModalShown) {
      console.error('[master-test-live] Signing in to Firebase…');
      await page.locator('#firebaseEmail').fill(email);
      await page.locator('#firebasePassword').fill(password);
      await page.locator('#firebaseAuthSubmit').click();
      stopBootTick = startWaitTicker('Firebase sign-in', 15000);
      try {
        await page.waitForFunction(
          () => {
            const m = document.getElementById('firebaseAuthModal');
            const err = document.getElementById('firebaseAuthError');
            const errShown =
              err && !err.classList.contains('hidden') && String(err.textContent || '').trim().length > 0;
            return (m && m.classList.contains('hidden')) || errShown;
          },
          { timeout: 180000 }
        );
      } finally {
        stopBootTick();
      }
      const errVisible = await page
        .locator('#firebaseAuthError')
        .evaluate((el) => el && !el.classList.contains('hidden') && String(err.textContent || '').trim().length > 0)
        .catch(() => false);
      if (errVisible) {
        const msg = await page.locator('#firebaseAuthError').innerText().catch(() => '');
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        throw new Error('Firebase sign-in failed: ' + String(msg).trim());
      }
    }

    stopBootTick = startWaitTicker('customer table', 15000);
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('#customerTableBody tr').length > 0,
        { timeout: 180000 }
      );
    } finally {
      stopBootTick();
    }

    console.error('[master-test-live] Preparing live test (Firestore customer, toggles, test date)…');
    const prep = await page.evaluate(async (cfgJson) => {
      window.clearMasterTestOfflineMode();
      if (typeof window.__developTestPrepareLiveMasterTest !== 'function') {
        return { ok: false, error: 'prepareLiveMasterTest missing — reload index.html' };
      }
      return await window.__developTestPrepareLiveMasterTest(JSON.parse(cfgJson));
    }, JSON.stringify(scenario));

    console.error('[master-test-live] Live prep:', JSON.stringify(prep));
    if (!prep || !prep.ok) {
      throw new Error('Live prep failed: ' + (prep && prep.error ? prep.error : 'unknown'));
    }

    console.error(
      '[master-test-live] Running master test (liveMode=true, advanceMode=' +
        scenario.advanceMode +
        ', timeoutMs=' +
        masterTestTimeoutMs +
        ')…'
    );

    progressTimer = setInterval(async () => {
      try {
        const p = await page.evaluate(() => window.__MASTER_TEST_PROGRESS || null);
        if (p) {
          console.error(
            '[master-test-live] progress — ' +
              p.step +
              (p.detail != null ? ' ' + JSON.stringify(p.detail) : '')
          );
        }
      } catch (e) {
        /* page busy */
      }
    }, 5000);

    const result = await page.evaluate(
      async ({ cfgJson, timeoutMs }) => {
        window.clearMasterTestOfflineMode();
        return await Promise.race([
          window.runSusanMasterTest(JSON.parse(cfgJson)),
          new Promise(function (_, reject) {
            setTimeout(function () {
              reject(new Error('runSusanMasterTest timeout (' + timeoutMs + 'ms)'));
            }, timeoutMs);
          })
        ]);
      },
      { cfgJson: JSON.stringify(scenario), timeoutMs: masterTestTimeoutMs }
    );

    clearInterval(progressTimer);
    progressTimer = null;

    const report = result && typeof result.masterTestReport === 'string' ? result.masterTestReport : '';
    fs.mkdirSync(path.dirname(outResults), { recursive: true });
    fs.writeFileSync(outResults, (report || JSON.stringify(result, null, 2)).replace(/\n+$/, ''), 'utf8');
    console.error('[master-test-live] Wrote', outResults, '(' + (report ? report.length : 0) + ' chars)');

    const lines = result && Array.isArray(result.consoleLines) ? result.consoleLines : [];
    fs.writeFileSync(outConsole, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    console.error('[master-test-live] Wrote', outConsole, '(' + lines.length + ' lines)');

    if (!result || !result.ok) {
      console.error('[master-test-live] Failed:', result && result.error ? result.error : '(no detail)');
      exitCode = 2;
    } else {
      console.error(
        '[master-test-live] SUCCESS — changes saved to Firestore. Open the billing app and look up',
        scenario.accountNumber
      );
    }
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    await browser.close().catch(() => {});
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[master-test-live] Fatal:', err);
  process.exit(1);
});
