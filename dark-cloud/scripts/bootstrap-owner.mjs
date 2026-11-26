#!/usr/bin/env node
/**
 * One-time creation of the General Manager invitation (the ONLY way an owner account can exist).
 * Usage:
 *   node scripts/bootstrap-owner.mjs --project <firebase-project-id> --email <gm-google-email> --name "المهندس توهيب السيفي"
 * Production: run with Application Default Credentials of a project admin (gcloud auth application-default login).
 * Emulator:   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 node scripts/bootstrap-owner.mjs --project demo-darkcloud --email gm@example.test --name GM
 * The GM then signs in with Google using that exact email; the server activates the account and creates default settings.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const project = arg('project'), email = arg('email')?.trim().toLowerCase(), name = arg('name') || 'المدير العام', database = arg('database');
if (!project || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Usage: --project <id> --email <gm email> [--name <name>] [--database <id>]'); process.exit(1); }
const app = initializeApp({ projectId: project });
const db = database ? getFirestore(app, database) : getFirestore(app);
const owners = await db.collection('users').where('kind', '==', 'owner').limit(1).get();
if (!owners.empty) { console.error('An owner account already exists — refusing.'); process.exit(2); }
const key = email.replace(/[^a-z0-9]/g, '_');
const ref = db.collection('invitations').doc(key);
await db.runTransaction(async (t) => {
  const s = await t.get(ref);
  if (s.exists && s.data().status === 'pending') throw new Error('A pending invitation already exists for this email');
  t.set(ref, { email, displayName: name, kind: 'owner', positions: ['المدير العام'], permissions: {}, status: 'pending', invitedBy: 'bootstrap-script', createdAt: FieldValue.serverTimestamp() });
});
console.log(`Owner invitation created for ${email} in project ${project}${process.env.FIRESTORE_EMULATOR_HOST ? ' (EMULATOR)' : ''}. Sign in with Google using this email.`);
