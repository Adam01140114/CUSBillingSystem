/**
 * Minimal Firestore REST client (no firebase-admin) — works on Node 25+.
 */
const crypto = require('crypto');
const fetch = require('node-fetch');

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function createServiceAccountJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore'
  };
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  const sig = sign.sign(sa.private_key, 'base64url');
  return `${signingInput}.${sig}`;
}

async function getAccessToken(sa) {
  const assertion = createServiceAccountJwt(sa);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('OAuth token failed: ' + JSON.stringify(data));
  }
  return data.access_token;
}

function convertFirestoreValue(v) {
  if (!v || typeof v !== 'object') return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
  if (v.doubleValue !== undefined) return parseFloat(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.bytesValue !== undefined) return v.bytesValue;
  if (v.referenceValue !== undefined) return v.referenceValue;
  if (v.geoPointValue !== undefined) return v.geoPointValue;
  if (v.arrayValue) {
    return (v.arrayValue.values || []).map(convertFirestoreValue);
  }
  if (v.mapValue) {
    const out = {};
    const fields = v.mapValue.fields || {};
    for (const key of Object.keys(fields)) {
      out[key] = convertFirestoreValue(fields[key]);
    }
    return out;
  }
  return null;
}

function documentToPlain(doc) {
  const name = doc.name || '';
  const id = name.split('/').pop();
  const fields = doc.fields || {};
  const data = {};
  for (const key of Object.keys(fields)) {
    data[key] = convertFirestoreValue(fields[key]);
  }
  return { id, ...data };
}

async function listCollection(projectId, collectionId, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}`;
  const items = [];
  let pageToken = '';
  do {
    const url = pageToken ? `${base}?pageToken=${encodeURIComponent(pageToken)}` : base;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Firestore list ${collectionId} failed: ${JSON.stringify(data)}`);
    }
    (data.documents || []).forEach((doc) => items.push(documentToPlain(doc)));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return items;
}

async function getSettingsDoc(projectId, docId, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings/${docId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Firestore get settings/${docId} failed: ${JSON.stringify(data)}`);
  }
  const plain = documentToPlain(data);
  delete plain.id;
  return plain;
}

function loadServiceAccountFromEnv() {
  return {
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
  };
}

async function exportAllFromFirestoreRest() {
  const sa = loadServiceAccountFromEnv();
  const projectId = sa.project_id;
  const token = await getAccessToken(sa);

  const collections = [
    'customers',
    'locations',
    'codes',
    'users',
    'drawers',
    'paymentProcessingSessions',
    'billingCycles'
  ];
  const out = {};
  for (const col of collections) {
    process.stderr.write(`[export] ${col}…\n`);
    out[col] = await listCollection(projectId, col, token);
  }

  const settingsDocs = ['sewerCharge', 'lateFee', 'pucSurcharge', 'toggles', 'paymentHierarchy', 'deletedCodeNames'];
  out.settings = {};
  for (const docId of settingsDocs) {
    process.stderr.write(`[export] settings/${docId}…\n`);
    const doc = await getSettingsDoc(projectId, docId, token);
    if (doc) out.settings[docId] = doc;
  }

  return out;
}

module.exports = {
  exportAllFromFirestoreRest,
  getAccessToken,
  loadServiceAccountFromEnv
};
