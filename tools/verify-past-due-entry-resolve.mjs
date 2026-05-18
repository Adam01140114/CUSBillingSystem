#!/usr/bin/env node
/**
 * Verifies Past Due Details resolve to the correct ledger row (e.g. 02/01 Billed Customer).
 * Run: node tools/verify-past-due-entry-resolve.mjs [path-to-job.json]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function normalizeFingerprintText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeLedgerDateForFingerprint(raw) {
  let s = normalizeFingerprintText(raw);
  if (!s) return '';
  s = s.replace(/\ba\.?\s*m\.?\b/g, 'am').replace(/\bp\.?\s*m\.?\b/g, 'pm');
  const m = s.match(/^(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?/);
  if (!m) return s;
  const date = m[1];
  if (!m[2]) return date;
  let hh = parseInt(m[2], 10);
  const mm = m[3];
  const ap = m[4];
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  return date + ' ' + String(hh).padStart(2, '0') + ':' + mm + ' am';
}

function pastDueLabelToFingerprint(label) {
  const t = String(label || '').trim();
  if (!t) return '';
  if (t.indexOf('·') >= 0) {
    const parts = t.split('·').map((s) => s.trim());
    if (parts.length >= 3) {
      return (
        normalizeLedgerDateForFingerprint(parts[0]) +
        '\u0001' +
        normalizeFingerprintText(parts[1]) +
        '\u0001' +
        normalizeFingerprintText(parts[2])
      );
    }
    return parts.map(normalizeFingerprintText).join('\u0001');
  }
  return normalizeFingerprintText(t);
}

function parseVerticalLedger(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n').map((l) => String(l).trim());
  let startData = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(lines[i])) {
      startData = i;
      break;
    }
  }
  if (startData <= 0) return { headers: [], rows: [] };
  const headers = lines.slice(0, startData).filter((l) => l !== '' && l !== ':');
  const n = headers.length;
  const dataLines = lines.slice(startData);
  const rows = [];
  let current = [];
  const isSep = (line) => /^-{3,}$/.test(line) || (line.length > 0 && /^\s+$/.test(line));
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    if (isSep(line)) {
      if (current.length) {
        while (current.length < n) current.push('');
        rows.push(current.slice(0, n));
        current = [];
      }
      rows.push(Array(n).fill(' '));
      continue;
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(line) && current.length) {
      while (current.length < n) current.push('');
      rows.push(current.slice(0, n));
      current = [line];
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) current = [line];
    else current.push(line);
  }
  if (current.length) {
    while (current.length < n) current.push('');
    rows.push(current.slice(0, n));
  }
  return { headers, rows };
}

function parsePastDueDetailsVertical(raw) {
  const t = String(raw || '').trim();
  if (!t) return [];
  const chunks = t.split(/\n\n+/);
  const out = [];
  for (const chunk of chunks) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '');
    if (!lines.length) continue;
    const rowM = /^\[ROW (\d+)\]$/i.exec(lines[0]);
    const rowIndex = rowM ? parseInt(rowM[1], 10) : out.length;
    const keyStart = lines.findIndex((l) => l === 'Past due amount');
    if (keyStart < 0) continue;
    const labelStart = rowM ? 1 : 0;
    const label = lines.slice(labelStart, keyStart).join(' ').trim();
    const totalIdx = lines.findIndex(
      (l, i) => i > keyStart && (l === 'Total (Past Due line)' || l === 'Total Due')
    );
    if (totalIdx < 0) continue;
    const keys = lines.slice(keyStart, totalIdx + 1);
    const vals = lines.slice(totalIdx + 1, totalIdx + 1 + keys.length);
    const pairs = keys.map((k, i) => ({ key: k, val: vals[i] != null ? vals[i] : '$0' }));
    out.push({ rowIndex, label, pairs });
  }
  return out;
}

function isLedgerSeparatorRow(row) {
  if (!row || !row.length) return false;
  return row.every((cell) => {
    const raw = String(cell ?? '');
    const t = raw.trim();
    return t === '' || /^-{3,}$/.test(t) || (raw.length > 0 && /^\s+$/.test(raw));
  });
}

function isLedgerCurrentStatusRow(row, headers) {
  const subCol = headers.findIndex((h) => /^subtype$/i.test(h));
  if (subCol >= 0 && /^current\s*status$/i.test(String(row[subCol] || '').trim())) return true;
  return false;
}

function findLastCurrentStatusRowIndex(headers, rows) {
  let lastIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (isLedgerCurrentStatusRow(rows[i], headers)) lastIdx = i;
  }
  return lastIdx;
}

function makeLedgerSeparatorRow(colCount) {
  return Array(colCount).fill(' ');
}

function ensureLedgerStatusSeparatorRows(headers, rows) {
  const lastCurrentIdx = findLastCurrentStatusRowIndex(headers, rows);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    out.push(rows[i]);
    if (i === lastCurrentIdx) continue;
    if (isLedgerCurrentStatusRow(rows[i], headers)) {
      const next = rows[i + 1];
      if (!next || !isLedgerSeparatorRow(next)) {
        out.push(makeLedgerSeparatorRow(headers.length));
      }
    }
  }
  return out;
}

function displayRowToStoredRowIndex(displayRows, displayRi) {
  let storedIdx = -1;
  for (let i = 0; i <= displayRi; i++) {
    if (!isLedgerSeparatorRow(displayRows[i])) storedIdx++;
  }
  return storedIdx;
}

function getLedgerRowMatchOrdinalInDisplay(displayRows, headers, displayRi) {
  if (!displayRows || displayRi < 0 || isLedgerSeparatorRow(displayRows[displayRi])) return 0;
  const fp = ledgerRowFingerprint(displayRows[displayRi], headers);
  let ordinal = 0;
  for (let i = 0; i < displayRi; i++) {
    if (isLedgerSeparatorRow(displayRows[i])) continue;
    if (ledgerRowFingerprint(displayRows[i], headers) === fp) ordinal++;
  }
  return ordinal;
}

function findStoredLedgerRowIndexForDisplayRow(storedRows, storedHeaders, displayRows, headers, displayRi, row) {
  if (!row || displayRi < 0 || isLedgerSeparatorRow(row)) return -1;
  const fp = ledgerRowFingerprint(row, headers);
  if (!fp) return displayRowToStoredRowIndex(displayRows, displayRi);
  const storedMatches = [];
  for (let i = 0; i < storedRows.length; i++) {
    if (isLedgerSeparatorRow(storedRows[i])) continue;
    if (ledgerRowFingerprint(storedRows[i], storedHeaders) === fp) storedMatches.push(i);
  }
  if (!storedMatches.length) return displayRowToStoredRowIndex(displayRows, displayRi);
  if (storedMatches.length === 1) return storedMatches[0];
  const ord = getLedgerRowMatchOrdinalInDisplay(displayRows, headers, displayRi);
  if (storedMatches[ord] != null) return storedMatches[ord];
  return storedMatches[0];
}

function findCol(headers, pattern) {
  return headers.findIndex((h) => pattern.test(String(h || '').trim()));
}

function ledgerRowFingerprint(row, headers) {
  const dateCol = findCol(headers, /^date\s*&\s*time$/i) >= 0 ? findCol(headers, /^date\s*&\s*time$/i) : findCol(headers, /^date$/i);
  const typeCol = findCol(headers, /^type$/i);
  const subCol = findCol(headers, /^subtype$/i);
  const parts = [];
  if (dateCol >= 0) parts.push(normalizeLedgerDateForFingerprint(row[dateCol]));
  if (typeCol >= 0) parts.push(normalizeFingerprintText(row[typeCol]));
  if (subCol >= 0) parts.push(normalizeFingerprintText(row[subCol]));
  return parts.join('\u0001');
}

function buildPastDueLabelForLedgerRow(row, headers) {
  const dateCol = findCol(headers, /^date\s*&\s*time$/i) >= 0 ? findCol(headers, /^date\s*&\s*time$/i) : findCol(headers, /^date$/i);
  const typeCol = findCol(headers, /^type$/i);
  const subCol = findCol(headers, /^subtype$/i);
  const parts = [];
  if (dateCol >= 0) parts.push(String(row[dateCol] || '').trim());
  if (typeCol >= 0) parts.push(String(row[typeCol] || '').trim());
  if (subCol >= 0) parts.push(String(row[subCol] || '').trim());
  return parts.filter(Boolean).join(' · ');
}

function getPastDueEntryMatchOrdinal(entry, allPastDue) {
  const fp = pastDueLabelToFingerprint(entry.label);
  let ord = 0;
  for (let i = 0; i < allPastDue.length; i++) {
    if (allPastDue[i] === entry) return ord;
    if (pastDueLabelToFingerprint(allPastDue[i].label) === fp) ord++;
  }
  return 0;
}

function relinkPastDueEntriesToLedger(headers, rows, pastDue) {
  const fpToLedgerRows = new Map();
  for (let i = 0; i < rows.length; i++) {
    if (isLedgerSeparatorRow(rows[i])) continue;
    const fp = ledgerRowFingerprint(rows[i], headers);
    if (!fp) continue;
    if (!fpToLedgerRows.has(fp)) fpToLedgerRows.set(fp, []);
    fpToLedgerRows.get(fp).push(i);
  }
  pastDue.forEach((e) => {
    e.rowIndex = -1;
  });
  pastDue.forEach((entry) => {
    const fp = pastDueLabelToFingerprint(entry.label);
    if (!fp) return;
    const ledgerMatches = fpToLedgerRows.get(fp) || [];
    const ord = getPastDueEntryMatchOrdinal(entry, pastDue);
    let ri = -1;
    if (ledgerMatches[ord] != null) ri = ledgerMatches[ord];
    else if (ledgerMatches.length === 1) ri = ledgerMatches[0];
    if (ri >= 0) entry.rowIndex = ri;
  });
}

function findAllLedgerRowIndicesByFingerprint(rows, headers, fingerprint) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (isLedgerSeparatorRow(rows[i])) continue;
    if (ledgerRowFingerprint(rows[i], headers) === fingerprint) out.push(i);
  }
  return out;
}

function getLedgerRowMatchOrdinal(rows, headers, rowIndex) {
  const fp = ledgerRowFingerprint(rows[rowIndex], headers);
  let ordinal = 0;
  for (let i = 0; i < rowIndex; i++) {
    if (isLedgerSeparatorRow(rows[i])) continue;
    if (ledgerRowFingerprint(rows[i], headers) === fp) ordinal++;
  }
  return ordinal;
}

function getPastDueEntryForFingerprint(pastDue, rows, headers, fingerprint, ordinal) {
  const matches = pastDue.filter((e) => pastDueLabelToFingerprint(e.label) === fingerprint);
  if (!matches.length) return null;
  const ord = ordinal == null || isNaN(ordinal) ? 0 : ordinal;
  const entry = matches[ord] != null ? matches[ord] : null;
  if (!entry) return null;
  const ledgerMatches = findAllLedgerRowIndicesByFingerprint(rows, headers, fingerprint);
  if (ledgerMatches[ord] != null) entry.rowIndex = ledgerMatches[ord];
  return entry;
}

function getPastDueEntryForRow(pastDue, rowIndex) {
  return pastDue.find((e) => e.rowIndex === rowIndex) || null;
}

function resolvePastDueEntryForLedgerRow(pastDue, rows, headers, rowIndex) {
  if (!rows[rowIndex]) return null;
  const ledgerFp = ledgerRowFingerprint(rows[rowIndex], headers);
  const label = buildPastDueLabelForLedgerRow(rows[rowIndex], headers);
  if (label) {
    const byLabel = pastDue.find((e) => String(e.label || '').trim() === label);
    if (byLabel) {
      byLabel.rowIndex = rowIndex;
      return byLabel;
    }
  }
  if (ledgerFp) {
    const ordinal = getLedgerRowMatchOrdinal(rows, headers, rowIndex);
    const byFp = getPastDueEntryForFingerprint(pastDue, rows, headers, ledgerFp, ordinal);
    if (byFp) {
      byFp.rowIndex = rowIndex;
      return byFp;
    }
  }
  const direct = getPastDueEntryForRow(pastDue, rowIndex);
  if (direct && ledgerFp && pastDueLabelToFingerprint(direct.label) === ledgerFp) {
    return direct;
  }
  return null;
}

function parseStepBlock(block) {
  const pi = block.indexOf('Payments/Charges Table Shows:');
  const ai = block.indexOf('Amount Breakdown Shows:');
  const pdi = block.indexOf('View Past Due Details Shows:');
  const ledgerRaw = block.slice(pi + 'Payments/Charges Table Shows:'.length, ai).trim();
  const pastDueRaw = block.slice(pdi + 'View Past Due Details Shows:'.length).trim();
  return { ledgerRaw, pastDueRaw };
}

function totalFromEntry(entry) {
  const p = entry.pairs.find((x) => x.key === 'Total (Past Due line)');
  return p ? p.val : '?';
}

const jobsDir = path.join(root, 'Test Scripts', '.master-test-jobs');
const jobPath =
  process.argv[2] ||
  fs.readdirSync(jobsDir).map((f) => path.join(jobsDir, f)).sort().pop();
const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
const text = job.resultsText || '';

let failures = 0;

for (let step = 1; step <= 7; step++) {
  const re = new RegExp('Step ' + step + ':[\\s\\S]*?(?=\\n\\n\\nStep ' + (step + 1) + ':|$)');
  const block = (text.match(re) || [])[0];
  if (!block) continue;
  const { ledgerRaw, pastDueRaw } = parseStepBlock(block);
  const { headers, rows: storedRows } = parseVerticalLedger(ledgerRaw);
  const pastDue = parsePastDueDetailsVertical(pastDueRaw);
  relinkPastDueEntriesToLedger(headers, storedRows, pastDue);

  const displayRows = ensureLedgerStatusSeparatorRows(headers, storedRows);
  const subCol = findCol(headers, /^subtype$/i);
  const typeCol = findCol(headers, /^type$/i);

  for (let displayRi = 0; displayRi < displayRows.length; displayRi++) {
    const row = displayRows[displayRi];
    if (isLedgerSeparatorRow(row)) continue;
    if (!/02\/01\/2026/.test(String(row[0] || ''))) continue;
    if (!/billed\s*customer/i.test(String(row[subCol] || ''))) continue;

    const storedRi = findStoredLedgerRowIndexForDisplayRow(
      storedRows,
      headers,
      displayRows,
      headers,
      displayRi,
      row
    );
    const oldStoredRi = displayRowToStoredRowIndex(displayRows, displayRi);
    const entry = resolvePastDueEntryForLedgerRow(pastDue, storedRows, headers, storedRi);
    if (oldStoredRi !== storedRi) {
      console.log(
        '  (fixed index mapping displayRi',
        displayRi,
        'old',
        oldStoredRi,
        '->',
        storedRi + ')'
      );
    }
    const label = buildPastDueLabelForLedgerRow(row, headers);

    const ok =
      entry &&
      /billed\s*customer/i.test(entry.label) &&
      !/late\s*fee/i.test(entry.label);
    if (!ok) {
      failures++;
      console.error('FAIL Step', step, {
        displayRi,
        storedRi,
        ledgerLabel: label,
        resolvedLabel: entry ? entry.label : null,
        resolvedTotal: entry ? totalFromEntry(entry) : null
      });
    } else {
      console.log('OK Step', step, 'displayRi', displayRi, 'storedRi', storedRi, 'total', totalFromEntry(entry));
    }
  }
}

// Regression: old displayRowToStoredRowIndex mapped display 42 -> stored 6 (wrong modal).
for (let step = 2; step <= 7; step++) {
  const re = new RegExp('Step ' + step + ':[\\s\\S]*?(?=\\n\\n\\nStep ' + (step + 1) + ':|$)');
  const block = (text.match(re) || [])[0];
  if (!block) continue;
  const { ledgerRaw, pastDueRaw } = parseStepBlock(block);
  const { headers, rows: storedRows } = parseVerticalLedger(ledgerRaw);
  const pastDue = parsePastDueDetailsVertical(pastDueRaw);
  relinkPastDueEntriesToLedger(headers, storedRows, pastDue);
  const displayRows = ensureLedgerStatusSeparatorRows(headers, storedRows);
  for (let displayRi = 0; displayRi < displayRows.length; displayRi++) {
    const row = displayRows[displayRi];
    if (isLedgerSeparatorRow(row)) continue;
    if (!/01\/22\/2026/.test(String(row[0] || ''))) continue;
    if (!/late\s*fee/i.test(String(row[headers.findIndex((h) => /^subtype$/i.test(h))] || ''))) continue;
    const storedRi = findStoredLedgerRowIndexForDisplayRow(
      storedRows,
      headers,
      displayRows,
      headers,
      displayRi,
      row
    );
    const entry = resolvePastDueEntryForLedgerRow(pastDue, storedRows, headers, storedRi);
    if (!entry || !/late\s*fee/i.test(entry.label)) {
      failures++;
      console.error('FAIL late fee Step', step, { displayRi, storedRi, resolved: entry?.label });
    }
  }
}

if (failures > 0) {
  console.error('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nAll Past Due resolve checks passed (02/01 Billed Customer + 01/22 Late Fee).');
