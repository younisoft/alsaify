import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function adminApp() {
  return getApps()[0] ?? initializeApp();
}
let _db: Firestore | null = null;
export function db(): Firestore {
  if (!_db) {
    const id = process.env.FIRESTORE_DATABASE_ID;
    _db = id ? getFirestore(adminApp(), id) : getFirestore(adminApp());
  }
  return _db;
}
