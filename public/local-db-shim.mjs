const LOCAL_MODE_KEY = 'cusLocalDatabaseMode';

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

  async function syncFirebaseToLocal() {
    return apiFetch('/api/local-db/sync/firebase-to-local', { method: 'POST', body: '{}' });
  }

  async function syncLocalToFirebase() {
    return apiFetch('/api/local-db/sync/local-to-firebase', { method: 'POST', body: '{}' });
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
    isLocalDatabaseMode,
    setLocalDatabaseMode
  };
}
