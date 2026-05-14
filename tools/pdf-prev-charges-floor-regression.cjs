#!/usr/bin/env node
/**
 * Regression for public/index.html getPdfPreviousChargesReconciledToTotal floorPrev rules
 * (stacked bills: stmt unpaid must not be dropped when ledger pastDue is lower).
 */
function floorPrevOnly(ledgerPd, stmtUn) {
  ledgerPd = Math.max(0, ledgerPd);
  stmtUn = Math.max(0, stmtUn);
  let floorPrev;
  if (ledgerPd < 0.02 && stmtUn > 0.005) {
    floorPrev = Math.round(stmtUn * 100) / 100;
  } else if (ledgerPd > 0.005 && stmtUn > ledgerPd + 0.02) {
    floorPrev = Math.round(Math.max(ledgerPd, stmtUn) * 100) / 100;
  } else if (stmtUn > 0.005 && ledgerPd > stmtUn + 0.02) {
    floorPrev = Math.round(stmtUn * 100) / 100;
  } else {
    floorPrev = Math.round(Math.max(ledgerPd, stmtUn) * 100) / 100;
  }
  return floorPrev;
}

const cases = [
  { l: 183.49, s: 361.98, want: 361.98, note: 'Susan-like: stmt unpaid > rolled ledger pastDue' },
  { l: 0, s: 178.49, want: 178.49, note: 'ledger zero' },
  { l: 178.49, s: 0, want: 178.49, note: 'no stmt remainder' },
  { l: 100, s: 100, want: 100, note: 'equal' },
  { l: 50, s: 200, want: 200, note: 'stmt higher (small ledger)' }
];
let bad = 0;
for (const c of cases) {
  const got = floorPrevOnly(c.l, c.s);
  if (Math.abs(got - c.want) > 0.02) {
    console.error('FAIL', c.note, { ledgerPd: c.l, stmtUn: c.s, want: c.want, got });
    bad++;
  }
}
if (bad) process.exit(1);
console.log('pdf-prev-charges floor regression: ok (' + cases.length + ' cases)');
