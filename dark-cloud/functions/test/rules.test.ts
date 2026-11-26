/**
 * Firestore rules — re-run of the 35 scenarios from the Phase-1 audit, adapted to the new
 * architecture (clients read-only), plus new cases. Uses @firebase/rules-unit-testing.
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, addDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const ctx = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();

beforeAll(async () => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-rules', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'), host, port: +port } });
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'settings/main'), { system: { portalEnabled: true } });
    await setDoc(doc(db, 'users/owner'), { kind: 'owner', status: 'active', permissions: {} });
    await setDoc(doc(db, 'users/dep'), { kind: 'member', status: 'active', permissions: { distributors: ['view'], tasks: ['view'] } });
    await setDoc(doc(db, 'users/none'), { kind: 'member', status: 'active', permissions: {} });
    await setDoc(doc(db, 'users/off'), { kind: 'member', status: 'suspended', permissions: { distributors: ['view'] } });
    await setDoc(doc(db, 'users/portal'), { kind: 'portal', status: 'active', permissions: {}, portalDistributorId: 'D0001' });
    await setDoc(doc(db, 'distributors/D0001'), { code: 'D0001', bal: { ledger: 1 } });
    await setDoc(doc(db, 'distributors/D0002'), { code: 'D0002', bal: { ledger: 2 } });
    await setDoc(doc(db, 'batches/b1'), { distributorId: 'D0001', status: 'open' });
    await setDoc(doc(db, 'batches/b2'), { distributorId: 'D0002', status: 'open' });
    await setDoc(doc(db, 'payments/p1'), { distributorId: 'D0001' });
    await setDoc(doc(db, 'audit_logs/a1'), { uid: 'dep' });
    await setDoc(doc(db, 'notifications/n1'), { uid: 'dep' });
    await setDoc(doc(db, 'notifications/n2'), { uid: 'owner' });
    await setDoc(doc(db, 'tasks/t1'), { assigneeUid: 'none', createdBy: 'owner' });
    await setDoc(doc(db, 'approvals/ap1'), { module: 'payments', requestedBy: 'none' });
    await setDoc(doc(db, 'journal_entries/j1'), { lines: [] });
  });
});
afterAll(async () => env?.cleanup());

describe('Phase-1 scenarios re-run (old attack → new outcome)', () => {
  it('anonymous cannot read', () => assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'distributors'))));
  it('signed-in user without an account doc cannot read', () => assertFails(getDocs(collection(ctx('stranger'), 'distributors'))));
  it('suspended member cannot read', () => assertFails(getDocs(collection(ctx('off'), 'distributors'))));
  it('member with distributors.view can list distributors', () => assertSucceeds(getDocs(collection(ctx('dep'), 'distributors'))));
  it('member without permission cannot list distributors', () => assertFails(getDocs(collection(ctx('none'), 'distributors'))));
  it('member cannot list team', () => assertFails(getDocs(collection(ctx('dep'), 'users'))));
  it('member can read own user doc only', async () => { await assertSucceeds(getDoc(doc(ctx('dep'), 'users/dep'))); await assertFails(getDoc(doc(ctx('dep'), 'users/owner'))); });
  it('member cannot promote self', () => assertFails(updateDoc(doc(ctx('dep'), 'users/dep'), { kind: 'owner' })));
  it('even the owner cannot write directly (server API only)', () => assertFails(setDoc(doc(ctx('owner'), 'settings/main'), { x: 1 })));
  it('distributor create with absurd opening balance — direct write denied', () => assertFails(setDoc(doc(ctx('dep'), 'distributors/D900'), { openingBalanceMinor: -999999999 })));
  it('duplicate distributor code — direct write denied', () => assertFails(setDoc(doc(ctx('owner'), 'distributors/ZZZ'), { code: 'D0001' })));
  it('commission change — direct write denied', () => assertFails(updateDoc(doc(ctx('owner'), 'distributors/D0001'), { commissionPct: 50 })));
  it('finished delivery with 100% commission — direct write denied', () => assertFails(setDoc(doc(ctx('owner'), 'batches/x'), { status: 'finalized', commissionPct: 100 })));
  it('edit finalized/open delivery — direct write denied', () => assertFails(updateDoc(doc(ctx('owner'), 'batches/b1'), { status: 'finalized' })));
  it('payment of 1e9 for unknown distributor — direct write denied', () => assertFails(addDoc(collection(ctx('owner'), 'payments'), { distributorId: 'NOPE', baseMinor: 1e11 })));
  it('payment delete — denied', () => assertFails(deleteDoc(doc(ctx('owner'), 'payments/p1'))));
  it('expense with negative rate — direct write denied', () => assertFails(addDoc(collection(ctx('owner'), 'expenses'), { rate: -5 })));
  it('distributor delete (orphans) — denied', () => assertFails(deleteDoc(doc(ctx('owner'), 'distributors/D0001'))));
  it('team doc with mismatched email — direct write denied', () => assertFails(setDoc(doc(ctx('owner'), 'invitations/x'), { email: 'victim@example.test' })));
  it('audit logs cannot be written or deleted by anyone', async () => { await assertFails(addDoc(collection(ctx('owner'), 'audit_logs'), { x: 1 })); await assertFails(deleteDoc(doc(ctx('owner'), 'audit_logs/a1'))); });
  it('audit logs readable only with audit.view', async () => { await assertFails(getDoc(doc(ctx('dep'), 'audit_logs/a1'))); await assertSucceeds(getDoc(doc(ctx('owner'), 'audit_logs/a1'))); });
  it('idempotency & counters are private', async () => { await assertFails(getDoc(doc(ctx('owner'), 'counters/receipt'))); await assertFails(setDoc(doc(ctx('owner'), 'counters/receipt'), { value: 0 })); });
  it('journal readable only with reports.view', async () => { await assertFails(getDoc(doc(ctx('dep'), 'journal_entries/j1'))); await assertSucceeds(getDoc(doc(ctx('owner'), 'journal_entries/j1'))); });
});

describe('Portal isolation', () => {
  it('portal reads own distributor', () => assertSucceeds(getDoc(doc(ctx('portal'), 'distributors/D0001'))));
  it('portal cannot read another distributor', () => assertFails(getDoc(doc(ctx('portal'), 'distributors/D0002'))));
  it('portal can query own batches', () => assertSucceeds(getDocs(query(collection(ctx('portal'), 'batches'), where('distributorId', '==', 'D0001')))));
  it('portal cannot list all batches', () => assertFails(getDocs(collection(ctx('portal'), 'batches'))));
  it('portal cannot read other distributor batch', () => assertFails(getDoc(doc(ctx('portal'), 'batches/b2'))));
  it('portal reads own payments only', async () => { await assertSucceeds(getDocs(query(collection(ctx('portal'), 'payments'), where('distributorId', '==', 'D0001')))); });
  it('portal cannot read expenses/cash', async () => { await assertFails(getDocs(collection(ctx('portal'), 'expenses'))); await assertFails(getDocs(collection(ctx('portal'), 'cash_accounts'))); });
});

describe('Personal data', () => {
  it('notifications: own only', async () => { await assertSucceeds(getDoc(doc(ctx('dep'), 'notifications/n1'))); await assertFails(getDoc(doc(ctx('dep'), 'notifications/n2'))); });
  it('tasks: assignee can read task without tasks.view', () => assertSucceeds(getDoc(doc(ctx('none'), 'tasks/t1'))));
  it('approvals: requester can read own request; non-approver others cannot', async () => { await assertSucceeds(getDoc(doc(ctx('none'), 'approvals/ap1'))); await assertFails(getDoc(doc(ctx('dep'), 'approvals/ap1'))); });
  it('security events: owner only', async () => { await assertFails(getDocs(collection(ctx('dep'), 'security_events'))); await assertSucceeds(getDocs(collection(ctx('owner'), 'security_events'))); });
});
