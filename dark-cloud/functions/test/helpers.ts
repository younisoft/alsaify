import { randomUUID } from 'node:crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { runAction, type Caller } from '../src/core/api';
import '../src/services/approvals';
import '../src/services/team';
import '../src/services/distribution';
import '../src/services/finance';
import '../src/services/reports';
import '../src/services/backup';
import { emailKey } from '../src/services/team';
import { fromMinor } from '@dc/shared';

export const PROJECT = process.env.GCLOUD_PROJECT || 'demo-darkcloud';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run via the Firestore emulator (npm run test:emulator) — refusing to touch a real project');

export function testDb(databaseId?: string): Firestore {
  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT });
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}
export async function resetDb(databaseId = '(default)') {
  const r = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/${databaseId}/documents`, { method: 'DELETE' });
  if (!r.ok) throw new Error('reset failed ' + r.status);
}

// Fictitious test identities (example.test is a reserved, non-routable domain). Real team emails are never invented.
export const IDS = {
  owner: { uid: 'u-tuhaib', email: 'gm@example.test', emailVerified: true, name: 'توهيب' },
  azzam: { uid: 'u-azzam', email: 'azzam@example.test', emailVerified: true, name: 'عزام' },
  ashbat: { uid: 'u-ashbat', email: 'ashbat@example.test', emailVerified: true, name: 'الأشبط' },
  dahman: { uid: 'u-dahman', email: 'dahman@example.test', emailVerified: true, name: 'دهمان' },
  portal: { uid: 'u-portal', email: 'dahman-portal@example.test', emailVerified: true, name: 'بوابة دهمان' },
  stranger: { uid: 'u-x', email: 'stranger@example.test', emailVerified: true, name: 'غريب' },
};

export const call = (db: Firestore, who: Caller, action: string, input: unknown = {}, requestId: string = randomUUID()) =>
  runAction(db, who, action, input, requestId) as Promise<any>;

export async function bootstrapOwner(db: Firestore) {
  await db.collection('invitations').doc(emailKey(IDS.owner.email)).set({ email: IDS.owner.email, displayName: 'المهندس توهيب السيفي', kind: 'owner', positions: ['المدير العام'], permissions: {}, status: 'pending' });
  const r = await call(db, IDS.owner, 'auth.claimInvitation');
  if (!r.authorized) throw new Error('owner bootstrap failed');
}
export async function invite(db: Firestore, who: Caller, kind: 'member' | 'portal', permissions: Record<string, string[]>, extra: Record<string, unknown> = {}) {
  await call(db, IDS.owner, 'team.invite', { email: who.email, displayName: who.name, kind, permissions, positions: [], ...extra });
  return call(db, who, 'auth.claimInvitation');
}
export const Y = (minor: number) => fromMinor(minor);
export const get = async (db: Firestore, col: string, id: string) => ({ ...(await db.collection(col).doc(id).get()).data(), id }) as any;
export { emailKey };
