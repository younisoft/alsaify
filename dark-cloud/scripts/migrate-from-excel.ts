/**
 * DRY-RUN migration of the legacy Excel workbook (DARK-CLOUD_Database_With_Formulas.xlsx) into the new schema.
 * It NEVER writes to any database. It produces:  <out>/migration-plan.json  and  <out>/migration-report.md
 * Usage: npm run migrate:dryrun -- <path-to-xlsx> [outDir]
 */
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { computeBatchTotals, toMinor, formatMoney, isValidISODate, normalizeYemeniPhone, DEFAULT_SETTINGS } from '../shared/src/index';

const [file, out = 'docs/migration-dryrun'] = process.argv.slice(2);
if (!file) { console.error('usage: migrate:dryrun <xlsx> [outDir]'); process.exit(1); }

type Issue = { level: 'error' | 'warning' | 'decision'; sheet: string; row?: number; message: string };
const issues: Issue[] = [];
const iso = (v: any): string | null => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return isValidISODate(s) ? s : null;
};
const val = (c: ExcelJS.Cell) => { const v: any = c.value; return v && typeof v === 'object' && 'result' in v ? v.result : v && typeof v === 'object' && 'formula' in v ? undefined : v; };

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(file);
const sh = (n: string) => { const s = wb.getWorksheet(n); if (!s) throw new Error('missing sheet ' + n); return s; };
const rows = (n: string, from = 5) => { const s = sh(n); const r: { row: number; v: any[] }[] = []; s.eachRow((row, i) => { if (i >= from) r.push({ row: i, v: (row.values as any[]).slice(1).map((_, k) => val(row.getCell(k + 1))) }); }); return r.filter((x) => x.v.some((y) => y !== undefined && y !== null && y !== '')); };

// ---------------- settings
const set = sh('الإعدادات');
const defaultRateFraction = Number(val(set.getCell('B4')));
const defaultPct = defaultRateFraction <= 1 ? defaultRateFraction * 100 : defaultRateFraction;
const defaultLimit = Number(val(set.getCell('B5')));
const listCol = (col: string) => { const out: string[] = []; for (let r = 8; r <= 40; r++) { const v = val(set.getCell(`${col}${r}`)); if (v !== undefined && v !== null && v !== '') out.push(String(v)); } return out; };
const denominations = listCol('A').map(Number), regions = listCol('B'), methods = listCol('C'), expenseCats = listCol('D'), currencies = listCol('E');
issues.push({ level: 'decision', sheet: 'الإعدادات', message: `العمولة في Excel مخزنة ككسر (${defaultRateFraction}) وتُحوَّل إلى نسبة مئوية (${defaultPct}%) في النظام الجديد.` });
if (regions.some((r) => /القرية \d/.test(r))) issues.push({ level: 'decision', sheet: 'الإعدادات', message: `أسماء المناطق (${regions.join('، ')}) تبدو أسماءً مؤقتة — يجب اعتماد الأسماء الحقيقية قبل الترحيل.` });

// ---------------- distributors
const dists = rows('الموزعون').filter((r) => r.v[0]).map((r) => {
  const [code, name, region, phone, pct, limit, opening, status] = r.v;
  const p = phone ? normalizeYemeniPhone(String(phone)) : null;
  if (!p) issues.push({ level: 'error', sheet: 'الموزعون', row: r.row, message: `رقم هاتف غير صالح للموزع ${code}: ${phone}` });
  if (/مثال/.test(String(name))) issues.push({ level: 'warning', sheet: 'الموزعون', row: r.row, message: `الموزع ${code} «${name}» يبدو بيانات تجريبية — لا يُرحَّل للإنتاج دون تأكيد.` });
  const pctNum = pct === undefined || pct === null || pct === '' ? null : Number(pct) <= 1 ? Number(pct) * 100 : Number(pct);
  return { legacyCode: String(code), name: String(name), region: String(region ?? ''), phone: p?.local ?? null, commissionPct: pctNum, creditLimit: limit ? Number(limit) : null,
    openingBalance: Number(opening || 0), status: status === 'موقوف' ? 'suspended' : 'active', row: r.row };
});
const dcodes = new Map(dists.map((d) => [d.legacyCode, d]));
const dup = dists.map((d) => d.legacyCode).filter((c, i, a) => a.indexOf(c) !== i);
for (const c of new Set(dup)) issues.push({ level: 'error', sheet: 'الموزعون', message: `كود موزع مكرر: ${c}` });

// ---------------- deliveries → batches
type Line = { row: number; batchNo: number; date: string | null; code: string; denom: number; count: number; status: string; finished: string | null };
const lines: Line[] = rows('تسليم الكروت').filter((r) => r.v[2]).map((r) => ({ row: r.row, batchNo: Number(r.v[0]), date: iso(r.v[1]), code: String(r.v[2]), denom: Number(r.v[3]), count: Number(r.v[4]), status: String(r.v[5] ?? ''), finished: iso(r.v[6]) }));
const groups = new Map<string, Line[]>();
for (const l of lines) {
  if (!dcodes.has(l.code)) issues.push({ level: 'error', sheet: 'تسليم الكروت', row: l.row, message: `كود موزع غير موجود: ${l.code}` });
  if (!l.date) issues.push({ level: 'error', sheet: 'تسليم الكروت', row: l.row, message: 'تاريخ تسليم غير صالح' });
  if (l.status === 'منتهية' && !l.finished) issues.push({ level: 'error', sheet: 'تسليم الكروت', row: l.row, message: 'سطر «منتهية» بلا تاريخ انتهاء — كان يُحسب في الرصيد ويختفي من الملخص الشهري في Excel' });
  if (!denominations.includes(l.denom)) issues.push({ level: 'warning', sheet: 'تسليم الكروت', row: l.row, message: `فئة ${l.denom} غير موجودة في قائمة الفئات` });
  // new model finalizes per batch: split legacy batches by (status, finish date)
  const key = `${l.batchNo}|${l.code}|${l.status}|${l.finished ?? ''}`;
  groups.set(key, [...(groups.get(key) || []), l]);
}
const batchNos = new Map<string, number>(); for (const k of groups.keys()) { const b = k.split('|').slice(0, 2).join('|'); batchNos.set(b, (batchNos.get(b) || 0) + 1); }
for (const [b, n] of batchNos) if (n > 1) issues.push({ level: 'decision', sheet: 'تسليم الكروت', message: `الدفعة ${b.split('|')[0]} للموزع ${b.split('|')[1]} فيها أسطر بحالات/تواريخ انتهاء مختلفة — ستُقسَّم إلى ${n} دفعات في النظام الجديد (الاعتماد يتم على مستوى الدفعة).` });
const batches = [...groups.entries()].map(([k, ls]) => {
  const d = dcodes.get(ls[0].code);
  const pct = d?.commissionPct ?? defaultPct;
  const t = computeBatchTotals(ls.map((l) => ({ categoryId: `c${l.denom}`, categoryName: `فئة ${l.denom}`, quantity: l.count, unitPriceMinor: toMinor(l.denom) })), pct, 0);
  return { legacyKey: k, legacyBatchNo: ls[0].batchNo, legacyDistributor: ls[0].code, deliveryDate: ls[0].date, status: ls[0].status === 'منتهية' ? 'finalized' : 'open', settlementDate: ls[0].finished,
    commissionPct: pct, grossMinor: t.grossMinor, commissionMinor: t.commissionMinor, netMinor: t.netMinor, rows: ls.map((l) => l.row) };
});

// ---------------- payments
const pays = rows('سداد الموزعين').filter((r) => r.v[0] || r.v[4]).map((r) => ({ row: r.row, voucher: String(r.v[0] ?? ''), date: iso(r.v[1]), code: String(r.v[2] ?? ''), amount: Number(r.v[4] || 0), method: String(r.v[5] ?? '') }));
const vdup = pays.map((p) => p.voucher).filter((v, i, a) => v && a.indexOf(v) !== i);
for (const v of new Set(vdup)) issues.push({ level: 'error', sheet: 'سداد الموزعين', message: `رقم سند مكرر: ${v}` });
for (const p of pays) {
  if (!dcodes.has(p.code)) issues.push({ level: 'error', sheet: 'سداد الموزعين', row: p.row, message: `كود موزع غير موجود: ${p.code}` });
  if (!(p.amount > 0)) issues.push({ level: 'error', sheet: 'سداد الموزعين', row: p.row, message: 'مبلغ صفري أو سالب' });
  if (!p.date) issues.push({ level: 'error', sheet: 'سداد الموزعين', row: p.row, message: 'تاريخ غير صالح' });
}
issues.push({ level: 'decision', sheet: 'سداد الموزعين', message: 'سندات Excel غير مخصصة لدفعات محددة. الاقتراح: ترحيلها بتخصيص FIFO (الأقدم أولاً) أو تركها غير مخصصة — يتطلب قراراً.' });
issues.push({ level: 'decision', sheet: 'سداد الموزعين', message: 'لا يوجد حساب نقدي في Excel لكل سند — يجب تحديد الصندوق المستلِم (مثلاً «الصندوق الرئيسي») لكل السندات المرحّلة.' });

// ---------------- expenses / purchases
const base = currencies[0] || 'ريال يمني';
const money = (sheet: string, rs: { row: number; v: any[] }[], dateI: number, curI: number, amtI: number, rateI: number) => rs.filter((r) => r.v[amtI]).map((r) => {
  const cur = String(r.v[curI] ?? ''); const amount = Number(r.v[amtI]); const rate = r.v[rateI] ? Number(r.v[rateI]) : null;
  if (cur !== base && !rate) issues.push({ level: 'error', sheet, row: r.row, message: `مبلغ بعملة ${cur} بلا سعر صرف — Excel كان يحسبه 1:1 (تقليل للقيمة). أدخل السعر الفعلي.` });
  if (!iso(r.v[dateI])) issues.push({ level: 'error', sheet, row: r.row, message: 'تاريخ غير صالح' });
  return { row: r.row, date: iso(r.v[dateI]), currency: cur, amount, rate, baseMinor: cur === base ? toMinor(amount) : rate ? toMinor(amount * rate) : null, raw: r.v };
});
const expenses = money('المصروفات اليومية', rows('المصروفات اليومية').map((r) => ({ ...r, v: r.v.slice(0, 7) })), 0, 3, 4, 5).map((e) => ({ ...e, category: String(e.raw[1]), description: String(e.raw[2]) }));
const custody = new Set(expenses.filter((e) => /مصروفات الفني|مصروفات المدير/.test(e.category)).map((e) => e.category));
if (custody.size) issues.push({ level: 'decision', sheet: 'المصروفات اليومية', message: `الأنواع (${[...custody].join('، ')}) تخلط بين مصروف تشغيلي وعهدة/سلفة ومسحوبات المالك. حدد لكل نوع: مصروف تشغيلي، أو مسحوبات مالك (سند نقدي)، أو عهدة.` });
const purchases = money('مشتريات الشبكة', rows('مشتريات الشبكة'), 0, 3, 4, 5).map((p) => ({ ...p, item: String(p.raw[1]), classification: p.raw[2] === 'رأسمالي' ? 'capital' : 'operational' }));
if (purchases.some((p) => p.classification === 'capital')) issues.push({ level: 'decision', sheet: 'مشتريات الشبكة', message: 'المشتريات الرأسمالية ستُنشئ أصولاً ثابتة. العمر الإنتاجي والقيمة المتبقية غير موجودين في Excel ولن تُفترض — بلا إهلاك حتى تُحدد.' });

// ---------------- reconciliation (engine vs legacy formula logic)
const recon = dists.map((d) => {
  const mine = batches.filter((b) => b.legacyDistributor === d.legacyCode);
  const finalizedNet = mine.filter((b) => b.status === 'finalized').reduce((a, b) => a + b.netMinor, 0);
  const custodyGross = mine.filter((b) => b.status === 'open').reduce((a, b) => a + b.grossMinor, 0);
  const custodyNet = mine.filter((b) => b.status === 'open').reduce((a, b) => a + b.netMinor, 0);
  const paid = pays.filter((p) => p.code === d.legacyCode).reduce((a, p) => a + toMinor(p.amount), 0);
  const balance = toMinor(d.openingBalance) + finalizedNet - paid;
  return { code: d.legacyCode, name: d.name, opening: toMinor(d.openingBalance), finalizedNet, paid, balance, custodyGross, exposureNet: balance + custodyNet };
});

// ---------------- output
mkdirSync(out, { recursive: true });
const plan = { source: file, generatedAt: new Date().toISOString(), settings: { defaultCommissionPct: defaultPct, defaultCreditLimit: defaultLimit, denominations, regions, paymentMethods: methods, expenseCategories: expenseCats, currencies },
  distributors: dists, batches, payments: pays, expenses: expenses.map(({ raw, ...e }) => e), purchases: purchases.map(({ raw, ...p }) => p), reconciliation: recon, issues };
writeFileSync(`${out}/migration-plan.json`, JSON.stringify(plan, null, 2));
const errs = issues.filter((i) => i.level === 'error'), warns = issues.filter((i) => i.level === 'warning'), decs = issues.filter((i) => i.level === 'decision');
const md = [`# تقرير ترحيل تجريبي (Dry-run) — لم يُكتب أي شيء في أي قاعدة بيانات`, '', `المصدر: \`${file.split('/').pop()}\` — ${new Date().toISOString()}`, '',
  `| العنصر | العدد |`, `|---|---|`, `| موزعون | ${dists.length} |`, `| أسطر تسليم | ${lines.length} → دفعات جديدة ${batches.length} |`, `| سندات سداد | ${pays.length} |`, `| مصروفات | ${expenses.length} |`, `| مشتريات | ${purchases.length} |`, '',
  `**أخطاء تمنع الترحيل: ${errs.length} · تحذيرات: ${warns.length} · قرارات مطلوبة: ${decs.length}**`, '',
  '## المطابقة (المحرك الجديد على بيانات Excel)', '', '| الموزع | افتتاحي | معتمد (صافي) | مسدد | الرصيد | عهدة مفتوحة | التعرض (صافي) |', '|---|---:|---:|---:|---:|---:|---:|',
  ...recon.map((r) => `| ${r.code} ${r.name} | ${formatMoney(r.opening)} | ${formatMoney(r.finalizedNet)} | ${formatMoney(r.paid)} | ${formatMoney(r.balance)} | ${formatMoney(r.custodyGross)} | ${formatMoney(r.exposureNet)} |`), '',
  ...(['error', 'warning', 'decision'] as const).flatMap((lv) => { const xs = issues.filter((i) => i.level === lv); return xs.length ? [`## ${lv === 'error' ? 'أخطاء' : lv === 'warning' ? 'تحذيرات' : 'قرارات مطلوبة من الإدارة'}`, '', ...xs.map((i) => `- **${i.sheet}${i.row ? ` / صف ${i.row}` : ''}**: ${i.message}`), ''] : []; }),
].join('\n');
writeFileSync(`${out}/migration-report.md`, md);
console.log(`dry-run complete: ${errs.length} errors, ${warns.length} warnings, ${decs.length} decisions → ${out}/`);
void DEFAULT_SETTINGS;
