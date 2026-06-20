'use strict';

const mysql = require('mysql2/promise');
const crypto = require('crypto');

const SYNC_COLLECTIONS = [
  'customers',
  'locations',
  'codes',
  'users',
  'drawers',
  'settings',
  'billingCycles',
  'paymentBatches',
  'paymentProcessingSessions',
  'forms'
];

let pool = null;

function getConfig() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'cus_billing_local',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true
  };
}

function generateDocId() {
  return crypto.randomBytes(10).toString('hex').slice(0, 20);
}

function sanitizeCollection(name) {
  const value = String(name || '').trim();
  if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid collection name: ${name}`);
  }
  return value;
}

function sanitizeDocId(id) {
  const value = String(id || '').trim();
  if (!value || value.length > 255) {
    throw new Error(`Invalid document id: ${id}`);
  }
  return value;
}

function stripDeleteSentinels(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && value.__deleteField === true) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = stripDeleteSentinels(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function deepMerge(base, patch) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && value.__deleteField === true) {
      delete result[key];
      continue;
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function getPool() {
  if (pool) return pool;
  pool = mysql.createPool(getConfig());
  return pool;
}

async function ensureDatabaseExists() {
  const cfg = getConfig();
  const bootstrap = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password
  });
  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${cfg.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }
}

async function ensureSchema() {
  await ensureDatabaseExists();
  const p = await getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS firestore_documents (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      collection_path VARCHAR(255) NOT NULL,
      doc_id VARCHAR(255) NOT NULL,
      data JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_collection_doc (collection_path, doc_id),
      INDEX idx_collection (collection_path)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ping() {
  try {
    await ensureSchema();
    const p = await getPool();
    await p.query('SELECT 1');
    const cfg = getConfig();
    const [rows] = await p.query(
      'SELECT COUNT(*) AS count FROM firestore_documents'
    );
    return {
      ok: true,
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      documentCount: rows[0]?.count || 0
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      host: getConfig().host,
      database: getConfig().database
    };
  }
}

async function listDocs(collectionName) {
  await ensureSchema();
  const collection = sanitizeCollection(collectionName);
  const p = await getPool();
  const [rows] = await p.query(
    'SELECT doc_id, data FROM firestore_documents WHERE collection_path = ? ORDER BY doc_id',
    [collection]
  );
  return rows.map(row => ({
    id: row.doc_id,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
  }));
}

async function getDoc(collectionName, docId) {
  await ensureSchema();
  const collection = sanitizeCollection(collectionName);
  const id = sanitizeDocId(docId);
  const p = await getPool();
  const [rows] = await p.query(
    'SELECT doc_id, data FROM firestore_documents WHERE collection_path = ? AND doc_id = ? LIMIT 1',
    [collection, id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.doc_id,
    data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
  };
}

async function setDoc(collectionName, docId, data, options = {}) {
  await ensureSchema();
  const collection = sanitizeCollection(collectionName);
  const id = sanitizeDocId(docId);
  const clean = stripDeleteSentinels(data || {});
  const p = await getPool();

  if (options.merge) {
    const existing = await getDoc(collection, id);
    const merged = deepMerge(existing?.data || {}, clean);
    await p.query(
      `INSERT INTO firestore_documents (collection_path, doc_id, data)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
      [collection, id, JSON.stringify(merged)]
    );
    return { id, data: merged };
  }

  await p.query(
    `INSERT INTO firestore_documents (collection_path, doc_id, data)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
    [collection, id, JSON.stringify(clean)]
  );
  return { id, data: clean };
}

async function updateDoc(collectionName, docId, data) {
  return setDoc(collectionName, docId, data, { merge: true });
}

async function deleteDocRecord(collectionName, docId) {
  await ensureSchema();
  const collection = sanitizeCollection(collectionName);
  const id = sanitizeDocId(docId);
  const p = await getPool();
  await p.query(
    'DELETE FROM firestore_documents WHERE collection_path = ? AND doc_id = ?',
    [collection, id]
  );
}

async function addDoc(collectionName, data) {
  const id = generateDocId();
  const saved = await setDoc(collectionName, id, data, { merge: false });
  return { id: saved.id, data: saved.data };
}

async function runBatch(operations) {
  await ensureSchema();
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    for (const op of operations || []) {
      const type = op.type;
      const collection = sanitizeCollection(op.collection);
      const docId = op.docId ? sanitizeDocId(op.docId) : null;
      if (type === 'set') {
        const clean = stripDeleteSentinels(op.data || {});
        if (op.merge) {
          const [rows] = await conn.query(
            'SELECT data FROM firestore_documents WHERE collection_path = ? AND doc_id = ? LIMIT 1',
            [collection, docId]
          );
          const existing = rows.length
            ? typeof rows[0].data === 'string'
              ? JSON.parse(rows[0].data)
              : rows[0].data
            : {};
          const merged = deepMerge(existing, clean);
          await conn.query(
            `INSERT INTO firestore_documents (collection_path, doc_id, data)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
            [collection, docId, JSON.stringify(merged)]
          );
        } else {
          await conn.query(
            `INSERT INTO firestore_documents (collection_path, doc_id, data)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
            [collection, docId, JSON.stringify(clean)]
          );
        }
      } else if (type === 'update') {
        const [rows] = await conn.query(
          'SELECT data FROM firestore_documents WHERE collection_path = ? AND doc_id = ? LIMIT 1',
          [collection, docId]
        );
        const existing = rows.length
          ? typeof rows[0].data === 'string'
            ? JSON.parse(rows[0].data)
            : rows[0].data
          : {};
        const merged = deepMerge(existing, stripDeleteSentinels(op.data || {}));
        await conn.query(
          `INSERT INTO firestore_documents (collection_path, doc_id, data)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
          [collection, docId, JSON.stringify(merged)]
        );
      } else if (type === 'delete') {
        await conn.query(
          'DELETE FROM firestore_documents WHERE collection_path = ? AND doc_id = ?',
          [collection, docId]
        );
      } else {
        throw new Error(`Unsupported batch operation: ${type}`);
      }
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function clearCollection(collectionName) {
  await ensureSchema();
  const collection = sanitizeCollection(collectionName);
  const p = await getPool();
  const [result] = await p.query(
    'DELETE FROM firestore_documents WHERE collection_path = ?',
    [collection]
  );
  return result.affectedRows || 0;
}

function serializeFirestoreValue(value) {
  if (value == null) return value;
  if (value instanceof adminTimestamp(value)) return value;
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeFirestoreValue);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeFirestoreValue(v);
    }
    return out;
  }
  return value;
}

function adminTimestamp() {}

async function syncFromFirebase(firestoreDb, collections = SYNC_COLLECTIONS) {
  await ensureSchema();
  const summary = {};
  for (const collectionName of collections) {
    const snap = await firestoreDb.collection(collectionName).get();
    await clearCollection(collectionName);
    let count = 0;
    for (const docSnap of snap.docs) {
      const data = serializeFirestoreValue(docSnap.data());
      await setDoc(collectionName, docSnap.id, data, { merge: false });
      count += 1;
    }
    summary[collectionName] = count;
  }
  return summary;
}

async function syncToFirebase(firestoreDb, collections = SYNC_COLLECTIONS) {
  await ensureSchema();
  const summary = {};
  for (const collectionName of collections) {
    const docs = await listDocs(collectionName);
    let count = 0;
    const batchSize = 400;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = firestoreDb.batch();
      const chunk = docs.slice(i, i + batchSize);
      for (const item of chunk) {
        const ref = firestoreDb.collection(collectionName).doc(item.id);
        batch.set(ref, item.data, { merge: false });
      }
      await batch.commit();
      count += chunk.length;
    }
    summary[collectionName] = count;
  }
  return summary;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  SYNC_COLLECTIONS,
  getConfig,
  ensureSchema,
  ping,
  listDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc: deleteDocRecord,
  addDoc,
  runBatch,
  clearCollection,
  syncFromFirebase,
  syncToFirebase,
  closePool
};
