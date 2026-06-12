/** Shared Playwright init payload for on-prem master tests. */
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

function buildOnPremInjectPayload(opts) {
  opts = opts || {};
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
    loginUser: {
      fullName: 'Adam',
      userCode: 'alco0114',
      title: 'Admin',
      role: 'admin',
      email: 'adam@alcowater.com'
    },
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
    customer: opts.includeSusan ? buildSusanTemplate() : null
  };
}

function applyOnPremInitScript(page, payload) {
  return page.addInitScript((p) => {
    window.__ON_PREM_MODE = true;
    window.__ON_PREM_MASTER_TEST = true;
    window.__ON_PREM_SKIP_DISK_PERSIST = true;
    window.__MASTER_TEST_SKIP_POS_UI = true;
    window.__MASTER_TEST_SKIP_PDF_BILL = true;
    window.__MASTER_TEST_FAST_DATE = true;
    const u = p.loginUser;
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
    if (p.toggles) window.__MASTER_TEST_OFFLINE_TOGGLES = p.toggles;
    if (p.billingGlobals) window.__MASTER_TEST_OFFLINE_BILLING_GLOBALS = p.billingGlobals;
    if (p.drawer) window.__MASTER_TEST_OFFLINE_DRAWER = p.drawer;
    if (p.customer) window.__MASTER_TEST_PENDING_CUSTOMER = p.customer;
  }, payload);
}

module.exports = {
  buildOnPremInjectPayload,
  applyOnPremInitScript,
  buildSusanTemplate
};
