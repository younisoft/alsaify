import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderBy, where, limit } from 'firebase/firestore';
import { Plus, Check, X, MessageSquare, UserPlus, Lock, Unlock, DatabaseBackup, Trash2 } from 'lucide-react';
import {
  MODULES, ACTIONS, MODULE_LABELS, ACTION_LABELS, FINANCIAL_MODULES, APPROVAL_LABELS, TASK_STATUS_LABELS, PRIORITY_LABELS, formatDate, type Permissions, type Module, type Action,
} from '@dc/shared';
import { useAuth } from '../lib/auth';
import { useCollection } from '../lib/hooks';
import { api } from '../lib/api';
import { tsDate } from '../lib/format';
import { Badge, Button, Card, DataView, Field, FormModal, Grid, Input, Note, PageHeader, Select, Tabs, Textarea, useToast, Modal, Empty, Stat, useReasonPrompt } from '../components/ui';
import { useTeamOptions, today, Documents } from './common';

// ================================================================== TASKS
export function TasksPage() {
  const { can, profile } = useAuth();
  const all = useCollection<any>(can('tasks', 'view') ? 'tasks' : null, [orderBy('createdAt', 'desc'), limit(500)]);
  const mine = useCollection<any>(!can('tasks', 'view') ? 'tasks' : null, [where('assigneeUid', '==', profile!.uid)], profile!.uid);
  const rows = can('tasks', 'view') ? all.data : mine.data;
  const [edit, setEdit] = useState<any>(null); const [view, setView] = useState<any>(null); const [filter, setFilter] = useState('open');
  const shown = rows.filter((t) => filter === 'all' || (filter === 'open' ? !['done', 'cancelled'].includes(t.status) : filter === 'mine' ? t.assigneeUid === profile!.uid : t.status === filter));
  return (
    <>
      <PageHeader title="المهام" subtitle="مهام الفريق الإدارية — لا تُنشئ المهام أي عمليات مالية" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'المهام' }]}
        actions={can('tasks', 'create') && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>مهمة جديدة</Button>} />
      <div className="mb-2 flex flex-wrap gap-1.5">{[['open', 'المفتوحة'], ['mine', 'المسندة إليّ'], ['review', 'بانتظار المراجعة'], ['done', 'المكتملة'], ['all', 'الكل']].map(([v, l]) => (
        <button key={v} onClick={() => setFilter(v)} className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === v ? 'bg-navy text-white' : 'bg-white text-muted ring-1 ring-line'}`}>{l}</button>))}</div>
      <DataView rows={shown} loading={all.loading && mine.loading} error={all.error || mine.error} onRowClick={setView} exportName="tasks" search={(t) => `${t.title} ${t.assigneeName}`} emptyTitle="لا توجد مهام" columns={[
        { key: 'title', label: 'المهمة', mobile: 'title' }, { key: 'assignee', label: 'المكلّف', mobile: 'sub', value: (t) => t.assigneeName || '—' },
        { key: 'priority', label: 'الأولوية', mobile: 'meta', value: (t) => PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS], render: (t) => <Badge tone={t.priority === 'urgent' ? 'bad' : t.priority === 'high' ? 'warn' : 'neutral'}>{PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS]}</Badge> },
        { key: 'due', label: 'الاستحقاق', value: (t) => formatDate(t.dueDate), render: (t) => <span className={t.dueDate && t.dueDate < today() && !['done', 'cancelled'].includes(t.status) ? 'font-bold text-bad' : ''}>{formatDate(t.dueDate)}</span> },
        { key: 'status', label: 'الحالة', mobile: 'meta', value: (t) => TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS], render: (t) => <Badge tone={t.status === 'done' ? 'ok' : t.status === 'review' ? 'gold' : 'info'}>{TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS]}</Badge> },
      ]} />
      {edit && <TaskForm t={edit} onClose={() => setEdit(null)} />}
      {view && <TaskView t={view} onClose={() => setView(null)} onEdit={() => { setEdit(view); setView(null); }} />}
    </>
  );
}
function TaskForm({ t, onClose }: { t: any; onClose: () => void }) {
  const toast = useToast(); const team = useTeamOptions();
  const [f, setF] = useState({ title: t.title || '', description: t.description || '', assigneeUid: t.assigneeUid || '', startDate: t.startDate || '', dueDate: t.dueDate || '', priority: t.priority || 'normal' });
  return (
    <FormModal open onClose={onClose} title={t.id ? 'تعديل المهمة' : 'مهمة جديدة'} onSubmit={async () => { await api('tasks.upsert', { id: t.id, ...f, assigneeUid: f.assigneeUid || null, startDate: f.startDate || undefined, dueDate: f.dueDate || undefined }); toast('تم حفظ المهمة'); }}>
      <Field label="العنوان" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="مثال: جرد المخزن الرئيسي" /></Field>
      <Grid>
        <Field label="المكلّف"><Select value={f.assigneeUid} onChange={(e) => setF({ ...f, assigneeUid: e.target.value })} placeholder="غير مسندة" options={team} /></Field>
        <Field label="الأولوية"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="تاريخ البدء"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="تاريخ الاستحقاق"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      </Grid>
      <Field label="الوصف"><Textarea rows={4} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
    </FormModal>
  );
}
function TaskView({ t, onClose, onEdit }: { t: any; onClose: () => void; onEdit: () => void }) {
  const { can, profile } = useAuth(); const toast = useToast();
  const comments = useCollection<any>('task_comments', [where('taskId', '==', t.id), orderBy('at')], t.id);
  const [text, setText] = useState('');
  const setStatus = async (status: string) => { try { await api('tasks.setStatus', { id: t.id, status }); toast('تم تحديث الحالة'); onClose(); } catch (e: any) { toast(e.message, 'bad'); } };
  const isAssignee = t.assigneeUid === profile?.uid;
  return (
    <Modal open onClose={onClose} title={t.title} wide footer={<>
      {(can('tasks', 'edit') || t.createdBy === profile?.uid) && <Button onClick={onEdit}>تعديل</Button>}
      {(isAssignee || can('tasks', 'edit')) && t.status !== 'in_progress' && !['done', 'cancelled'].includes(t.status) && <Button onClick={() => setStatus('in_progress')}>بدء التنفيذ</Button>}
      {(isAssignee || can('tasks', 'edit')) && ['in_progress', 'assigned'].includes(t.status) && <Button onClick={() => setStatus('review')}>إرسال للمراجعة</Button>}
      {(can('tasks', 'approve') || t.createdBy === profile?.uid) && !['done', 'cancelled'].includes(t.status) && <Button variant="success" onClick={() => setStatus('done')}>إكمال</Button>}
      {can('tasks', 'edit') && !['done', 'cancelled'].includes(t.status) && <Button variant="danger" onClick={() => setStatus('cancelled')}>إلغاء</Button>}</>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card><Stat label="الحالة" value={TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS]} /><Stat label="المكلّف" value={t.assigneeName || '—'} /><Stat label="الاستحقاق" value={formatDate(t.dueDate)} /><Stat label="أنشأها" value={t.createdByName} />
          {t.description && <p className="mt-2 whitespace-pre-wrap text-sm">{t.description}</p>}</Card>
        <Card title={<span className="inline-flex items-center gap-1.5"><MessageSquare className="h-4 w-4" />التعليقات</span>}>
          <ul className="mb-2 max-h-56 space-y-2 overflow-y-auto">{comments.data.map((c) => <li key={c.id} className="rounded-lg bg-slate-50 p-2 text-sm"><p className="text-xs font-semibold">{c.userName} · {tsDate(c.at)}</p><p>{c.text}</p></li>)}
            {!comments.data.length && <li className="text-sm text-muted">لا توجد تعليقات</li>}</ul>
          <div className="flex gap-2"><Input value={text} onChange={(e) => setText(e.target.value)} placeholder="أضف تعليقاً…" /><Button disabled={!text.trim()} onClick={async () => { try { await api('tasks.comment', { id: t.id, text }); setText(''); } catch (e: any) { toast(e.message, 'bad'); } }}>إرسال</Button></div>
        </Card>
      </div>
      <div className="mt-4"><Documents module="tasks" recordId={t.id} /></div>
    </Modal>
  );
}

// ================================================================== APPROVALS
export function ApprovalsPage() {
  const { profile, can } = useAuth(); const toast = useToast(); const { ask, el } = useReasonPrompt();
  const approvable = (MODULES as readonly Module[]).filter((m) => can(m, 'approve'));
  const pend = useCollection<any>(approvable.length ? 'approvals' : null, profile?.kind === 'owner' ? [orderBy('requestedAt', 'desc'), limit(300)] : [where('module', 'in', approvable.slice(0, 30)), orderBy('requestedAt', 'desc'), limit(300)], approvable.join());
  const mine = useCollection<any>('approvals', [where('requestedBy', '==', profile!.uid), orderBy('requestedAt', 'desc'), limit(100)], profile!.uid);
  const [tab, setTab] = useState<'pending' | 'history' | 'mine'>('pending');
  const decide = async (a: any, decision: 'approve' | 'reject') => {
    const note = decision === 'reject' ? await ask('سبب الرفض', 'الملاحظة') : '';
    if (decision === 'reject' && !note) return;
    try { await api('approvals.decide', { id: a.id, decision, note: note || '' }); toast(decision === 'approve' ? 'تم الاعتماد والتنفيذ' : 'تم الرفض'); } catch (e: any) { toast(e.message, 'bad'); }
  };
  const rows = tab === 'mine' ? mine.data : pend.data.filter((a) => (tab === 'pending' ? a.status === 'pending' : a.status !== 'pending'));
  return (
    <>
      <PageHeader title="الاعتمادات" subtitle="طلب ← مراجعة ← اعتماد أو رفض ← سجل تدقيق. لا يمكن اعتماد طلبك بنفسك." crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الاعتمادات' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'pending', label: 'بانتظار قراري', count: pend.data.filter((a) => a.status === 'pending').length }, { id: 'history', label: 'السجل' }, { id: 'mine', label: 'طلباتي' }]} />
      {!approvable.length && tab !== 'mine' ? <Empty title="ليست لديك صلاحية اعتماد" /> : (
        <DataView rows={rows} loading={tab === 'mine' ? mine.loading : pend.loading} error={tab === 'mine' ? mine.error : pend.error} exportName="approvals" emptyTitle="لا توجد طلبات" columns={[
          { key: 'type', label: 'النوع', mobile: 'meta', value: (a) => APPROVAL_LABELS[a.type as keyof typeof APPROVAL_LABELS], render: (a) => <Badge tone="info">{APPROVAL_LABELS[a.type as keyof typeof APPROVAL_LABELS]}</Badge> },
          { key: 'summary', label: 'الملخص', mobile: 'title' }, { key: 'reason', label: 'السبب', value: (a) => a.reason },
          { key: 'by', label: 'مقدم الطلب', mobile: 'sub', value: (a) => `${a.requestedByName} · ${formatDate(a.date)}` },
          { key: 'status', label: 'الحالة', value: (a) => a.status, render: (a) => <Badge tone={a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : 'warn'}>{a.status === 'approved' ? (a.auto ? 'نُفذ مباشرة (المدير العام)' : `معتمد — ${a.decidedByName}`) : a.status === 'rejected' ? `مرفوض — ${a.decidedByName}` : 'معلق'}</Badge> },
          { key: 'act', label: '', noExport: true, render: (a) => a.status === 'pending' && a.requestedBy !== profile?.uid && can(a.module, 'approve') ? <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => void decide(a, 'approve')}>اعتماد</Button>
            <Button size="sm" variant="danger" icon={<X className="h-3.5 w-3.5" />} onClick={() => void decide(a, 'reject')}>رفض</Button></div> : null },
        ]} />
      )}
      {el}
    </>
  );
}

// ================================================================== ARCHIVE
export function ArchivePage() {
  const docs = useCollection<any>('documents', [orderBy('createdAt', 'desc'), limit(500)]);
  return (
    <>
      <PageHeader title="أرشيف المستندات" subtitle="كل مستند مرتبط بسجله الأصلي. الإرفاق يتم من داخل السجل (دفعة، سند، مصروف…)." crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الأرشيف' }]} />
      <DataView rows={docs.data} loading={docs.loading} error={docs.error} exportName="documents" search={(d) => `${d.name} ${d.module}`} emptyTitle="لا توجد مستندات" columns={[
        { key: 'name', label: 'الملف', mobile: 'title' }, { key: 'module', label: 'القسم', mobile: 'meta', value: (d) => MODULE_LABELS[d.module as Module] },
        { key: 'record', label: 'السجل', render: (d) => <Link className="text-brand" to={({ distributors: `/distributors/${d.recordId}`, batches: `/batches/${d.recordId}`, payments: `/payments/${d.recordId}`, purchases: `/purchases/${d.recordId}`, suppliers: `/suppliers/${d.recordId}` } as any)[d.module] ?? '#'}>{d.recordId}</Link>, value: (d) => d.recordId },
        { key: 'size', label: 'الحجم', value: (d) => `${Math.round(d.size / 1024)}KB` }, { key: 'by', label: 'رفعه', mobile: 'sub', value: (d) => `${d.createdByName} · ${tsDate(d.createdAt)}` },
      ]} />
    </>
  );
}

// ================================================================== TEAM
function PermissionMatrix({ value, onChange }: { value: Permissions; onChange: (p: Permissions) => void }) {
  const toggle = (m: Module, a: Action) => { const cur = new Set(value[m] || []); cur.has(a) ? cur.delete(a) : cur.add(a); onChange({ ...value, [m]: ACTIONS.filter((x) => cur.has(x)) }); };
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-xs"><thead className="bg-slate-50"><tr><th className="sticky right-0 bg-slate-50 p-2 text-right">القسم</th>{ACTIONS.map((a) => <th key={a} className="p-2">{ACTION_LABELS[a]}</th>)}</tr></thead>
        <tbody>{MODULES.map((m) => (
          <tr key={m} className="border-t border-line"><td className="sticky right-0 bg-white p-2 font-semibold">{MODULE_LABELS[m]}{FINANCIAL_MODULES.includes(m) && <span className="mr-1 text-gold" title="قسم مالي">●</span>}</td>
            {ACTIONS.map((a) => <td key={a} className="p-1 text-center"><input type="checkbox" aria-label={`${MODULE_LABELS[m]} — ${ACTION_LABELS[a]}`} checked={!!value[m]?.includes(a)} onChange={() => toggle(m, a)} className="h-4 w-4 accent-[#2878C7]" /></td>)}</tr>))}</tbody></table>
      <p className="p-2 text-xs text-muted">● أقسام مالية — لا تُمنح أي صلاحية افتراضياً. كل عضو مستقل: لا يرث أحد صلاحيات غيره.</p>
    </div>
  );
}
export function TeamPage() {
  const toast = useToast(); const { ask, el } = useReasonPrompt();
  const users = useCollection<any>('users', []);
  const invites = useCollection<any>('invitations', []);
  const dists = useCollection<any>('distributors', [orderBy('code')]);
  const [inv, setInv] = useState(false); const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <PageHeader title="الفريق والصلاحيات" subtitle="لا تسجيل عام: يدخل فقط من دعاه المدير العام ببريد Google المطابق" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الفريق' }]}
        actions={<Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setInv(true)}>دعوة عضو</Button>} />
      <Note>يُدخل المدير العام البريد الفعلي لكل عضو (لا يُفترض أي بريد). للعضو دهمان هويتان منفصلتان: حساب موظف بصلاحيات تُمنح هنا، وسجل موزع مستقل في قسم الموزعين — ويمكن عند الحاجة إنشاء حساب «بوابة موزع» منفصل له.</Note>
      <h2 className="mb-2 mt-4 text-sm font-bold">الأعضاء</h2>
      <DataView rows={users.data} loading={users.loading} error={users.error} columns={[
        { key: 'displayName', label: 'الاسم', mobile: 'title' }, { key: 'email', label: 'البريد', mobile: 'sub', render: (u) => <span dir="ltr">{u.email}</span>, value: (u) => u.email },
        { key: 'kind', label: 'النوع', mobile: 'meta', value: (u) => u.kind, render: (u) => <Badge tone={u.kind === 'owner' ? 'navy' : u.kind === 'portal' ? 'gold' : 'info'}>{u.kind === 'owner' ? 'المدير العام' : u.kind === 'portal' ? 'بوابة موزع' : 'عضو فريق'}</Badge> },
        { key: 'positions', label: 'المسميات', value: (u) => (u.positions || []).join('، ') || '—' },
        { key: 'perms', label: 'الصلاحيات', value: (u) => (u.kind === 'owner' ? 'كاملة' : `${Object.values(u.permissions || {}).flat().length} صلاحية`) },
        { key: 'status', label: 'الحالة', mobile: 'meta', value: (u) => u.status, render: (u) => <Badge tone={u.status === 'active' ? 'ok' : 'bad'}>{u.status === 'active' ? 'نشط' : 'موقوف'}</Badge> },
        { key: 'act', label: '', noExport: true, render: (u) => u.kind !== 'owner' && <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" onClick={() => setEdit(u)}>الصلاحيات</Button>
          <Button size="sm" variant={u.status === 'active' ? 'danger' : 'success'} onClick={async () => { const r = await ask(u.status === 'active' ? `إيقاف ${u.displayName}` : `تفعيل ${u.displayName}`, 'السبب', u.status === 'active'); if (!r) return;
            try { await api('team.setStatus', { uid: u.id, status: u.status === 'active' ? 'suspended' : 'active', reason: r }); toast('تم'); } catch (e: any) { toast(e.message, 'bad'); } }}>{u.status === 'active' ? 'إيقاف' : 'تفعيل'}</Button></div> },
      ]} />
      <h2 className="mb-2 mt-6 text-sm font-bold">الدعوات</h2>
      <DataView rows={invites.data.filter((i) => i.kind !== 'owner')} loading={invites.loading} columns={[
        { key: 'displayName', label: 'الاسم', mobile: 'title' }, { key: 'email', label: 'البريد', mobile: 'sub', render: (i) => <span dir="ltr">{i.email}</span>, value: (i) => i.email },
        { key: 'status', label: 'الحالة', mobile: 'meta', value: (i) => i.status, render: (i) => <Badge tone={i.status === 'accepted' ? 'ok' : i.status === 'pending' ? 'warn' : 'neutral'}>{({ pending: 'بانتظار تسجيل الدخول', accepted: 'مفعلة', revoked: 'ملغاة' } as any)[i.status]}</Badge> },
        { key: 'act', label: '', noExport: true, render: (i) => i.status === 'pending' && <Button size="sm" variant="danger" onClick={async () => { try { await api('team.revokeInvitation', { id: i.id }); toast('أُلغيت الدعوة'); } catch (e: any) { toast(e.message, 'bad'); } }}>إلغاء</Button> },
      ]} />
      {inv && <InviteForm dists={dists.data} onClose={() => setInv(false)} />}
      {edit && <EditUser u={edit} onClose={() => setEdit(null)} />}
      {el}
    </>
  );
}
function InviteForm({ dists, onClose }: { dists: any[]; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ email: '', displayName: '', kind: 'member', positions: '', portalDistributorId: '' });
  const [perms, setPerms] = useState<Permissions>({ tasks: ['view'] });
  return (
    <FormModal open onClose={onClose} title="دعوة عضو جديد" wide submitLabel="إنشاء الدعوة" onSubmit={async () => {
      await api('team.invite', { email: f.email, displayName: f.displayName, kind: f.kind, positions: f.positions.split(/[،,]/).map((s) => s.trim()).filter(Boolean), permissions: perms, portalDistributorId: f.kind === 'portal' ? f.portalDistributorId : null });
      toast('تم إنشاء الدعوة — يسجّل العضو الدخول بحساب Google لنفس البريد');
    }}>
      <Grid>
        <Field label="البريد الفعلي (Google)" required><Input dir="ltr" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="الاسم" required><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
        <Field label="نوع الحساب"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'member', label: 'عضو فريق' }, { value: 'portal', label: 'بوابة موزع (عرض حسابه فقط)' }]} /></Field>
        {f.kind === 'member' ? <Field label="المسميات" hint="افصل بفاصلة: موزع، صيانة فنية"><Input value={f.positions} onChange={(e) => setF({ ...f, positions: e.target.value })} /></Field>
          : <Field label="الموزع المرتبط" required><Select value={f.portalDistributorId} onChange={(e) => setF({ ...f, portalDistributorId: e.target.value })} placeholder="اختر" options={dists.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }))} /></Field>}
      </Grid>
      {f.kind === 'member' && <PermissionMatrix value={perms} onChange={setPerms} />}
    </FormModal>
  );
}
function EditUser({ u, onClose }: { u: any; onClose: () => void }) {
  const toast = useToast();
  const [perms, setPerms] = useState<Permissions>(u.permissions || {});
  const [positions, setPositions] = useState((u.positions || []).join('، '));
  return (
    <FormModal open onClose={onClose} title={`صلاحيات ${u.displayName}`} wide onSubmit={async () => { await api('team.updateUser', { uid: u.id, permissions: perms, positions: positions.split(/[،,]/).map((s: string) => s.trim()).filter(Boolean) }); toast('تم تحديث الصلاحيات — تسري فوراً'); }}>
      {u.kind === 'portal' ? <Note>حساب بوابة موزع: يرى حسابه فقط عند تفعيل البوابة في الإعدادات.</Note> : <>
        <Field label="المسميات"><Input value={positions} onChange={(e) => setPositions(e.target.value)} /></Field>
        <PermissionMatrix value={perms} onChange={setPerms} /></>}
    </FormModal>
  );
}

// ================================================================== AUDIT
export function AuditPage() {
  const logs = useCollection<any>('audit_logs', [orderBy('at', 'desc'), limit(1000)]);
  const sec = useCollection<any>('security_events', [orderBy('at', 'desc'), limit(100)]);
  const { profile } = useAuth();
  const [sel, setSel] = useState<any>(null);
  return (
    <>
      <PageHeader title="سجل التدقيق ونشاط المستخدمين" subtitle="سجل محمي: لا يمكن لأي مستخدم تعديله أو حذفه" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'سجل التدقيق' }]} />
      {profile?.kind === 'owner' && sec.data.length > 0 && <Card title="محاولات الوصول غير المصرح بها" className="mb-4">
        <ul className="space-y-1 text-sm">{sec.data.map((s) => <li key={s.id} className="flex justify-between"><span dir="ltr">{s.email ?? s.uid}</span><span className="text-xs text-muted">{s.date} · {s.count ?? 1} محاولة</span></li>)}</ul></Card>}
      <DataView rows={logs.data} loading={logs.loading} error={logs.error} onRowClick={setSel} exportName="audit-log" title="تقرير نشاط المستخدمين" search={(a) => `${a.userName} ${a.module} ${a.action} ${a.recordId}`} columns={[
        { key: 'at', label: 'الوقت', mobile: 'sub', value: (a) => tsDate(a.at) }, { key: 'userName', label: 'المستخدم', mobile: 'title' },
        { key: 'module', label: 'القسم', mobile: 'meta', value: (a) => MODULE_LABELS[a.module as Module] ?? a.module }, { key: 'action', label: 'العملية', mobile: 'meta' },
        { key: 'recordId', label: 'السجل' }, { key: 'reason', label: 'السبب', value: (a) => a.reason || '—' },
      ]} />
      {sel && <Modal open onClose={() => setSel(null)} title={`${sel.module} · ${sel.action}`} wide>
        <Grid><div><p className="mb-1 text-xs font-bold">القيم السابقة</p><pre dir="ltr" className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(sel.before, null, 2)}</pre></div>
          <div><p className="mb-1 text-xs font-bold">القيم الجديدة</p><pre dir="ltr" className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{JSON.stringify(sel.after, null, 2)}</pre></div></Grid>
        <p className="mt-2 text-xs text-muted">المستخدم: {sel.userName} ({sel.uid}) · معرّف الطلب: {sel.requestId}</p>
      </Modal>}
    </>
  );
}

// ================================================================== SETTINGS
type ST = 'company' | 'finance' | 'lists' | 'rates' | 'system' | 'periods' | 'backup';
export function SettingsPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<ST>('company');
  const owner = profile?.kind === 'owner';
  return (
    <>
      <PageHeader title="الإعدادات" subtitle="تغيير القيم الافتراضية لا يعيد كتابة أي عملية سابقة" crumbs={[{ label: 'الرئيسية', to: '/' }, { label: 'الإعدادات' }]} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'company', label: 'الشركة' }, ...(owner ? [{ id: 'finance' as ST, label: 'المالية' }] : []), { id: 'lists', label: 'القوائم' }, { id: 'rates', label: 'أسعار الصرف' },
        { id: 'system', label: 'النظام' }, ...(owner ? [{ id: 'periods' as ST, label: 'الفترات المحاسبية' }, { id: 'backup' as ST, label: 'النسخ الاحتياطي' }] : [])]} />
      {tab === 'company' && <CompanySettings />}{tab === 'finance' && <FinanceSettings />}{tab === 'lists' && <ListsSettings />}{tab === 'rates' && <Rates />}
      {tab === 'system' && <SystemSettings />}{tab === 'periods' && <Periods />}{tab === 'backup' && <Backups />}
    </>
  );
}
function useSave(section: string) {
  const toast = useToast(); const [busy, setBusy] = useState(false);
  return { busy, save: async (data: any) => { setBusy(true); try { await api('settings.update', { section, data }); toast('تم حفظ الإعدادات'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } } };
}
function CompanySettings() {
  const { settings, can } = useAuth(); const [f, setF] = useState(settings.company); const { busy, save } = useSave('company');
  const fields: [keyof typeof f, string][] = [['nameAr', 'الاسم بالعربية'], ['nameEn', 'الاسم بالإنجليزية'], ['managerName', 'المدير العام'], ['phone', 'الهاتف'], ['whatsapp', 'واتساب'], ['email', 'البريد'], ['address', 'العنوان']];
  return <Card actions={can('settings', 'manage') && <Button variant="primary" loading={busy} onClick={() => save(f)}>حفظ</Button>}>
    <Grid>{fields.map(([k, l]) => <Field key={k} label={l}><Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</Grid>
    <Grid><Field label="ترويسة الفواتير"><Textarea value={f.invoiceHeader} onChange={(e) => setF({ ...f, invoiceHeader: e.target.value })} /></Field><Field label="تذييل الفواتير"><Textarea value={f.invoiceFooter} onChange={(e) => setF({ ...f, invoiceFooter: e.target.value })} /></Field></Grid>
    <p className="mt-2 text-xs text-muted">الشعار الرسمي مضمّن في التطبيق ويظهر في الفواتير وكشوف الحساب.</p></Card>;
}
function FinanceSettings() {
  const { settings } = useAuth(); const fin = settings.finance; const { busy, save } = useSave('finance');
  const [f, setF] = useState({ ...fin, defaultCreditLimit: String(fin.defaultCreditLimitMinor / 100), agingBounds: fin.agingBounds.join(',') });
  return <Card actions={<Button variant="primary" loading={busy} onClick={() => save({ defaultCommissionPct: Number(f.defaultCommissionPct), defaultCreditLimit: Number(f.defaultCreditLimit), precision: Number(f.precision),
    fiscalYearStartMonth: Number(f.fiscalYearStartMonth), creditPolicy: f.creditPolicy, exposureBasis: f.exposureBasis, agingBounds: f.agingBounds.split(',').map(Number), allowNegativeInventory: f.allowNegativeInventory })}>حفظ</Button>}>
    <Note>هذه القيم تُستخدم للعمليات الجديدة فقط. كل دفعة تحتفظ بنسبة عمولتها، وكل عملية بعملة أجنبية تحتفظ بسعر صرفها.</Note>
    <div className="mt-3"><Grid cols={3}>
      <Field label="العملة الأساسية"><Input value={`${fin.baseCurrency} — ريال يمني`} disabled /></Field>
      <Field label="العمولة الافتراضية (%)"><Input type="number" value={f.defaultCommissionPct} onChange={(e) => setF({ ...f, defaultCommissionPct: e.target.value as any })} /></Field>
      <Field label="الحد الائتماني الافتراضي (ريال)"><Input type="number" value={f.defaultCreditLimit} onChange={(e) => setF({ ...f, defaultCreditLimit: e.target.value })} /></Field>
      <Field label="عدد المنازل العشرية"><Select value={String(f.precision)} onChange={(e) => setF({ ...f, precision: Number(e.target.value) })} options={[{ value: '0', label: '0 (ريال صحيح)' }, { value: '1', label: '1' }, { value: '2', label: '2' }]} /></Field>
      <Field label="بداية السنة المالية (شهر)"><Input type="number" min="1" max="12" value={f.fiscalYearStartMonth} onChange={(e) => setF({ ...f, fiscalYearStartMonth: Number(e.target.value) })} /></Field>
      <Field label="سياسة تجاوز الحد الائتماني"><Select value={f.creditPolicy} onChange={(e) => setF({ ...f, creditPolicy: e.target.value as any })} options={[{ value: 'warn', label: 'تحذير فقط' }, { value: 'block', label: 'منع إلا باعتماد' }]} /></Field>
      <Field label="أساس التعرض الائتماني" hint="الرصيد + العهدة المفتوحة"><Select value={f.exposureBasis} onChange={(e) => setF({ ...f, exposureBasis: e.target.value as any })} options={[{ value: 'net', label: 'العهدة بالصافي (كما في ملف Excel)' }, { value: 'gross', label: 'العهدة بالإجمالي' }]} /></Field>
      <Field label="حدود أعمار الديون (أيام)" hint="ثلاثة أرقام تصاعدية مثل 7,15,30"><Input dir="ltr" value={f.agingBounds} onChange={(e) => setF({ ...f, agingBounds: e.target.value })} /></Field>
      <Field label="السماح بالمخزون السالب"><Select value={f.allowNegativeInventory ? '1' : '0'} onChange={(e) => setF({ ...f, allowNegativeInventory: e.target.value === '1' })} options={[{ value: '0', label: 'لا' }, { value: '1', label: 'نعم (غير مستحسن)' }]} /></Field>
    </Grid></div></Card>;
}
const LISTS: { key: string; label: string; price?: boolean; code?: boolean }[] = [
  { key: 'cardCategories', label: 'فئات الكروت', price: true }, { key: 'paymentMethods', label: 'طرق السداد' }, { key: 'expenseCategories', label: 'أنواع المصروفات' }, { key: 'regions', label: 'المناطق' },
  { key: 'distributorCategories', label: 'تصنيفات الموزعين' }, { key: 'currencies', label: 'العملات', code: true }, { key: 'assetCategories', label: 'فئات الأصول' }, { key: 'inventoryCategories', label: 'فئات المخزون' },
];
function ListsSettings() {
  const { settings, can } = useAuth(); const { busy, save } = useSave('lists');
  const [which, setWhich] = useState('cardCategories');
  const def = LISTS.find((l) => l.key === which)!;
  const [items, setItems] = useState<any[]>(() => (settings.lists as any)[which]);
  const load = (k: string) => { setWhich(k); setItems((settings.lists as any)[k].map((x: any) => (k === 'cardCategories' ? { ...x, unitPrice: x.unitPriceMinor / 100 } : x))); };
  const payload = () => ({ [which]: items.map(({ unitPriceMinor, ...x }: any) => (def.price ? { id: x.id, name: x.name, unitPrice: Number(x.unitPrice ?? unitPriceMinor / 100), active: x.active !== false } : def.code ? { code: x.code, name: x.name, active: x.active !== false } : { id: x.id, name: x.name, active: x.active !== false })) });
  return (
    <Card title={<Select aria-label="القائمة" className="w-56" value={which} onChange={(e) => load(e.target.value)} options={LISTS.map((l) => ({ value: l.key, label: l.label }))} />}
      actions={can('settings', 'manage') && <Button variant="primary" loading={busy} onClick={() => save(payload())}>حفظ القائمة</Button>}>
      {def.price && <Note>تغيير سعر الفئة لا يغيّر الدفعات السابقة. عطّل الفئة بدلاً من حذفها.</Note>}
      <ul className="mt-3 space-y-2">{items.map((it, i) => (
        <li key={i} className="flex flex-wrap items-center gap-2">
          {def.code ? <Input dir="ltr" className="w-24" value={it.code} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} /> : <Input dir="ltr" className="w-32 text-xs" value={it.id} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, id: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') } : x)))} aria-label="المعرف" />}
          <Input className="flex-1" value={it.name} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          {def.price && <Input type="number" className="w-32" value={it.unitPrice ?? it.unitPriceMinor / 100} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)))} aria-label="السعر" />}
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.active !== false} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} />مفعّل</label>
          <Button size="sm" variant="ghost" aria-label="حذف" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </li>))}</ul>
      <Button size="sm" className="mt-3" icon={<Plus className="h-4 w-4" />} onClick={() => setItems([...items, def.code ? { code: '', name: '', active: true } : { id: `x${Date.now().toString(36)}`, name: '', active: true, ...(def.price ? { unitPrice: '' } : {}) }])}>إضافة</Button>
    </Card>
  );
}
function Rates() {
  const { settings, can } = useAuth(); const toast = useToast();
  const rates = useCollection<any>('exchange_rates', [orderBy('date', 'desc'), limit(200)]);
  const [f, setF] = useState({ currency: settings.lists.currencies.find((c) => c.code !== settings.finance.baseCurrency)?.code || 'USD', rate: '', date: today(), source: 'يدوي' });
  return (
    <div className="space-y-4">
      <Note>أسعار الصرف تُدخل يدوياً ولا تُجلب من مصادر خارجية. كل عملية تحفظ سعرها لحظة تسجيلها، فتعديل السعر هنا لا يغيّر أي عملية سابقة.</Note>
      {can('settings', 'manage') && <Card title="تسجيل سعر صرف"><div className="flex flex-wrap items-end gap-2">
        <Field label="العملة"><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={settings.lists.currencies.filter((c) => c.code !== settings.finance.baseCurrency).map((c) => ({ value: c.code, label: c.name }))} /></Field>
        <Field label={`1 ${f.currency} = ؟ ${settings.finance.baseCurrency}`}><Input type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field>
        <Field label="التاريخ"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="المصدر"><Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <Button variant="primary" onClick={async () => { try { await api('settings.setExchangeRate', { ...f, rate: Number(f.rate) }); toast('تم تسجيل السعر'); setF({ ...f, rate: '' }); } catch (e: any) { toast(e.message, 'bad'); } }}>تسجيل</Button></div></Card>}
      <DataView rows={rates.data} loading={rates.loading} error={rates.error} exportName="exchange-rates" columns={[{ key: 'date', label: 'التاريخ', mobile: 'sub', value: (r) => formatDate(r.date) }, { key: 'currency', label: 'العملة', mobile: 'title' },
        { key: 'rate', label: 'السعر', align: 'end', mobile: 'amount', render: (r) => <span className="num font-bold">{r.rate.toLocaleString('en-US')}</span> }, { key: 'source', label: 'المصدر' }, { key: 'by', label: 'أدخله', value: (r) => r.createdByName }]} />
    </div>
  );
}
function SystemSettings() {
  const { settings, can } = useAuth(); const [f, setF] = useState(settings.system); const { busy, save } = useSave('system');
  return <Card actions={can('settings', 'manage') && <Button variant="primary" loading={busy} onClick={() => save({ portalEnabled: f.portalEnabled, lowStockAlerts: f.lowStockAlerts, overdueReceivableDays: Number(f.overdueReceivableDays) })}>حفظ</Button>}>
    <Grid>
      <Field label="المنطقة الزمنية"><Input value={f.timezone} disabled /></Field><Field label="صيغة التاريخ"><Input value="DD/MM/YYYY" disabled /></Field>
      <Field label="بوابة الموزعين"><Select value={f.portalEnabled ? '1' : '0'} onChange={(e) => setF({ ...f, portalEnabled: e.target.value === '1' })} options={[{ value: '0', label: 'معطّلة' }, { value: '1', label: 'مفعّلة' }]} /></Field>
      <Field label="تنبيهات انخفاض المخزون"><Select value={f.lowStockAlerts ? '1' : '0'} onChange={(e) => setF({ ...f, lowStockAlerts: e.target.value === '1' })} options={[{ value: '1', label: 'مفعّلة' }, { value: '0', label: 'معطّلة' }]} /></Field>
      <Field label="اعتبار المستحق متأخراً بعد (يوم)"><Input type="number" value={f.overdueReceivableDays} onChange={(e) => setF({ ...f, overdueReceivableDays: Number(e.target.value) })} /></Field>
    </Grid></Card>;
}
function Periods() {
  const toast = useToast(); const { ask, el } = useReasonPrompt();
  const p = useCollection<any>('accounting_periods', []);
  const [month, setMonth] = useState(today().slice(0, 7));
  return (
    <div className="space-y-4">
      <Note>إقفال شهر يمنع أي ترحيل بتاريخ داخله (بما في ذلك القيود العكسية بأثر رجعي). التصحيحات بعد الإقفال تُرحّل بتاريخ الفترة المفتوحة الحالية.</Note>
      <Card><div className="flex flex-wrap items-end gap-2"><Field label="الشهر"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Button icon={<Lock className="h-4 w-4" />} onClick={async () => { try { await api('periods.close', { month }); toast(`تم إقفال ${month}`); } catch (e: any) { toast(e.message, 'bad'); } }}>إقفال</Button>
        <Button icon={<Unlock className="h-4 w-4" />} onClick={async () => { const r = await ask(`إعادة فتح ${month}`); if (r) try { await api('periods.reopen', { month, reason: r }); toast('أُعيد الفتح'); } catch (e: any) { toast(e.message, 'bad'); } }}>إعادة فتح</Button></div></Card>
      <DataView rows={p.data} loading={p.loading} columns={[{ key: 'month', label: 'الشهر', mobile: 'title' }, { key: 'closed', label: 'الحالة', mobile: 'meta', render: (x) => <Badge tone={x.closed ? 'navy' : 'ok'}>{x.closed ? 'مقفل' : 'مفتوح'}</Badge>, value: (x) => (x.closed ? 'مقفل' : 'مفتوح') }]} />
      {el}
    </div>
  );
}
function Backups() {
  const toast = useToast(); const b = useCollection<any>('backups', [orderBy('at', 'desc'), limit(50)]); const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Note>نسخة احتياطية يومية تلقائية (02:30 بتوقيت عدن) + نسخ يدوي. كل نسخة تُعاد قراءتها بعد الكتابة وتُتحقق بصمتها (SHA-256). الاستعادة تتم إلى مشروع/قاعدة فارغة فقط عبر سكربت مُوثّق، ولا تُستبدل البيانات الحية تلقائياً.</Note>
      <Button variant="primary" icon={<DatabaseBackup className="h-4 w-4" />} loading={busy} onClick={async () => { setBusy(true); try { const r = await api('backup.run'); toast(r.verified ? 'تم إنشاء النسخة والتحقق منها' : 'أُنشئت النسخة لكن فشل التحقق', r.verified ? 'ok' : 'bad'); } catch (e: any) { toast(e.message, 'bad'); } finally { setBusy(false); } }}>نسخ احتياطي الآن</Button>
      <DataView rows={b.data} loading={b.loading} error={b.error} emptyTitle="لا توجد نسخ بعد" columns={[{ key: 'at', label: 'الوقت', mobile: 'title', value: (x) => tsDate(x.at) }, { key: 'path', label: 'الملف', mobile: 'sub' },
        { key: 'size', label: 'الحجم', value: (x) => `${Math.round(x.sizeBytes / 1024)}KB` }, { key: 'verified', label: 'التحقق', mobile: 'meta', value: (x) => (x.verified ? 'سليمة' : 'فشل'), render: (x) => <Badge tone={x.verified ? 'ok' : 'bad'}>{x.verified ? 'سليمة' : 'فشل التحقق'}</Badge> },
        { key: 'by', label: 'بواسطة', value: (x) => (x.by === 'scheduler' ? 'تلقائي' : 'يدوي') }]} />
    </div>
  );
}
