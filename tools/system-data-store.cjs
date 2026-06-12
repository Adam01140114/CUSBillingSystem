#!/usr/bin/env node
/**
 * On-prem system data store — JSON canonical + system_data.xlsx export.
 * Server runtime reads/writes data/system_data.json; xlsx is regenerated on save.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const JSON_PATH = path.join(DATA_DIR, 'system_data.json');
const XLSX_PATH = path.join(DATA_DIR, 'system_data.xlsx');
const CONFIG_PATH = path.join(DATA_DIR, 'onprem-config.json');

const FORMAT_VERSION = 1;

const DEFAULT_LOGIN_USERS = [
  { id: 'USR-adam', fullName: 'Adam', userCode: 'alco0114', title: 'Admin', createdAt: new Date().toISOString() },
  { id: 'USR-rich', fullName: 'Rich', userCode: 'alco0114', title: 'Admin', createdAt: new Date().toISOString() },
  { id: 'USR-rob', fullName: 'Rob', userCode: 'alco0114', title: 'Admin', createdAt: new Date().toISOString() },
  { id: 'USR-cynthia', fullName: 'Cynthia', userCode: 'alco0114', title: 'Point of Sale', createdAt: new Date().toISOString() },
  { id: 'USR-kelli', fullName: 'Kelli', userCode: 'alco0114', title: 'Supervisor', createdAt: new Date().toISOString() },
  { id: 'USR-becky', fullName: 'Becky', userCode: 'alco0114', title: 'Supervisor', createdAt: new Date().toISOString() }
];

function emptyState() {
  return {
    meta: {
      formatVersion: FORMAT_VERSION,
      exportedAt: null,
      lastSavedAt: null,
      onPremEnabled: false
    },
    settings: {
      sewerCharge: { value: 170 },
      lateFee: { mode: 'flat', flatPerCycle: 20, percent: 0 },
      pucSurcharge: { value: 0 },
      toggles: {
        askUserCodePerTransaction: false,
        skipPOSInitialRegisterCount: false,
        testingDrawerEnabled: false,
        afterHoursLogoutEnabled: false,
        afterHoursStartTime: '17:00',
        afterHoursEndTime: '09:00',
        posDoesntCloseOut: false,
        useUsernameInsteadOfUserCode: false,
        autoApplyLateFees: true,
        lateFeeTimerDays: 21,
        depositWithdrawDelinquencyDays: 60,
        lateFeeGraceAmountEnabled: false,
        lateFeeGraceAmountDollars: 0,
        testDate: null,
        freshStartUseSetDate: false,
        freshStartSetDate: null,
        freshStartSingleCustomerEnabled: false,
        freshStartSingleCustomerId: null,
        onPremModeEnabled: false
      },
      paymentHierarchy: {
        order: ['Late fees', 'Past due amount', 'Current amount due', 'Puc surcharge', 'Tax Codes'],
        updatedAt: new Date().toISOString()
      },
      deletedCodeNames: { names: [] }
    },
    customers: [],
    locations: [],
    codes: [],
    users: [...DEFAULT_LOGIN_USERS],
    drawers: [],
    paymentProcessingSessions: [],
    billingCycles: []
  };
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readOnPremConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return { onPremEnabled: process.env.ON_PREM_MODE === '1' || process.env.ON_PREM_MODE === 'true' };
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      onPremEnabled:
        cfg.onPremEnabled === true ||
        process.env.ON_PREM_MODE === '1' ||
        process.env.ON_PREM_MODE === 'true'
    };
  } catch (e) {
    return { onPremEnabled: process.env.ON_PREM_MODE === '1' };
  }
}

function writeOnPremConfig(patch) {
  ensureDir();
  const cur = readOnPremConfig();
  const next = Object.assign({}, cur, patch || {});
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    meta: Object.assign({}, base.meta, raw.meta || {}),
    settings: Object.assign({}, base.settings, raw.settings || {}),
    customers: Array.isArray(raw.customers) ? raw.customers : [],
    locations: Array.isArray(raw.locations) ? raw.locations : [],
    codes: Array.isArray(raw.codes) ? raw.codes : [],
    users: Array.isArray(raw.users) && raw.users.length ? raw.users : base.users,
    drawers: Array.isArray(raw.drawers) ? raw.drawers : [],
    paymentProcessingSessions: Array.isArray(raw.paymentProcessingSessions) ? raw.paymentProcessingSessions : [],
    billingCycles: Array.isArray(raw.billingCycles) ? raw.billingCycles : []
  };
}

let memoryState = null;

function loadStateFromDisk() {
  ensureDir();
  if (fs.existsSync(JSON_PATH)) {
    try {
      memoryState = normalizeState(JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')));
      return memoryState;
    } catch (e) {
      console.error('[system-data] JSON parse failed:', e.message);
    }
  }
  if (fs.existsSync(XLSX_PATH)) {
    try {
      memoryState = normalizeState(readStateFromXlsx(XLSX_PATH));
      return memoryState;
    } catch (e) {
      console.error('[system-data] XLSX read failed:', e.message);
    }
  }
  memoryState = emptyState();
  return memoryState;
}

function getState() {
  if (!memoryState) return loadStateFromDisk();
  return memoryState;
}

function reloadStateFromDisk() {
  memoryState = null;
  return loadStateFromDisk();
}

function restoreStateFromBackup(backupPath) {
  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found: ' + backupPath);
  }
  const state = normalizeState(JSON.parse(fs.readFileSync(backupPath, 'utf8')));
  return saveStateToDisk(state);
}

function setState(next) {
  memoryState = normalizeState(next);
  memoryState.meta.lastSavedAt = new Date().toISOString();
  return memoryState;
}

function saveStateToDisk(state) {
  ensureDir();
  const normalized = setState(state || memoryState || emptyState());
  fs.writeFileSync(JSON_PATH, JSON.stringify(normalized, null, 0), 'utf8');
  writeStateToXlsx(normalized, XLSX_PATH);
  return normalized;
}

function jsonCell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (e) {
    return '';
  }
}

function parseJsonCell(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (e) {
    return fallback;
  }
}

function sheetToRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function writeStateToXlsx(state, outPath) {
  const wb = XLSX.utils.book_new();

  const metaRows = [
    { key: 'formatVersion', value: String(state.meta.formatVersion || FORMAT_VERSION) },
    { key: 'exportedAt', value: state.meta.exportedAt || '' },
    { key: 'lastSavedAt', value: state.meta.lastSavedAt || '' },
    { key: 'onPremEnabled', value: state.meta.onPremEnabled ? 'true' : 'false' }
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), '_meta');

  const settingsRows = [];
  const s = state.settings || {};
  if (s.sewerCharge) settingsRows.push({ key: 'sewerCharge', value: jsonCell(s.sewerCharge) });
  if (s.lateFee) settingsRows.push({ key: 'lateFee', value: jsonCell(s.lateFee) });
  if (s.pucSurcharge) settingsRows.push({ key: 'pucSurcharge', value: jsonCell(s.pucSurcharge) });
  if (s.toggles) settingsRows.push({ key: 'toggles', value: jsonCell(s.toggles) });
  if (s.paymentHierarchy) settingsRows.push({ key: 'paymentHierarchy', value: jsonCell(s.paymentHierarchy) });
  if (s.deletedCodeNames) settingsRows.push({ key: 'deletedCodeNames', value: jsonCell(s.deletedCodeNames) });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settingsRows), 'settings');

  const customerScalars = (state.customers || []).map((c) => {
    const row = Object.assign({}, c);
    delete row.paymentHistory;
    delete row.chargeHistory;
    delete row.ledgerStatusHistory;
    delete row.billPdfSnapshots;
    delete row.currentMonthPaymentHistory;
    delete row.codes;
    delete row.importData;
    delete row.pastDueComposition;
    delete row.processBillPanelFrozenSnapshot;
    row.codes_json = jsonCell(c.codes);
    row.pastDueComposition_json = jsonCell(c.pastDueComposition);
    row.importData_json = jsonCell(c.importData);
    row.processBillPanelFrozenSnapshot_json = jsonCell(c.processBillPanelFrozenSnapshot);
    return row;
  });
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(customerScalars.length ? customerScalars : [{ id: '' }]),
    'customers'
  );

  const payRows = [];
  const chargeRows = [];
  const statusRows = [];
  const snapRows = [];
  const monthPayRows = [];
  for (const c of state.customers || []) {
    const cid = c.id || c.accountNumber || '';
    (c.paymentHistory || []).forEach((p, i) => {
      payRows.push({ customer_id: cid, row_index: i, data_json: jsonCell(p) });
    });
    (c.chargeHistory || []).forEach((p, i) => {
      chargeRows.push({ customer_id: cid, row_index: i, data_json: jsonCell(p) });
    });
    (c.ledgerStatusHistory || []).forEach((p, i) => {
      statusRows.push({ customer_id: cid, row_index: i, data_json: jsonCell(p) });
    });
    (c.billPdfSnapshots || []).forEach((p, i) => {
      snapRows.push({ customer_id: cid, row_index: i, data_json: jsonCell(p) });
    });
    (c.currentMonthPaymentHistory || []).forEach((p, i) => {
      monthPayRows.push({ customer_id: cid, row_index: i, data_json: jsonCell(p) });
    });
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payRows.length ? payRows : [{ customer_id: '' }]), 'customer_payment_history');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chargeRows.length ? chargeRows : [{ customer_id: '' }]), 'customer_charge_history');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statusRows.length ? statusRows : [{ customer_id: '' }]), 'customer_status_history');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(snapRows.length ? snapRows : [{ customer_id: '' }]), 'customer_bill_pdf_snapshots');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthPayRows.length ? monthPayRows : [{ customer_id: '' }]), 'customer_month_payments');

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet((state.locations || []).length ? state.locations : [{ id: '' }]),
    'locations'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet((state.codes || []).length ? state.codes : [{ id: '' }]),
    'codes'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet((state.users || []).length ? state.users : [{ id: '' }]),
    'users'
  );

  const drawerRows = (state.drawers || []).map((d) => {
    const row = Object.assign({}, d);
    row.lastCount_json = jsonCell(d.lastCount);
    row.countHistory_json = jsonCell(d.countHistory);
    delete row.lastCount;
    delete row.countHistory;
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(drawerRows.length ? drawerRows : [{ id: '' }]), 'drawers');

  const sessionRows = (state.paymentProcessingSessions || []).map((s) => ({
    id: s.id,
    username: s.username,
    userCode: s.userCode,
    startedAt: s.startedAt,
    totalAmount: s.totalAmount,
    drawer_json: jsonCell(s.drawer),
    register_json: jsonCell(s.register),
    entries_json: jsonCell(s.entries)
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessionRows.length ? sessionRows : [{ id: '' }]), 'pos_sessions');

  const cycleRows = (state.billingCycles || []).map((c) => ({
    id: c.id,
    cycleNumber: c.cycleNumber,
    generatedDate: c.generatedDate,
    generatedDateStr: c.generatedDateStr,
    statementDate: c.statementDate,
    cyclePeriod: c.cyclePeriod,
    dueDateStr: c.dueDateStr,
    settings_json: jsonCell(c.settings),
    customerSnapshots_json: jsonCell(c.customerSnapshots)
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cycleRows.length ? cycleRows : [{ id: '' }]), 'billing_cycles');

  ensureDir();
  XLSX.writeFile(wb, outPath);
}

function readChildHistory(rows, customerId) {
  return rows
    .filter((r) => String(r.customer_id) === String(customerId))
    .sort((a, b) => Number(a.row_index) - Number(b.row_index))
    .map((r) => parseJsonCell(r.data_json, null))
    .filter(Boolean);
}

function readStateFromXlsx(filePath) {
  const wb = XLSX.readFile(filePath);
  const state = emptyState();

  const metaRows = sheetToRows(wb, '_meta');
  for (const row of metaRows) {
    if (row.key === 'formatVersion') state.meta.formatVersion = parseInt(row.value, 10) || FORMAT_VERSION;
    if (row.key === 'exportedAt') state.meta.exportedAt = row.value || null;
    if (row.key === 'lastSavedAt') state.meta.lastSavedAt = row.value || null;
    if (row.key === 'onPremEnabled') state.meta.onPremEnabled = String(row.value).toLowerCase() === 'true';
  }

  const settingsRows = sheetToRows(wb, 'settings');
  for (const row of settingsRows) {
    const val = parseJsonCell(row.value, null);
    if (row.key && val) state.settings[row.key] = val;
  }

  const payRows = sheetToRows(wb, 'customer_payment_history');
  const chargeRows = sheetToRows(wb, 'customer_charge_history');
  const statusRows = sheetToRows(wb, 'customer_status_history');
  const snapRows = sheetToRows(wb, 'customer_bill_pdf_snapshots');
  const monthPayRows = sheetToRows(wb, 'customer_month_payments');

  const customerRows = sheetToRows(wb, 'customers').filter((r) => r.id);
  state.customers = customerRows.map((row) => {
    const c = Object.assign({}, row);
    const cid = c.id;
    c.codes = parseJsonCell(c.codes_json, []);
    c.pastDueComposition = parseJsonCell(c.pastDueComposition_json, undefined);
    c.importData = parseJsonCell(c.importData_json, undefined);
    c.processBillPanelFrozenSnapshot = parseJsonCell(c.processBillPanelFrozenSnapshot_json, undefined);
    delete c.codes_json;
    delete c.pastDueComposition_json;
    delete c.importData_json;
    delete c.processBillPanelFrozenSnapshot_json;
    c.paymentHistory = readChildHistory(payRows, cid);
    c.chargeHistory = readChildHistory(chargeRows, cid);
    c.ledgerStatusHistory = readChildHistory(statusRows, cid);
    c.billPdfSnapshots = readChildHistory(snapRows, cid);
    c.currentMonthPaymentHistory = readChildHistory(monthPayRows, cid);
    return c;
  });

  state.locations = sheetToRows(wb, 'locations').filter((r) => r.id);
  state.codes = sheetToRows(wb, 'codes').filter((r) => r.id);
  state.users = sheetToRows(wb, 'users').filter((r) => r.id);
  if (!state.users.length) state.users = [...DEFAULT_LOGIN_USERS];

  state.drawers = sheetToRows(wb, 'drawers')
    .filter((r) => r.id)
    .map((row) => {
      const d = Object.assign({}, row);
      d.lastCount = parseJsonCell(d.lastCount_json, null);
      d.countHistory = parseJsonCell(d.countHistory_json, []);
      delete d.lastCount_json;
      delete d.countHistory_json;
      return d;
    });

  state.paymentProcessingSessions = sheetToRows(wb, 'pos_sessions')
    .filter((r) => r.id)
    .map((row) => ({
      id: row.id,
      username: row.username,
      userCode: row.userCode,
      startedAt: row.startedAt,
      totalAmount: row.totalAmount,
      drawer: parseJsonCell(row.drawer_json, null),
      register: parseJsonCell(row.register_json, null),
      entries: parseJsonCell(row.entries_json, [])
    }));

  state.billingCycles = sheetToRows(wb, 'billing_cycles')
    .filter((r) => r.id)
    .map((row) => ({
      id: row.id,
      cycleNumber: row.cycleNumber,
      generatedDate: row.generatedDate,
      generatedDateStr: row.generatedDateStr,
      statementDate: row.statementDate,
      cyclePeriod: row.cyclePeriod,
      dueDateStr: row.dueDateStr,
      settings: parseJsonCell(row.settings_json, {}),
      customerSnapshots: parseJsonCell(row.customerSnapshots_json, [])
    }));

  return state;
}

async function exportFromFirebase(firestoreDb) {
  const state = emptyState();
  state.meta.exportedAt = new Date().toISOString();
  state.meta.onPremEnabled = true;

  const collections = ['customers', 'locations', 'codes', 'users', 'drawers', 'paymentProcessingSessions', 'billingCycles'];
  for (const name of collections) {
    const snap = await firestoreDb.collection(name).get();
    state[name === 'paymentProcessingSessions' ? 'paymentProcessingSessions' : name] = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));
  }

  const settingsDocs = ['sewerCharge', 'lateFee', 'pucSurcharge', 'toggles', 'paymentHierarchy', 'deletedCodeNames'];
  for (const docId of settingsDocs) {
    const docSnap = await firestoreDb.collection('settings').doc(docId).get();
    if (docSnap.exists) {
      state.settings[docId] = docSnap.data();
    }
  }

  if (!state.users.length) {
    state.users = [...DEFAULT_LOGIN_USERS];
  } else {
    const names = new Set(state.users.map((u) => (u.fullName || '').toLowerCase()));
    for (const du of DEFAULT_LOGIN_USERS) {
      if (!names.has(du.fullName.toLowerCase())) {
        state.users.push(du);
      }
    }
  }

  if (state.settings.toggles) {
    state.settings.toggles.onPremModeEnabled = true;
  } else {
    state.settings.toggles = { onPremModeEnabled: true };
  }

  return saveStateToDisk(state);
}

function mergeCustomerUpdate(customer) {
  const state = getState();
  const idx = state.customers.findIndex((c) => c && c.id === customer.id);
  if (idx >= 0) state.customers[idx] = customer;
  else state.customers.push(customer);
  return saveStateToDisk(state);
}

function buildClientSnapshot(state) {
  return {
    meta: state.meta,
    settings: state.settings,
    customers: state.customers,
    locations: state.locations,
    codes: state.codes,
    users: state.users,
    drawers: state.drawers,
    paymentProcessingSessions: state.paymentProcessingSessions,
    billingCycles: state.billingCycles
  };
}

function applyClientSnapshot(snapshot) {
  const state = getState();
  const next = normalizeState(Object.assign({}, state, snapshot || {}));
  return saveStateToDisk(next);
}

module.exports = {
  DATA_DIR,
  JSON_PATH,
  XLSX_PATH,
  CONFIG_PATH,
  DEFAULT_LOGIN_USERS,
  emptyState,
  readOnPremConfig,
  writeOnPremConfig,
  loadStateFromDisk,
  getState,
  setState,
  saveStateToDisk,
  writeStateToXlsx,
  readStateFromXlsx,
  exportFromFirebase,
  mergeCustomerUpdate,
  buildClientSnapshot,
  applyClientSnapshot,
  reloadStateFromDisk,
  restoreStateFromBackup
};
