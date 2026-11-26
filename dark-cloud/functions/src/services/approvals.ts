import { FieldValue } from 'firebase-admin/firestore';
import { can, APPROVAL_LABELS, S, type ApprovalType, type Module } from '@dc/shared';
import { EXECUTORS, mutation } from '../core/registry';
import { fail } from '../core/errors';
import type { Tx, ApprovalRequest } from '../core/tx';

/**
 * Sensitive operations. The General Manager's own requests execute immediately (recorded as
 * auto-approved). Anyone else creates a pending request that a different authorised user must approve.
 */
export async function requestOrExecute(tx: Tx, req: ApprovalRequest): Promise<{ executed: boolean; approvalId: string; result?: unknown }> {
  const ref = tx.ref('approvals');
  const base = { type: req.type, module: req.module, summary: req.summary, payload: req.payload, reason: req.reason,
    requestedBy: tx.ctx.actor.uid, requestedByName: tx.ctx.actor.displayName, requestedAt: FieldValue.serverTimestamp(), date: tx.ctx.today };
  if (tx.ctx.actor.kind === 'owner') {
    const result = await execute(tx, req.type, req.payload);
    tx.create(ref, { ...base, status: 'approved', auto: true, decidedBy: tx.ctx.actor.uid, decidedByName: tx.ctx.actor.displayName, decidedAt: FieldValue.serverTimestamp(), result: JSON.parse(JSON.stringify(result ?? null)) });
    tx.audit({ module: req.module, action: `approval.auto:${req.type}`, recordId: ref.id, after: req.payload, reason: req.reason });
    return { executed: true, approvalId: ref.id, result };
  }
  tx.create(ref, { ...base, status: 'pending', auto: false });
  tx.audit({ module: req.module, action: `approval.request:${req.type}`, recordId: ref.id, after: req.payload, reason: req.reason });
  await tx.notify({ type: 'approval', title: 'طلب اعتماد جديد', body: `${APPROVAL_LABELS[req.type]}: ${req.summary}`, link: '/approvals', module: req.module, action: 'approve', excludeUid: tx.ctx.actor.uid });
  return { executed: false, approvalId: ref.id };
}

async function execute(tx: Tx, type: ApprovalType, payload: Record<string, unknown>) {
  const ex = EXECUTORS[type];
  if (!ex) throw fail.state('لا يوجد منفذ لهذا النوع من الطلبات');
  return ex(tx, payload);
}

mutation('approvals.decide', S.approvalDecide, 'user', async (tx, input) => {
  const ref = tx.ref('approvals', input.id);
  const a = await tx.must<{ status: string; type: ApprovalType; module: Module; payload: Record<string, unknown>; requestedBy: string; summary: string }>(ref, 'الطلب');
  if (a.status !== 'pending') throw fail.state('تم البت في هذا الطلب مسبقاً');
  if (!can(tx.ctx.actor, a.module, 'approve')) throw fail.denied('ليست لديك صلاحية الاعتماد في هذا القسم');
  if (a.requestedBy === tx.ctx.actor.uid) throw fail.denied('لا يمكنك اعتماد طلب قدمته بنفسك (فصل المهام)');
  let result: unknown = null;
  if (input.decision === 'approve') result = await execute(tx, a.type, a.payload);
  tx.update(ref, { status: input.decision === 'approve' ? 'approved' : 'rejected', decidedBy: tx.ctx.actor.uid, decidedByName: tx.ctx.actor.displayName,
    decidedAt: FieldValue.serverTimestamp(), note: input.note, result: JSON.parse(JSON.stringify(result ?? null)) });
  tx.audit({ module: a.module, action: `approval.${input.decision}:${a.type}`, recordId: input.id, reason: input.note });
  tx.set(tx.ref('notifications'), { uid: a.requestedBy, type: 'approval_result', title: input.decision === 'approve' ? 'تم اعتماد طلبك' : 'تم رفض طلبك',
    body: a.summary + (input.note ? ` — ${input.note}` : ''), link: '/approvals', read: false, at: FieldValue.serverTimestamp(), date: tx.ctx.today });
  return { status: input.decision, result };
});
