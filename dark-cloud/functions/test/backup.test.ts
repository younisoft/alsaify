import { describe, it, expect, beforeAll } from 'vitest';
import { testDb, resetDb, IDS, call, bootstrapOwner } from './helpers';
import { exportDatabase, restoreDatabase, verifyDump } from '../src/services/backup';
import { reconcile } from '../src/services/reports';
import { runDailyScan } from '../src/services/scan';

const db = testDb();
const restoreDb = testDb('restore-test');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());

beforeAll(async () => {
  await resetDb(); await resetDb('restore-test');
  await bootstrapOwner(db);
  const cash = (await call(db, IDS.owner, 'cash.createAccount', { name: 'صندوق', type: 'cash', currency: 'YER', openingBalance: 300000, openingDate: today })).id;
  const d = (await call(db, IDS.owner, 'distributors.create', { name: 'موزع نسخ احتياطي', phone: '776000007', startDate: today })).id;
  const b = (await call(db, IDS.owner, 'batches.create', { distributorId: d, deliveryDate: today, lines: [{ categoryId: 'c1000', quantity: 50 }] })).id;
  await call(db, IDS.owner, 'batches.finalize', { id: b, settlementDate: today });
  await call(db, IDS.owner, 'payments.create', { distributorId: d, date: today, amount: 20000, currency: 'YER', methodId: 'cash', cashAccountId: cash, allocation: { mode: 'fifo', items: [] } });
  await call(db, IDS.owner, 'tasks.upsert', { title: 'مهمة متأخرة', dueDate: '2026-01-01', assigneeUid: IDS.owner.uid });
});

describe('Backup & recovery (logical export → verify → restore into an empty database)', () => {
  it('export has counts + sha256 and verifies', async () => {
    const dump = await exportDatabase(db);
    expect(dump.meta.counts.journal_entries).toBeGreaterThan(0);
    expect(verifyDump(dump).ok).toBe(true);
  });
  it('tampered backup is detected', async () => {
    const dump = await exportDatabase(db);
    const first = Object.keys(dump.collections.payments)[0];
    (dump.collections.payments[first] as any).baseMinor = 1;
    expect(verifyDump(dump).ok).toBe(false);
  });
  it('restore reproduces identical data and books still reconcile; refuses a non-empty target', async () => {
    const dump = await exportDatabase(db);
    const r = await restoreDatabase(restoreDb, dump);
    expect(r.restored).toBe(Object.values(dump.meta.counts).reduce((a, b) => a + b, 0));
    const again = await exportDatabase(restoreDb);
    expect(again.meta.checksum).toBe(dump.meta.checksum);
    expect((await reconcile(restoreDb)).ok).toBe(true);
    await expect(restoreDatabase(restoreDb, dump)).rejects.toThrow(/TARGET_NOT_EMPTY/);
  });
});

describe('Daily alert scan', () => {
  it('creates de-duplicated notifications (overdue task)', async () => {
    const a = await runDailyScan(db);
    const b = await runDailyScan(db);
    expect(a.notifications).toBeGreaterThan(0);
    expect(b.notifications).toBe(a.notifications);
    const n = await db.collection('notifications').where('type', '==', 'task_overdue').get();
    expect(n.size).toBe(1);
  });
});
