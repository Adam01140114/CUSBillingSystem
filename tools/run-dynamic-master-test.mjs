#!/usr/bin/env node
/**
 * Run a custom master test (steps from master_test_viewer Create / Edit steps).
 * Invoked by POST /api/master-test/run — updates MASTER_TEST_JOB_FILE with progress.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { saveResultsToDisk } = require('./master-test-disk-store.cjs');
const { buildOnPremInjectPayload, applyOnPremInitScript } = require('./master-test-onprem-payload.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

function readJob(jobFile) {
  if (!jobFile || !fs.existsSync(jobFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeJob(jobFile, patch) {
  if (!jobFile) return;
  const cur = readJob(jobFile);
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(
    jobFile,
    JSON.stringify(Object.assign({}, cur, patch, { updatedAt: Date.now() }), null, 0),
    'utf8'
  );
}

function progressFromMasterTestEntry(p, totalSteps) {
  if (!p) return { progress: 0, message: 'Starting…' };
  const d = p.detail;
  if (d && typeof d.percent === 'number') {
    return {
      progress: Math.min(100, Math.max(0, d.percent)),
      message: d.message || p.step || 'Running…'
    };
  }
  if (p.step && String(p.step).indexOf('stepDef:') === 0) {
    const n = parseInt(String(p.step).replace('stepDef:', ''), 10);
    if (!isNaN(n) && totalSteps > 0) {
      return {
        progress: Math.min(99, Math.round(((n - 1) / totalSteps) * 100)),
        message: 'Running step ' + n + ' of ' + totalSteps + '…'
      };
    }
  }
  return { progress: 5, message: p.step ? String(p.step) : 'Running…' };
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    console.error('Could not load playwright. Run: npm install && npx playwright install chromium');
    process.exit(1);
  }
}

async function main() {
  const jobFile = process.env.MASTER_TEST_JOB_FILE;
  let config = {};
  try {
    config = JSON.parse(process.env.MASTER_TEST_CONFIG || '{}');
  } catch (e) {
    writeJob(jobFile, { status: 'failed', error: 'Invalid MASTER_TEST_CONFIG', progress: 0 });
    process.exit(1);
  }

  const steps = Array.isArray(config.steps) ? config.steps : [];
  if (!steps.length) {
    writeJob(jobFile, { status: 'failed', error: 'No steps in config', progress: 0 });
    process.exit(1);
  }

  writeJob(jobFile, { status: 'running', progress: 2, message: 'Launching browser…' });

  const localPath = path.join(repoRoot, 'tools', 'billing-test.local.json');
  let email = process.env.FIREBASE_TEST_EMAIL || process.env.DEV_TEST_EMAIL;
  let password = process.env.FIREBASE_TEST_PASSWORD || process.env.DEV_TEST_PASSWORD;
  let baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

  if (fs.existsSync(localPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      email = email || j.email || j.FIREBASE_TEST_EMAIL;
      password = password || j.password || j.FIREBASE_TEST_PASSWORD;
      if (!process.env.BASE_URL && (j.baseUrl || j.BASE_URL)) {
        baseUrl = String(j.baseUrl || j.BASE_URL).replace(/\/$/, '');
      }
    } catch (e) {
      /* ignore */
    }
  }

  const storageMode = config.storageMode === 'onprem' ? 'onprem' : 'online';
  const isOnPrem = storageMode === 'onprem';

  if (!isOnPrem && (!email || !password)) {
    writeJob(jobFile, {
      status: 'failed',
      error: 'Missing Firebase credentials (tools/billing-test.local.json)',
      progress: 0
    });
    process.exit(1);
  }

  const { chromium } = await loadPlaywright();
  const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';
  const onPremInjectPayload = isOnPrem ? buildOnPremInjectPayload({ includeSusan: false }) : null;
  const scenario = {
    liveMode: !isOnPrem,
    advanceMode: config.advanceMode === 'walk' ? 'walk' : 'instant',
    accountNumber: config.accountNumber || 'CUS-3011000',
    customerNameMatch: config.customerName || '',
    customerMode: config.customerMode || 'existing',
    customerFirstName: config.customerFirstName || '',
    customerLastName: config.customerLastName || '',
    customerCreatedDate: config.customerCreatedDate || '',
    steps: steps,
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false,
    scopeDiagnosticConsole: true,
    walkStepDelayMs: 0,
    steps: steps
  };

  const masterTestTimeoutMs =
    process.env.MASTER_TEST_TIMEOUT_MS != null && !isNaN(parseInt(process.env.MASTER_TEST_TIMEOUT_MS, 10))
      ? parseInt(process.env.MASTER_TEST_TIMEOUT_MS, 10)
      : scenario.advanceMode === 'walk'
        ? 900000
        : 300000;

  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);
  let progressTimer = null;
  let exitCode = 0;

  if (isOnPrem && onPremInjectPayload) {
    await applyOnPremInitScript(page, onPremInjectPayload);
  }

  try {
    writeJob(jobFile, {
      status: 'running',
      progress: 5,
      message: isOnPrem ? 'Loading on-prem billing app…' : 'Loading billing app…'
    });
    const appUrl = isOnPrem
      ? `${baseUrl}/index.html?onPrem=1&masterTestLive=${Date.now()}`
      : `${baseUrl}/index.html?masterTestLive=${Date.now()}`;
    await page.goto(appUrl, {
      waitUntil: 'load',
      timeout: 120000
    });

    if (isOnPrem) {
      await page.waitForFunction(
        () =>
          window.__ON_PREM_READY &&
          typeof window.runMasterTestFromStepDefs === 'function',
        { timeout: 180000 }
      );
      if (onPremInjectPayload) {
        await page.evaluate((payload) => {
          if (payload.toggles) window.__MASTER_TEST_OFFLINE_TOGGLES = payload.toggles;
          if (payload.drawer) window.__MASTER_TEST_OFFLINE_DRAWER = payload.drawer;
          if (payload.billingGlobals) {
            window.__MASTER_TEST_OFFLINE_BILLING_GLOBALS = payload.billingGlobals;
          }
        }, onPremInjectPayload);
      }
    } else {
      await page.waitForFunction(
        () => {
          const modal = document.getElementById('firebaseAuthModal');
          const modalShown = modal && !modal.classList.contains('hidden');
          const n = document.querySelectorAll('#customerTableBody tr').length;
          return modalShown || n > 0;
        },
        { timeout: 180000 }
      );

      const authModalShown = await page
        .locator('#firebaseAuthModal')
        .evaluate((el) => el && !el.classList.contains('hidden'))
        .catch(() => false);

      if (authModalShown) {
        writeJob(jobFile, { status: 'running', progress: 8, message: 'Signing in…' });
        await page.locator('#firebaseEmail').fill(email);
        await page.locator('#firebasePassword').fill(password);
        await page.locator('#firebaseAuthSubmit').click();
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
      }

      await page.waitForFunction(
        () => document.querySelectorAll('#customerTableBody tr').length > 0,
        { timeout: 180000 }
      );
    }

    writeJob(jobFile, { status: 'running', progress: 12, message: 'Preparing customer…' });
    const prep = await page.evaluate(
      async ({ cfgJson, skipClearOffline }) => {
        if (!skipClearOffline && typeof window.clearMasterTestOfflineMode === 'function') {
          window.clearMasterTestOfflineMode();
        }
        if (typeof window.__developTestPrepareLiveMasterTest !== 'function') {
          return { ok: false, error: 'prepareLiveMasterTest missing' };
        }
        return await window.__developTestPrepareLiveMasterTest(JSON.parse(cfgJson));
      },
      { cfgJson: JSON.stringify(scenario), skipClearOffline: isOnPrem }
    );

    if (!prep || !prep.ok) {
      throw new Error('Live prep failed: ' + (prep && prep.error ? prep.error : 'unknown'));
    }

    writeJob(jobFile, { status: 'running', progress: 15, message: 'Running test steps…' });

    progressTimer = setInterval(async () => {
      try {
        const p = await page.evaluate(() => window.__MASTER_TEST_PROGRESS || null);
        const prog = progressFromMasterTestEntry(p, steps.length);
        writeJob(jobFile, {
          status: 'running',
          progress: Math.max(15, prog.progress),
          message: prog.message
        });
      } catch (e) {
        /* page busy */
      }
    }, 1500);

    const result = await page.evaluate(
      async ({ cfgJson, timeoutMs, skipClearOffline }) => {
        if (!skipClearOffline && typeof window.clearMasterTestOfflineMode === 'function') {
          window.clearMasterTestOfflineMode();
        }
        if (typeof window.runMasterTestFromStepDefs !== 'function') {
          return { ok: false, error: 'runMasterTestFromStepDefs missing — reload billing app' };
        }
        const cfg = JSON.parse(cfgJson);
        if (skipClearOffline) cfg.liveMode = false;
        return await Promise.race([
          window.runMasterTestFromStepDefs(cfg),
          new Promise(function (_, reject) {
            setTimeout(function () {
              reject(new Error('runMasterTestFromStepDefs timeout (' + timeoutMs + 'ms)'));
            }, timeoutMs);
          })
        ]);
      },
      {
        cfgJson: JSON.stringify(scenario),
        timeoutMs: masterTestTimeoutMs,
        skipClearOffline: isOnPrem
      }
    );

    clearInterval(progressTimer);
    progressTimer = null;

    const report = result && typeof result.masterTestReport === 'string' ? result.masterTestReport : '';
    const consoleText =
      result && Array.isArray(result.consoleLines) ? result.consoleLines.join('\n') : '';

    const testSlug = config.testSlug ? String(config.testSlug).trim() : '';
    if (testSlug && report) {
      try {
        saveResultsToDisk(testSlug, report, consoleText);
      } catch (eDisk) {
        console.error('[dynamic-master-test] disk save failed:', eDisk.message || eDisk);
      }
    }

    if (!result || !result.ok) {
      writeJob(jobFile, {
        status: 'failed',
        progress: 100,
        message: 'Test failed',
        error: result && result.error ? result.error : 'Unknown error',
        resultsText: report,
        consoleText: consoleText
      });
      exitCode = 2;
    } else {
      writeJob(jobFile, {
        status: 'complete',
        progress: 100,
        message: 'Test complete',
        error: null,
        resultsText: report,
        consoleText: consoleText
      });
    }
  } catch (err) {
    if (progressTimer) clearInterval(progressTimer);
    writeJob(jobFile, {
      status: 'failed',
      progress: 100,
      message: 'Test failed',
      error: err && err.message ? err.message : String(err)
    });
    exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }

  process.exit(exitCode);
}

main().catch((err) => {
  const jobFile = process.env.MASTER_TEST_JOB_FILE;
  writeJob(jobFile, {
    status: 'failed',
    error: err && err.message ? err.message : String(err),
    progress: 100,
    message: 'Fatal error'
  });
  console.error('[dynamic-master-test]', err);
  process.exit(1);
});
