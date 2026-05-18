/**
 * Master Test disk layout (no browser storage):
 *   Test Scripts/Test Script N/
 *     Test_N.master-test.json  — name, customer, stepDefs, foundationText (optional)
 *     testN_results.txt
 *     testN_expected_output.txt
 *     testN_console_logs.txt (optional)
 */
const fs = require('fs');
const path = require('path');

const TEST_SCRIPTS_ROOT = path.join(__dirname, '..', 'Test Scripts');

function folderNameForSlug(slug) {
  const m = /^test(\d+)$/i.exec(String(slug || '').trim());
  if (!m) return null;
  return 'Test Script ' + m[1];
}

function slugFromFolderName(folder) {
  const m = /^Test Script (\d+)$/i.exec(String(folder || '').trim());
  return m ? 'test' + m[1] : null;
}

function getTestDir(slug) {
  const folder = folderNameForSlug(slug);
  if (!folder) return null;
  return path.join(TEST_SCRIPTS_ROOT, folder);
}

function firstExistingFile(dir, names) {
  for (let i = 0; i < names.length; i++) {
    const fp = path.join(dir, names[i]);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

function pathsForSlug(slug) {
  const dir = getTestDir(slug);
  if (!dir) return null;
  const n = String(slug).replace(/^test/i, '');
  const packagePath =
    firstExistingFile(dir, [
      'Test_' + n + '.master-test.json',
      'test' + n + '.master-test.json'
    ]) || path.join(dir, 'Test_' + n + '.master-test.json');
  const resultsPath =
    firstExistingFile(dir, [
      'test' + n + '_results.txt',
      'test_script_results.txt'
    ]) || path.join(dir, 'test' + n + '_results.txt');
  const expectedPath =
    firstExistingFile(dir, [
      'test' + n + '_expected_output.txt',
      'expected_output.txt'
    ]) || path.join(dir, 'test' + n + '_expected_output.txt');
  const consolePath =
    firstExistingFile(dir, [
      'test' + n + '_console_logs.txt',
      'test_script_console_logs.txt'
    ]) || path.join(dir, 'test' + n + '_console_logs.txt');
  return { dir, packagePath, resultsPath, expectedPath, consolePath, n };
}

function readTextFile(fp) {
  if (!fp || !fs.existsSync(fp)) return '';
  try {
    return fs.readFileSync(fp, 'utf8');
  } catch (e) {
    return '';
  }
}

function listTestsOnDisk() {
  if (!fs.existsSync(TEST_SCRIPTS_ROOT)) return [];
  const out = [];
  const entries = fs.readdirSync(TEST_SCRIPTS_ROOT, { withFileTypes: true });
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    if (!ent.isDirectory()) continue;
    const slug = slugFromFolderName(ent.name);
    if (!slug) continue;
    const paths = pathsForSlug(slug);
    if (!paths) continue;
    const hasPackage = fs.existsSync(paths.packagePath);
    const hasResults = fs.existsSync(paths.resultsPath);
    if (!hasPackage && !hasResults) continue;
    let name = 'Test ' + paths.n;
    let customerName = 'Susan Young';
    let customerId = 'CUS-3011000';
    if (hasPackage) {
      try {
        const data = JSON.parse(fs.readFileSync(paths.packagePath, 'utf8'));
        if (data.name) name = String(data.name);
        if (data.customerName) customerName = String(data.customerName);
        if (data.customerId) customerId = String(data.customerId);
      } catch (ePkg) {
        /* ignore */
      }
    }
    out.push({
      slug,
      name,
      customerName,
      customerId,
      folder: ent.name,
      relDir: 'Test Scripts/' + ent.name,
      hasPackage,
      hasResults,
      hasExpected: fs.existsSync(paths.expectedPath)
    });
  }
  out.sort(function (a, b) {
    const an = parseInt(a.slug.replace(/^test/, ''), 10) || 0;
    const bn = parseInt(b.slug.replace(/^test/, ''), 10) || 0;
    return an - bn;
  });
  return out;
}

function loadTestFromDisk(slug) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  let data = {
    format: 'cus-master-test-v1',
    name: 'Test ' + paths.n,
    customerName: 'Susan Young',
    customerId: 'CUS-3011000',
    stepDefs: [],
    foundationText: '',
    resultsText: '',
    expectedText: ''
  };
  if (fs.existsSync(paths.packagePath)) {
    try {
      data = Object.assign(data, JSON.parse(fs.readFileSync(paths.packagePath, 'utf8')));
    } catch (e) {
      throw new Error('Invalid package JSON for ' + slug + ': ' + (e.message || String(e)));
    }
  }
  const diskResults = readTextFile(paths.resultsPath);
  const diskExpected = readTextFile(paths.expectedPath);
  if (diskResults.trim()) data.resultsText = diskResults;
  else if (!data.resultsText) data.resultsText = '';
  if (diskExpected.trim()) data.expectedText = diskExpected;
  else if (!data.expectedText) data.expectedText = '';
  data.resultsText = String(data.resultsText || '').replace(/\n+$/, '');
  data.expectedText = String(data.expectedText || '').replace(/\n+$/, '');
  return {
    slug,
    paths,
    test: {
      slug,
      name: String(data.name || 'Test ' + paths.n).trim() || 'Test ' + paths.n,
      customerName: String(data.customerName || 'Susan Young').trim() || 'Susan Young',
      customerId: String(data.customerId || 'CUS-3011000').trim() || 'CUS-3011000',
      stepDefs: Array.isArray(data.stepDefs) ? data.stepDefs : [],
      foundationText: String(data.foundationText || '').trim(),
      resultsText: data.resultsText,
      expectedText: data.expectedText
    }
  };
}

function savePackageToDisk(slug, test) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  fs.mkdirSync(paths.dir, { recursive: true });
  const pkg = {
    format: 'cus-master-test-v1',
    exportedAt: new Date().toISOString(),
    name: test && test.name ? test.name : 'Test ' + paths.n,
    customerName: test && test.customerName ? test.customerName : 'Susan Young',
    customerId: test && test.customerId ? test.customerId : 'CUS-3011000',
    stepDefs: test && Array.isArray(test.stepDefs) ? test.stepDefs : [],
    foundationText: test && test.foundationText ? test.foundationText : ''
  };
  fs.writeFileSync(paths.packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  return { ok: true, slug, paths };
}

function saveResultsTextToDisk(slug, resultsText) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  fs.mkdirSync(paths.dir, { recursive: true });
  const text = String(resultsText || '').replace(/\n+$/, '');
  const payload = text + (text ? '\n' : '');
  fs.writeFileSync(paths.resultsPath, payload, 'utf8');
  const legacyResults = path.join(paths.dir, 'test_script_results.txt');
  if (legacyResults !== paths.resultsPath) {
    fs.writeFileSync(legacyResults, payload, 'utf8');
  }
  return { ok: true, slug, path: paths.resultsPath };
}

function saveExpectedTextToDisk(slug, expectedText) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  fs.mkdirSync(paths.dir, { recursive: true });
  const text = String(expectedText || '').replace(/\n+$/, '');
  fs.writeFileSync(paths.expectedPath, text + (text ? '\n' : ''), 'utf8');
  return { ok: true, slug, path: paths.expectedPath };
}

function saveTestToDisk(slug, test) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  fs.mkdirSync(paths.dir, { recursive: true });
  if (test && test.resultsText !== undefined) {
    saveResultsTextToDisk(slug, test.resultsText);
  }
  if (test && test.expectedText !== undefined) {
    saveExpectedTextToDisk(slug, test.expectedText);
  }
  savePackageToDisk(slug, test || {});
  return { ok: true, slug, paths };
}

function saveResultsToDisk(slug, resultsText, consoleText) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  fs.mkdirSync(paths.dir, { recursive: true });
  const text = String(resultsText || '').replace(/\n+$/, '');
  fs.writeFileSync(paths.resultsPath, text + (text ? '\n' : ''), 'utf8');
  if (consoleText != null && String(consoleText).length) {
    const c = String(consoleText).replace(/\n+$/, '');
    fs.writeFileSync(paths.consolePath, c + (c ? '\n' : ''), 'utf8');
  }
  return { ok: true, resultsPath: paths.resultsPath };
}

function deleteTestFromDisk(slug) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Unknown test slug: ' + slug);
  const removed = [];
  [paths.packagePath, paths.resultsPath, paths.expectedPath, paths.consolePath].forEach(function (fp) {
    if (fp && fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      removed.push(fp);
    }
  });
  return { ok: true, removed };
}

function allocateNextSlug() {
  const existing = listTestsOnDisk();
  let max = 0;
  existing.forEach(function (t) {
    const n = parseInt(t.slug.replace(/^test/, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return 'test' + (max + 1);
}

function createTestFolder(slug, test) {
  const paths = pathsForSlug(slug);
  if (!paths) throw new Error('Invalid slug: ' + slug);
  if (fs.existsSync(paths.dir)) {
    const hasContent =
      fs.existsSync(paths.packagePath) ||
      fs.existsSync(paths.resultsPath) ||
      fs.existsSync(paths.expectedPath);
    if (hasContent) throw new Error('Test folder already exists: ' + slug);
  }
  fs.mkdirSync(paths.dir, { recursive: true });
  return saveTestToDisk(slug, test);
}

module.exports = {
  TEST_SCRIPTS_ROOT,
  folderNameForSlug,
  slugFromFolderName,
  getTestDir,
  pathsForSlug,
  listTestsOnDisk,
  loadTestFromDisk,
  savePackageToDisk,
  saveResultsTextToDisk,
  saveExpectedTextToDisk,
  saveTestToDisk,
  saveResultsToDisk,
  deleteTestFromDisk,
  allocateNextSlug,
  createTestFolder
};
