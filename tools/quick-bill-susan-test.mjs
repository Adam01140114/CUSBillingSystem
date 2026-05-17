#!/usr/bin/env node
/** Quick login + Send Bill smoke test (diagnose loading hang). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const localPath = path.join(repoRoot, 'tools', 'billing-test.local.json');

let email = process.env.FIREBASE_TEST_EMAIL;
let password = process.env.FIREBASE_TEST_PASSWORD;
let baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

if (fs.existsSync(localPath)) {
  const j = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  email = email || j.email;
  password = password || j.password;
  if (!process.env.BASE_URL && j.baseUrl) baseUrl = String(j.baseUrl).replace(/\/$/, '');
}

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(120000);

const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

try {
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load', timeout: 60000 });

  const authModal = page.locator('#firebaseAuthModal');
  if (await authModal.evaluate((el) => el && !el.classList.contains('hidden')).catch(() => false)) {
    await page.locator('#firebaseEmail').fill(email);
    await page.locator('#firebasePassword').fill(password);
    await page.locator('#firebaseAuthSubmit').click();
    await page.waitForFunction(
      () => {
        const m = document.getElementById('firebaseAuthModal');
        return m && m.classList.contains('hidden');
      },
      { timeout: 120000 }
    );
    await page.waitForLoadState('load');
  }

  await page.waitForFunction(
    () => typeof window.__billModuleCustomersReady !== 'undefined',
    { timeout: 30000 }
  );

  try {
    await page.waitForFunction(
      () => document.querySelectorAll('#customerTableBody tr').length > 0,
      { timeout: 90000 }
    );
  } catch (e) {
    console.error('[quick-test] no customer rows after 90s (Firestore may be empty or denied)');
  }

  const gateMs = await page.evaluate(async () => {
    const t0 = Date.now();
    await Promise.race([
      window.__billModuleCustomersReady,
      new Promise((r) => setTimeout(() => r('timeout'), 90000))
    ]);
    return Date.now() - t0;
  });
  console.error('[quick-test] __billModuleCustomersReady resolved in', gateMs, 'ms');

  const counts = await page.evaluate(() => {
    const rows = document.querySelectorAll('#customerTableBody tr').length;
    const searchHtml = document.getElementById('billCustomerSearchResults')?.innerText || '';
    return {
      dashboardCustomerRows: rows,
      billSearchHasSusan: /Susan|3011000/i.test(searchHtml)
    };
  });
  console.error('[quick-test] customer rows on dashboard:', counts);

  await page.evaluate(() => window.showBillModule());
  await page.waitForTimeout(3000);

  const billState = await page.evaluate(() => {
    const mod = document.getElementById('billModule');
    const text = mod ? mod.innerText.slice(0, 200) : '';
    return {
      loading: text.includes('Loading customers'),
      hasSearch: !!document.getElementById('billCustomerSearch'),
      preview: text
    };
  });
  console.error('[quick-test] bill module:', JSON.stringify(billState, null, 2));

  if (billState.hasSearch) {
    await page.locator('#billCustomerSearch').fill('CUS-3011000');
    await page.waitForTimeout(800);
    const picked = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('#billCustomerSearchResults button')).find((b) =>
        /Susan|3011000/i.test(b.textContent || '')
      );
      if (!btn) return { ok: false, reason: 'no search result button' };
      btn.click();
      return { ok: true, label: btn.textContent?.trim().slice(0, 80) };
    });
    console.error('[quick-test] picked susan:', picked);
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => ({
      billInfoHidden: document.getElementById('customerBillInfo')?.classList.contains('hidden'),
      selectedId: document.getElementById('billSelectedCustomerId')?.value || '',
      produceBtn: !!document.querySelector('[onclick*="produceBill"]')
    }));
    console.error('[quick-test] after select:', info);
    if (picked.ok) {
      const billed = await page.evaluate(async () => {
        try {
          if (typeof produceBill !== 'function') return { ok: false, reason: 'no produceBill' };
          await produceBill();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: String(e.message) };
        }
      });
      console.error('[quick-test] produceBill:', billed);
      await page.waitForTimeout(2000);
    }
  }

  const errLogs = logs.filter((l) => /error|failed|timeout|Maximum call stack/i.test(l));
  console.error('[quick-test] error-ish console lines:', errLogs.slice(0, 20).join('\n') || '(none)');
} catch (e) {
  console.error('[quick-test] FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
