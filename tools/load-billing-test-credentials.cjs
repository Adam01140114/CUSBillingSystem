/**
 * Billing app test login for Playwright master tests.
 * Fields are the same as the sign-in modal: username (full name) + user code.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const PLACEHOLDER_PASSWORDS = new Set([
  'your-password-here',
  'your-firebase-password-here'
]);

function getRepoRoot() {
  return path.join(__dirname, '..');
}

function getLocalCredentialsPath() {
  return path.join(getRepoRoot(), 'tools', 'billing-test.local.json');
}

function getExampleCredentialsPath() {
  return path.join(getRepoRoot(), 'tools', 'billing-test.local.example.json');
}

function ensureLocalCredentialsFile() {
  const localPath = getLocalCredentialsPath();
  if (fs.existsSync(localPath)) return localPath;
  const examplePath = getExampleCredentialsPath();
  if (!fs.existsSync(examplePath)) return null;
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.copyFileSync(examplePath, localPath);
  return localPath;
}

function readLocalCredentialsJson(localPath) {
  const j = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  const email = String(
    j.email || j.username || j.FIREBASE_TEST_EMAIL || ''
  ).trim();
  const password = String(
    j.password || j.userCode || j.FIREBASE_TEST_PASSWORD || ''
  );
  let baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl && (j.baseUrl || j.BASE_URL)) {
    baseUrl = String(j.baseUrl || j.BASE_URL).replace(/\/$/, '');
  }
  return { email, password, baseUrl };
}

function loadBillingTestCredentials(options) {
  const opts = options || {};
  const repoRoot = getRepoRoot();
  dotenv.config({ path: path.join(repoRoot, '.env') });

  const localPath = getLocalCredentialsPath();
  if (opts.ensureFile && !fs.existsSync(localPath)) {
    ensureLocalCredentialsFile();
  }

  let email = String(process.env.FIREBASE_TEST_EMAIL || process.env.DEV_TEST_EMAIL || '').trim();
  let password = String(process.env.FIREBASE_TEST_PASSWORD || process.env.DEV_TEST_PASSWORD || '');
  let baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  let source = email && password ? 'env' : null;

  if (fs.existsSync(localPath)) {
    try {
      const local = readLocalCredentialsJson(localPath);
      if (!email) email = local.email;
      if (!password) password = local.password;
      if (!process.env.BASE_URL && local.baseUrl) baseUrl = local.baseUrl;
      if (!source && local.email && local.password) source = 'local-json';
    } catch (e) {
      return {
        ok: false,
        email: '',
        password: '',
        baseUrl,
        source: null,
        error: 'Invalid JSON in tools/billing-test.local.json: ' + (e.message || String(e)),
        localPath,
        hasLocalFile: true
      };
    }
  }

  if (!email || !password) {
    return {
      ok: false,
      email: email || '',
      password: '',
      baseUrl,
      source: null,
      error:
        'Missing billing app test login. Set username + user code in tools/billing-test.local.json ' +
        '(copy from tools/billing-test.local.example.json) or set FIREBASE_TEST_EMAIL + FIREBASE_TEST_PASSWORD in .env.',
      localPath,
      hasLocalFile: fs.existsSync(localPath)
    };
  }

  if (PLACEHOLDER_PASSWORDS.has(password.trim())) {
    return {
      ok: false,
      email,
      password: '',
      baseUrl,
      source,
      error:
        'Replace the placeholder password in tools/billing-test.local.json with your billing app user code.',
      localPath,
      hasLocalFile: fs.existsSync(localPath)
    };
  }

  return {
    ok: true,
    email,
    password,
    baseUrl,
    source: source || 'local-json',
    error: null,
    localPath,
    hasLocalFile: fs.existsSync(localPath)
  };
}

function saveBillingTestCredentials(body) {
  const email = String((body && (body.email || body.username)) || '').trim();
  const password = String((body && (body.password || body.userCode)) || '');
  const baseUrl = String((body && (body.baseUrl || body.BASE_URL)) || 'http://127.0.0.1:8000')
    .trim()
    .replace(/\/$/, '');

  if (!email) {
    throw new Error('Username is required (billing app full name, same as the sign-in modal).');
  }
  if (!password) {
    throw new Error('User code is required (billing app password / user code).');
  }
  if (PLACEHOLDER_PASSWORDS.has(password.trim())) {
    throw new Error('Replace the placeholder password with your real billing app user code.');
  }

  const localPath = getLocalCredentialsPath();
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const payload = {
    email,
    password,
    baseUrl: baseUrl || 'http://127.0.0.1:8000'
  };
  fs.writeFileSync(localPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

function credentialsStatus() {
  const creds = loadBillingTestCredentials();
  let username = '';
  if (fs.existsSync(getLocalCredentialsPath())) {
    try {
      username = readLocalCredentialsJson(getLocalCredentialsPath()).email;
    } catch (e) {
      /* ignore */
    }
  }
  if (!username && creds.email) username = creds.email;

  return {
    configured: creds.ok,
    username: username || null,
    baseUrl: creds.baseUrl,
    hasLocalFile: creds.hasLocalFile,
    source: creds.source,
    error: creds.error
  };
}

module.exports = {
  loadBillingTestCredentials,
  saveBillingTestCredentials,
  ensureLocalCredentialsFile,
  credentialsStatus,
  getLocalCredentialsPath,
  getExampleCredentialsPath
};
