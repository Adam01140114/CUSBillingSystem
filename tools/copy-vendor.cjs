'use strict';

/**
 * Copies browser bundles from node_modules into public/vendor/.
 * Run manually after upgrading jszip or xlsx: npm run copy-vendor
 * (Not run on npm install — public/vendor is committed for deploys.)
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'vendor');

/** @param {string[][]} relCandidates paths relative to project root */
function copyFirstExisting(relCandidates, destName) {
  for (const parts of relCandidates) {
    const src = path.join(root, ...parts);
    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
      fs.mkdirSync(outDir, { recursive: true });
      const dest = path.join(outDir, destName);
      fs.copyFileSync(src, dest);
      console.log('copy-vendor:', path.relative(root, src), '->', path.relative(root, dest));
      return true;
    }
  }
  return false;
}

const jszipCandidates = [
  ['node_modules', 'jszip', 'dist', 'jszip.min.js'],
];

const xlsxCandidates = [
  ['node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'],
  ['node_modules', 'xlsx', 'xlsx.full.min.js'],
];

let ok = true;
if (!copyFirstExisting(jszipCandidates, 'jszip.min.js')) {
  console.error('copy-vendor: could not find jszip browser bundle under node_modules/jszip');
  ok = false;
}
if (!copyFirstExisting(xlsxCandidates, 'xlsx.full.min.js')) {
  console.error('copy-vendor: could not find xlsx browser bundle under node_modules/xlsx');
  ok = false;
}

if (!ok) {
  process.exit(1);
}
