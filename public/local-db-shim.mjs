const LOCAL_MODE_KEY = 'cusLocalDatabaseMode';

/** Must match tools/mysql-local-db.cjs SYNC_COLLECTIONS */
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

const SYNC_IMPORT_BATCH_SIZE = 75;
const SYNC_FIREBASE_WRITE_BATCH = 400;

function serializeFirebaseDataForImport(value) {
  if (value == null) return value;
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      return value.toDate().toISOString();
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) {
    return value.map(serializeFirebaseDataForImport);
  }
  if (typeof value === 'object') {
    if (typeof value.path === 'string' && value.firestore) {
      return { __firestoreRef: value.path };
    }
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return {
        __geoPoint: true,
        latitude: value.latitude,
        longitude: value.longitude
      };
    }
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = serializeFirebaseDataForImport(nested);
    }
    return out;
  }
  return value;
}

export function isLocalDatabaseMode() {
  try {
    return localStorage.getItem(LOCAL_MODE_KEY) === 'local';
  } catch {
    return false;
  }
}

export function setLocalDatabaseMode(enabled) {
  localStorage.setItem(LOCAL_MODE_KEY, enabled ? 'local' : 'online');
}

export function deleteField() {
  return { __deleteField: true };
}

const LOCAL_DB_MARKER = { __localDb: true };

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Local database request failed (${res.status})`);
  }
  return body;
}

function parseDocRef(ref) {
  if (!ref || !ref.__localRef) {
    throw new Error('Invalid local document reference');
  }
  return { collection: ref.collection, docId: ref.id };
}

function parseCollectionRef(ref) {
  if (!ref || !ref.__localCollection) {
    throw new Error('Invalid local collection reference');
  }
  return ref.collection;
}

class LocalDocumentSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
  }
  exists() {
    return this._data != null;
  }
  data() {
    return this._data ? structuredClone(this._data) : undefined;
  }
}

class LocalQuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
  forEach(callback) {
    this.docs.forEach(callback);
  }
}

class LocalWriteBatch {
  constructor() {
    this._operations = [];
  }
  set(ref, data, options = {}) {
    const { collection, docId } = parseDocRef(ref);
    this._operations.push({
      type: 'set',
      collection,
      docId,
      data,
      merge: !!options.merge
    });
  }
  update(ref, data) {
    const { collection, docId } = parseDocRef(ref);
    this._operations.push({ type: 'update', collection, docId, data });
  }
  delete(ref) {
    const { collection, docId } = parseDocRef(ref);
    this._operations.push({ type: 'delete', collection, docId });
  }
  async commit() {
    await apiFetch('/api/local-db/batch', {
      method: 'POST',
      body: JSON.stringify({ operations: this._operations })
    });
    this._operations = [];
  }
}

export function installLocalDbLayer(firebaseApi) {
  const {
    getFirestore,
    collection: fbCollection,
    doc: fbDoc,
    addDoc: fbAddDoc,
    getDocs: fbGetDocs,
    getDoc: fbGetDoc,
    setDoc: fbSetDoc,
    updateDoc: fbUpdateDoc,
    deleteDoc: fbDeleteDoc,
    writeBatch: fbWriteBatch,
    deleteField: fbDeleteField
  } = firebaseApi;

  let syncApp = null;
  let syncProjectId = '';

  function bindSyncContext(ctx) {
    syncApp = ctx && ctx.app ? ctx.app : null;
    syncProjectId = ctx && ctx.clientProjectId ? String(ctx.clientProjectId) : '';
  }

  function requireOnlineFirestoreDb() {
    if (isLocalDatabaseMode()) {
      throw new Error(
        'Switch to online (Firebase) mode before syncing FROM Firebase. Turn off Local database mode, run sync, then switch back to local mode.'
      );
    }
    if (!syncApp) {
      throw new Error('Firebase is not ready yet. Reload the page and try again.');
    }
    return getFirestore(syncApp);
  }

  async function importDocsToLocal(collectionName, docs, clearFirst) {
    let imported = 0;
    for (let i = 0; i < docs.length; i += SYNC_IMPORT_BATCH_SIZE) {
      const chunk = docs.slice(i, i + SYNC_IMPORT_BATCH_SIZE);
      const body = await apiFetch('/api/local-db/sync/import-collection', {
        method: 'POST',
        body: JSON.stringify({
          collection: collectionName,
          docs: chunk,
          clearFirst: clearFirst && i === 0
        })
      });
      imported += body.count || chunk.length;
    }
    if (clearFirst && docs.length === 0) {
      await apiFetch('/api/local-db/sync/import-collection', {
        method: 'POST',
        body: JSON.stringify({
          collection: collectionName,
          docs: [],
          clearFirst: true
        })
      });
    }
    return imported;
  }

  async function syncFirebaseToLocal(options) {
    options = options || {};
    let db;
    if (options.readFirebaseWhileLocal === true) {
      if (!syncApp) {
        throw new Error('Firebase is not ready yet. Reload the page and try again.');
      }
      db = getFirestore(syncApp);
    } else {
      db = requireOnlineFirestoreDb();
    }
    const summary = {};
    for (const collectionName of SYNC_COLLECTIONS) {
      const snap = await fbGetDocs(fbCollection(db, collectionName));
      const docs = snap.docs.map(docSnap => ({
        id: docSnap.id,
        data: serializeFirebaseDataForImport(docSnap.data())
      }));
      summary[collectionName] = await importDocsToLocal(collectionName, docs, true);
    }
    return {
      ok: true,
      direction: 'firebase-to-local',
      projectId: syncProjectId || undefined,
      summary
    };
  }

  async function syncLocalToFirebase() {
    if (!syncApp) {
      throw new Error('Firebase is not ready yet. Reload the page and try again.');
    }
    const db = getFirestore(syncApp);
    const summary = {};
    for (const collectionName of SYNC_COLLECTIONS) {
      const body = await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs`
      );
      const docs = body.docs || [];
      for (let i = 0; i < docs.length; i += SYNC_FIREBASE_WRITE_BATCH) {
        const batch = fbWriteBatch(db);
        const chunk = docs.slice(i, i + SYNC_FIREBASE_WRITE_BATCH);
        for (const item of chunk) {
          batch.set(fbDoc(db, collectionName, item.id), item.data || {}, { merge: false });
        }
        await batch.commit();
      }
      summary[collectionName] = docs.length;
    }
    return {
      ok: true,
      direction: 'local-to-firebase',
      projectId: syncProjectId || undefined,
      summary
    };
  }

  function getDb(app) {
    return isLocalDatabaseMode() ? LOCAL_DB_MARKER : getFirestore(app);
  }

  function collection(dbRef, collectionName, ...rest) {
    if (rest.length > 0) {
      throw new Error('Local database mode does not support nested subcollections yet.');
    }
    if (isLocalDatabaseMode()) {
      return { __localCollection: true, collection: collectionName };
    }
    return fbCollection(dbRef, collectionName);
  }

  function isLocalCollectionRef(ref) {
    return ref && ref.__localCollection === true;
  }

  function doc(firstArg, secondArg, thirdArg, ...rest) {
    if (rest.length > 0) {
      throw new Error('Local database mode does not support nested subcollections yet.');
    }

    const hasExplicitCollection = thirdArg !== undefined;

    if (isLocalDatabaseMode()) {
      if (hasExplicitCollection) {
        return { __localRef: true, collection: secondArg, id: thirdArg };
      }
      if (isLocalCollectionRef(firstArg)) {
        return { __localRef: true, collection: firstArg.collection, id: secondArg };
      }
      throw new Error('Invalid local document reference');
    }

    if (hasExplicitCollection) {
      return fbDoc(firstArg, secondArg, thirdArg);
    }
    return fbDoc(firstArg, secondArg);
  }

  async function getDoc(ref) {
    if (isLocalDatabaseMode()) {
      const { collection: collectionName, docId } = parseDocRef(ref);
      const body = await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs/${encodeURIComponent(docId)}`
      );
      return new LocalDocumentSnapshot(docId, body.doc ? body.doc.data : null);
    }
    return fbGetDoc(ref);
  }

  async function getDocs(ref) {
    if (isLocalDatabaseMode()) {
      const collectionName = parseCollectionRef(ref);
      const body = await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs`
      );
      const docs = (body.docs || []).map(
        item => new LocalDocumentSnapshot(item.id, item.data)
      );
      return new LocalQuerySnapshot(docs);
    }
    return fbGetDocs(ref);
  }

  async function setDoc(ref, data, options = {}) {
    if (isLocalDatabaseMode()) {
      const { collection: collectionName, docId } = parseDocRef(ref);
      await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs/${encodeURIComponent(docId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ data, merge: !!options.merge })
        }
      );
      return;
    }
    return fbSetDoc(ref, data, options);
  }

  async function updateDoc(ref, data) {
    if (isLocalDatabaseMode()) {
      const { collection: collectionName, docId } = parseDocRef(ref);
      await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs/${encodeURIComponent(docId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ data })
        }
      );
      return;
    }
    return fbUpdateDoc(ref, data);
  }

  async function deleteDoc(ref) {
    if (isLocalDatabaseMode()) {
      const { collection: collectionName, docId } = parseDocRef(ref);
      await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs/${encodeURIComponent(docId)}`,
        { method: 'DELETE' }
      );
      return;
    }
    return fbDeleteDoc(ref);
  }

  async function addDoc(ref, data) {
    if (isLocalDatabaseMode()) {
      const collectionName = parseCollectionRef(ref);
      const body = await apiFetch(
        `/api/local-db/collections/${encodeURIComponent(collectionName)}/docs`,
        {
          method: 'POST',
          body: JSON.stringify({ data })
        }
      );
      return { id: body.id, __localRef: true, collection: collectionName };
    }
    return fbAddDoc(ref, data);
  }

  function writeBatch(dbRef) {
    if (isLocalDatabaseMode()) {
      return new LocalWriteBatch();
    }
    return fbWriteBatch(dbRef);
  }

  async function fetchLocalDbStatus() {
    try {
      return await apiFetch('/api/local-db/status');
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  function wrappedDeleteField() {
    if (isLocalDatabaseMode()) {
      return { __deleteField: true };
    }
    return fbDeleteField();
  }

  return {
    getDb,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    writeBatch,
    deleteField: wrappedDeleteField,
    fetchLocalDbStatus,
    syncFirebaseToLocal,
    syncLocalToFirebase,
    bindSyncContext,
    isLocalDatabaseMode,
    setLocalDatabaseMode
  };
}
