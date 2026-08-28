import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  signInAnonymously,
  onAuthStateChanged,
  type Auth,
  type User,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Initialized lazily, on first use in the browser. Doing this at module scope
 * breaks `next build`, because the page is prerendered on the server where the
 * Firebase config isn't meaningful.
 */
function app(): FirebaseApp {
  if (!firebaseConfig.apiKey) {
    throw new Error(
      "Firebase config is missing. Copy .env.local.example to .env.local, fill it in, and restart the dev server.",
    );
  }
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

let authInstance: Auth | null = null;

/**
 * Persistence is set explicitly. Without it, some browsers fall back to
 * in-memory auth, which mints a brand-new anonymous uid on every page load —
 * and since contacts live under users/{uid}/contacts, the list reads as empty
 * after a refresh even though the old docs are still in Firestore.
 */
export function getAuthClient(): Auth {
  if (authInstance) return authInstance;
  const a = app();
  try {
    authInstance = initializeAuth(a, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch {
    // Already initialized (e.g. React strict-mode double-invoke, or HMR).
    authInstance = getAuth(a);
  }
  return authInstance;
}

export function getDb(): Firestore {
  return getFirestore(app());
}

/**
 * Resolves once we have a signed-in (anonymous) user.
 * Judges will not create an account, so anonymous auth is the default and only path.
 */
export function ensureUser(): Promise<User> {
  return new Promise((resolve, reject) => {
    const auth = getAuthClient();
    const unsub = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsub();
          resolve(user);
          return;
        }
        signInAnonymously(auth).catch(reject);
      },
      reject,
    );
  });
}
