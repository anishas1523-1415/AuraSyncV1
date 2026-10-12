import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from "firebase/auth";
import { isMobileApp } from "@/lib/api";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
};

const enabled = !!firebaseConfig.apiKey;
const isFirstInit = enabled && getApps().length === 0;
const app = enabled ? (isFirstInit ? initializeApp(firebaseConfig) : getApp()) : null;
const inBrowser = typeof window !== "undefined";

// Accounts (Firebase Authentication). In the Android app the sign-in session is kept in
// IndexedDB and no popup/redirect helper is loaded (those need browser windows the app's WebView
// doesn't have); Google sign-in there goes through the native account picker instead.
const createAuth = () => {
  if (!app || !inBrowser) return null;
  if (!isMobileApp) return getAuth(app);
  try {
    return initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  } catch (e) {
    return getAuth(app); // already initialised (e.g. after a hot reload)
  }
};

// Library sync (Cloud Firestore). Long polling is picked automatically where streaming is blocked.
const createFirestore = () => {
  if (!app) return null;
  try {
    return initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch (e) {
    return getFirestore(app);
  }
};

export const firebaseApp = app;
export const auth = createAuth();
export const db = createFirestore();
export const rtdb = app ? getDatabase(app) : null;
export const isFirebaseActive = !!app;
