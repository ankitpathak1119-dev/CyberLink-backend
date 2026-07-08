const admin = require("firebase-admin");

function buildCredentialFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      return admin.credential.cert(parsed);
    } catch (error) {
      console.warn("Invalid FIREBASE_SERVICE_ACCOUNT_JSON. Firebase disabled.");
      return null;
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (projectId && clientEmail && privateKey) {
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    });
  }

  return null;
}

function initializeFirebase() {
  if (admin.apps.length > 0) {
    return true;
  }

  const credential = buildCredentialFromEnv();

  if (!credential) {
    console.warn("Firebase credentials not found. FCM notifications disabled.");
    return false;
  }

  try {
    admin.initializeApp({ credential });
    console.log("Firebase Admin initialized.");
    return true;
  } catch (error) {
    console.warn(`Firebase init failed: ${error.message}`);
    return false;
  }
}

module.exports = initializeFirebase;
