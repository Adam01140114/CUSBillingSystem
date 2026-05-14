#!/usr/bin/env node
/**
 * Headless browser run of the same develop billing scenario as the UI harness.
 *
 * Prerequisites:
 *   1. npm install   (installs devDependency playwright)
 *   2. npx playwright install chromium
 *   3. Server running: npm start
 *   4. Env: FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD (Firebase sign-in on index.html)
 *
 * Optional:
 *   BASE_URL=http://127.0.0.1:8000
 *   DEV_SCENARIO_JSON=/path/to/scenario.json   (defaults to ./public/dev-scenario.json if it exists, else built-in default)
 *   OUTPUT_PATH=./test-results.txt
 *   HEADED=1   (show browser for debugging)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function defaultScenario() {
  return {
    preset: 'susanJanApr2026',
    customerId: 'CUS-3011000',
    customerNameMatch: 'Susan Young',
    anchorDate: '2026-01-01',
    advanceMode: 'instant',
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false
  };
}

function loadScenario() {
  const envPath = process.env.DEV_SCENARIO_JSON;
  const candidates = [
    envPath,
    path.join(repoRoot, 'public', 'dev-scenario.json'),
    path.join(repoRoot, 'public', 'dev-scenario.sample.json')
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        console.error('[test:billing-scenario] Using scenario file:', p);
        return j;
      }
    } catch (e) {
      console.error('[test:billing-scenario] Skip invalid JSON:', p, e.message);
    }
  }
  console.error('[test:billing-scenario] Using built-in default scenario (no dev-scenario.json found).');
  return defaultScenario();
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    console.error(
      'Could not load "playwright". Run: npm install\nThen install a browser: npx playwright install chromium'
    );
    process.exit(1);
  }
}

function startWaitTicker(label, intervalMs) {
  const id = setInterval(() => {
    console.error('[test:billing-scenario] …still waiting (' + label + ') — if this repeats, check login/credentials/Firestore.');
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
      'Missing credentials. Set in your shell:\n' +
        '  export FIREBASE_TEST_EMAIL="you@example.com"\n' +
        '  export FIREBASE_TEST_PASSWORD="your-firebase-password"\n' +
        '(Aliases: DEV_TEST_EMAIL / DEV_TEST_PASSWORD)'
    );
    process.exit(1);
  }

  if (String(password).trim() === 'your-password-here') {
    console.error(
      '[test:billing-scenario] FIREBASE_TEST_PASSWORD is still the literal placeholder "your-password-here".\n' +
        'Export your real password (the same one you use in the app), then run again.'
    );
    process.exit(1);
  }

  let scenario = loadScenario();
  scenario = {
    ...defaultScenario(),
    ...scenario,
    openResultsTab: false,
    suppressAlerts: true,
    captureConsole: scenario.captureConsole !== false
  };

  const outPath = path.resolve(process.cwd(), process.env.OUTPUT_PATH || 'test-results.txt');
  const shotPath = path.resolve(process.cwd(), process.env.SCREENSHOT_PATH || 'test-results-screenshot.png');
  const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  let scenarioExitCode = 0;

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
    console.error('[test:billing-scenario] Opening', url);
    await page.goto(url, { waitUntil: 'load' });

    // Auth modal starts with class "hidden" and is shown asynchronously after waitForAuth / verifyAdminAndLoad.
    // Do not sample visibility only once — wait until either the login form is shown OR customers already loaded.
    console.error('[test:billing-scenario] Waiting for login prompt or customer table (app bootstrap)…');
    let stopBootTick = startWaitTicker('bootstrap (auth modal or first customer row)', 12000);
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
      console.error('[test:billing-scenario] Screenshot:', shotPath);
      throw new Error(
        'Timed out waiting for Firebase login modal OR customer rows. ' +
          'Is the server running at BASE_URL? Is Firebase/config loading (check browser console in HEADED=1)?'
      );
    } finally {
      stopBootTick();
    }

    const authModalShown = await page
      .locator('#firebaseAuthModal')
      .evaluate((el) => el && !el.classList.contains('hidden'))
      .catch(() => false);

    if (authModalShown) {
      console.error('[test:billing-scenario] Signing in via #firebaseAuthForm …');
      await page.locator('#firebaseEmail').fill(email);
      await page.locator('#firebasePassword').fill(password);
      await page.locator('#firebaseAuthSubmit').click();

      stopBootTick = startWaitTicker('Firebase sign-in (modal should hide)', 12000);
      try {
        await page.waitForFunction(
          () => {
            const m = document.getElementById('firebaseAuthModal');
            const err = document.getElementById('firebaseAuthError');
            const errShown =
              err && !err.classList.contains('hidden') && String(err.textContent || '').trim().length > 0;
            const hidden = m && m.classList.contains('hidden');
            return hidden || errShown;
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
        console.error('[test:billing-scenario] Screenshot:', shotPath);
        throw new Error('Firebase sign-in failed: ' + String(msg).trim());
      }
    } else {
      console.error('[test:billing-scenario] Login modal not visible (session may already be present).');
    }

    console.error('[test:billing-scenario] Waiting for customer table …');
    stopBootTick = startWaitTicker('customer rows in #customerTableBody', 12000);
    try {
      await page.waitForFunction(
        () => {
          const tb = document.querySelectorAll('#customerTableBody tr');
          return tb && tb.length > 0;
        },
        { timeout: 120000 }
      );
    } catch (e) {
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      console.error('[test:billing-scenario] Screenshot:', shotPath);
      const hint = await page
        .evaluate(() => {
          const m = document.getElementById('firebaseAuthModal');
          return {
            authModalHidden: !!(m && m.classList.contains('hidden')),
            rowCount: document.querySelectorAll('#customerTableBody tr').length,
            bodySnippet:
              document.body && document.body.innerText ? document.body.innerText.slice(0, 400) : ''
          };
        })
        .catch(() => ({}));
      console.error('[test:billing-scenario] Page state:', JSON.stringify(hint));
      throw new Error(
        'Timed out waiting for #customerTableBody rows. Often: not signed in, Firestore rules blocked load, or wrong role/drawer gate. Try HEADED=1 to watch.'
      );
    } finally {
      stopBootTick();
    }

    const drawerModal = page.locator('#drawerSelectionModal');
    const drawerVisible = await drawerModal
      .evaluate((el) => el && !el.classList.contains('hidden'))
      .catch(() => false);
    if (drawerVisible) {
      console.error('[test:billing-scenario] Drawer modal open; auto-picking first drawer if possible …');
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
            const d = drawers[0];
            if (d) await window.selectDrawer(d);
          }
        } catch (e) {
          console.error('[billing-scenario-headless] drawer auto-pick', e);
        }
      });
      await new Promise((r) => setTimeout(r, 800));
    }

    console.error('[test:billing-scenario] Running window.runDevelopBillingScenarioFromJson …');
    const result = await page.evaluate(async (cfgJson) => {
      if (typeof window.runDevelopBillingScenarioFromJson !== 'function') {
        return { ok: false, error: 'runDevelopBillingScenarioFromJson is not defined (old index.html?)' };
      }
      const cfg = JSON.parse(cfgJson);
      return await window.runDevelopBillingScenarioFromJson(cfg);
    }, JSON.stringify(scenario));

    const text =
      result && typeof result.header === 'string'
        ? result.header
        : JSON.stringify(result, null, 2) + '\n';
    fs.writeFileSync(outPath, text, 'utf8');
    console.error('[test:billing-scenario] Wrote', outPath);

    if (!result || !result.ok) {
      console.error('[test:billing-scenario] Scenario reported failure. See', outPath);
      scenarioExitCode = 2;
    }
  } finally {
    await browser.close().catch(() => {});
  }

  if (scenarioExitCode) process.exit(scenarioExitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
