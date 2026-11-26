import { describe, it, expect, beforeAll } from 'vitest';
import { testDb, resetDb, IDS, call, bootstrapOwner, invite, get } from './helpers';

const db = testDb();
const O = IDS.owner;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());
let cash = '', distDahman = '', distOther = '';

beforeAll(async () => {
  await resetDb();
  await bootstrapOwner(db);
  cash = (await call(db, O, 'cash.createAccount', { name: 'صندوق', type: 'cash', currency: 'YER', openingBalance: 1_000_000, openingDate: today })).id;
  // Dahman's DISTRIBUTOR financial identity: an ordinary distributor record, not linked to his employee account
  distDahman = (await call(db, O, 'distributors.create', { name: 'دهمان (موزع)', phone: '774000005', startDate: today })).id;
  distOther = (await call(db, O, 'distributors.create', { name: 'موزع آخر', phone: '775000006', startDate: today })).id;
  // Explicit, individual permissions — nothing financial by default
  await invite(db, IDS.azzam, 'member', { tasks: ['view', 'create'], inventory: ['view'] }, { positions: ['صيانة فنية'] });
  await invite(db, IDS.ashbat, 'member', { tasks: ['view'] }, { positions: ['صيانة فنية'] });
  await invite(db, IDS.dahman, 'member', { tasks: ['view'], batches: ['view', 'create'], distributors: ['view'], payments: ['view', 'create', 'cancel'] }, { positions: ['موزع', 'صيانة فنية'] });
});

describe('Team & permission enforcement (server-side)', () => {
  it('General Manager has full access', async () => {
    const r = await call(db, O, 'reports.reconcile');
    expect(r.ok).toBe(true);
  });
  it('Azzam only has his assigned permissions', async () => {
    await expect(call(db, IDS.azzam, 'tasks.upsert', { title: 'جرد المخزن' })).resolves.toBeTruthy();
    await expect(call(db, IDS.azzam, 'inventory.createItem', { name: 'x', unit: 'قطعة' })).rejects.toThrow(/صلاحية/);
    await expect(call(db, IDS.azzam, 'payments.create', { distributorId: distOther, date: today, amount: 5, currency: 'YER', methodId: 'cash', cashAccountId: cash, allocation: { mode: 'none' } })).rejects.toThrow(/صلاحية/);
    await expect(call(db, IDS.azzam, 'reports.dashboard', {})).rejects.toThrow(/صلاحية/);
  });
  it('Al-Ashbat does not inherit Azzam\'s permissions', async () => {
    await expect(call(db, IDS.ashbat, 'tasks.upsert', { title: 'x' })).rejects.toThrow(/صلاحية/);
    const u = await get(db, 'users', IDS.ashbat.uid);
    expect(u.permissions).toEqual({ tasks: ['view'] });
  });
  it('Dahman: employee permissions and distributor account are separate', async () => {
    const u = await get(db, 'users', IDS.dahman.uid);
    expect(u.portalDistributorId).toBeNull();
    expect(u.positions).toEqual(['موزع', 'صيانة فنية']);
    // he can record a batch, but cannot finalize (approve) it — not even for his own distributor record
    const b = await call(db, IDS.dahman, 'batches.create', { distributorId: distDahman, deliveryDate: today, lines: [{ categoryId: 'c200', quantity: 10 }] });
    await expect(call(db, IDS.dahman, 'batches.finalize', { id: b.id, settlementDate: today })).rejects.toThrow(/صلاحية/);
    // custom unit price / special commission need approval rights
    await expect(call(db, IDS.dahman, 'batches.create', { distributorId: distDahman, deliveryDate: today, lines: [{ categoryId: 'c200', quantity: 10, unitPrice: 1 }] })).rejects.toThrow(/الاعتماد/);
    await expect(call(db, IDS.dahman, 'team.updateUser', { uid: IDS.dahman.uid, permissions: { settings: ['manage'] } })).rejects.toThrow(/مدير العام/);
  });
  it('sensitive cancellation by a member becomes an approval request; self-approval is blocked; GM approves', async () => {
    const p = await call(db, IDS.dahman, 'payments.create', { distributorId: distDahman, date: today, amount: 1000, currency: 'YER', methodId: 'cash', cashAccountId: cash, allocation: { mode: 'none', items: [] } });
    const r = await call(db, IDS.dahman, 'payments.cancel', { id: p.id, reason: 'خطأ' });
    expect(r.executed).toBe(false);
    expect((await get(db, 'payments', p.id)).status).toBe('posted');
    await expect(call(db, IDS.dahman, 'approvals.decide', { id: r.approvalId, decision: 'approve' })).rejects.toThrow();
    await call(db, O, 'approvals.decide', { id: r.approvalId, decision: 'approve', note: 'موافق' });
    expect((await get(db, 'payments', p.id)).status).toBe('cancelled');
    await expect(call(db, O, 'approvals.decide', { id: r.approvalId, decision: 'approve' })).rejects.toThrow(/مسبقاً/);
  });
  it('suspended accounts cannot perform new operations', async () => {
    await call(db, O, 'team.setStatus', { uid: IDS.azzam.uid, status: 'suspended', reason: 'اختبار' });
    await expect(call(db, IDS.azzam, 'tasks.upsert', { title: 'x' })).rejects.toThrow(/موقوف/);
    await call(db, O, 'team.setStatus', { uid: IDS.azzam.uid, status: 'active', reason: 'إعادة' });
  });
  it('unapproved users cannot access and the attempt is logged + GM notified', async () => {
    const r = await call(db, IDS.stranger, 'auth.claimInvitation');
    expect(r.authorized).toBe(false);
    await expect(call(db, IDS.stranger, 'reports.dashboard', {})).rejects.toThrow(/غير مصرح/);
    expect((await db.collection('security_events').where('uid', '==', IDS.stranger.uid).get()).size).toBeGreaterThan(0);
    expect((await db.collection('notifications').where('uid', '==', O.uid).where('type', '==', 'security').get()).size).toBeGreaterThan(0);
  });
  it('unverified email cannot claim an invitation', async () => {
    await call(db, O, 'team.invite', { email: 'unverified@example.test', displayName: 'x', kind: 'member', permissions: {} });
    const r = await call(db, { uid: 'u-unv', email: 'unverified@example.test', emailVerified: false }, 'auth.claimInvitation');
    expect(r.authorized).toBe(false);
  });
  it('only the GM may invite / change permissions', async () => {
    await expect(call(db, IDS.dahman, 'team.invite', { email: 'z@example.test', displayName: 'z', kind: 'member', permissions: { payments: ['approve'] } })).rejects.toThrow(/مدير العام/);
  });
  it('distributor portal: isolated to its own distributor and only when enabled', async () => {
    await invite(db, IDS.portal, 'portal', {}, { portalDistributorId: distDahman });
    await expect(call(db, IDS.portal, 'reports.distributorStatement', { id: distDahman })).rejects.toThrow(); // portal disabled
    await call(db, O, 'settings.update', { section: 'system', data: { portalEnabled: true } });
    const own = await call(db, IDS.portal, 'reports.distributorStatement', { id: distDahman });
    expect(own.distributor.id).toBe(distDahman);
    await expect(call(db, IDS.portal, 'reports.distributorStatement', { id: distOther })).rejects.toThrow(/صلاحية/);
    await expect(call(db, IDS.portal, 'payments.create', { distributorId: distDahman, date: today, amount: 5, currency: 'YER', methodId: 'cash', cashAccountId: cash, allocation: { mode: 'none' } })).rejects.toThrow(/صلاحية/);
  });
  it('finance settings: GM only', async () => {
    await call(db, O, 'team.updateUser', { uid: IDS.ashbat.uid, permissions: { settings: ['view', 'manage'] } });
    await expect(call(db, IDS.ashbat, 'settings.update', { section: 'finance', data: { defaultCommissionPct: 50 } })).rejects.toThrow(/للمدير العام/);
    await expect(call(db, IDS.ashbat, 'settings.update', { section: 'company', data: { phone: '777' } })).resolves.toBeTruthy();
  });
  it('every action leaves an audit record attributed to the real user id', async () => {
    const logs = await db.collection('audit_logs').where('uid', '==', IDS.dahman.uid).get();
    expect(logs.size).toBeGreaterThan(0);
  });
  it('unknown actions and malformed request ids are rejected', async () => {
    await expect(call(db, O, 'payments.delete', {})).rejects.toThrow(/غير معروفة/);
    const { runAction } = await import('../src/core/api');
    await expect(runAction(db, O, 'me.get', {}, 'x')).rejects.toThrow(/الطلب/);
    await expect(runAction(db, null, 'me.get', {}, 'abcdefgh1')).rejects.toThrow(/تسجيل الدخول/);
  });
});
