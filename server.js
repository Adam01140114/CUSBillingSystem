// server.js
require('./tools/node-buffer-polyfill.cjs');
const express       = require('express');
const dotenv        = require('dotenv');
const fetch         = require('node-fetch');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const pdfParse      = require('pdf-parse');
const os            = require('os');
dotenv.config();

// Stripe functionality removed - no longer needed

// AI Configuration (optional - only needed if using chat feature)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Admin Configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is not set in the environment. Please add it to your .env file.');
}

// Firebase Configuration
const requiredFirebaseEnvVars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY_ID', 
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_CLIENT_ID'
];

for (const envVar of requiredFirebaseEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} is not set in the environment. Please add it to your .env file.`);
  }
}
// Stripe package removed
const admin         = require('firebase-admin');
const bodyParser    = require('body-parser');
const fileUpload    = require('express-fileupload');
const path          = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const cors          = require('cors');
const fs            = require('fs');
const nodemailer    = require('nodemailer');
const { spawn }     = require('child_process');

const app = express();
app.use(bodyParser.json({ limit: '2mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
const masterTestTextBody = bodyParser.text({ type: 'text/plain', limit: '64mb' });
app.use(fileUpload());          // parses multipart/form‑data (fields ➜ req.body, files ➜ req.files)
app.use(cors());

// ────────────────────────────────────────────────────────────
// Master test runner (viewer → Playwright) — before static so POST is never swallowed
// ────────────────────────────────────────────────────────────
const masterTestJobsDir = path.join(__dirname, 'Test Scripts', '.master-test-jobs');
const {
  loadBillingTestCredentials,
  saveBillingTestCredentials,
  ensureLocalCredentialsFile,
  credentialsStatus
} = require('./tools/load-billing-test-credentials.cjs');

function readMasterTestJobFile(jobId) {
  const safe = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  const fp = path.join(masterTestJobsDir, safe + '.json');
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeMasterTestJobFile(jobId, patch) {
  const safe = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) return null;
  fs.mkdirSync(masterTestJobsDir, { recursive: true });
  const fp = path.join(masterTestJobsDir, safe + '.json');
  let cur = {};
  if (fs.existsSync(fp)) {
    try {
      cur = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      cur = {};
    }
  }
  const next = Object.assign({}, cur, patch, { jobId: safe, updatedAt: Date.now() });
  fs.writeFileSync(fp, JSON.stringify(next, null, 0), 'utf8');
  return next;
}

app.get('/api/master-test/ping', (req, res) => {
  const runnerPath = path.join(__dirname, 'tools', 'run-dynamic-master-test.mjs');
  const creds = credentialsStatus();
  res.json({
    ok: true,
    runnerInstalled: fs.existsSync(runnerPath),
    jobsDir: masterTestJobsDir,
    credentialsConfigured: creds.configured,
    credentialsError: creds.error || null
  });
});

app.get('/api/master-test/credentials', (req, res) => {
  try {
    const status = credentialsStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/master-test/credentials', (req, res) => {
  try {
    const saved = saveBillingTestCredentials(req.body || {});
    const status = credentialsStatus();
    res.json({
      ok: true,
      saved: { username: saved.email, baseUrl: saved.baseUrl },
      ...status
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/master-test/run', (req, res) => {
  try {
    const body = req.body || {};
    const onprem = body.onprem === true || body.onprem === 'true';
    spawnMasterTestRun(body, onprem, res);
  } catch (err) {
    console.error('[master-test] run error:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/master-test/run-onprem', (req, res) => {
  try {
    spawnMasterTestRun(req.body || {}, true, res);
  } catch (err) {
    console.error('[master-test] run-onprem error:', err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

function spawnMasterTestRun(body, onprem, res) {
  const steps = body.steps;
  if (!Array.isArray(steps) || !steps.length) {
    return res.status(400).json({ ok: false, error: 'At least one step is required.' });
  }
  ensureLocalCredentialsFile();
  const creds = loadBillingTestCredentials();
  if (!creds.ok) {
    return res.status(400).json({ ok: false, error: creds.error });
  }
  const jobId =
    'job-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const config = {
    accountNumber: String(body.accountNumber || body.customerId || 'CUS-3011000').trim(),
    customerName: String(body.customerName || '').trim(),
    customerMode: String(body.customerMode || 'existing').trim() || 'existing',
    customerFirstName: String(body.customerFirstName || '').trim(),
    customerLastName: String(body.customerLastName || '').trim(),
    customerCreatedDate: String(body.customerCreatedDate || '').trim(),
    steps: steps,
    advanceMode: body.advanceMode === 'walk' ? 'walk' : 'instant',
    testSlug: String(body.testSlug || '').trim(),
    onprem: onprem === true
  };
  writeMasterTestJobFile(jobId, {
    status: 'queued',
    progress: 0,
    message: onprem ? 'Queued (on-prem)…' : 'Queued…',
    config: config,
    resultsText: '',
    consoleText: '',
    error: null,
    startedAt: Date.now()
  });
  const runnerPath = path.join(__dirname, 'tools', 'run-dynamic-master-test.mjs');
  if (!fs.existsSync(runnerPath)) {
    return res.status(500).json({ ok: false, error: 'Test runner script missing.' });
  }
  const jobFile = path.join(masterTestJobsDir, jobId + '.json');
  const child = spawn(process.execPath, [runnerPath], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, {
      MASTER_TEST_JOB_FILE: jobFile,
      MASTER_TEST_CONFIG: JSON.stringify(config),
      FIREBASE_TEST_EMAIL: creds.email,
      FIREBASE_TEST_PASSWORD: creds.password,
      BASE_URL: creds.baseUrl
    })
  });
  child.on('error', function (spawnErr) {
    writeMasterTestJobFile(jobId, {
      status: 'failed',
      progress: 100,
      message: 'Could not start runner',
      error: spawnErr.message || String(spawnErr)
    });
  });
  child.unref();
  res.json({ ok: true, jobId: jobId, onprem: onprem === true });
}

app.get('/api/master-test/status/:jobId', (req, res) => {
  const job = readMasterTestJobFile(req.params.jobId);
  if (!job) {
    return res.status(404).json({ ok: false, error: 'Job not found' });
  }
  const slim = {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    resultsTextStoredOnDisk: job.resultsTextStoredOnDisk === true,
    consoleTextStoredOnDisk: job.consoleTextStoredOnDisk === true
  };
  if (typeof job.resultsText === 'string' && job.resultsText.length <= 8192) {
    slim.resultsText = job.resultsText;
  }
  res.json({ ok: true, job: slim });
});

const masterTestDisk = require('./tools/master-test-disk-store.cjs');

app.get('/api/master-test/registry', (req, res) => {
  try {
    const onprem = req.query.onprem === '1' || req.query.onprem === 'true';
    res.json({ ok: true, onprem: onprem, tests: masterTestDisk.listTestsOnDisk(onprem) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get('/api/master-test/tests/:slug', (req, res) => {
  try {
    const onprem = req.query.onprem === '1' || req.query.onprem === 'true';
    const loaded = masterTestDisk.loadTestFromDisk(req.params.slug, onprem);
    res.json({ ok: true, onprem: onprem, test: loaded.test });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/master-test/tests/:slug/package', (req, res) => {
  try {
    const body = req.body || {};
    const slug = String(req.params.slug || '').trim();
    masterTestDisk.savePackageToDisk(slug, {
      name: body.name,
      customerMode: body.customerMode,
      customerName: body.customerName,
      customerId: body.customerId,
      customerFirstName: body.customerFirstName,
      customerLastName: body.customerLastName,
      customerCreatedDate: body.customerCreatedDate,
      stepDefs: body.stepDefs,
      foundationText: body.foundationText
    });
    res.json({ ok: true, slug: slug });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/master-test/tests/:slug/results', masterTestTextBody, (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    masterTestDisk.saveResultsTextToDisk(slug, req.body || '', false);
    res.json({ ok: true, slug: slug });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/master-test/tests/:slug/onprem/results', masterTestTextBody, (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    masterTestDisk.saveResultsTextToDisk(slug, req.body || '', true);
    res.json({ ok: true, slug: slug, onprem: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/master-test/tests/:slug/expected', masterTestTextBody, (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    masterTestDisk.saveExpectedTextToDisk(slug, req.body || '', false);
    res.json({ ok: true, slug: slug });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.put('/api/master-test/tests/:slug/onprem/expected', masterTestTextBody, (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    masterTestDisk.saveExpectedTextToDisk(slug, req.body || '', true);
    res.json({ ok: true, slug: slug, onprem: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

/** Legacy: small metadata only — do not send results/expected in JSON (use /results and /expected). */
app.put('/api/master-test/tests/:slug', (req, res) => {
  try {
    const body = req.body || {};
    const slug = String(req.params.slug || '').trim();
    masterTestDisk.savePackageToDisk(slug, {
      name: body.name,
      customerMode: body.customerMode,
      customerName: body.customerName,
      customerId: body.customerId,
      customerFirstName: body.customerFirstName,
      customerLastName: body.customerLastName,
      customerCreatedDate: body.customerCreatedDate,
      stepDefs: body.stepDefs,
      foundationText: body.foundationText
    });
    res.json({ ok: true, slug: slug });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/master-test/tests', (req, res) => {
  try {
    const body = req.body || {};
    const slug = String(body.slug || masterTestDisk.allocateNextSlug()).trim();
    masterTestDisk.createTestFolder(slug, body);
    const loaded = masterTestDisk.loadTestFromDisk(slug);
    res.json({ ok: true, slug: slug, test: loaded.test });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.delete('/api/master-test/tests/:slug', (req, res) => {
  try {
    masterTestDisk.deleteTestFromDisk(req.params.slug);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

// ────────────────────────────────────────────────────────────
// Firebase
// ────────────────────────────────────────────────────────────
// Firebase configuration using environment variables
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
});
const db = admin.firestore();

const { registerLocalDbRoutes } = require('./tools/local-db-api.cjs');
registerLocalDbRoutes(app, db);

// ────────────────────────────────────────────────────────────
// Static files
// ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get('/Master Test/master_test_viewer.html', (req, res) => {
  res.redirect(301, '/test-scripts/master_test_viewer.html');
});
app.get('/Master Test/master_test_viewer_onprem.html', (req, res) => {
  res.redirect(301, '/test-scripts/master_test_viewer_onprem.html');
});
app.use('/test-scripts', express.static(path.join(__dirname, 'Test Scripts')));

// ────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────
// Remove the root route handler to allow static file serving
// The static middleware will serve index.html from the public directory

// Admin authentication endpoint
app.post('/api/admin-login', (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password is required' 
      });
    }

    if (password === ADMIN_PASSWORD) {
      res.json({ 
        success: true, 
        message: 'Authentication successful' 
      });
    } else {
      res.status(401).json({ 
        success: false, 
        error: 'Invalid password' 
      });
    }

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during authentication' 
    });
  }
});

// Password verification endpoint for site-wide protection
app.post('/api/verify-password', (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password is required' 
      });
    }

    // Compare with stored password from environment variable
    if (password === ADMIN_PASSWORD) {
      res.json({ 
        success: true, 
        message: 'Authentication successful' 
      });
    } else {
      res.status(401).json({ 
        success: false, 
        error: 'Invalid password' 
      });
    }

  } catch (error) {
    console.error('Password verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during authentication' 
    });
  }
});

// Admin forms data endpoint
app.get('/api/admin-forms', async (req, res) => {
  try {
    console.log('Loading forms for admin console...');
    
    const formsRef = db.collection('forms');
    const snapshot = await formsRef.get();
    
    const formsData = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      formsData.push({
        id: doc.id,
        ...data
      });
    });
    
    console.log(`Found ${formsData.length} forms for admin console`);
    res.json({ 
      success: true, 
      forms: formsData 
    });

  } catch (error) {
    console.error('Error loading admin forms:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to load forms data' 
    });
  }
});

// Admin save forms endpoint
app.post('/api/admin-save-forms', async (req, res) => {
  try {
    const { forms } = req.body;
    
    if (!forms || !Array.isArray(forms)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Forms data is required' 
      });
    }

    console.log(`Saving ${forms.length} forms to Firebase...`);
    
    const batch = db.batch();
    const formsRef = db.collection('forms');
    
    // Clear existing forms
    const snapshot = await formsRef.get();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Add new forms
    forms.forEach(form => {
      const docRef = formsRef.doc(form.id || form.name);
      batch.set(docRef, form);
    });
    
    await batch.commit();
    
    console.log(`Successfully saved ${forms.length} forms to Firebase`);
    res.json({ 
      success: true, 
      message: `Successfully saved ${forms.length} forms` 
    });

  } catch (error) {
    console.error('Error saving admin forms:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save forms data' 
    });
  }
});

// Admin delete form endpoint
app.delete('/api/admin-delete-form/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    
    if (!formId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Form ID is required' 
      });
    }

    console.log(`Deleting form ${formId} from Firebase...`);
    
    await db.collection('forms').doc(formId).delete();
    
    console.log(`Successfully deleted form ${formId} from Firebase`);
    res.json({ 
      success: true, 
      message: 'Form deleted successfully' 
    });

  } catch (error) {
    console.error('Error deleting admin form:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to delete form' 
    });
  }
});

// Debug endpoint to check forms in source database
app.get('/api/debug-forms', async (req, res) => {
  try {
    const sourceProjectId = 'invoice-4f2b4';
    
    // Initialize source Firebase app
    const sourceApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${sourceProjectId}.firebaseio.com`
    }, 'debugSourceApp');
    
    const sourceDb = sourceApp.firestore();

    // Get all forms from source
    const snapshot = await sourceDb.collection('forms').get();
    const forms = [];
    
    snapshot.forEach(doc => {
      const formData = doc.data();
      forms.push({
        id: doc.id,
        name: formData.name || 'Unnamed',
        description: formData.description || 'No description',
        counties: formData.counties || []
      });
    });

    // Clean up
    await sourceApp.delete();

    res.json({
      success: true,
      projectId: sourceProjectId,
      totalForms: forms.length,
      forms: forms
    });

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ────────────────────────────────────────────────────────────
// Form Transfer Endpoint (Accepts Forms Data)
// ────────────────────────────────────────────────────────────
app.post('/api/transfer-forms-data', async (req, res) => {
  try {
    const { forms, targetProjectId } = req.body;
    
    if (!forms || !Array.isArray(forms) || forms.length === 0) {
      return res.status(400).json({ error: 'Forms data is required' });
    }

    if (!targetProjectId) {
      return res.status(400).json({ error: 'Target project ID is required' });
    }

    // Initialize target Firebase app (FormWiz)
    const targetApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${targetProjectId}.firebaseio.com`
    }, 'targetApp');
    
    const targetDb = targetApp.firestore();

    // Transfer forms to target database
    const batch = targetDb.batch();
    let transferredCount = 0;

    for (const form of forms) {
      const formRef = targetDb.collection('forms').doc(form.id);
      const { id, ...formData } = form; // Remove id from data since it's the document ID
      batch.set(formRef, formData);
      transferredCount++;
      console.log(`Transferring form: ${form.id} - ${form.name || 'Unnamed'}`);
    }

    await batch.commit();

    // Clean up
    await targetApp.delete();

    res.json({ 
      success: true, 
      message: `Successfully transferred ${transferredCount} forms`,
      transferredCount 
    });

  } catch (error) {
    console.error('Error transferring forms data:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ────────────────────────────────────────────────────────────
// Form Transfer Endpoint (Secure)
// ────────────────────────────────────────────────────────────
app.post('/api/transfer-forms', async (req, res) => {
  try {
    const { sourceProjectId, targetProjectId } = req.body;
    
    if (!sourceProjectId || !targetProjectId) {
      return res.status(400).json({ error: 'Source and target project IDs are required' });
    }

    // Initialize source Firebase app
    const sourceApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${sourceProjectId}.firebaseio.com`
    }, 'sourceApp');
    
    const sourceDb = sourceApp.firestore();

    // Initialize target Firebase app (FormWiz)
    const targetApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${targetProjectId}.firebaseio.com`
    }, 'targetApp');
    
    const targetDb = targetApp.firestore();

    // Get all forms from source
    console.log(`Attempting to read from source project: ${sourceProjectId}`);
    const snapshot = await sourceDb.collection('forms').get();
    const formsToTransfer = [];
    
    console.log(`Found ${snapshot.size} documents in source forms collection`);
    
    snapshot.forEach(doc => {
      const formData = doc.data();
      formData.id = doc.id;
      formsToTransfer.push(formData);
      console.log(`Form found: ${doc.id} - ${formData.name || 'Unnamed'}`);
    });

    if (formsToTransfer.length === 0) {
      console.log('No forms found to transfer');
      return res.json({ 
        success: true, 
        message: 'No forms found in source database',
        transferredCount: 0,
        debug: {
          sourceProjectId,
          targetProjectId,
          documentsFound: snapshot.size
        }
      });
    }

    // Transfer forms to target database
    const batch = targetDb.batch();
    let transferredCount = 0;

    for (const form of formsToTransfer) {
      const formRef = targetDb.collection('forms').doc(form.id);
      const { id, ...formData } = form;
      batch.set(formRef, formData);
      transferredCount++;
    }

    await batch.commit();

    // Clean up apps
    await sourceApp.delete();
    await targetApp.delete();

    res.json({ 
      success: true, 
      message: `Successfully transferred ${transferredCount} forms`,
      transferredCount 
    });

  } catch (error) {
    console.error('Error transferring forms:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ────────────────────────────────────────────────────────────
// AI Chat Endpoint (Secure)
// ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check if OpenAI API key is configured
    if (!OPENAI_API_KEY) {
      return res.status(503).json({ 
        error: 'AI chat feature is not configured. Please set OPENAI_API_KEY in your .env file to use this feature.' 
      });
    }

    // Prepare messages for OpenAI API
    const messages = [
      {
        role: 'system',
        content: `You are an AI Legal Assistant designed to help users with general legal questions and guidance. 

IMPORTANT DISCLAIMERS:
- You provide general information only and cannot replace professional legal advice
- You cannot provide specific legal advice for individual cases
- Always recommend consulting with a qualified attorney for specific legal matters
- You cannot represent users in court or provide legal representation
- Information provided is for educational purposes only

Your role is to:
- Explain legal concepts in simple terms
- Provide general guidance on legal processes
- Help users understand their rights and options
- Suggest when professional legal help is needed
- Be helpful, accurate, and responsible
- ASSESS if the user's situation matches any available forms and recommend them

AVAILABLE FORMS:
- SC-100: Plaintiff's Claim form for suing a defendant
- SC-120: Defendant's Claim form for counter-suing a plaintiff  
- SC-500: Small claims form for cases related to COVID-19
- Fee Waiver: Application for waiver of court filing fees

FORM ASSESSMENT GUIDELINES:
- Listen carefully to the user's situation and needs
- If their situation matches one of the available forms, recommend it
- Provide a helpful explanation of the form and why it's appropriate
- Use the format: "If you need assistance with [situation], we recommend filling out a [Form Name] form. [Explanation of what the form does and why it's useful]."
- If multiple forms might apply, explain the differences
- If no forms match, provide general guidance and suggest consulting an attorney

Always end responses with a reminder to consult with a qualified attorney for specific legal matters.`
      },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: message }
    ];

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: messages,
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'OpenAI API request failed');
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    res.json({ 
      response: aiResponse,
      success: true 
    });

  } catch (error) {
    console.error('AI Chat Error:', error);
    res.status(500).json({ 
      error: 'Failed to process chat message',
      details: error.message 
    });
  }
});

/* ————— helper ————— */
function shouldCheck(v) {
  // treat ANY present, non‑false value as "checked"
  if (v === undefined)               return false;
  if (Array.isArray(v))              return v.length > 0;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'false' && s !== 'off' && s !== 'no';
}

/**
 * Map HTML form values to PDF radio group options
 * @param {PDFRadioGroup} field - The PDF radio group field
 * @param {string} value - The value from the HTML form
 * @returns {string|null} - The mapped option name or null if no match
 */
function mapRadioValue(field, value) {
  try {
    const options = field.getOptions();
    const valueStr = String(value).trim();
    
    // If the value is already a valid option, use it
    if (options.includes(valueStr)) {
      return valueStr;
    }
    
    // Handle common HTML form values
    if (valueStr === 'on' || valueStr === 'true' || valueStr === '1') {
      // For 'on' values, try to find a "Yes" option or the first available option
      const yesOption = options.find(opt => 
        opt.toLowerCase().includes('yes') || 
        opt.toLowerCase().includes('true') ||
        opt.toLowerCase().includes('1')
      );
      if (yesOption) return yesOption;
      
      // If no "Yes" option, use the first option
      if (options.length > 0) return options[0];
    }
    
    if (valueStr === 'off' || valueStr === 'false' || valueStr === '0') {
      // For 'off' values, try to find a "No" option
      const noOption = options.find(opt => 
        opt.toLowerCase().includes('no') || 
        opt.toLowerCase().includes('false') ||
        opt.toLowerCase().includes('0')
      );
      if (noOption) return noOption;
    }
    
    // Handle comma-separated values (like "on,on")
    if (valueStr.includes(',')) {
      const parts = valueStr.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length > 0) {
        // Use the first non-empty part and try to map it
        return mapRadioValue(field, parts[0]);
      }
    }
    
    // Try partial matching
    const partialMatch = options.find(opt => 
      opt.toLowerCase().includes(valueStr.toLowerCase()) ||
      valueStr.toLowerCase().includes(opt.toLowerCase())
    );
    if (partialMatch) return partialMatch;
    
    console.log(`Could not map radio value "${valueStr}" to any option in field ${field.getName()}. Available options: ${options.join(', ')}`);
    return null;
    
  } catch (error) {
    console.error(`Error mapping radio value for field ${field.getName()}:`, error.message);
    return null;
  }
}

/**
 * POST /edit_pdf
 * Accepts ▸ a file upload named "pdf", **or** ▸ a query string ?pdf=fileName
 * and returns the edited PDF with filled‑in fields.
 */
app.post('/edit_pdf', async (req, res) => {
  let pdfBytes;
  let outputName = 'Edited_document.pdf';

  // 1️⃣  First choice: an uploaded file
  if (req.files && req.files.pdf) {
    pdfBytes   = req.files.pdf.data;
    outputName = `Edited_${req.files.pdf.name}`;
    console.log(`Using uploaded PDF: ${req.files.pdf.name}`);
  } else {
    // 2️⃣  Fallback: ?pdf=fileName
    const pdfName = req.query.pdf;
    if (!pdfName) {
      return res.status(400).send('No PDF provided (upload a file or pass ?pdf=filename).');
    }
    const sanitized = path.basename(pdfName) + '.pdf';
    const pdfPath   = path.join(__dirname, 'public', sanitized);
    if (!fs.existsSync(pdfPath)) {
      return res.status(400).send('Requested PDF does not exist on the server.');
    }
    pdfBytes   = await fs.promises.readFile(pdfPath);
    outputName = `Edited_${sanitized}`;
    console.log(`Using server PDF: ${sanitized}`);
  }

  // ── Fill the form ─────────────────────────────────────────
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form   = pdfDoc.getForm();
  const helv   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Debug: Log all available PDF fields
  console.log('Available PDF fields:');
  form.getFields().forEach(field => {
    console.log(`- ${field.getName()} (${field.constructor.name})`);
  });

  // Debug: Log all form data received
  console.log('Form data received:');
  Object.keys(req.body).forEach(key => {
    console.log(`- ${key}: ${req.body[key]}`);
  });

  form.getFields().forEach(field => {
    const key   = field.getName();
    const value = req.body[key];

    if (value === undefined) {
      console.log(`No data for field: ${key}`);
      return;            // nothing sent for this field
    }

    console.log(`Processing field: ${key} = ${value} (${field.constructor.name})`);

    try {
      switch (field.constructor.name) {
        case 'PDFCheckBox':
          const shouldBeChecked = shouldCheck(value);
          console.log(`Checkbox ${key}: shouldCheck(${value}) = ${shouldBeChecked}`);
          shouldBeChecked ? field.check() : field.uncheck();
          break;

        case 'PDFRadioGroup':
          // Handle radio groups with proper option mapping
          const radioValue = mapRadioValue(field, value);
          console.log(`Radio ${key}: mapped "${value}" to "${radioValue}"`);
          if (radioValue) {
            field.select(radioValue);
          }
          break;

        case 'PDFDropdown':
          field.select(String(value));
          break;

        case 'PDFTextField':
          field.setText(String(value));
          field.updateAppearances(helv);
          break;

        case 'PDFSignature':
          // Skip signature fields - they can't be filled programmatically
          console.log(`Skipping signature field: ${key}`);
          break;

        default:
          // For unknown field types, try to set text if the method exists
          if (typeof field.setText === 'function') {
            field.setText(String(value));
            if (typeof field.updateAppearances === 'function') {
              field.updateAppearances(helv);
            }
          } else {
            console.log(`Skipping field ${key} of type ${field.constructor.name} - no setText method available`);
          }
          break;
      }
    } catch (error) {
      console.error(`Error processing field ${key} of type ${field.constructor.name}:`, error.message);
      // Continue processing other fields even if one fails
    }
  });

  const edited = await pdfDoc.save();
  res
    .set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${outputName}"`,
    })
    .send(Buffer.from(edited));
});

/**
 * Word-wrap for pdf-lib Helvetica text.
 */
function wrapTextToWidth(text, font, fontSize, maxWidth) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [''];
  const paragraphs = raw.split(/\n/);
  const out = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const w = font.widthOfTextAtSize(test, fontSize);
      if (w <= maxWidth) {
        line = test;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    if (words.length === 0) out.push('');
  }
  return out.length ? out : [''];
}

function moneyOrDash(v) {
  const n = parseFloat(v);
  if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
  return '—';
}

/**
 * POST /api/generate-deposit-withdrawal-notice
 * JSON body → single-page or multi-page letter-style PDF (no stored template).
 */
app.post('/api/generate-deposit-withdrawal-notice', async (req, res) => {
  try {
    const b = req.body || {};
    const accountName = String(b.accountName || '').trim() || 'Account holder';
    const accountNumber = String(b.accountNumber || '').trim() || '—';
    const serviceAddress = String(b.serviceAddress || '').trim();
    const noticeDateStr = String(b.noticeDateStr || '').trim() || new Date().toLocaleDateString('en-US');
    const triggerDateStr = String(b.triggerDateStr || '').trim() || '—';
    const anchorBillDateStr = String(b.anchorBillDateStr || '').trim() || '—';
    const daysLatePhrase = String(b.daysLatePhrase || '').trim() || '60+';
    const thresholdDays = parseInt(b.depositThresholdDays, 10);
    const thresholdStr = Number.isFinite(thresholdDays) ? String(thresholdDays) : '60';
    const contDays = parseInt(b.continuousDelinquencyDaysAtTrigger, 10);
    const contStr = Number.isFinite(contDays) ? String(contDays) : '—';
    const amountApplied = parseFloat(b.amountAppliedFromDeposit);
    const amtStr = Number.isFinite(amountApplied) ? amountApplied.toFixed(2) : String(b.amountAppliedFromDeposit || '0.00');
    const depositBefore = parseFloat(b.depositOnFileBefore);
    const depositAfter = parseFloat(b.depositOnFileAfter);
    const totalAddressed = parseFloat(b.totalBalanceAddressed);
    const replenishTarget = parseFloat(b.replenishTargetAmount);
    const shortfall = Number.isFinite(replenishTarget) && Number.isFinite(depositAfter)
      ? Math.max(0, Math.round((replenishTarget - depositAfter) * 100) / 100)
      : parseFloat(b.replenishShortfall);

    const allocationSummary = String(b.allocationSummary || '').trim();

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const margin = 50;
    const maxTextW = 512;
    const fontSize = 11;
    const titleSize = 16;
    const lineStep = 15;

    let page = pdfDoc.addPage([612, 792]);
    let y = 742;

    const drawLines = (lines, size, useBold, extraGap) => {
      const f = useBold ? fontBold : font;
      for (const ln of lines) {
        if (y < margin + 40) {
          page = pdfDoc.addPage([612, 792]);
          y = 742;
        }
        page.drawText(ln, {
          x: margin,
          y,
          size,
          font: f,
          color: rgb(0, 0, 0)
        });
        y -= lineStep * (size / fontSize);
      }
      y -= extraGap == null ? 8 : extraGap;
    };

    const drawHeading = (t) => {
      drawLines(wrapTextToWidth(t, fontBold, titleSize, maxTextW), titleSize, true, 14);
    };

    const drawBody = (t) => {
      drawLines(wrapTextToWidth(t, font, fontSize, maxTextW), fontSize, false, 10);
    };

    drawHeading('DEPOSIT WITHDRAWAL NOTICE');

    drawBody(
      `Notice date: ${noticeDateStr}\n\n` +
      `Account: ${accountName}\n` +
      `Account number: ${accountNumber}` +
      (serviceAddress ? `\nService address: ${serviceAddress}` : '')
    );

    drawBody(
      `This notice explains a withdrawal from your security deposit that was applied automatically by the system. ` +
        `Under your account terms, when sewer charges remain unpaid for an extended period, the district may apply ` +
        `funds you have on deposit toward the balance you owe.`
    );

    drawBody(
      `On ${triggerDateStr}, your account was marked as ${daysLatePhrase} days late on the continuous delinquency ` +
        `timer (you had reached ${contStr} day(s) while an amount remained due). This threshold is tied to ` +
        `${thresholdStr}+ calendar days on that timer, which is the district’s configured trigger for deposit withdrawal. ` +
        `The unpaid balance was measured from your billing position as of the last bill print / anchor reference date ` +
        `of ${anchorBillDateStr} (the date shown reflects when charges were last established on your bill before this action).`
    );

    drawBody(
      `Because those conditions were met, an amount of $${amtStr} was taken from your security deposit and applied ` +
        `to your outstanding balance in the same way a payment would be applied (for example toward past due amounts, ` +
        `current sewer charges, tax code surcharges, PUC surcharge, and late fees, in the order configured for your account).`
    );

    if (allocationSummary) {
      drawBody(`Application detail from the ledger for this event: ${allocationSummary}`);
    }

    const depBeforeStr = Number.isFinite(depositBefore) ? moneyOrDash(depositBefore) : moneyOrDash(b.depositOnFileBefore);
    const depAfterStr = Number.isFinite(depositAfter) ? moneyOrDash(depositAfter) : moneyOrDash(b.depositOnFileAfter);
    const totStr = Number.isFinite(totalAddressed) ? moneyOrDash(totalAddressed) : moneyOrDash(b.totalBalanceAddressed);

    drawBody(
      `At the time of this withdrawal, the total account balance this action addressed was approximately ${totStr}. ` +
        `Your security deposit on file immediately before this withdrawal was ${depBeforeStr}, and after the withdrawal ` +
        `the remaining deposit on file is ${depAfterStr}.`
    );

    const replStr = Number.isFinite(replenishTarget) ? moneyOrDash(replenishTarget) : moneyOrDash(b.replenishTargetAmount);
    const shortStr = Number.isFinite(shortfall) ? moneyOrDash(shortfall) : moneyOrDash(b.replenishShortfall);

    drawBody(
      `You are required to restore your security deposit to the full required on-file amount. ` +
        `Based on the balance held before this withdrawal, that target is ${replStr}. ` +
        `To return your deposit to that level, you must pay approximately ${shortStr} (plus any future bill amounts when due). ` +
        `Until the deposit is replenished, your account may not meet the district’s deposit requirements for continued service.`
    );

    drawBody(
      `This notice is for your records. If you believe this withdrawal was applied in error, contact the office with ` +
        `your account number and the notice date above.`
    );

    const bytes = await pdfDoc.save();
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Deposit_Withdrawal_Notice.pdf"'
      })
      .send(Buffer.from(bytes));
  } catch (err) {
    console.error('generate-deposit-withdrawal-notice:', err);
    res.status(500).send('Failed to generate deposit withdrawal notice PDF.');
  }
});

// Stripe checkout session endpoint removed

// Stripe cart checkout session endpoint removed

// Stripe prices listing endpoint removed

// Stripe price retrieval endpoint removed

// Endpoint to email a PDF to the user
app.post('/email-pdf', async (req, res) => {
    try {
        let { to, extraEmails, subject, text, filename } = req.body;
        if (!to && !extraEmails) {
            return res.status(400).json({ error: 'Missing recipient email(s)' });
        }
        if (!filename) {
            return res.status(400).json({ error: 'Missing required field: filename' });
        }
        // PDF should be sent as raw binary in req.files.pdf
        if (!req.files || !req.files.pdf) {
            return res.status(400).json({ error: 'Missing PDF file' });
        }
        const pdfBuffer = req.files.pdf.data;
        // Build recipients array
        let recipients = [];
        if (to) recipients.push(to);
        if (extraEmails) {
            if (typeof extraEmails === 'string') {
                // Accept comma-separated or single email
                if (extraEmails.includes(',')) {
                    recipients = recipients.concat(extraEmails.split(',').map(e => e.trim()).filter(Boolean));
                } else {
                    recipients.push(extraEmails.trim());
                }
            } else if (Array.isArray(extraEmails)) {
                recipients = recipients.concat(extraEmails.filter(Boolean));
            }
        }
        recipients = recipients.filter(Boolean);
        // Extract form name from filename
        let formName = filename.replace(/^Edited_/, '').replace(/\.pdf$/i, '').replace(/_/g, ' ');
        // Send to all recipients
        for (const email of recipients) {
            await sendPdfEmail(
                email,
                subject || `Your Completed ${formName} from FormWiz`,
                text || `Attached is your completed ${formName} PDF form from FormWiz.`,
                pdfBuffer,
                filename
            );
        }
        res.json({ success: true });
    } catch (e) {
        console.error('Error sending PDF email:', e);
        res.status(500).json({ error: 'Failed to send email' });
    }
});

// ────────────────────────────────────────────────────────────
// Nodemailer setup (using Gmail SMTP for example)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // set in .env
        pass: process.env.EMAIL_PASS  // set in .env
    }
});

/**
 * Send an email with a PDF attachment
 * @param {string} to - recipient email
 * @param {string} subject - email subject
 * @param {string} text - email body
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} filename - PDF file name
 */
async function sendPdfEmail(to, subject, text, pdfBuffer, filename) {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to,
        subject,
        text,
        attachments: [
            {
                filename,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }
        ]
    };
    await transporter.sendMail(mailOptions);
}

// ────────────────────────────────────────────────────────────
// PDF to Word Conversion
// ────────────────────────────────────────────────────────────
app.post('/convert-pdf-to-word', async (req, res) => {
    try {
        console.log('PDF conversion request received');
        
        if (!req.files) {
            console.log('No files in request');
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        if (!req.files.pdf) {
            console.log('No PDF file in request');
            return res.status(400).json({ error: 'No PDF file uploaded' });
        }

        const pdfFile = req.files.pdf;
        
        console.log(`Processing PDF: ${pdfFile.name} (${pdfFile.size} bytes)`);

        // Extract text from PDF
        console.log('Extracting text from PDF...');
        const pdfData = await pdfParse(pdfFile.data);
        
        console.log(`Extracted ${pdfData.text.length} characters from PDF`);
        console.log(`PDF has ${pdfData.numpages} pages`);

        // Create Word document with extracted content
        const children = [];

        // Add document header
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: "Converted from PDF: " + (pdfFile.name || 'Unknown'),
                        bold: true,
                        size: 24
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "Conversion Date: " + new Date().toLocaleString(),
                        italics: true,
                        size: 20
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: " "
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "─────────────────────────────────────────",
                        italics: true
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: " "
                    })
                ]
            })
        );

        // Process the extracted text
        if (pdfData.text && pdfData.text.trim().length > 0) {
            // Split text into paragraphs (by double newlines or long lines)
            const paragraphs = pdfData.text
                .split(/\n\s*\n/) // Split by double newlines
                .map(p => p.trim())
                .filter(p => p.length > 0);

            console.log(`Processing ${paragraphs.length} text paragraphs`);

            // Add each paragraph to the document
            paragraphs.forEach((paragraph, index) => {
                // Skip very short paragraphs that might be artifacts
                if (paragraph.length < 3) return;

                // Clean up the paragraph text
                const cleanText = paragraph
                    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                    .replace(/\n/g, ' ') // Replace newlines with spaces
                    .trim();

                if (cleanText.length > 0) {
                    children.push(
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: cleanText,
                                    size: 22
                                })
                            ]
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: " "
                                })
                            ]
                        })
                    );
                }
            });
        } else {
            // No text extracted, add a note
            children.push(
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "No text content could be extracted from this PDF.",
                            italics: true,
                            size: 20
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "This may be due to:",
                            size: 20
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "• The PDF contains only images",
                            size: 18
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "• The PDF is password protected",
                            size: 18
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "• The PDF uses non-standard text encoding",
                            size: 18
                        })
                    ]
                }),
                new Paragraph({
                    children: [
                        new TextRun({
                            text: "• The PDF is corrupted or damaged",
                            size: 18
                        })
                    ]
                })
            );
        }

        // Add footer information
        children.push(
            new Paragraph({
                children: [
                    new TextRun({
                        text: " "
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "─────────────────────────────────────────",
                        italics: true
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: " "
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "Document Information:",
                        bold: true,
                        size: 20
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "• Original File: " + (pdfFile.name || 'Unknown'),
                        size: 18
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "• File Size: " + formatFileSize(pdfFile.size || 0),
                        size: 18
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "• Pages: " + (pdfData.numpages || 'Unknown'),
                        size: 18
                    })
                ]
            }),
            new Paragraph({
                children: [
                    new TextRun({
                        text: "• Characters Extracted: " + (pdfData.text ? pdfData.text.length : 0),
                        size: 18
                    })
                ]
            })
        );

        // Create the document with all children
        const doc = new Document({
            sections: [{
                properties: {},
                children: children
            }]
        });

        // Generate Word document
        console.log('Generating Word document...');
        const buffer = await Packer.toBuffer(doc);

        // Set response headers
        const originalName = pdfFile.name || 'document';
        const outputFilename = path.basename(originalName, '.pdf') + '_converted.docx';
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
        res.setHeader('Content-Length', buffer.length);

        // Send the Word document
        res.send(buffer);

        console.log(`Successfully converted PDF to Word: ${outputFilename}`);

    } catch (error) {
        console.error('PDF to Word conversion error:', error);
        res.status(500).json({ 
            error: 'Conversion failed: ' + error.message 
        });
    }
});

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ────────────────────────────────────────────────────────────
// Start server
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  ensureLocalCredentialsFile();
  const credStatus = credentialsStatus();
  if (!credStatus.configured) {
    console.log(
      '\n[master-test] Test login not configured — live tests need billing app username + user code.\n' +
        '  Open the test viewer → Configure Test Login, or edit tools/billing-test.local.json\n' +
        '  (copy from tools/billing-test.local.example.json).\n'
    );
    if (credStatus.error) {
      console.log('  ' + credStatus.error + '\n');
    }
  }
  if (process.env.DEV_BILLING_SCENARIO === '1') {
    const base = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
    console.log('\n[DEV_BILLING_SCENARIO] Browser automation (login first, then open):\n');
    console.log(`  ${base}/index.html?devScenario=1`);
    console.log('Optional: copy public/dev-scenario.sample.json → public/dev-scenario.json to override defaults.\n');
    console.log(
      'Expanded scenario (check + May bill): Settings → Toggles → Testing Drawer ON, Skip POS initial register count ON.\n'
    );
    console.log('CLI helper: npm run dev:scenario-help\n');
  }
});
