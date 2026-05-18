#!/usr/bin/env node
/**
 * Run Susan master test by loading customer from Firestore via Admin SDK (no UI login).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}
const db = admin.firestore();

async function fetchSusanCustomer(accountNumber) {
  const snap = await db.collection('customers').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const acct = d.accountNumber != null ? String(d.accountNumber).trim() : '';
    if (acct === accountNumber || doc.id === accountNumber) {
      return { id: doc.id, ...d };
    }
  }
  return null;
}

async function main() {
  const { chromium } = await import('playwright');
  const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const accountNumber = (process.env.TEST_ACCOUNT_NUMBER || 'CUS-3011000').trim();
  const test1Dir = path.join(repoRoot, 'Test Scripts', 'Test Script 1');
  const masterDir = path.join(repoRoot, 'Master Test');
  const defaultOutDir = fs.existsSync(test1Dir) ? test1Dir : masterDir;
  const outResults = path.resolve(
    process.cwd(),
    process.env.MASTER_TEST_RESULTS || path.join(defaultOutDir, 'test1_results.txt')
  );
  const outConsole = path.resolve(
    process.cwd(),
    process.env.MASTER_TEST_CONSOLE || path.join(defaultOutDir, 'test1_console_logs.txt')
  );

  console.error('[master-admin] Fetching customer', accountNumber, 'from Firestore…');
  const customerDoc = await fetchSusanCustomer(accountNumber);
  if (!customerDoc) {
    console.error('[master-admin] Customer not found in Firestore.');
    process.exit(1);
  }
  console.error('[master-admin] Loaded', customerDoc.name || customerDoc.id);

  const scenario = {
    advanceMode: process.env.MASTER_TEST_ADVANCE === 'instant' ? 'instant' : 'walk',
    accountNumber,
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

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);

  try {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => typeof window.runSusanMasterTest === 'function', { timeout: 120000 });

    console.error('[master-admin] Injecting customer and running master test…');
    const result = await page.evaluate(
      async ({ customerJson, cfgJson }) => {
        const cust = JSON.parse(customerJson);
        const cfg = JSON.parse(cfgJson);
        if (typeof syncLedgerOrderCounterFromHistory === 'function') {
          syncLedgerOrderCounterFromHistory(cust);
        }
        if (!Array.isArray(cust.billPdfSnapshots)) cust.billPdfSnapshots = [];
        customers.length = 0;
        customers.push(cust);
        filteredCustomers = [...customers];
        if (typeof updateCustomerTable === 'function') updateCustomerTable();
        if (typeof window.setTestDate === 'function') {
          await window.setTestDate('2026-01-01', { skipAnimation: true, skipRunSimulatedDayForAllCustomers: false });
        }
        return await window.runSusanMasterTest(cfg);
      },
      { customerJson: JSON.stringify(customerDoc), cfgJson: JSON.stringify(scenario) }
    );

    const report = result && typeof result.masterTestReport === 'string' ? result.masterTestReport : '';
    fs.mkdirSync(path.dirname(outResults), { recursive: true });
    fs.writeFileSync(outResults, (report || JSON.stringify(result, null, 2)).replace(/\n+$/, ''), 'utf8');
    console.error('[master-admin] Wrote', outResults);

    const lines = result && Array.isArray(result.consoleLines) ? result.consoleLines : [];
    fs.writeFileSync(outConsole, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    console.error('[master-admin] Wrote', outConsole, '(' + lines.length + ' lines)');

    if (!result || !result.ok) {
      console.error('[master-admin] Failed:', result && result.error ? result.error : '(no detail)');
      process.exit(2);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
