import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator, memoryLocalCache } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

const env = import.meta.env;
export const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true';
if (!env.VITE_FIREBASE_PROJECT_ID) throw new Error('VITE_FIREBASE_PROJECT_ID is not configured — see web/.env.example');

export const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, appId: env.VITE_FIREBASE_APP_ID,
});
if (env.VITE_APPCHECK_SITE_KEY && !USE_EMULATORS) initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });

export const auth = getAuth(app);
// Memory-only cache: financial records are never persisted on the phone/PC disk (lost when the app closes).
export const db = initializeFirestore(app, { localCache: memoryLocalCache() },
  env.VITE_FIRESTORE_DATABASE_ID && env.VITE_FIRESTORE_DATABASE_ID !== '(default)' ? env.VITE_FIRESTORE_DATABASE_ID : undefined);
export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || 'europe-west1');
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}
