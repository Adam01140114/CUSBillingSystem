'use strict';

const localDb = require('./mysql-local-db.cjs');

function registerLocalDbRoutes(app, firestoreDb) {
  app.get('/api/local-db/status', async (req, res) => {
    try {
      const status = await localDb.ping();
      res.json(status);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.get('/api/local-db/collections/:collection/docs', async (req, res) => {
    try {
      const docs = await localDb.listDocs(req.params.collection);
      res.json({ ok: true, docs });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.get('/api/local-db/collections/:collection/docs/:docId', async (req, res) => {
    try {
      const doc = await localDb.getDoc(req.params.collection, req.params.docId);
      res.json({ ok: true, exists: !!doc, doc });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/local-db/collections/:collection/docs', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.docId) {
        const saved = await localDb.setDoc(
          req.params.collection,
          body.docId,
          body.data || {},
          { merge: !!body.merge }
        );
        res.json({ ok: true, id: saved.id });
      } else {
        const saved = await localDb.addDoc(req.params.collection, body.data || {});
        res.json({ ok: true, id: saved.id });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.put('/api/local-db/collections/:collection/docs/:docId', async (req, res) => {
    try {
      const body = req.body || {};
      const saved = body.merge
        ? await localDb.updateDoc(req.params.collection, req.params.docId, body.data || {})
        : await localDb.setDoc(req.params.collection, req.params.docId, body.data || {}, { merge: false });
      res.json({ ok: true, id: saved.id });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.patch('/api/local-db/collections/:collection/docs/:docId', async (req, res) => {
    try {
      const saved = await localDb.updateDoc(
        req.params.collection,
        req.params.docId,
        (req.body || {}).data || {}
      );
      res.json({ ok: true, id: saved.id });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.delete('/api/local-db/collections/:collection/docs/:docId', async (req, res) => {
    try {
      await localDb.deleteDoc(req.params.collection, req.params.docId);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/local-db/batch', async (req, res) => {
    try {
      await localDb.runBatch((req.body || {}).operations || []);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/local-db/sync/firebase-to-local', async (req, res) => {
    try {
      if (!firestoreDb) {
        return res.status(500).json({ ok: false, error: 'Firebase is not configured on the server.' });
      }
      const collections = Array.isArray(req.body?.collections)
        ? req.body.collections
        : localDb.SYNC_COLLECTIONS;
      const summary = await localDb.syncFromFirebase(firestoreDb, collections);
      res.json({ ok: true, direction: 'firebase-to-local', summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  });

  app.post('/api/local-db/sync/local-to-firebase', async (req, res) => {
    try {
      if (!firestoreDb) {
        return res.status(500).json({ ok: false, error: 'Firebase is not configured on the server.' });
      }
      const collections = Array.isArray(req.body?.collections)
        ? req.body.collections
        : localDb.SYNC_COLLECTIONS;
      const summary = await localDb.syncToFirebase(firestoreDb, collections);
      res.json({ ok: true, direction: 'local-to-firebase', summary });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message || String(err) });
    }
  });
}

module.exports = { registerLocalDbRoutes };
