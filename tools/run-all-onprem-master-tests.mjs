#!/usr/bin/env node
/**
 * Run every master test against local MySQL (on-prem mode) and compare to expected output.
 *
 *   npm start
 *   node tools/run-all-onprem-master-tests.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadBillingTestCredentials } = require('./load-billing-test-credentials.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const testScriptsRoot = path.join(repoRoot, 'Test Scripts');
const runner = path.join(repoRoot, 'tools', 'run-dynamic-master-test.mjs');
const jobsDir = path.join(testScriptsRoot, '.master-test-jobs');

function listTests() {
  if (!fs.existsSync(testScriptsRoot)) return [];
  return fs
    .readdirSync(testScriptsRoot, { withFileTypes: true })
    .filter(function (ent) {
      return ent.isDirectory() && /^Test Script \d+$/i.test(ent.name);
    })
    .map(function (ent) {
      const n = ent.name.match(/(\d+)/)[1];
      return {
        slug: 'test' + n,
        n: n,
        dir: path.join(testScriptsRoot, ent.name)
      };
    })
    .sort(function (a, b) {
      return parseInt(a.n, 10) - parseInt(b.n, 10);
    });
}

function resolveExpectedPath(testDir, n) {
  const cloud = path.join(testDir, 'test' + n + '_expected_output.txt');
  if (fs.existsSync(cloud)) return cloud;
  return null;
}

function resolveResultsPath(testDir, n) {
  const onprem = path.join(testDir, 'test' + n + '_onprem_results.txt');
  const legacy = path.join(testDir, 'test_script_results.txt');
  if (fs.existsSync(onprem)) return onprem;
  if (fs.existsSync(legacy)) return legacy;
  return onprem;
}

async function main() {
  const creds = loadBillingTestCredentials();
  if (!creds.ok) {
    console.error('[onprem-all] ' + creds.error);
    process.exit(1);
  }

  const tests = listTests();
  if (!tests.length) {
    console.error('[onprem-all] No Test Script N folders found.');
    process.exit(1);
  }

  let failed = 0;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const pkgPath = path.join(t.dir, 'Test_' + t.n + '.master-test.json');
    if (!fs.existsSync(pkgPath)) {
      console.error('[onprem-all] Skip ' + t.slug + ' — missing ' + pkgPath);
      continue;
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const expectedPath = resolveExpectedPath(t.dir, t.n);
    if (!expectedPath) {
      console.error('[onprem-all] Skip ' + t.slug + ' — no expected output file.');
      failed++;
      continue;
    }

    const jobFile = path.join(jobsDir, 'cli-onprem-' + t.slug + '.json');
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(jobFile, JSON.stringify({ status: 'pending' }), 'utf8');

    const config = {
      testSlug: t.slug,
      onprem: true,
      accountNumber: pkg.customerId || 'CUS-3011000',
      customerName: pkg.customerName || 'Susan Young',
      customerMode: pkg.customerMode || 'existing',
      customerFirstName: pkg.customerFirstName || '',
      customerLastName: pkg.customerLastName || '',
      customerCreatedDate: pkg.customerCreatedDate || '',
      advanceMode: 'instant',
      steps: Array.isArray(pkg.stepDefs) ? pkg.stepDefs : []
    };

    if (!config.steps.length) {
      console.error('[onprem-all] Skip ' + t.slug + ' — no steps in package.');
      failed++;
      continue;
    }

    console.error(
      '\n[onprem-all] Running ' +
        t.slug +
        ' (' +
        config.steps.length +
        ' steps, ' +
        config.accountNumber +
        ')…'
    );

    const result = spawnSync(process.execPath, [runner], {
      cwd: repoRoot,
      env: Object.assign({}, process.env, {
        MASTER_TEST_JOB_FILE: jobFile,
        MASTER_TEST_CONFIG: JSON.stringify(config),
        FIREBASE_TEST_EMAIL: creds.email,
        FIREBASE_TEST_PASSWORD: creds.password,
        BASE_URL: creds.baseUrl || 'http://127.0.0.1:8000',
        MASTER_TEST_TIMEOUT_MS: '900000'
      }),
      stdio: 'inherit'
    });

    if (result.status !== 0) {
      console.error('[onprem-all] FAIL ' + t.slug + ': runner exited with code ' + result.status);
      failed++;
      continue;
    }

    let job = {};
    try {
      job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
    } catch (eJob) {
      job = {};
    }

    const resultsPath = resolveResultsPath(t.dir, t.n);
    const hasResultsFile =
      fs.existsSync(resultsPath) && String(fs.readFileSync(resultsPath, 'utf8')).trim().length > 0;

    if (job.status !== 'complete' && !hasResultsFile) {
      console.error('[onprem-all] FAIL ' + t.slug + ':', job.error || 'test did not complete');
      failed++;
      continue;
    }

    if (!hasResultsFile) {
      console.error('[onprem-all] FAIL ' + t.slug + ': no results file written.');
      failed++;
      continue;
    }

    const cmp = spawnSync(
      process.execPath,
      ['tools/compare-master-test-values.mjs', expectedPath, resultsPath],
      { cwd: repoRoot, encoding: 'utf8' }
    );
    if (cmp.stdout) process.stdout.write(cmp.stdout);
    if (cmp.stderr) process.stderr.write(cmp.stderr);
    if (cmp.status !== 0) {
      console.error('[onprem-all] MISMATCH ' + t.slug);
      failed++;
    } else {
      console.error('[onprem-all] PASS ' + t.slug);
    }
  }

  if (failed) {
    console.error('\n[onprem-all] ' + failed + ' test(s) failed.');
    process.exit(1);
  }
  console.error('\n[onprem-all] All on-prem tests passed.');
}

main().catch(function (err) {
  console.error('[onprem-all] Fatal:', err && err.message ? err.message : err);
  process.exit(1);
});
