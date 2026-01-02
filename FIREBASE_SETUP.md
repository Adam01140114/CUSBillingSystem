# Firebase Authentication Setup Guide

This guide will help you set up Firebase Authentication to secure your Firestore data so only you can access it.

## Step 1: Enable Firebase Authentication

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `cus-billing-e84eb`
3. In the left sidebar, click **"Authentication"**
4. Click **"Get started"** if you haven't enabled it yet
5. Click on the **"Sign-in method"** tab
6. Click on **"Email/Password"**
7. Enable the **"Email/Password"** provider (toggle it ON)
8. Click **"Save"**

## Step 2: Create Your Admin User

You have two options:

### Option A: Create User via Firebase Console (Easiest)

1. In the Firebase Console, go to **Authentication** → **Users**
2. Click **"Add user"**
3. Enter your email (e.g., `admin@cus.com`)
4. Enter a password (choose a strong password)
5. Click **"Add user"**

### Option B: Create User Programmatically

You can create a user by running this in your browser console after the app loads:

```javascript
// This will only work if you temporarily enable anonymous auth or use Admin SDK
// Recommended: Use Option A instead
```

## Step 3: Update Login Credentials

1. Open `/public/login.html`
2. Find these lines (around line 156-157):
   ```javascript
   const FIREBASE_AUTH_EMAIL = 'admin@cus.com'; // Change this to your Firebase Auth email
   const FIREBASE_AUTH_PASSWORD = 'admin123'; // Change this to your Firebase Auth password
   ```
3. Update `FIREBASE_AUTH_EMAIL` with the email you created in Step 2
4. Update `FIREBASE_AUTH_PASSWORD` with the password you created in Step 2

## Step 4: Deploy Firestore Rules

1. Install Firebase CLI (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Deploy the updated Firestore rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

   Or if you're in the project directory:
   ```bash
   cd /Users/platnm/Desktop/CUSBillingSystem
   firebase deploy --only firestore:rules
   ```

## Step 5: Test the Setup

1. Make sure you're logged out (clear localStorage if needed)
2. Go to your login page
3. Enter your password
4. The app should now:
   - Verify your password with the server
   - Sign you in with Firebase Authentication
   - Allow access to Firestore data

## How It Works

1. **Custom Password Check**: Your existing password system (`/api/verify-password`) still works and protects the UI
2. **Firebase Auth**: After password verification, the app signs you in with Firebase Authentication
3. **Firestore Security**: The Firestore rules now require Firebase Authentication to access any data
4. **Double Protection**: Both your custom password AND Firebase Auth must succeed for access

## Troubleshooting

### Error: "Firebase: Error (auth/user-not-found)"
- Make sure you created the user in Firebase Console (Step 2)
- Verify the email matches exactly (case-sensitive)

### Error: "Firebase: Error (auth/wrong-password)"
- Verify the password is correct
- Check that you updated `FIREBASE_AUTH_PASSWORD` in `login.html`

### Error: "Missing or insufficient permissions" when accessing Firestore
- Make sure you deployed the Firestore rules (Step 4)
- Check that Firebase Auth is working (look for `[FIREBASE AUTH] Successfully signed in` in console)

### Firestore rules not updating
- Make sure you ran `firebase deploy --only firestore:rules`
- Wait a few seconds for rules to propagate
- Check Firebase Console → Firestore → Rules to verify the rules are updated

## Security Notes

- Your Firestore data is now protected by Firebase Authentication
- Only users who can sign in with Firebase Auth can access the data
- The custom password system provides an additional layer of security
- Keep your Firebase Auth credentials secure (don't commit passwords to git)

## Next Steps (Optional)

For even better security, you could:
1. Use Firebase Custom Claims to restrict access to specific users
2. Set up Firebase App Check to prevent abuse
3. Use Firebase Hosting with proper security headers
4. Enable 2FA for your Firebase account

