#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
function resolveTestFile(names) {
  const list = Array.isArray(names) ? names : [names];
  const dirs = [
    path.join(repoRoot, 'Test Scripts', 'Test Script 1'),
    path.join(repoRoot, 'Master Test')
  ];
  for (const dir of dirs) {
    for (const name of list) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return path.join(dirs[0], list[0]);
}

const expArg = process.argv[2];
const actArg = process.argv[3];
const expPath = expArg
  ? path.resolve(process.cwd(), expArg)
  : resolveTestFile(['test1_expected_output.txt', 'expected_output.txt']);
const actPath = actArg
  ? path.resolve(process.cwd(), actArg)
  : resolveTestFile(['test1_results.txt', 'test_script_results.txt']);

function normMoney(s) {
  const t = String(s ?? '').trim();
  if (!t || t === 'N/A' || t === '(none)' || t === '(unavailable)') return null;
  const n = parseFloat(t.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function isDashSeparatorLine(line) {
  return /^-{3,}$/.test(String(line ?? '').trim());
}

function linesEquivalent(el, al) {
  if (el === al) return true;
  const et = String(el ?? '').trim();
  const at = String(al ?? '').trim();
  if (et === at) return true;
  if (isDashSeparatorLine(et) && isDashSeparatorLine(at)) return true;
  const en = normMoney(et);
  const an = normMoney(at);
  if (en !== null || an !== null) {
    if (en === null && an === null) return true;
    if (en !== null && an !== null && Math.abs(en - an) < 0.011) return true;
    if ((en === 0 || en === null) && (an === 0 || an === null)) return true;
    return false;
  }
  if ((et === 'N/A' || et === '') && (at === '0' || at === '$0' || at === '')) return true;
  if ((at === 'N/A' || at === '') && (et === '0' || et === '$0' || et === '')) return true;
  return false;
}

function splitSteps(text) {
  const parts = text.split(/(?=^Step \d+:\s*$)/m);
  const map = new Map();
  for (const p of parts) {
    const m = p.match(/^Step (\d+):/m);
    if (m) map.set(Number(m[1]), p);
  }
  return map;
}

function lines(text) {
  return text.split(/\r?\n/);
}

const exp = fs.readFileSync(expPath, 'utf8');
const act = fs.readFileSync(actPath, 'utf8');
const expSteps = splitSteps(exp);
const actSteps = splitSteps(act);

let totalMism = 0;
const report = [];

for (let step = 1; step <= 9; step++) {
  const eLines = lines(expSteps.get(step) || '');
  const aLines = lines(actSteps.get(step) || '');
  const mism = [];
  const eFiltered = eLines.filter((l) => !isDashSeparatorLine(l));
  const aFiltered = aLines.filter((l) => !isDashSeparatorLine(l));
  const maxFiltered = Math.max(eFiltered.length, aFiltered.length);
  for (let i = 0; i < maxFiltered; i++) {
    const el = eFiltered[i] ?? '';
    const al = aFiltered[i] ?? '';
    if (linesEquivalent(el, al)) continue;
    const en = normMoney(el);
    const an = normMoney(al);
    if (en !== null || an !== null) {
      mism.push({ line: i + 1, expected: el, actual: al, en, an });
    } else {
      mism.push({ line: i + 1, expected: el, actual: al, text: true });
    }
  }
  if (mism.length) {
    totalMism += mism.length;
    report.push({ step, count: mism.length, samples: mism.slice(0, 8) });
  }
}

console.log(JSON.stringify({ totalMismatches: totalMism, steps: report }, null, 2));
process.exit(totalMism > 0 ? 1 : 0);
