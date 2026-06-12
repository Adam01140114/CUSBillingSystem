#!/usr/bin/env node
/**
 * Run master tests 1–3 against on-prem mode (system_data, no Firebase).
 * Master tests run in-memory only — they never overwrite data/system_data.json.
 *
 * Prerequisites:
 *   npm run export:firebase   (once)
 *   ON_PREM_MODE=1 npm start
 *
 * Usage:
 *   npm run test:onprem:all
 *   npm run test:onprem:1
 *   npm run test:onprem:2
 *   npm run test:onprem:3
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const { JSON_PATH, restoreStateFromBackup } = require('./system-data-store.cjs');
const BACKUP_PATH = path.join(repoRoot, 'data', '.system_data.pre-test-backup.json');

const TEST_CONFIGS = {
  1: {
    name: 'Test Script 1',
    dir: path.join(repoRoot, 'Test Scripts', 'Test Script 1'),
    useSusan: true,
    resultsFile: 'test1_results.txt',
    consoleFile: 'test1_console_logs.txt',
    accountNumber: 'CUS-3011000',
    customerName: 'Susan Young',
    steps: null
  },
  2: {
    name: 'Test Script 2',
    dir: path.join(repoRoot, 'Test Scripts', 'Test Script 2'),
    pkgFile: 'Test_2.master-test.json',
    resultsFile: 'test_script_results.txt',
    consoleFile: 'test2_console_logs.txt',
    testSlug: 'test2'
  },
  3: {
    name: 'Test Script 3',
    dir: path.join(repoRoot, 'Test Scripts', 'Test Script 3'),
    pkgFile: 'Test_3.master-test.json',
    resultsFile: 'test_script_results.txt',
    consoleFile: 'test3_console_logs.txt',
    testSlug: 'test3'
  }
};

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

function buildLoginInject() {
  return {
    fullName: 'Adam',
    userCode: 'alco0114',
    title: 'Admin',
    role: 'admin',
    email: 'adam@alcowater.com'
  };
}

function applyOnPremInitScript(page, extra) {
  return page.addInitScript((payload) => {
    window.__ON_PREM_MODE = true;
    window.__ON_PREM_MASTER_TEST = true;
    window.__ON_PREM_SKIP_DISK_PERSIST = true;
    window.__MASTER_TEST_SKIP_POS_UI = true;
    window.__MASTER_TEST_SKIP_PDF_BILL = true;
    window.__MASTER_TEST_FAST_DATE = true;
    const u = payload.loginUser;
    window.authenticatedUser = {
      id: 'USR-adam',
      fullName: u.fullName,
      userCode: u.userCode,
      title: u.title,
      role: u.role,
      email: u.email
    };
    try {
      localStorage.setItem('authenticatedUser', JSON.stringify(window.authenticatedUser));
    } catch (e) {
      /* ignore */
    }
    if (payload.toggles) window.__MASTER_TEST_OFFLINE_TOGGLES = payload.toggles;
    if (payload.billingGlobals) window.__MASTER_TEST_OFFLINE_BILLING_GLOBALS = payload.billingGlobals;
    if (payload.drawer) window.__MASTER_TEST_OFFLINE_DRAWER = payload.drawer;
    if (payload.customer) window.__MASTER_TEST_PENDING_CUSTOMER = payload.customer;
  }, extra);
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    console.error('[onprem-tests] Install playwright: npm install && npx playwright install chromium');
    process.exit(1);
  }
}

async function runTest1(page, baseUrl, cfg) {
  const scenario = {
    advanceMode: process.env.MASTER_TEST_ADVANCE === 'instant' ? 'instant' : 'walk',
    accountNumber: cfg.accountNumber,
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false,
    scopeDiagnosticConsole: false,
    masterCheckAmount: 10,
    masterCheckNumber: 'MT-10'
  };

  await page.goto(`${baseUrl}/index.html?onPrem=1&masterTestTs=${Date.now()}`, {
    waitUntil: 'load',
    timeout: 120000
  });
  await page.waitForFunction(
    () => window.__ON_PREM_READY && typeof window.runSusanMasterTest === 'function',
    { timeout: 180000 }
  );

  const boot = await page.evaluate(() => {
    if (typeof window.__developTestApplyMasterTestPendingInjections === 'function') {
      window.__developTestApplyMasterTestPendingInjections();
    }
    if (typeof window.__developTestBootstrapForMasterTest === 'function') {
      return window.__developTestBootstrapForMasterTest();
    }
    return { ok: false, error: 'bootstrap missing' };
  });
  if (!boot || !boot.ok) throw new Error('Test 1 bootstrap failed: ' + (boot && boot.error));

  if (!boot.customerCount || boot.customerCount < 1) {
    throw new Error('Test 1: no customers loaded after bootstrap');
  }

  const timeoutMs = scenario.advanceMode === 'walk' ? 900000 : 180000;
  const result = await page.evaluate(
    async ({ cfgJson, timeoutMs }) => {
      return await Promise.race([
        window.runSusanMasterTest(JSON.parse(cfgJson)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]);
    },
    { cfgJson: JSON.stringify(scenario), timeoutMs }
  );
  return result;
}

async function runDynamicTest(page, baseUrl, cfg, testNum, injectPayload) {
  const pkgPath = path.join(cfg.dir, cfg.pkgFile);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const scenario = {
    liveMode: false,
    advanceMode: 'walk',
    accountNumber: pkg.customerId || 'CUS-3011000',
    customerNameMatch: pkg.customerName || '',
    customerMode: pkg.customerMode || 'existing',
    customerFirstName: pkg.customerFirstName || '',
    customerLastName: pkg.customerLastName || '',
    customerCreatedDate: pkg.customerCreatedDate || '',
    steps: pkg.stepDefs || [],
    captureConsole: true,
    suppressAlerts: true,
    openResultsTab: false,
    scopeDiagnosticConsole: true,
    walkStepDelayMs: 0,
    testSlug: cfg.testSlug
  };

  await page.goto(`${baseUrl}/index.html?onPrem=1&masterTestTs=${Date.now()}`, {
    waitUntil: 'load',
    timeout: 120000
  });

  await page.waitForFunction(
    () => window.__ON_PREM_READY && typeof window.runMasterTestFromStepDefs === 'function',
    { timeout: 180000 }
  );

  await page.evaluate((payload) => {
    if (payload.toggles) window.__MASTER_TEST_OFFLINE_TOGGLES = payload.toggles;
    if (payload.drawer) window.__MASTER_TEST_OFFLINE_DRAWER = payload.drawer;
    if (payload.billingGlobals) window.__MASTER_TEST_OFFLINE_BILLING_GLOBALS = payload.billingGlobals;
  }, injectPayload || {});

  const prep = await page.evaluate(async (cfgJson) => {
    if (typeof window.__developTestPrepareLiveMasterTest === 'function') {
      return await window.__developTestPrepareLiveMasterTest(JSON.parse(cfgJson));
    }
    return { ok: false, error: 'prepareLiveMasterTest missing' };
  }, JSON.stringify(scenario));

  if (!prep || !prep.ok) {
    throw new Error(`Test ${testNum} prep failed: ` + (prep && prep.error ? prep.error : 'unknown'));
  }

  const timeoutMs = 900000;
  const result = await page.evaluate(
    async ({ cfgJson, timeoutMs }) => {
      if (typeof window.runMasterTestFromStepDefs !== 'function') {
        return { ok: false, error: 'runMasterTestFromStepDefs missing' };
      }
      const cfg = JSON.parse(cfgJson);
      cfg.liveMode = false;
      return await Promise.race([
        window.runMasterTestFromStepDefs(cfg),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]);
    },
    { cfgJson: JSON.stringify(scenario), timeoutMs }
  );
  return result;
}

async function runOne(testNum, baseUrl) {
  const cfg = TEST_CONFIGS[testNum];
  if (!cfg) throw new Error('Unknown test: ' + testNum);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);

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

  const inject = {
    loginUser: buildLoginInject(),
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
    }
  };

  if (testNum === 1) {
    inject.customer = buildSusanTemplate();
  }

  await applyOnPremInitScript(page, inject);

  let result;
  try {
    console.error(`[onprem-tests] Running Test ${testNum} (${cfg.name})…`);
    if (cfg.useSusan) {
      result = await runTest1(page, baseUrl, cfg);
    } else {
      result = await runDynamicTest(page, baseUrl, cfg, testNum, inject);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const report = result && typeof result.masterTestReport === 'string' ? result.masterTestReport : '';
  const outResults = path.join(cfg.dir, cfg.resultsFile);
  const outConsole = path.join(cfg.dir, cfg.consoleFile || 'test_console_logs.txt');
  fs.mkdirSync(cfg.dir, { recursive: true });
  fs.writeFileSync(outResults, (report || JSON.stringify(result, null, 2)).replace(/\n+$/, '') + '\n', 'utf8');
  const lines = result && Array.isArray(result.consoleLines) ? result.consoleLines : [];
  fs.writeFileSync(outConsole, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

  if (!result || !result.ok) {
    console.error(`[onprem-tests] Test ${testNum} FAILED:`, result && result.error ? result.error : '');
    return false;
  }
  console.error(`[onprem-tests] Test ${testNum} PASSED`);
  return true;
}

function backupProductionData() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error('[onprem-tests] No system_data.json to backup — run npm run export:firebase first');
    return 0;
  }
  fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true });
  fs.copyFileSync(JSON_PATH, BACKUP_PATH);
  const state = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const count = Array.isArray(state.customers) ? state.customers.length : 0;
  console.error(`[onprem-tests] Backed up system_data (${count} customers) → ${BACKUP_PATH}`);
  return count;
}

async function restoreProductionData(baseUrl) {
  if (!fs.existsSync(BACKUP_PATH)) return;
  restoreStateFromBackup(BACKUP_PATH);
  const state = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const count = Array.isArray(state.customers) ? state.customers.length : 0;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/system-data/reload-from-disk`, {
      method: 'POST'
    });
    if (!res.ok) {
      console.error('[onprem-tests] Warning: could not reload server memory — restart npm run start:onprem');
    }
  } catch (e) {
    console.error('[onprem-tests] Warning: server reload failed — restart npm run start:onprem');
  }
  console.error(`[onprem-tests] Restored production system_data (${count} customers)`);
}

async function main() {
  const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const arg = process.argv[2] || 'all';
  const tests =
    arg === 'all' ? [1, 2, 3] : arg.split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n));

  const countBefore = backupProductionData();
  let failed = 0;
  try {
    for (const t of tests) {
      const ok = await runOne(t, baseUrl);
      if (!ok) failed++;
    }
  } finally {
    await restoreProductionData(baseUrl);
    const countAfter = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')).customers?.length ?? 0;
    if (countBefore > 0 && countAfter !== countBefore) {
      console.error(
        `[onprem-tests] WARNING: customer count changed ${countBefore} → ${countAfter} after restore`
      );
    }
  }
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('[onprem-tests] Fatal:', err);
  process.exit(1);
});
