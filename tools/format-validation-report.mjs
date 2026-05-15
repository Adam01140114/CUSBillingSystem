#!/usr/bin/env node
/**
 * Build a readable markdown report from a develop billing scenario export
 * (OUTPUT_PATH file containing "=== Validation snapshots ===" JSON + final ledger TSV).
 *
 * Usage:
 *   node tools/format-validation-report.mjs <source.txt> [output.md]
 *   VALIDATION_SOURCE=./test_output/foo.txt VALIDATION_REPORT=./test_output/report.md node tools/format-validation-report.mjs
 *
 * Default output: same directory as source, named validation_report.md
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fmt(v) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  const s = String(v).trim();
  return s || '—';
}

function tsvToMarkdownTable(tsv) {
  const raw = String(tsv || '').trim();
  if (!raw) return '*(no ledger TSV)*';
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return '*(empty)*';
  const esc = (c) => String(c ?? '').replace(/\|/g, '\\|');
  const rows = lines.map((l) => l.split('\t'));
  const n = rows[0].length;
  const sep = '|' + Array(n).fill('---').join('|') + '|';
  const mdRows = rows.map((cells) => '| ' + cells.map((c) => esc(c)).join(' | ') + ' |');
  return [mdRows[0], sep, ...mdRows.slice(1)].join('\n');
}

function frozenComposite(fz) {
  if (!fz || typeof fz !== 'object') return '—';
  const parts = [fz.amountDue, fz.pastDue, fz.lateFee, fz.dueDateStr, fz.statusLabel].map((x) =>
    x === undefined || x === null ? '' : String(x)
  );
  const s = parts.filter(Boolean).join(' / ');
  return s || '—';
}

function formatAmountBreakdownTable(ab) {
  if (!ab || typeof ab !== 'object') return '*(no amount breakdown)*\n';
  const panel = ab.processBillPanel && !ab.processBillPanel.error ? ab.processBillPanel : {};
  const ro = ab.calculateCustomerTotalReadOnly && !ab.calculateCustomerTotalReadOnly.error ? ab.calculateCustomerTotalReadOnly : {};
  const fz = ab.frozenPanelSnapshot;
  const lines = [
    '| Field | Panel | RO | Frozen |',
    '|---|---:|---:|---|',
    `| Total | ${fmt(panel.total)} | ${fmt(ro.total)} | ${frozenComposite(fz)} |`,
    `| Past due | ${fmt(panel.pastDue)} | ${fmt(ro.pastDue)} | — |`,
    `| Late fee | ${fmt(panel.lateFee)} | ${fmt(ro.lateFeeAmount != null ? ro.lateFeeAmount : ro.lateFee)} | — |`,
    `| dueDateStr (panel) | ${fmt(panel.dueDateStr)} | — | — |`,
    `| fromFrozen | ${fmt(panel.fromFrozen)} | — | — |`
  ];
  if (ab.lastBillPdfPastDueLine !== undefined || ab.lastBillPdfLateFeeLine !== undefined) {
    lines.push(
      `| lastBillPdfPastDueLine | — | — | ${fmt(ab.lastBillPdfPastDueLine)} |`,
      `| lastBillPdfLateFeeLine | — | — | ${fmt(ab.lastBillPdfLateFeeLine)} |`
    );
  }
  return lines.join('\n') + '\n';
}

function parseExport(text) {
  const snapMarker = '=== Validation snapshots (Amount Breakdown + PDF + full ledger TSV at each step) ===';
  const finalBreakMarker = '=== Final amount breakdown only (JSON) ===';
  const ledgerMarker = '=== All Previous Payments / Charges (TSV — tabs between columns, one row per line) ===';
  const ledgerHtmlMarker = '=== Ledger table (HTML';

  const i0 = text.indexOf(snapMarker);
  if (i0 === -1) throw new Error('Export missing validation snapshots marker: ' + snapMarker);
  const jsonStart = i0 + snapMarker.length;
  const i1 = text.indexOf(finalBreakMarker, jsonStart);
  if (i1 === -1) throw new Error('Export missing final breakdown marker');
  const jsonStr = text.slice(jsonStart, i1).trim();
  const steps = JSON.parse(jsonStr);

  let finalTsv = '';
  const l0 = text.indexOf(ledgerMarker);
  if (l0 !== -1) {
    const tStart = l0 + ledgerMarker.length;
    let tEnd = text.indexOf('\n\n===', tStart);
    if (tEnd === -1) tEnd = text.indexOf(ledgerHtmlMarker, tStart);
    if (tEnd === -1) tEnd = text.length;
    finalTsv = text.slice(tStart, tEnd).trim();
  }

  let customerLine = '';
  const m = text.match(/Customer:\s*([^\n]+)/);
  if (m) customerLine = m[1].trim();

  return { steps, finalTsv, customerLine };
}

function fieldsToMarkdownTable(fields) {
  if (!fields || typeof fields !== 'object') return '';
  const keys = Object.keys(fields).sort();
  const rows = keys.map((k) => `| ${k} | ${String(fields[k] ?? '').replace(/\|/g, '\\|')} |`);
  return ['| PDF field | Value |', '|---|---|', ...rows].join('\n');
}

function buildMarkdown({ sourceRel, steps, finalTsv, customerLine }) {
  const parts = [];
  parts.push(`**Source file:** \`${sourceRel}\``);
  if (customerLine) parts.push(`**Customer:** ${customerLine}`);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## 1 — Full Payments / Charges table (end of run)');
  parts.push('');
  parts.push(tsvToMarkdownTable(finalTsv));
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('## 2 — Each amount breakdown snapshot + Payments/Charges table **at that same step**');
  parts.push('');

  for (const s of steps) {
    if (s.error) {
      parts.push(`### \`${s.step || '?'}\` — **error:** ${s.error}`);
      parts.push('');
      continue;
    }
    parts.push(`### \`${s.step}\` · simulated **${s.simulatedDate || '—'}**`);
    parts.push('');
    parts.push(formatAmountBreakdownTable(s.amountBreakdown));
    parts.push('**`ledgerPaymentsChargesTsv` (full table for this step)**');
    parts.push('');
    parts.push(tsvToMarkdownTable(s.ledgerPaymentsChargesTsv));
    if (s.ledgerAnchorNetVsPanelTotal && typeof s.ledgerAnchorNetVsPanelTotal === 'object') {
      parts.push('');
      parts.push(
        '**Ledger vs panel:** `' + JSON.stringify(s.ledgerAnchorNetVsPanelTotal).replace(/`/g, "'") + '`'
      );
    }
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('## 3 — PDF bill entries (full `fields` when present)');
  parts.push('');
  parts.push(
    'Each subsection is a Produce Bill snapshot that still has full `pdfBillArchive.fields` in the export. The **amount breakdown** and **ledger table** are taken from the **same** validation step object (`after_bill_…`).'
  );
  parts.push('');

  let pdfNum = 0;
  for (const s of steps) {
    const st = String(s.step || '');
    if (!st.startsWith('after_bill_')) continue;
    const arc = s.pdfBillArchive;
    if (!arc) continue;
    if (arc.omittedBecauseArchivedPdfDoesNotMatchPanel) {
      parts.push('### PDF bills with **omitted** full fields (archive total ≠ panel at step)');
      parts.push('');
      parts.push(
        `- **\`${s.step}\`** · ${s.simulatedDate || '—'} — panel **${arc.processBillPanelTotalAtStep}** vs archived **\`${arc.archivedPdfTotalAmount}\`**`
      );
      parts.push('');
      continue;
    }
    if (!arc.fields) continue;
    pdfNum += 1;
    const f = arc.fields;
    const printDate = f.print_date || '—';
    const totalAmt = f.total_amount || '—';
    parts.push(`### PDF bill **#${pdfNum}** — \`print_date\` **${printDate}** · \`total_amount\` **${totalAmt}**`);
    parts.push('');
    parts.push('| Summary | Value |');
    parts.push('|---|---|');
    parts.push(`| print_date | ${fmt(f.print_date)} |`);
    parts.push(`| total_amount | ${fmt(f.total_amount)} |`);
    parts.push(`| current_due | ${fmt(f.current_due)} |`);
    parts.push(`| previous_charges | ${fmt(f.previous_charges)} |`);
    parts.push(`| late_fee | ${fmt(f.late_fee)} |`);
    parts.push('');
    parts.push('**Full PDF `fields`:**');
    parts.push('');
    parts.push(fieldsToMarkdownTable(f));
    parts.push('');
    parts.push(`**Amount breakdown (\`${s.step}\` · ${s.simulatedDate || '—'}):**`);
    parts.push('');
    parts.push(formatAmountBreakdownTable(s.amountBreakdown));
    parts.push('**Payments / Charges at this step:**');
    parts.push('');
    parts.push(tsvToMarkdownTable(s.ledgerPaymentsChargesTsv));
    parts.push('');
  }

  return parts.join('\n') + '\n';
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  const defaultSrc = path.join(repoRoot, 'test_output', 'test_script2_credit_susan_ledger_per_step.txt');
  const defaultOut = path.join(repoRoot, 'test_output', 'validation_report_susan_credit.md');

  const srcArg = process.argv[2] || process.env.VALIDATION_SOURCE || defaultSrc;
  const outArg = process.argv[3] || process.env.VALIDATION_REPORT || defaultOut;
  const srcAbs = path.isAbsolute(srcArg) ? srcArg : path.resolve(process.cwd(), srcArg);
  if (!fs.existsSync(srcAbs)) {
    console.error('File not found:', srcAbs);
    process.exit(1);
  }
  const text = fs.readFileSync(srcAbs, 'utf8');
  const { steps, finalTsv, customerLine } = parseExport(text);
  const sourceRel = path.relative(path.join(__dirname, '..'), srcAbs) || srcAbs;
  const md = buildMarkdown({ sourceRel, steps, finalTsv, customerLine });
  const outAbs = outArg
    ? path.isAbsolute(outArg)
      ? outArg
      : path.resolve(process.cwd(), outArg)
    : path.join(path.dirname(srcAbs), 'validation_report.md');
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, md, 'utf8');
  console.error('Wrote', outAbs, `(${steps.length} steps)`);
}

main();
