#!/usr/bin/env node
/**
 * Prints the default develop-test JSON and how to run the scenario.
 * Full billing logic runs in the browser (Firestore + PDF); the server only serves static files.
 */
const fs = require('fs');
const path = require('path');
const samplePath = path.join(__dirname, '..', 'public', 'dev-scenario.sample.json');
const text = fs.readFileSync(samplePath, 'utf8');
console.log('--- Default dev-scenario JSON (also in public/dev-scenario.sample.json) ---\n');
console.log(text);
console.log('--- How to run ---\n');
console.log('1. npm start   (or npm run start:dev-scenario for the URL hint on boot)\n');
console.log('2. Log in, go to Accounts (home).\n');
console.log('3. Either:\n');
console.log('   A) Press Ctrl+CapsLock (Windows/Linux) or Cmd+CapsLock (macOS), paste JSON, Run.\n');
console.log('   B) Copy this file to public/dev-scenario.json (optional edits), then open:\n');
console.log('      http://localhost:8000/index.html?devScenario=1\n');
console.log('4. Results: new tab with plain text; also inspect window.__DEVELOP_TEST_LAST_RESULT in DevTools.\n');
console.log('advanceMode: "instant" (default) or "walk" (uses the same day-by-day overlay as the date picker).\n');
console.log('After Jan–Apr bills: $75 check (default #123) via Testing Drawer, then 5/1 + bill — requires Settings → Toggles:\n');
console.log('  Testing Drawer ON, Skip POS initial register count ON. Set skipCheckPaymentMay: true to skip that block.\n');
console.log('--- Headless (Node writes test-results.txt) ---\n');
console.log('  Terminal 1: npm start\n');
console.log('  npm install && npx playwright install chromium   # once per machine\n');
console.log('  export FIREBASE_TEST_EMAIL="..." FIREBASE_TEST_PASSWORD="..."\n');
console.log('  npm run test:billing-scenario:local   # uses tools/billing-test.local.json (gitignored) or env vars\n');
console.log('  → writes ./test-results.txt (override with OUTPUT_PATH=...)\n');
