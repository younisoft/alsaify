import { FieldValue, type DocumentReference, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import {
  assertBalanced, can, DEFAULT_SETTINGS, todayISO, monthKey, type Action, type JournalLine, type Module, type Settings, type UserProfile,
  type ApprovalType, applyRate, toMinor, type Minor,
} from '@dc/shared';
import { fail } from './errors';

export interface Actor extends UserProfile { }
export interface Ctx { db: Firestore; actor: Actor; now: Date; today: string; requestId: string }

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/**
 * Transaction wrapper. Firestore transactions require every read before any write;
 * services may interleave freely because writes are buffered and applied on flush().
 */
export class Tx {
  private writes: ((t: Transaction) => void)[] = [];
  private counters = new Map<string, number>();
  private cache = new Map<string, unknown>();
  readonly results: Record<string, unknown> = {};
  constructor(public t: Transaction, public ctx: Ctx) { }
  get db() { return this.ctx.db; }
  col(name: string) { return this.ctx.db.collection(name); }
  ref(col: string, id?: string) { return id ? this.col(col).doc(id) : this.col(col).doc(); }

  async read<T = Record<string, unknown>>(ref: DocumentReference): Promise<(T & { id: string }) | null> {
    const s = await this.t.get(ref);
    return s.exists ? ({ ...(s.data() as T), id: s.id }) : null;
  }
  async must<T = Record<string, unknown>>(ref: DocumentReference, what: string): Promise<T & { id: string }> {
    const d = await this.read<T>(ref);
    if (!d) throw fail.notFound(what);
    return d;
  }
  async query<T = Record<string, unknown>>(q: Query): Promise<(T & { id: string })[]> {
    const s = await this.t.get(q);
    return s.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  }
  set(ref: DocumentReference, data: object) { this.writes.push((t) => t.set(ref, data)); }
  create(ref: DocumentReference, data: object) { this.writes.push((t) => t.create(ref, data)); }
  update(ref: DocumentReference, data: object) { this.writes.push((t) => t.update(ref, data)); }
  flush() { for (const w of this.writes) w(this.t); }

  stamp(isNew = true) {
    const base = { updatedAt: FieldValue.serverTimestamp(), updatedBy: this.ctx.actor.uid };
    return isNew ? { ...base, createdAt: FieldValue.serverTimestamp(), createdBy: this.ctx.actor.uid, createdByName: this.ctx.actor.displayName } : base;
  }

  async settings(): Promise<Settings> {
    if (!this.cache.has('settings')) {
      const s = await this.read<Partial<Settings>>(this.ref('settings', 'main'));
      const merged: Settings = {
        company: { ...DEFAULT_SETTINGS.company, ...(s?.company || {}) },
        finance: { ...DEFAULT_SETTINGS.finance, ...(s?.finance || {}) },
        lists: { ...DEFAULT_SETTINGS.lists, ...(s?.lists || {}) },
        system: { ...DEFAULT_SETTINGS.system, ...(s?.system || {}) },
      };
      this.cache.set('settings', merged);
    }
    return this.cache.get('settings') as Settings;
  }

  /** Sequential, unique, gap-free (per committed transaction) document numbers. */
  async nextNumber(name: string): Promise<number> {
    const ref = this.ref('counters', name);
    let cur = this.counters.get(name);
    if (cur === undefined) cur = ((await this.read<{ value: number }>(ref))?.value) ?? 0;
    const next = cur + 1;
    this.counters.set(name, next);
    this.writes = this.writes.filter((w) => (w as { counter?: string }).counter !== name);
    const w = ((t: Transaction) => t.set(ref, { value: next, updatedAt: FieldValue.serverTimestamp() })) as ((t: Transaction) => void) & { counter?: string };
    w.counter = name;
    this.writes.push(w);
    return next;
  }
  async code(name: string, prefix: string, pad = 4) { return `${prefix}${String(await this.nextNumber(name)).padStart(pad, '0')}`; }

  async assertPeriodOpen(date: string) {
    const key = 'period:' + monthKey(date);
    if (!this.cache.has(key)) this.cache.set(key, await this.read<{ closed: boolean }>(this.ref('accounting_periods', monthKey(date))));
    const p = this.cache.get(key) as { closed?: boolean } | null;
    if (p?.closed) throw fail.state(`الفترة المحاسبية ${monthKey(date)} مقفلة — لا يمكن الترحيل إليها`);
  }

  /** Post a balanced journal entry. Returns its id. */
  async journal(e: { date: string; memo: string; lines: JournalLine[]; source: { type: string; id: string }; reversalOf?: string }): Promise<string> {
    assertBalanced(e.lines);
    await this.assertPeriodOpen(e.date);
    const ref = this.ref('journal_entries');
    const parties = [...new Set(e.lines.filter((l) => l.party).map((l) => `${l.party!.type}:${l.party!.id}`))];
    this.create(ref, {
      date: e.date, month: monthKey(e.date), memo: e.memo, lines: e.lines, source: e.source, reversalOf: e.reversalOf ?? null,
      accounts: [...new Set(e.lines.map((l) => l.account.split(':')[0]))], parties,
      totalMinor: e.lines.reduce((a, l) => a + l.debit, 0), ...this.stamp(),
    });
    return ref.id;
  }
  async reverseJournal(journalId: string, date: string, memo: string): Promise<string> {
    const j = await this.must<{ lines: JournalLine[]; source: { type: string; id: string } }>(this.ref('journal_entries', journalId), 'القيد');
    const lines = j.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
    const id = await this.journal({ date, memo, lines, source: j.source, reversalOf: journalId });
    this.update(this.ref('journal_entries', journalId), { reversedBy: id });
    return id;
  }

  audit(a: { module: Module | 'auth' | 'system'; action: string; recordId: string; before?: unknown; after?: unknown; reason?: string }) {
    this.create(this.ref('audit_logs'), {
      module: a.module, action: a.action, recordId: a.recordId, before: a.before === undefined ? null : clone(a.before), after: a.after === undefined ? null : clone(a.after),
      reason: a.reason ?? null, uid: this.ctx.actor.uid, userName: this.ctx.actor.displayName, requestId: this.ctx.requestId, at: FieldValue.serverTimestamp(), date: this.ctx.today,
    });
  }

  /** Notify every active user who holds (module, action), plus owners. */
  async notify(n: { type: string; title: string; body: string; link?: string; module: Module; action: Action; dedupeKey?: string; excludeUid?: string }) {
    if (!this.cache.has('users')) this.cache.set('users', await this.query<UserProfile>(this.col('users').where('status', '==', 'active')));
    for (const u of this.cache.get('users') as (UserProfile & { id: string })[]) {
      if (u.id === n.excludeUid || !can(u, n.module, n.action)) continue;
      const ref = n.dedupeKey ? this.ref('notifications', `${u.id}_${n.dedupeKey}`) : this.ref('notifications');
      this.set(ref, { uid: u.id, type: n.type, title: n.title, body: n.body, link: n.link ?? null, read: false, at: FieldValue.serverTimestamp(), date: this.ctx.today });
    }
  }

  /** Resolve exchange rate: explicit manual rate wins; else latest recorded manual rate on/before date; never invented. */
  async fx(currency: string, originalAmount: number, date: string, rate?: number, rateDate?: string, rateSource?: string) {
    const st = await this.settings();
    const base = st.finance.baseCurrency;
    const cur = st.lists.currencies.find((c) => c.code === currency);
    if (!cur || !cur.active) throw fail.invalid(`العملة ${currency} غير مفعلة في الإعدادات`);
    const originalMinor = toMinor(originalAmount);
    if (currency === base) return { currency, originalMinor, rate: 1, rateDate: date, rateSource: 'base', baseMinor: originalMinor };
    let r = rate, rd = rateDate ?? date, src = rateSource || 'يدوي';
    if (!r) {
      const found = await this.query<{ rate: number; date: string; source: string }>(this.col('exchange_rates').where('currency', '==', currency).where('date', '<=', date).orderBy('date', 'desc').limit(1));
      if (!found.length) throw fail.invalid(`لا يوجد سعر صرف مسجل لـ ${currency} حتى تاريخ ${date} — أدخل سعر الصرف`);
      r = found[0].rate; rd = found[0].date; src = found[0].source || 'جدول الأسعار';
    }
    return { currency, originalMinor, rate: r, rateDate: rd, rateSource: src, baseMinor: applyRate(originalMinor, r, st.finance.precision) };
  }

  /** Cash movement on an account: updates balance (account currency) and writes the cash transaction. */
  async cashMove(m: { accountId: string; date: string; direction: 'in' | 'out'; originalMinor: Minor; currency: string; rate: number; baseMinor: Minor;
    type: string; flowClass: 'operating' | 'investing' | 'financing' | 'transfer' | 'opening'; sourceType: string; sourceId: string; journalId: string; description: string; allowNegative?: boolean }) {
    const accRef = this.ref('cash_accounts', m.accountId);
    const acc = await this.must<{ currency: string; balanceMinor: number; status: string; name: string; balanceBaseMinor?: number }>(accRef, 'الحساب النقدي');
    if (acc.status !== 'active') throw fail.state(`الحساب النقدي «${acc.name}» غير نشط`);
    if (acc.currency !== m.currency) throw fail.invalid(`عملة الحساب «${acc.name}» هي ${acc.currency} وليست ${m.currency}`);
    const pending = (this.cache.get('cash:' + m.accountId) as number | undefined) ?? acc.balanceMinor;
    const pendingBase = (this.cache.get('cashb:' + m.accountId) as number | undefined) ?? (acc.balanceBaseMinor ?? 0);
    const next = pending + (m.direction === 'in' ? m.originalMinor : -m.originalMinor);
    const nextBase = pendingBase + (m.direction === 'in' ? m.baseMinor : -m.baseMinor);
    if (next < 0 && !m.allowNegative) throw fail.state(`رصيد «${acc.name}» غير كافٍ لهذه العملية`);
    this.cache.set('cash:' + m.accountId, next); this.cache.set('cashb:' + m.accountId, nextBase);
    this.update(accRef, { balanceMinor: next, balanceBaseMinor: nextBase, updatedAt: FieldValue.serverTimestamp() });
    const ref = this.ref('cash_transactions');
    this.create(ref, { ...m, accountName: acc.name, atMs: this.ctx.now.getTime(), ...this.stamp() });
    return ref.id;
  }
}

export interface ApprovalRequest { type: ApprovalType; module: Module; summary: string; payload: Record<string, unknown>; reason: string }

export const todayFor = (now: Date) => todayISO(now);
