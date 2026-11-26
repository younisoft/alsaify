import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { S, DEFAULT_SETTINGS, can, sanitizePermissions, toMinor, zId, MODULE_LABELS, type Module, type Settings, type UserProfile } from '@dc/shared';
import { mutation, query } from '../core/registry';
import { fail } from '../core/errors';
import type { Tx } from '../core/tx';

export const emailKey = (email: string) => email.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
type Token = { uid: string; email?: string; emailVerified?: boolean; name?: string };
const tokenOf = (tx: Tx) => (tx.ctx.actor as unknown as { token: Token }).token;

// ------------------------------------------------------------------ auth
query('me.get', z.object({}), 'any', async (ctx) => {
  const s = await ctx.db.collection('users').doc(ctx.actor.uid).get();
  if (!s.exists) return { authorized: false };
  const settings = await ctx.db.collection('settings').doc('main').get();
  return { authorized: true, profile: { ...s.data(), uid: s.id }, settingsReady: settings.exists };
});

/** Called after Google sign-in. Activates the account only if the GM created a matching invitation. */
mutation('auth.claimInvitation', z.object({}), 'any', async (tx) => {
  const tok = tokenOf(tx);
  const uref = tx.ref('users', tx.ctx.actor.uid);
  const existing = await tx.read<UserProfile>(uref);
  if (existing) return { authorized: existing.status === 'active', profile: existing };
  if (!tok.email || !tok.emailVerified) return { authorized: false, reason: 'البريد الإلكتروني غير موثّق' };
  const email = tok.email.toLowerCase();
  const iref = tx.ref('invitations', emailKey(email));
  const inv = await tx.read<{ email: string; displayName: string; kind: 'owner' | 'member' | 'portal'; positions: string[]; permissions: Record<string, string[]>; portalDistributorId?: string | null; status: string }>(iref);
  if (!inv || inv.status !== 'pending' || inv.email !== email) {
    const key = `${tx.ctx.today}_${tx.ctx.actor.uid}`;
    tx.set(tx.ref('security_events', key), { type: 'unauthorized_login', uid: tx.ctx.actor.uid, email, date: tx.ctx.today, at: FieldValue.serverTimestamp() });
    const owners = await tx.query(tx.col('users').where('kind', '==', 'owner'));
    for (const o of owners) tx.set(tx.ref('notifications', `${o.id}_login_${key}`), { uid: o.id, type: 'security', title: 'محاولة دخول غير مصرح بها',
      body: `تسجيل دخول بحساب غير مدعو: ${email}`, link: '/audit', read: false, at: FieldValue.serverTimestamp(), date: tx.ctx.today });
    return { authorized: false, reason: 'لا توجد دعوة لهذا البريد. تواصل مع المدير العام.' };
  }
  const profile = { email, displayName: inv.displayName, kind: inv.kind, status: 'active', positions: inv.positions || [], permissions: sanitizePermissions(inv.permissions),
    portalDistributorId: inv.portalDistributorId ?? null, invitationId: iref.id, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
  tx.create(uref, profile);
  tx.update(iref, { status: 'accepted', acceptedUid: tx.ctx.actor.uid, acceptedAt: FieldValue.serverTimestamp() });
  if (inv.kind === 'owner' && !(await tx.read(tx.ref('settings', 'main')))) tx.create(tx.ref('settings', 'main'), { ...DEFAULT_SETTINGS, updatedAt: FieldValue.serverTimestamp() });
  Object.assign(tx.ctx.actor, { displayName: inv.displayName });
  tx.audit({ module: 'auth', action: 'claimInvitation', recordId: tx.ctx.actor.uid, after: { email, kind: inv.kind } });
  return { authorized: true, profile: { ...profile, uid: tx.ctx.actor.uid, createdAt: null, updatedAt: null } };
});

// ------------------------------------------------------------------ team (General Manager only)
mutation('team.invite', S.invite, 'owner', async (tx, i) => {
  const ref = tx.ref('invitations', emailKey(i.email));
  const prev = await tx.read<{ status: string }>(ref);
  if (prev && prev.status !== 'revoked') throw fail.exists('توجد دعوة سابقة لهذا البريد');
  if (i.kind === 'portal') {
    if (!i.portalDistributorId) throw fail.invalid('حدد الموزع المرتبط بحساب البوابة');
    await tx.must(tx.ref('distributors', i.portalDistributorId), 'الموزع');
  }
  const doc = { email: i.email, displayName: i.displayName, kind: i.kind, positions: i.positions, permissions: i.kind === 'portal' ? {} : sanitizePermissions(i.permissions),
    portalDistributorId: i.kind === 'portal' ? i.portalDistributorId : null, status: 'pending', invitedBy: tx.ctx.actor.uid, ...tx.stamp() };
  tx.set(ref, doc);
  tx.audit({ module: 'team', action: 'invite', recordId: ref.id, after: doc });
  return { id: ref.id };
});
mutation('team.revokeInvitation', S.idOnly, 'owner', async (tx, i) => {
  const ref = tx.ref('invitations', i.id);
  const inv = await tx.must<{ status: string }>(ref, 'الدعوة');
  if (inv.status !== 'pending') throw fail.state('الدعوة ليست معلقة');
  tx.update(ref, { status: 'revoked', ...tx.stamp(false) });
  tx.audit({ module: 'team', action: 'revokeInvitation', recordId: i.id });
  return { id: i.id };
});
mutation('team.updateUser', S.updateUser, 'owner', async (tx, i) => {
  const ref = tx.ref('users', i.uid);
  const u = await tx.must<UserProfile>(ref, 'المستخدم');
  if (u.kind === 'owner') throw fail.state('صلاحيات المدير العام كاملة ولا تُعدّل');
  const patch: Record<string, unknown> = {};
  if (i.displayName !== undefined) patch.displayName = i.displayName;
  if (i.positions !== undefined) patch.positions = i.positions;
  if (i.permissions !== undefined) patch.permissions = u.kind === 'portal' ? {} : sanitizePermissions(i.permissions);
  if (i.portalDistributorId !== undefined && u.kind === 'portal') { if (i.portalDistributorId) await tx.must(tx.ref('distributors', i.portalDistributorId), 'الموزع'); patch.portalDistributorId = i.portalDistributorId; }
  tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
  tx.audit({ module: 'team', action: 'updateUser', recordId: i.uid, before: { permissions: u.permissions, positions: u.positions, displayName: u.displayName }, after: patch });
  return { uid: i.uid };
});
mutation('team.setStatus', S.setUserStatus, 'owner', async (tx, i) => {
  if (i.uid === tx.ctx.actor.uid) throw fail.state('لا يمكنك إيقاف حسابك');
  const ref = tx.ref('users', i.uid);
  const u = await tx.must<UserProfile>(ref, 'المستخدم');
  tx.update(ref, { status: i.status, updatedAt: FieldValue.serverTimestamp() });
  tx.audit({ module: 'team', action: 'setStatus', recordId: i.uid, before: { status: u.status }, after: { status: i.status }, reason: i.reason });
  return { uid: i.uid };
});

// ------------------------------------------------------------------ settings
const named = z.array(z.object({ id: zId, name: z.string().trim().min(1).max(100), active: z.boolean().optional() })).max(100);
const sectionSchemas = {
  company: z.object({ nameAr: z.string().min(1).max(120), nameEn: z.string().max(120), managerName: z.string().max(120), phone: z.string().max(40), whatsapp: z.string().max(40),
    email: z.string().max(120), address: z.string().max(300), invoiceHeader: z.string().max(500), invoiceFooter: z.string().max(500) }).partial(),
  finance: z.object({ defaultCommissionPct: z.number().min(0).max(100), defaultCreditLimit: z.number().min(0).max(1e12), precision: z.number().int().min(0).max(2),
    fiscalYearStartMonth: z.number().int().min(1).max(12), creditPolicy: z.enum(['warn', 'block']), exposureBasis: z.enum(['net', 'gross']),
    agingBounds: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]).refine(([a, b, c]) => a < b && b < c, 'حدود الأعمار يجب أن تكون تصاعدية'),
    allowNegativeInventory: z.boolean() }).partial(),
  lists: z.object({ paymentMethods: named, expenseCategories: named, regions: named, distributorCategories: named, assetCategories: named, inventoryCategories: named,
    cardCategories: z.array(z.object({ id: zId, name: z.string().min(1).max(60), unitPrice: z.number().positive().max(1e9), active: z.boolean() })).max(50),
    currencies: z.array(z.object({ code: z.string().regex(/^[A-Z]{3}$/), name: z.string().min(1).max(40), active: z.boolean() })).max(20) }).partial(),
  system: z.object({ portalEnabled: z.boolean(), lowStockAlerts: z.boolean(), overdueReceivableDays: z.number().int().min(1).max(365) }).partial(),
};

mutation('settings.update', S.settingsUpdate, ['settings', 'manage'], async (tx, i) => {
  if (i.section === 'finance' && tx.ctx.actor.kind !== 'owner') throw fail.denied('الإعدادات المالية متاحة للمدير العام فقط');
  const parsed = sectionSchemas[i.section as keyof typeof sectionSchemas].safeParse(i.data);
  if (!parsed.success) throw fail.invalid(parsed.error.issues[0].message + ' (' + parsed.error.issues[0].path.join('.') + ')');
  const st = await tx.settings();
  const data = { ...(parsed.data as Record<string, unknown>) };
  if (i.section === 'finance' && data.defaultCreditLimit !== undefined) { data.defaultCreditLimitMinor = toMinor(data.defaultCreditLimit as number); delete data.defaultCreditLimit; }
  if (i.section === 'lists') {
    for (const [k, v] of Object.entries(data)) {
      const ids = (v as { id?: string; code?: string }[]).map((x) => x.id ?? x.code);
      if (new Set(ids).size !== ids.length) throw fail.invalid(`معرفات مكررة في القائمة ${k}`);
    }
    if (data.cardCategories) data.cardCategories = (data.cardCategories as { unitPrice: number }[]).map(({ unitPrice, ...c }) => ({ ...c, unitPriceMinor: toMinor(unitPrice) }));
    if (data.currencies && !(data.currencies as { code: string; active: boolean }[]).some((c) => c.code === st.finance.baseCurrency && c.active)) throw fail.invalid('لا يمكن تعطيل العملة الأساسية');
  }
  const before = st[i.section as keyof Settings];
  const after = { ...before, ...data };
  tx.set(tx.ref('settings', 'main'), { ...st, [i.section]: after, updatedAt: FieldValue.serverTimestamp(), updatedBy: tx.ctx.actor.uid });
  tx.audit({ module: 'settings', action: `update.${i.section}`, recordId: 'main', before, after });
  return { ok: true };
});

mutation('settings.setExchangeRate', S.exchangeRate, ['settings', 'manage'], async (tx, i) => {
  const st = await tx.settings();
  if (i.currency === st.finance.baseCurrency) throw fail.invalid('العملة الأساسية سعرها 1 دائماً');
  if (!st.lists.currencies.some((c) => c.code === i.currency)) throw fail.invalid('العملة غير معرفة');
  const ref = tx.ref('exchange_rates', `${i.currency}_${i.date}`);
  const before = await tx.read(ref);
  tx.set(ref, { currency: i.currency, rate: i.rate, date: i.date, source: i.source, ...tx.stamp() });
  tx.audit({ module: 'settings', action: 'exchangeRate', recordId: ref.id, before, after: i });
  return { id: ref.id };
});

// ------------------------------------------------------------------ accounting periods
mutation('periods.close', S.period, 'owner', async (tx, i) => {
  tx.set(tx.ref('accounting_periods', i.month), { month: i.month, closed: true, closedBy: tx.ctx.actor.uid, closedAt: FieldValue.serverTimestamp() });
  tx.audit({ module: 'settings', action: 'periodClose', recordId: i.month });
  return { month: i.month, closed: true };
});
mutation('periods.reopen', S.period.extend({ reason: z.string().min(1).max(300) }), 'owner', async (tx, i) => {
  tx.set(tx.ref('accounting_periods', i.month), { month: i.month, closed: false, reopenedBy: tx.ctx.actor.uid, reopenedAt: FieldValue.serverTimestamp(), reopenReason: i.reason });
  tx.audit({ module: 'settings', action: 'periodReopen', recordId: i.month, reason: i.reason });
  return { month: i.month, closed: false };
});

// ------------------------------------------------------------------ tasks
interface Task { id: string; title: string; assigneeUid: string | null; createdBy: string; status: string }
async function userName(tx: Tx, uid?: string | null) {
  if (!uid) return null;
  const u = await tx.must<UserProfile>(tx.ref('users', uid), 'المستخدم');
  if (u.kind === 'portal' || u.status !== 'active') throw fail.invalid('لا يمكن إسناد المهمة لهذا الحساب');
  return u.displayName;
}
mutation('tasks.upsert', S.taskUpsert, 'user', async (tx, i) => {
  const isNew = !i.id;
  const ref = isNew ? tx.ref('tasks') : tx.ref('tasks', i.id);
  let existing: Task | null = null;
  if (isNew) { if (!can(tx.ctx.actor, 'tasks', 'create')) throw fail.denied(); }
  else {
    existing = await tx.must<Task>(ref, 'المهمة');
    if (!can(tx.ctx.actor, 'tasks', 'edit') && existing.createdBy !== tx.ctx.actor.uid) throw fail.denied();
  }
  if (i.startDate && i.dueDate && i.dueDate < i.startDate) throw fail.invalid('تاريخ الاستحقاق قبل تاريخ البدء');
  const assigneeName = await userName(tx, i.assigneeUid);
  const { id: _omit, ...rest } = i;
  const data = { ...rest, assigneeUid: i.assigneeUid ?? null, assigneeName, startDate: i.startDate ?? null, dueDate: i.dueDate ?? null, relatedModule: i.relatedModule ?? null, relatedId: i.relatedId ?? null };
  if (isNew) tx.create(ref, { ...data, status: i.assigneeUid ? 'assigned' : 'new', commentsCount: 0, ...tx.stamp() });
  else tx.update(ref, { ...data, ...(i.assigneeUid && existing!.status === 'new' ? { status: 'assigned' } : {}), ...tx.stamp(false) });
  if (i.assigneeUid && i.assigneeUid !== existing?.assigneeUid && i.assigneeUid !== tx.ctx.actor.uid)
    tx.set(tx.ref('notifications'), { uid: i.assigneeUid, type: 'task', title: 'مهمة جديدة مسندة إليك', body: i.title, link: `/tasks`, read: false, at: FieldValue.serverTimestamp(), date: tx.ctx.today });
  tx.audit({ module: 'tasks', action: isNew ? 'create' : 'update', recordId: ref.id, before: existing, after: data });
  return { id: ref.id };
});
mutation('tasks.setStatus', S.taskStatus, 'user', async (tx, i) => {
  const ref = tx.ref('tasks', i.id);
  const t = await tx.must<Task>(ref, 'المهمة');
  const isAssignee = t.assigneeUid === tx.ctx.actor.uid;
  if (!can(tx.ctx.actor, 'tasks', 'edit') && !(isAssignee && ['in_progress', 'review'].includes(i.status))) throw fail.denied('يمكن للمكلَّف تحويل المهمة إلى «قيد التنفيذ» أو «بانتظار المراجعة» فقط');
  if (i.status === 'done' && !can(tx.ctx.actor, 'tasks', 'approve') && t.createdBy !== tx.ctx.actor.uid) throw fail.denied('إكمال المهمة يتطلب صلاحية الاعتماد أو أن تكون منشئها');
  tx.update(ref, { status: i.status, ...tx.stamp(false), ...(i.status === 'done' ? { completedAt: FieldValue.serverTimestamp() } : {}) });
  tx.audit({ module: 'tasks', action: 'status', recordId: i.id, before: { status: t.status }, after: { status: i.status } });
  return { id: i.id };
});
mutation('tasks.comment', S.taskComment, 'user', async (tx, i) => {
  const ref = tx.ref('tasks', i.id);
  const t = await tx.must<Task & { commentsCount: number }>(ref, 'المهمة');
  if (!can(tx.ctx.actor, 'tasks', 'view') && t.assigneeUid !== tx.ctx.actor.uid && t.createdBy !== tx.ctx.actor.uid) throw fail.denied();
  tx.create(tx.ref('task_comments'), { taskId: i.id, text: i.text, uid: tx.ctx.actor.uid, userName: tx.ctx.actor.displayName, at: FieldValue.serverTimestamp() });
  tx.update(ref, { commentsCount: (t.commentsCount || 0) + 1 });
  return { id: i.id };
});

// ------------------------------------------------------------------ documents & notifications
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
mutation('documents.register', S.documentRegister, 'user', async (tx, i) => {
  const m = i.module as Module;
  if (!can(tx.ctx.actor, m, 'create') && !can(tx.ctx.actor, m, 'edit') && !can(tx.ctx.actor, 'archive', 'create')) throw fail.denied(`لا تملك صلاحية إرفاق مستندات في ${MODULE_LABELS[m]}`);
  if (!i.path.startsWith(`documents/${m}/${i.recordId}/`)) throw fail.invalid('مسار الملف غير صالح');
  if (!ALLOWED_TYPES.includes(i.contentType)) throw fail.invalid('نوع الملف غير مسموح');
  const ref = tx.ref('documents');
  tx.create(ref, { module: m, recordId: i.recordId, path: i.path, name: i.name, size: i.size, contentType: i.contentType, status: 'active', ...tx.stamp() });
  tx.audit({ module: 'archive', action: 'upload', recordId: ref.id, after: i });
  return { id: ref.id };
});
mutation('notifications.markRead', S.markRead, 'user', async (tx, i) => {
  for (const id of i.ids) {
    const ref = tx.ref('notifications', id);
    const n = await tx.read<{ uid: string }>(ref);
    if (n && n.uid === tx.ctx.actor.uid) tx.update(ref, { read: true });
  }
  return { count: i.ids.length };
});
