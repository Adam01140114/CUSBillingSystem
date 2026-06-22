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
const { loadBillingTestCredentials } = require('./load-billing-test-credentials.cjs');

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
  if (cur.status === 'complete' || cur.status === 'failed') {
    if (patch && patch.status === 'running') {
      patch = Object.assign({}, patch);
      delete patch.status;
    }
  }
  const next = Object.assign({}, cur, patch, { updatedAt: Date.now() });
  if (typeof next.resultsText === 'string' && next.resultsText.length > 65536) {
    next.resultsTextStoredOnDisk = true;
    delete next.resultsText;
  }
  if (typeof next.consoleText === 'string' && next.consoleText.length > 65536) {
    next.consoleTextStoredOnDisk = true;
    delete next.consoleText;
  }
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  fs.writeFileSync(jobFile, JSON.stringify(next, null, 0), 'utf8');
}

function progressFromMasterTestEntry(p) {
  if (!p) return null;
  if (String(p.step) !== 'progress') return null;
  const d = p.detail;
  if (!d || typeof d.percent !== 'number') return null;
  return {
    progress: Math.min(99, Math.max(0, d.percent)),
    message: d.message || 'Running…'
  };
}

function prepProgressMessage(completed, totalSubsteps, label) {
  const percent = totalSubsteps > 0 ? Math.min(99, Math.round((completed / totalSubsteps) * 100)) : 0;
  return { progress: percent, message: label };
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

  const creds = loadBillingTestCredentials({ ensureFile: true });
  if (!creds.ok) {
    writeJob(jobFile, {
      status: 'failed',
      error: creds.error,
      progress: 0
    });
    process.exit(1);
  }

  const email = creds.email;
  const password = creds.password;
  const baseUrl = creds.baseUrl;

  const { chromium } = await loadPlaywright();
  const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';
  const scenario = {
    liveMode: true,
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
  const onprem = config.onprem === true;
  if (onprem) {
    await page.addInitScript(() => {
      localStorage.setItem('cusLocalDatabaseMode', 'local');
    });
  }
  let progressTimer = null;
  let exitCode = 0;
  let lastProgress = { progress: 0, message: 'Launching browser…' };
  let totalSubsteps = steps.length * 5 + 2;

  function writeProgress(completed, label) {
    const next = prepProgressMessage(completed, totalSubsteps, label);
    lastProgress = next;
    writeJob(jobFile, { status: 'running', progress: next.progress, message: next.message });
  }

  try {
    writeJob(jobFile, { status: 'running', progress: 0, message: 'Launching browser…' });
    await page.goto(`${baseUrl}/index.html?masterTestLive=${Date.now()}`, {
      waitUntil: 'load',
      timeout: 120000
    });

    try {
      const planCount = await page.evaluate((stepDefs) => {
        return typeof window.countMasterTestSubsteps === 'function'
          ? window.countMasterTestSubsteps(stepDefs, { includePrep: true })
          : null;
      }, steps);
      if (planCount && planCount > 0) {
        totalSubsteps = planCount;
      }
    } catch (ePlan) {
      /* use fallback total */
    }

    writeProgress(0, 'Loading billing app…');

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
      writeProgress(1, 'Signing in…');
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
    } else {
      writeProgress(1, 'Signing in…');
    }

    if (onprem) {
      writeProgress(2, 'Verifying on-prem (local MySQL) mode…');
      const localOk = await page.evaluate(() => {
        return !!(window.localDbLayer && window.localDbLayer.isLocalDatabaseMode());
      });
      if (!localOk) {
        throw new Error(
          'Billing app did not start in local database mode. Sync Firebase → Local first, then retry OnPrem tests.'
        );
      }

      writeProgress(3, 'Syncing Firebase → Local…');
      let syncOk = null;
      for (let syncAttempt = 1; syncAttempt <= 4; syncAttempt++) {
        syncOk = await page.evaluate(async () => {
          if (typeof window.__masterTestOnpremSyncFromFirebase !== 'function') {
            return { ok: false, error: '__masterTestOnpremSyncFromFirebase missing — reload index.html' };
          }
          try {
            return await window.__masterTestOnpremSyncFromFirebase();
          } catch (eSync) {
            return { ok: false, error: eSync && eSync.message ? eSync.message : String(eSync) };
          }
        });
        const syncErr = syncOk && syncOk.error ? String(syncOk.error) : '';
        const syncDeadlock = /deadlock/i.test(syncErr);
        if ((syncOk && syncOk.ok !== false) || !syncDeadlock || syncAttempt >= 4) break;
        writeProgress(3, 'Syncing Firebase → Local (retry ' + syncAttempt + ')…');
        await page.waitForTimeout(200 * syncAttempt);
      }
      if (!syncOk || syncOk.ok === false) {
        throw new Error(
          'OnPrem Firebase → Local sync failed: ' +
            (syncOk && syncOk.error ? syncOk.error : 'unknown') +
            '. Sign in to Firebase and confirm Sync Firebase → Local works in Settings.'
        );
      }
    }

    await page.waitForFunction(
      () => document.querySelectorAll('#customerTableBody tr').length > 0,
      { timeout: onprem ? 300000 : 180000 }
    );

    writeProgress(onprem ? 4 : 2, 'Preparing customer…');
    const prep = await page.evaluate(async (cfgJson) => {
      window.clearMasterTestOfflineMode();
      if (typeof window.__developTestPrepareLiveMasterTest !== 'function') {
        return { ok: false, error: 'prepareLiveMasterTest missing' };
      }
      return await window.__developTestPrepareLiveMasterTest(JSON.parse(cfgJson));
    }, JSON.stringify(scenario));

    if (!prep || !prep.ok) {
      throw new Error('Live prep failed: ' + (prep && prep.error ? prep.error : 'unknown'));
    }

    let allowProgressJobWrites = true;
    progressTimer = setInterval(async () => {
      if (!allowProgressJobWrites) return;
      try {
        const p = await page.evaluate(() => window.__MASTER_TEST_PROGRESS || null);
        const prog = progressFromMasterTestEntry(p);
        if (prog && allowProgressJobWrites) {
          lastProgress = prog;
          writeJob(jobFile, {
            status: 'running',
            progress: prog.progress,
            message: prog.message
          });
        }
      } catch (e) {
        /* page busy */
      }
    }, 800);

    const result = await page.evaluate(
      async ({ cfgJson, timeoutMs, prepSubstepsCompleted }) => {
        window.clearMasterTestOfflineMode();
        if (typeof window.runMasterTestFromStepDefs !== 'function') {
          return { ok: false, error: 'runMasterTestFromStepDefs missing — reload billing app' };
        }
        const cfg = JSON.parse(cfgJson);
        cfg.prepSubstepsCompleted = prepSubstepsCompleted;
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
        prepSubstepsCompleted: 2
      }
    );

    allowProgressJobWrites = false;
    clearInterval(progressTimer);
    progressTimer = null;

    const report = result && typeof result.masterTestReport === 'string' ? result.masterTestReport : '';
    const consoleText =
      result && Array.isArray(result.consoleLines) ? result.consoleLines.join('\n') : '';

    const testSlug = config.testSlug ? String(config.testSlug).trim() : '';
    if (testSlug && report) {
      try {
        saveResultsToDisk(testSlug, report, consoleText, !!config.onprem);
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
