#!/usr/bin/env node
/**
 * Headless test: Firebase → Local sync reads from browser Firebase project (cus-billing-e84eb).
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadBillingTestCredentials } = require('./load-billing-test-credentials.cjs');
const localDb = require('./mysql-local-db.cjs');

async function loadPlaywright() {
  return import('playwright');
}

async function loginToBillingApp(page, creds) {
  await page.goto(`${creds.baseUrl}/index.html`, { waitUntil: 'load', timeout: 120000 });

  await page.waitForFunction(
    () => {
      const modal = document.getElementById('firebaseAuthModal');
      const modalShown = modal && !modal.classList.contains('hidden');
      const n = document.querySelectorAll('#customerTableBody tr').length;
      return modalShown || n > 0;
    },
    { timeout: 120000 }
  );

  const authModalShown = await page
    .locator('#firebaseAuthModal')
    .evaluate(el => el && !el.classList.contains('hidden'))
    .catch(() => false);

  if (authModalShown) {
    await page.locator('#firebaseEmail').fill(creds.email);
    await page.locator('#firebasePassword').fill(creds.password);
    await page.locator('#firebaseAuthSubmit').click();
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
    const errVisible = await page
      .locator('#firebaseAuthError')
      .evaluate(
        el => el && !el.classList.contains('hidden') && String(el.textContent || '').trim().length > 0
      )
      .catch(() => false);
    if (errVisible) {
      const msg = await page.locator('#firebaseAuthError').innerText().catch(() => '');
      throw new Error('Login failed: ' + String(msg).trim());
    }
  }

  await page.waitForFunction(
    () => document.querySelectorAll('#customerTableBody tr').length > 0,
    { timeout: 120000 }
  );
}

async function main() {
  const creds = loadBillingTestCredentials();
  if (!creds.ok) {
    console.error('[sync-test]', creds.error);
    process.exit(1);
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);

  try {
    await page.addInitScript(() => {
      localStorage.setItem('cusLocalDatabaseMode', 'online');
    });

    console.error('[sync-test] Logging in as', creds.email);
    await loginToBillingApp(page, creds);

    const onlineCount = await page.evaluate(
      () => document.querySelectorAll('#customerTableBody tr').length
    );
    console.error('[sync-test] Online customers loaded:', onlineCount);

    if (onlineCount <= 0) {
      throw new Error('No customers loaded in online mode before sync');
    }

    const result = await page.evaluate(async () => window.localDbLayer.syncFirebaseToLocal());
    console.error('[sync-test] Sync result:', JSON.stringify(result, null, 2));

    const customersSynced = result.summary?.customers ?? 0;
    if (customersSynced <= 0) {
      throw new Error(
        `Expected customers in sync summary, got ${customersSynced}. Project: ${result.projectId || 'unknown'}`
      );
    }

    await page.evaluate(() => window.localDbLayer.setLocalDatabaseMode(true));
    await page.reload({ waitUntil: 'load' });
    await loginToBillingApp(page, creds);

    const localCount = await page.evaluate(
      () => document.querySelectorAll('#customerTableBody tr').length
    );
    const hasAvey = await page.evaluate(() => {
      const text = document.getElementById('customerTableBody')?.innerText || '';
      return text.toLowerCase().includes('avey');
    });

    console.error('[sync-test] Local mode customers loaded:', localCount, 'hasAvey:', hasAvey);

    if (localCount < customersSynced) {
      throw new Error(`Local mode shows ${localCount} customers but sync copied ${customersSynced}`);
    }
    if (!hasAvey) {
      throw new Error('Bill Avey (or similar) not found in local mode after sync');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          projectId: result.projectId,
          customersSynced,
          localCount,
          hasAvey
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    await localDb.closePool();
  }
}

main().catch(err => {
  console.error('[sync-test] FAILED:', err.message || err);
  process.exit(1);
});
