import { z } from 'zod';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { can, todayISO, type UserProfile } from '@dc/shared';
import { ACTIONS_REGISTRY } from './registry';
import { AppError, fail } from './errors';
import { Tx, type Ctx } from './tx';

export interface Caller { uid: string; email?: string; emailVerified?: boolean; name?: string }
const PRE_AUTH = new Set(['auth.claimInvitation', 'me.get']);

function zodMessage(e: z.ZodError): string {
  const i = e.issues[0];
  return `${i.message}${i.path.length ? ` (${i.path.join('.')})` : ''}`;
}

/** Single entry point for every client operation. Permission checks happen here, server-side. */
export async function runAction(db: Firestore, caller: Caller | null, action: string, input: unknown, requestId: string, now = new Date()): Promise<unknown> {
  if (!caller) throw new AppError('unauthenticated', 'يجب تسجيل الدخول');
  const def = ACTIONS_REGISTRY[action];
  if (!def) throw fail.invalid('عملية غير معروفة: ' + action);
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_\-]{8,64}$/.test(requestId)) throw fail.invalid('معرّف الطلب غير صالح');

  const snap = await db.collection('users').doc(caller.uid).get();
  let actor: UserProfile & { email: string };
  if (snap.exists) {
    actor = { ...(snap.data() as UserProfile), uid: caller.uid };
  } else {
    if (!PRE_AUTH.has(action)) {
      await recordUnauthorized(db, caller, action);
      throw fail.denied('حسابك غير مصرح له بالدخول إلى النظام. تواصل مع المدير العام.');
    }
    actor = { uid: caller.uid, email: (caller.email || '').toLowerCase(), displayName: caller.name || caller.email || '', kind: 'member', status: 'suspended', positions: [], permissions: {} };
  }
  if (snap.exists && actor.status !== 'active' && action !== 'me.get') throw fail.denied('الحساب موقوف — لا يمكن تنفيذ عمليات جديدة');

  const p = def.perm;
  if (p === 'owner' && actor.kind !== 'owner') throw fail.denied('هذه العملية متاحة للمدير العام فقط');
  if (p === 'user' && (!snap.exists || actor.status !== 'active')) throw fail.denied();
  if (Array.isArray(p) && !can(actor, p[0], p[1])) throw fail.denied();

  const parsed = def.schema.safeParse(input ?? {});
  if (!parsed.success) throw fail.invalid(zodMessage(parsed.error));
  const ctx: Ctx = { db, actor: Object.assign(actor, { token: caller }) as Ctx['actor'], now, today: todayISO(now), requestId };

  if (def.kind === 'query') return def.run(ctx, parsed.data);

  return db.runTransaction(async (t) => {
    const tx = new Tx(t, ctx);
    const idemRef = db.collection('idempotency').doc(`${caller.uid}_${requestId}`);
    const prev = await t.get(idemRef);
    if (prev.exists) {
      const d = prev.data()!;
      if (d.action !== action) throw fail.exists('معرّف الطلب مستخدم لعملية أخرى');
      return { ...(d.result ?? {}), duplicate: true };
    }
    const result = (await def.run(tx, parsed.data)) ?? {};
    tx.create(idemRef, { action, uid: caller.uid, result: JSON.parse(JSON.stringify(result)), at: FieldValue.serverTimestamp() });
    tx.flush();
    return result;
  });
}

async function recordUnauthorized(db: Firestore, caller: Caller, action: string) {
  const day = todayISO();
  const key = `${day}_${caller.uid}`;
  const ref = db.collection('security_events').doc(key);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (s.exists) { t.update(ref, { count: FieldValue.increment(1), lastAction: action }); return; }
    t.set(ref, { type: 'unauthorized_access', uid: caller.uid, email: caller.email ?? null, firstAction: action, lastAction: action, count: 1, date: day, at: FieldValue.serverTimestamp() });
    const owners = await t.get(db.collection('users').where('kind', '==', 'owner'));
    for (const o of owners.docs) t.set(db.collection('notifications').doc(`${o.id}_unauth_${key}`), {
      uid: o.id, type: 'security', title: 'محاولة دخول غير مصرح بها', body: `حساب غير مصرح (${caller.email ?? caller.uid}) حاول الوصول إلى النظام`, link: '/audit', read: false, at: FieldValue.serverTimestamp(), date: day,
    });
  });
}
