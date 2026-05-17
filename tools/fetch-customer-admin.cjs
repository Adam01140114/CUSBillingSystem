#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const admin = require('firebase-admin');

const serviceAccount = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

const accountNumber = process.argv[2] || 'CUS-3011000';

admin
  .firestore()
  .collection('customers')
  .get()
  .then((snap) => {
    for (const doc of snap.docs) {
      const d = doc.data();
      const acct = d.accountNumber != null ? String(d.accountNumber).trim() : '';
      if (acct === accountNumber || doc.id === accountNumber) {
        process.stdout.write(JSON.stringify({ id: doc.id, ...d }));
        return;
      }
    }
    process.stderr.write('not found\n');
    process.exit(1);
  })
  .catch((e) => {
    process.stderr.write(String(e.stack || e) + '\n');
    process.exit(1);
  });
