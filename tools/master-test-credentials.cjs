const fs = require('fs');
const path = require('path');

const PLACEHOLDER_PASSWORDS = new Set([
  '',
  'your-password-here',
  'your-firebase-password-here'
]);

function billingTestLocalPath(repoRoot) {
  return path.join(repoRoot, 'tools', 'billing-test.local.json');
}

function normalizeCreds(raw) {
  if (!raw || typeof raw !== 'object') {
    return { username: '', password: '', baseUrl: '' };
  }
  return {
    username: String(
      raw.username || raw.email || raw.FIREBASE_TEST_EMAIL || raw.DEV_TEST_EMAIL || ''
    ).trim(),
    password: String(
      raw.password || raw.userCode || raw.FIREBASE_TEST_PASSWORD || raw.DEV_TEST_PASSWORD || ''
    ).trim(),
    baseUrl: String(raw.baseUrl || raw.BASE_URL || '').trim()
  };
}

function isConfigured(creds) {
  const username = creds && creds.username ? String(creds.username).trim() : '';
  const password = creds && creds.password ? String(creds.password).trim() : '';
  if (!username || !password) return false;
  if (PLACEHOLDER_PASSWORDS.has(password)) return false;
  return true;
}

function loadMasterTestCredentials(repoRoot) {
  let username = String(process.env.FIREBASE_TEST_EMAIL || process.env.DEV_TEST_EMAIL || '').trim();
  let password = String(
    process.env.FIREBASE_TEST_PASSWORD || process.env.DEV_TEST_PASSWORD || ''
  ).trim();
  let baseUrl = String(process.env.BASE_URL || '').trim();
  let source = username && password && !PLACEHOLDER_PASSWORDS.has(password) ? 'env' : null;

  const localPath = billingTestLocalPath(repoRoot);
  if (fs.existsSync(localPath)) {
    try {
      const parsed = normalizeCreds(JSON.parse(fs.readFileSync(localPath, 'utf8')));
      if (!username) username = parsed.username;
      if (!password) password = parsed.password;
      if (!baseUrl && parsed.baseUrl) baseUrl = parsed.baseUrl;
      if (parsed.username && parsed.password && !PLACEHOLDER_PASSWORDS.has(parsed.password)) {
        source = source || 'file';
      }
    } catch (e) {
      /* ignore malformed local file */
    }
  }

  const creds = {
    username: username,
    password: password,
    baseUrl: baseUrl,
    source: source,
    configured: false
  };
  creds.configured = isConfigured(creds);
  return creds;
}

function saveMasterTestCredentials(repoRoot, input) {
  const normalized = normalizeCreds(input || {});
  if (!normalized.username || !normalized.password) {
    throw new Error('Username and user code are required.');
  }
  if (PLACEHOLDER_PASSWORDS.has(normalized.password)) {
    throw new Error('Replace the placeholder user code with your real billing login code.');
  }

  const localPath = billingTestLocalPath(repoRoot);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const payload = {
    username: normalized.username,
    password: normalized.password
  };
  if (normalized.baseUrl) {
    payload.baseUrl = String(normalized.baseUrl).replace(/\/$/, '');
  }
  fs.writeFileSync(localPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return loadMasterTestCredentials(repoRoot);
}

function maskUsername(username) {
  const value = String(username || '').trim();
  if (!value) return '';
  if (value.length <= 2) return value.charAt(0) + '***';
  return value.slice(0, 2) + '***';
}

function credentialsStatus(repoRoot) {
  const creds = loadMasterTestCredentials(repoRoot);
  return {
    configured: creds.configured,
    source: creds.source,
    usernameHint: creds.username ? maskUsername(creds.username) : '',
    baseUrl: creds.baseUrl || 'http://127.0.0.1:8000'
  };
}

function credentialsToRunnerEnv(creds) {
  if (!isConfigured(creds)) return {};
  const env = {
    FIREBASE_TEST_EMAIL: creds.username,
    FIREBASE_TEST_PASSWORD: creds.password
  };
  if (creds.baseUrl && !process.env.BASE_URL) {
    env.BASE_URL = String(creds.baseUrl).replace(/\/$/, '');
  }
  return env;
}

module.exports = {
  billingTestLocalPath,
  loadMasterTestCredentials,
  saveMasterTestCredentials,
  credentialsStatus,
  credentialsToRunnerEnv,
  isConfigured,
  normalizeCreds
};
