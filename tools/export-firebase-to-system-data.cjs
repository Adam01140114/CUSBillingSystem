#!/usr/bin/env node
/**
 * One-time (or repeatable) export: Firebase Firestore → data/system_data.xlsx + system_data.json
 *
 * Usage: npm run export:firebase
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const {
  emptyState,
  saveStateToDisk,
  XLSX_PATH,
  JSON_PATH,
  writeOnPremConfig,
  DEFAULT_LOGIN_USERS
} = require('./system-data-store.cjs');
const { exportAllFromFirestoreRest } = require('./firestore-rest-client.cjs');

const required = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_CLIENT_ID'
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[export] Missing env var: ${key}`);
    process.exit(1);
  }
}

console.error('[export] Reading all collections from Firebase (REST)…');

exportAllFromFirestoreRest()
  .then((raw) => {
    const state = emptyState();
    state.meta.exportedAt = new Date().toISOString();
    state.meta.onPremEnabled = true;
    state.customers = raw.customers || [];
    state.locations = raw.locations || [];
    state.codes = raw.codes || [];
    state.users = raw.users && raw.users.length ? raw.users : [...DEFAULT_LOGIN_USERS];
    state.drawers = raw.drawers || [];
    state.paymentProcessingSessions = raw.paymentProcessingSessions || [];
    state.billingCycles = raw.billingCycles || [];
    if (raw.settings) {
      Object.assign(state.settings, raw.settings);
    }
    if (!state.users.length) state.users = [...DEFAULT_LOGIN_USERS];
    else {
      const names = new Set(state.users.map((u) => (u.fullName || '').toLowerCase()));
      for (const du of DEFAULT_LOGIN_USERS) {
        if (!names.has(du.fullName.toLowerCase())) state.users.push(du);
      }
    }
    if (state.settings.toggles) {
      state.settings.toggles.onPremModeEnabled = true;
    } else {
      state.settings.toggles = { onPremModeEnabled: true };
    }
    return saveStateToDisk(state);
  })
  .then(async (state) => {
    if (!state.customers.length) {
      console.error('[export] Service-account export returned 0 customers.');
      console.error('[export] Falling back to browser export (cus-billing-e84eb via app login)…');
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.execPath, [path.join(__dirname, 'export-firebase-via-browser.mjs')], {
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit',
        env: process.env
      });
      process.exit(r.status || 0);
    }
    writeOnPremConfig({ onPremEnabled: true });
    console.error('[export] Done.');
    console.error(`  JSON: ${JSON_PATH}`);
    console.error(`  XLSX: ${XLSX_PATH}`);
    console.error(`  Customers: ${state.customers.length}`);
    console.error(`  Locations: ${state.locations.length}`);
    console.error(`  Codes: ${state.codes.length}`);
    console.error(`  Users: ${state.users.length}`);
    console.error(`  Drawers: ${state.drawers.length}`);
    console.error(`  POS sessions: ${state.paymentProcessingSessions.length}`);
    console.error(`  Billing cycles: ${state.billingCycles.length}`);
  })
  .catch((err) => {
    console.error('[export] Failed:', err.stack || err);
    process.exit(1);
  });
