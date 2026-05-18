#!/usr/bin/env node
/**
 * OFFLINE-ONLY Susan master test (injected fake customer, no Firestore persist).
 *
 * For the REAL billing program use:
 *   npm run test:master:susan
 * which runs tools/run-susan-master-test-headless.mjs with Firebase login.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const test1Dir = path.join(repoRoot, 'Test Scripts', 'Test Script 1');
const masterDir = path.join(repoRoot, 'Master Test');
const defaultOutDir = fs.existsSync(test1Dir) ? test1Dir : masterDir;

function buildSusanTemplate() {
  const factor = Math.round((168.36 / 170) * 1000000) / 1000000;
  return {
    id: 'CUS-3011000',
    accountNumber: 'CUS-3011000',
    name: 'Susan Young',
    deposit: 1000,
    pastDue: 0,
    factor,
    createdDate: '2020-01-01T00:00:00.000Z',
    paymentHistory: [],
    chargeHistory: [],
    ledgerStatusHistory: [],
    ledgerOrderCounter: 0,
    currentMonthPaid: 0,
    currentMonthPaidSewer: 0,
    currentMonthPaidTaxCodes: 0,
    currentMonthPaidPuc: 0,
    currentMonthPaidLateFee: 0,
    currentMonthPaymentHistory: [],
    billPdfSnapshots: [],
    paymentStatus: 'current',
    codes: [{ id: 'susan-tax', name: 'Tax Codes', type: 'percentage', amount: 1.45 }],
    lastPayment: 'Never'
  };
}

function buildInjectPayload(advanceMode) {
  const sodIso = new Date(2026, 0, 1, 12, 0, 0, 0).toISOString();
  const bills = { 1: 0, 2: 0, 5: 0, 10: 0, 20: 0, 50: 0, 100: 1 };
  const coins = { penny: 0, nickel: 0, dime: 0, quarter: 0, half: 0, dollar: 0 };
  const countRecord = {
    bills: { ...bills },
    coins: { ...coins },
    cashTotal: 100,
    checksTotal: 0,
    total: 100,
    countedBy: 'Testing Drawer (system)',
    countedByCode: '',
    countedAt: sodIso,
    type: 'SOD'
  };

  return {
    advanceMode,
    customer: buildSusanTemplate(),
    toggles: {
      askUserCodePerTransaction: false,
      skipPOSInitialRegisterCount: true,
      testingDrawerEnabled: true,
      autoApplyLateFees: true,
      lateFeeTimerDays: 21,
      depositWithdrawDelinquencyDays: 60
    },
    billingGlobals: {
      pucSurcharge: 4.5,
      lateFeeFlat: 5,
      lateFeeMode: 'flat',
      lateFeeTimerDays: 21,
      depositWithdrawDelinquencyDays: 60,
      autoApplyLateFees: true
    },
    drawer: {
      id: '__system_testing_drawer__',
      name: 'Testing Drawer',
      fundValue: 100,
      available: true,
      isSystemTestingDrawer: true,
      lastCountDate: sodIso,
      lastCount: { ...countRecord },
      countHistory: [{ ...countRecord }],
      createdAt: sodIso
    },
    users: [{ userCode: '9999', fullName: 'Master Test', role: 'admin' }]
  };
}

function applyMasterTestInitScript(page, inject) {
  return page.addInitScript((payload) => {
    window.__MASTER_TEST_SKIP_PDF_BILL = true;
    window.__MASTER_TEST_SKIP_FIRESTORE_PERSIST = true;
    window.__MASTER_TEST_SKIP_POS_UI = true;
    /** Skip heavy dashboard refresh each simulated day (overlay walk still runs). */
    window.__MASTER_TEST_FAST_DATE = true;
    window.__MASTER_TEST_PENDING_CUSTOMER = payload.customer;
    window.__MASTER_TEST_OFFLINE_TOGGLES = payload.toggles;
    window.__MASTER_TEST_OFFLINE_BILLING_GLOBALS = payload.billingGlobals;
    window.__MASTER_TEST_OFFLINE_DRAWER = payload.drawer;
    window.__MASTER_TEST_OFFLINE_USERS = payload.users;
    if (payload.users && payload.users[0]) {
      const u = payload.users[0];
      window.authenticatedUser = {
        userCode: u.userCode || '9999',
        fullName: u.fullName || 'Master Test',
        role: u.role || 'admin',
        email: 'master-test@cus.local'
      };
      try {
        localStorage.setItem('authenticatedUser', JSON.stringify(window.authenticatedUser));
      } catch (e) {
        /* ignore */
      }
    }
  }, inject);
}

async function main() {
  const { chromium } = await import('playwright');
  const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const outResults = path.resolve(
    process.cwd(),
    process.env.MASTER_TEST_RESULTS || path.join(defaultOutDir, 'test1_results.txt')
  );
  const outConsole = path.resolve(
    process.cwd(),
    process.env.MASTER_TEST_CONSOLE || path.join(defaultOutDir, 'test1_console_logs.txt')
  );

  const scenario = {
    advanceMode: process.env.MASTER_TEST_ADVANCE === 'instant' ? 'instant' : 'walk',
    accountNumber: (process.env.TEST_ACCOUNT_NUMBER || 'CUS-3011000').trim(),
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false,
    scopeDiagnosticConsole: false,
    masterCheckAmount:
      process.env.MASTER_TEST_CHECK_AMOUNT != null && !isNaN(parseFloat(process.env.MASTER_TEST_CHECK_AMOUNT))
        ? parseFloat(process.env.MASTER_TEST_CHECK_AMOUNT)
        : 10,
    masterCheckNumber: process.env.MASTER_TEST_CHECK_NUMBER != null ? String(process.env.MASTER_TEST_CHECK_NUMBER) : 'MT-10'
  };

  const inject = buildInjectPayload(scenario.advanceMode);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);

  page.on('console', (msg) => {
    const text = msg.text();
    if (
      text.indexOf('[MasterTest]') !== -1 ||
      text.indexOf('[master-offline]') !== -1 ||
      msg.type() === 'error' ||
      msg.type() === 'warning'
    ) {
      console.error('[browser:' + msg.type() + ']', text);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[browser:pageerror]', err && err.message ? err.message : String(err));
  });

  let progressTimer = null;

  try {
    await applyMasterTestInitScript(page, inject);

    console.error('[master-offline] Loading app…');
    const pageUrl = `${baseUrl}/index.html?masterTestTs=${Date.now()}`;
    await page.goto(pageUrl, { waitUntil: 'load', timeout: 120000 });
    console.error('[master-offline] Page loaded, waiting for runSusanMasterTest…');
    await page.waitForFunction(() => typeof window.runSusanMasterTest === 'function', { timeout: 180000 });

    console.error('[master-offline] Applying offline fixtures + bootstrap…');
    const boot = await page.evaluate((payload) => {
      if (typeof window.__developTestApplyMasterTestPendingInjections === 'function') {
        window.__developTestApplyMasterTestPendingInjections();
      }
      if (typeof window.__developTestBootstrapForMasterTest === 'function') {
        return window.__developTestBootstrapForMasterTest();
      }
      return { ok: false, error: 'bootstrap missing' };
    }, inject);

    console.error('[master-offline] Bootstrap result:', JSON.stringify(boot));
    if (!boot || !boot.ok) {
      throw new Error('Bootstrap failed: ' + (boot && boot.error ? boot.error : 'unknown'));
    }

    const preflight = await page.evaluate(() => ({
      customerCount: Array.isArray(window.customers) ? window.customers.length : -1,
      hasSusan: !!(Array.isArray(window.customers) && window.customers.find((c) => c && c.accountNumber === 'CUS-3011000')),
      testDate: typeof window.testDate !== 'undefined' ? window.testDate : null,
      skipFirestore: !!window.__MASTER_TEST_SKIP_FIRESTORE_PERSIST
    }));
    console.error('[master-offline] Preflight:', JSON.stringify(preflight));

    const masterTestTimeoutMs =
      process.env.MASTER_TEST_TIMEOUT_MS != null && !isNaN(parseInt(process.env.MASTER_TEST_TIMEOUT_MS, 10))
        ? parseInt(process.env.MASTER_TEST_TIMEOUT_MS, 10)
        : scenario.advanceMode === 'walk'
          ? 900000
          : 180000;

    console.error(
      '[master-offline] Running master test (advanceMode=' +
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
            '[master-offline] progress @ ' +
              p.ts +
              ' — ' +
              p.step +
              (p.detail != null ? ' ' + JSON.stringify(p.detail) : '')
          );
        }
      } catch (e) {
        /* page may be busy */
      }
    }, 5000);

    const result = await page.evaluate(
      async ({ cfgJson, timeoutMs }) => {
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
    console.error('[master-offline] Wrote', outResults, '(' + (report ? report.length : 0) + ' chars)');

    const lines = result && Array.isArray(result.consoleLines) ? result.consoleLines : [];
    fs.writeFileSync(outConsole, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    console.error('[master-offline] Wrote console log (' + lines.length + ' lines)');

    if (!result || !result.ok) {
      console.error('[master-offline] Failed:', result && result.error ? result.error : '(no detail)');
      process.exit(2);
    }
    console.error('[master-offline] SUCCESS — all steps completed');
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[master-offline] Fatal:', err);
  process.exit(1);
});
