import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { can, creditExposure, todayISO, addDays, formatMoney, DEFAULT_SETTINGS, type Action, type Module, type Settings, type UserProfile } from '@dc/shared';

/** Daily alert scan (runs on a schedule; also callable from tests). Notifications are de-duplicated per day. */
export async function runDailyScan(db: Firestore, now = new Date()) {
  const today = todayISO(now);
  const s = (await db.collection('settings').doc('main').get()).data() as Partial<Settings> | undefined;
  const fin = { ...DEFAULT_SETTINGS.finance, ...s?.finance }; const sys = { ...DEFAULT_SETTINGS.system, ...s?.system };
  const users = (await db.collection('users').where('status', '==', 'active').get()).docs.map((d) => ({ ...(d.data() as UserProfile), uid: d.id }));
  const batch = db.batch(); let count = 0;
  const push = (uid: string, key: string, title: string, body: string, link: string, type: string) => {
    batch.set(db.collection('notifications').doc(`${uid}_${key}_${today}`), { uid, type, title, body, link, read: false, at: FieldValue.serverTimestamp(), date: today }); count++;
  };
  const toPerm = (m: Module, a: Action, key: string, title: string, body: string, link: string, type: string) => { for (const u of users) if (can(u, m, a)) push(u.uid, key, title, body, link, type); };
  const get = async (q: FirebaseFirestore.Query) => (await q.get()).docs.map((d) => ({ ...d.data(), id: d.id }) as Record<string, any>);

  for (const t of await get(db.collection('tasks').where('status', 'in', ['new', 'assigned', 'in_progress', 'review'])))
    if (t.dueDate && t.dueDate < today) for (const uid of new Set([t.assigneeUid, t.createdBy].filter(Boolean))) push(uid, `task_${t.id}`, 'مهمة متأخرة', `${t.title} — موعدها ${t.dueDate}`, '/tasks', 'task_overdue');
  if (sys.lowStockAlerts) for (const it of await get(db.collection('inventory_items').where('status', '==', 'active')))
    if ((it.qtyTotal || 0) < (it.minQuantity || 0)) toPerm('inventory', 'view', `low_${it.id}`, 'انخفاض المخزون', `${it.name}: ${it.qtyTotal} (الحد الأدنى ${it.minQuantity})`, '/inventory', 'low_stock');
  const overdueBefore = addDays(today, -sys.overdueReceivableDays);
  const overdue = (await get(db.collection('batches').where('allocOpen', '==', true))).filter((b) => b.settlementDate < overdueBefore);
  const perDist = new Map<string, { name: string; amount: number }>();
  for (const b of overdue) { const r = perDist.get(b.distributorId) ?? { name: b.distributorName, amount: 0 }; r.amount += b.netMinor - b.paidMinor; perDist.set(b.distributorId, r); }
  for (const [id, r] of perDist) toPerm('collection', 'view', `overdue_${id}`, 'مستحقات متأخرة', `${r.name}: ${formatMoney(r.amount)} ريال متأخرة أكثر من ${sys.overdueReceivableDays} يوماً`, `/distributors/${id}`, 'overdue_receivable');
  for (const b of await get(db.collection('batches').where('status', '==', 'open')))
    if (b.deliveryDate < addDays(today, -30)) toPerm('batches', 'approve', `awaitfin_${b.id}`, 'دفعة مفتوحة منذ أكثر من 30 يوماً', `دفعة #${b.batchNo} — ${b.distributorName}`, '/batches', 'batch_awaiting');
  for (const d of await get(db.collection('distributors').where('status', '==', 'active'))) {
    const limit = d.creditLimitMinor ?? fin.defaultCreditLimitMinor;
    if (creditExposure(d.bal?.ledger || 0, d.bal?.custodyGross || 0, d.bal?.custodyNet || 0, fin.exposureBasis) > limit) toPerm('distributors', 'view', `limit_${d.id}`, 'تجاوز الحد الائتماني', `${d.name} (${d.code})`, `/distributors/${d.id}`, 'credit_limit');
  }
  for (const p of await get(db.collection('purchases').where('status', '==', 'approved')))
    if (p.payState !== 'paid' && p.date < addDays(today, -30)) toPerm('suppliers', 'view', `unpaid_${p.id}`, 'فاتورة مورد غير مسددة', `${p.purchaseNo}: المتبقي ${formatMoney(p.totalBaseMinor - p.paidBaseMinor)}`, '/purchases', 'supplier_unpaid');
  for (const f of await get(db.collection('collection_followups').where('nextFollowUpDate', '<=', today)))
    if (f.contactStatus !== 'settled' && f.assignedTo) push(f.assignedTo, `follow_${f.id}`, 'تذكير متابعة تحصيل', `${f.distributorName} — موعد المتابعة ${f.nextFollowUpDate}`, '/collection', 'collection_reminder');
  for (const a of await get(db.collection('approvals').where('status', '==', 'pending')))
    if (a.date < today) toPerm(a.module, 'approve', `appr_${a.id}`, 'طلب اعتماد معلّق', a.summary, '/approvals', 'approval_pending');
  const docs = new Set((await get(db.collection('documents').where('module', '==', 'expenses'))).map((d) => d.recordId));
  const recent = (await get(db.collection('expenses').where('date', '>=', addDays(today, -30)))).filter((e) => e.status === 'posted' && !docs.has(e.id));
  if (recent.length) toPerm('expenses', 'edit', 'exp_incomplete', 'مصروفات بلا مستندات', `${recent.length} مصروف خلال 30 يوماً بدون مرفق`, '/expenses', 'expense_incomplete');
  if (count) await batch.commit();
  return { notifications: count };
}
