# How to Create Admin User and Restrict Access

## Step 1: Enable Firebase Authentication

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `cus-billing-e84eb`
3. Click **"Authentication"** in the left sidebar
4. Click **"Get started"** if not enabled
5. Go to **"Sign-in method"** tab
6. Click **"Email/Password"**
7. Enable it and click **"Save"**

## Step 2: Create Admin User

1. In Firebase Console, go to **Authentication** → **Users**
2. Click **"Add user"** button
3. Enter your email (e.g., `admin@cus.com`)
4. Enter a password (choose a strong password)
5. Click **"Add user"**
6. **IMPORTANT**: Copy the **User UID** that appears (it looks like: `abc123xyz456...`)

## Step 3: Get Your User UID

After creating the user, you'll see the UID in the Users list. It's a long string like:
```
aBc123XyZ456DeF789GhI012JkL345MnO678PqR
```

**Copy this UID** - you'll need it for the rules.

## Step 4: Update Firestore Rules

Replace `YOUR_ADMIN_UID_HERE` in the rules below with your actual UID from Step 3.

