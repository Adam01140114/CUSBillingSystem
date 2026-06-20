# MySQL Local Database Mode

This guide explains how to run the CUS Billing System against a **local MySQL database** instead of Firebase, and how to sync data between the two.

## Overview

| Mode | Data store | When to use |
|------|------------|-------------|
| **Online** (default) | Firebase Firestore | Production, shared access, hosted deployment |
| **Local** | MySQL on your Mac | Offline work, faster local testing, no Firebase reads/writes |

Switch modes in **Settings → System Toggles → Local database mode**. Sync buttons in the same panel copy data between Firebase and MySQL.

---

## 1. MySQL installation (Mac)

MySQL is installed via Homebrew:

```bash
brew install mysql
brew services start mysql
```

Verify it is running:

```bash
mysql -u root -e "SELECT VERSION();"
```

You should see a version like `9.6.0`.

### Optional: set a root password

By default Homebrew MySQL has **no root password** (localhost only). To secure it:

```bash
mysql_secure_installation
```

If you set a password, add it to your `.env` file (see below).

---

## 2. Database setup

The app creates the database and tables automatically on first use. You can also create the database manually:

```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS cus_billing_local CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### Environment variables (optional)

Add these to your project `.env` file if you need non-default settings:

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=cus_billing_local
```

Defaults match a standard Homebrew MySQL install with no password.

---

## 3. Running the app in local mode

Local mode requires **both** MySQL and the Node server (`server.js`), because the browser talks to MySQL through REST API routes on the server.

```bash
# Terminal 1 — ensure MySQL is running
brew services start mysql

# Terminal 2 — start the app server
npm start
```

Open the app (usually `http://localhost:3000` or whatever port your server uses).

1. Go to **Settings → System Toggles**
2. Turn on **Local database mode**
3. Confirm the reload prompt

The status line under the toggle shows whether MySQL is connected and how many documents are stored locally.

---

## 4. First-time sync (Firebase → Local)

When your local MySQL database is empty and you want a copy of production/test Firebase data:

1. Stay in **online mode** (or either mode — sync runs on the server)
2. Click **Sync Firebase → Local**
3. Confirm the dialog

This copies these collections from Firebase into MySQL:

- `customers`
- `locations`
- `codes`
- `users`
- `drawers`
- `settings`
- `billingCycles`
- `paymentBatches`
- `paymentProcessingSessions`
- `forms`

Existing local rows in those collections are **replaced** during sync.

4. Turn on **Local database mode** and reload
5. You should see the same customers, settings, drawers, etc. as Firebase

---

## 5. Pushing local changes back (Local → Firebase)

After working in local mode:

1. Click **Sync Local → Firebase**
2. Confirm — matching Firebase documents will be overwritten

Use this when you want to upload local test data or changes made offline.

---

## 6. How it works (architecture)

```
Browser (index.html)
    │
    ├─ Online mode  → Firebase SDK → Firestore
    │
    └─ Local mode   → local-db-shim.mjs → /api/local-db/* → mysql2 → MySQL
```

- **Mode selection** is stored in `localStorage` (`cusLocalDatabaseMode`) so the app knows which backend to use before loading settings.
- **Firestore-shaped storage**: each Firestore document becomes one MySQL row with JSON data (`firestore_documents` table).
- **Firebase Auth** still runs in local mode (for login/session compatibility); only **data** reads/writes go to MySQL.
- **Sync** uses Firebase Admin SDK on the server plus the MySQL module — it does not go through the browser shim.

---

## 7. Useful MySQL commands

Connect to the database:

```bash
mysql -u root cus_billing_local
```

Inspect stored documents:

```sql
SELECT collection_path, doc_id, updated_at
FROM firestore_documents
ORDER BY collection_path, doc_id;

SELECT COUNT(*) AS total FROM firestore_documents;

SELECT collection_path, COUNT(*) AS docs
FROM firestore_documents
GROUP BY collection_path;
```

View one document (example — toggles settings):

```sql
SELECT data FROM firestore_documents
WHERE collection_path = 'settings' AND doc_id = 'toggles';
```

Clear all local data (does not affect Firebase):

```sql
TRUNCATE TABLE firestore_documents;
```

---

## 8. Troubleshooting

### “Local mode is ON but MySQL is not reachable”

- Run `brew services start mysql`
- Run `npm start` (the API lives on the Node server)
- Check `.env` `MYSQL_*` values if you customized them

### Sync fails with Firebase errors

- Ensure Firebase Admin credentials are set in `.env` (`FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, etc.)
- Sync endpoints require the server to reach both Firebase and MySQL

### Changes don’t appear after switching modes

- Switching modes **reloads the page** — if it didn’t reload, toggle again and confirm
- After editing in local mode, data is only in MySQL until you sync to Firebase

### Stop MySQL

```bash
brew services stop mysql
```

---

## 9. Online deployment note

Hosted/production deployments should stay in **online mode** (Firebase). Local MySQL is intended for development on your Mac where MySQL and `npm start` are available. The sync buttons are useful for seeding a local copy or promoting tested local data back to Firebase.
