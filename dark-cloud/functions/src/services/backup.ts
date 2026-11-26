import { createHash } from 'node:crypto';
import { FieldValue, Timestamp, GeoPoint, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { query } from '../core/registry';

export const BACKUP_COLLECTIONS = [
  'settings', 'users', 'invitations', 'exchange_rates', 'counters', 'accounting_periods', 'distributors', 'distributor_ledger', 'distributor_charges', 'batches', 'payments', 'payment_allocations',
  'collection_followups', 'expenses', 'suppliers', 'supplier_ledger', 'supplier_payments', 'purchases', 'inventory_items', 'warehouses', 'inventory_movements', 'assets', 'depreciation_entries',
  'cash_accounts', 'cash_transactions', 'cash_transfers', 'cash_vouchers', 'cash_reconciliations', 'journal_entries', 'approvals', 'tasks', 'task_comments', 'documents', 'audit_logs', 'security_events',
];

const enc = (v: unknown): unknown => {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, enc(x)]));
  return v;
};
const dec = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.__ts === 'number' && Object.keys(o).length === 1) return Timestamp.fromMillis(o.__ts);
    if (Array.isArray(o.__geo) && Object.keys(o).length === 1) return new GeoPoint(o.__geo[0] as number, o.__geo[1] as number);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, dec(x)]));
  }
  return v;
};

export interface Dump { meta: { format: 'dark-cloud-backup/v1'; createdAt: string; counts: Record<string, number>; checksum: string }; collections: Record<string, Record<string, unknown>> }
export const checksumOf = (collections: Dump['collections']) => createHash('sha256').update(JSON.stringify(collections)).digest('hex');

export async function exportDatabase(db: Firestore): Promise<Dump> {
  const collections: Dump['collections'] = {}; const counts: Record<string, number> = {};
  for (const c of BACKUP_COLLECTIONS) {
    const snap = await db.collection(c).orderBy('__name__').get();
    collections[c] = Object.fromEntries(snap.docs.map((d) => [d.id, enc(d.data())]));
    counts[c] = snap.size;
  }
  return { meta: { format: 'dark-cloud-backup/v1', createdAt: new Date().toISOString(), counts, checksum: checksumOf(collections) }, collections };
}

export function verifyDump(d: Dump): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (d.meta?.format !== 'dark-cloud-backup/v1') problems.push('صيغة غير معروفة');
  if (checksumOf(d.collections) !== d.meta.checksum) problems.push('البصمة (checksum) غير مطابقة — الملف تالف أو معدّل');
  for (const [c, n] of Object.entries(d.meta.counts)) if (Object.keys(d.collections[c] || {}).length !== n) problems.push(`عدد السجلات غير مطابق في ${c}`);
  return { ok: problems.length === 0, problems };
}

/** Restore into an EMPTY database only (refuses otherwise). Intended for recovery projects / emulators. */
export async function restoreDatabase(db: Firestore, d: Dump) {
  const v = verifyDump(d);
  if (!v.ok) throw new Error('BACKUP_INVALID: ' + v.problems.join('; '));
  for (const c of BACKUP_COLLECTIONS) if (!(await db.collection(c).limit(1).get()).empty) throw new Error(`TARGET_NOT_EMPTY: ${c}`);
  let batch = db.batch(); let n = 0;
  for (const [c, docs] of Object.entries(d.collections)) for (const [id, data] of Object.entries(docs)) {
    batch.set(db.collection(c).doc(id), dec(data) as Record<string, unknown>); n++;
    if (n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  return { restored: n };
}

/** Writes a logical backup to Cloud Storage and records it. */
export async function runBackup(db: Firestore, by: string) {
  const { getStorage } = await import('firebase-admin/storage');
  const dump = await exportDatabase(db);
  const body = JSON.stringify(dump);
  const path = `backups/${dump.meta.createdAt.replace(/[:.]/g, '-')}.json`;
  const file = getStorage().bucket(process.env.BACKUP_BUCKET || undefined).file(path);
  await file.save(body, { contentType: 'application/json', resumable: false });
  const [back] = await file.download();
  const verified = verifyDump(JSON.parse(back.toString('utf8')) as Dump);
  const ref = await db.collection('backups').add({ path, bucket: file.bucket.name, counts: dump.meta.counts, checksum: dump.meta.checksum, sizeBytes: Buffer.byteLength(body),
    verified: verified.ok, problems: verified.problems, by, at: FieldValue.serverTimestamp() });
  return { id: ref.id, path, verified: verified.ok, counts: dump.meta.counts };
}

query('backup.run', z.object({}), 'owner', async (ctx) => runBackup(ctx.db, ctx.actor.uid));
