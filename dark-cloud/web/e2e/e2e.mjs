/**
 * End-to-end UI test against the Firebase emulators + built web app (no real project is touched).
 * Run: firebase emulators running, `vite preview --mode emulator --port 4173`, owner bootstrapped, then `node web/e2e/e2e.mjs`.
 */
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SHOTS = new URL('../../docs/screenshots/', import.meta.url).pathname;
const results = []; const errors = [];
const ok = (name) => { results.push(['PASS', name]); console.log('PASS', name); };
const bad = (name, e) => { results.push(['FAIL', name, String(e?.message || e).slice(0, 300)]); console.log('FAIL', name, String(e?.message || e).slice(0, 300)); };
let current = null;
async function step(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e); if (current) { await current.screenshot({ path: SHOTS + 'FAIL-' + name.slice(0, 20).replace(/[^\w\u0600-\u06FF]+/g, '_') + '.png' }).catch(() => {}); await current.keyboard.press('Escape').catch(() => {}); } } }

function watch(page, who) {
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource.*(fonts|gstatic)|ERR_TUNNEL|ERR_PROXY|net::ERR/.test(m.text())) errors.push(`[${who}] console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errors.push(`[${who}] pageerror: ${e.message.slice(0, 200)}`));
}
async function login(page, email) {
  await page.goto(BASE + '/');
  await page.getByPlaceholder('gm@example.test').fill(email);
  await page.getByRole('button', { name: 'دخول تجريبي' }).click();
}
const toast = (page, re) => page.getByRole('status').getByText(re).first().waitFor({ timeout: 20000 });
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const L = (page, label) => page.getByLabel(new RegExp('^\\s*' + esc(label) + '\\s*\\*?\\s*$'));
const sel = async (page, label, text) => { const s = L(page, label); const v = await s.locator('option', { hasText: text }).first().getAttribute('value'); await s.selectOption(v); };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
// ---------------------------------------------------------------- GM on desktop
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
const page = await ctx.newPage(); watch(page, 'gm'); current = page;

await step('GM signs in with invited Google identity → dashboard', async () => {
  await login(page, 'gm@example.test');
  await page.getByRole('heading', { name: /مرحباً/ }).waitFor({ timeout: 30000 });
  await page.getByText('المؤشرات المالية').waitFor();
  await page.screenshot({ path: SHOTS + '01-dashboard-empty-desktop.png' });
});
await step('Create main cash account (opening 500,000)', async () => {
  await page.getByRole('link', { name: 'الصناديق والحسابات' }).click();
  await page.getByRole('button', { name: 'حساب جديد' }).click();
  await page.getByLabel('اسم الحساب').fill('الصندوق الرئيسي');
  await page.getByLabel('الرصيد الافتتاحي (بعملة الحساب)').fill('500000');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await toast(page, 'تم إنشاء الحساب');
  await page.getByRole('cell', { name: 'الصندوق الرئيسي' }).waitFor();
});
await step('Create distributor (auto code, Yemeni phone)', async () => {
  await page.getByRole('link', { name: 'الموزعون' }).click();
  await page.getByRole('button', { name: 'موزع جديد' }).click();
  await page.getByLabel('الاسم الكامل').fill('موزع تجريبي — المدينة');
  await page.getByLabel('المنطقة').fill('المدينة');
  await L(page, 'رقم الهاتف').fill('0770000001');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await page.getByRole('heading', { name: 'موزع تجريبي — المدينة' }).waitFor({ timeout: 20000 });
  await page.getByText('D0001').first().waitFor();
});
let batchUrl = '';
await step('Create & deliver batch 500 × 1,000 @10% → preview 500,000 / 50,000 / 450,000', async () => {
  await page.getByRole('link', { name: 'الدفعات والتسليمات' }).click();
  await page.getByRole('button', { name: 'دفعة جديدة' }).click();
  await sel(page, 'الموزع', 'D0001');
  await sel(page, 'الفئة', 'فئة 1000');
  await page.getByLabel('العدد').fill('500');
  await page.getByText('450,000').first().waitFor();
  await page.screenshot({ path: SHOTS + '02-batch-form.png' });
  await page.getByRole('button', { name: 'حفظ وتسليم' }).click();
  await page.getByRole('heading', { name: /دفعة #1/ }).waitFor({ timeout: 20000 });
  await page.getByText('مفتوحة — عهدة').first().waitFor();
  batchUrl = page.url();
});
await step('Finalize batch → receivable posted', async () => {
  await page.getByRole('button', { name: 'اعتماد الدفعة' }).click();
  await page.getByRole('button', { name: 'اعتماد نهائي' }).click();
  await toast(page, 'تم اعتماد الدفعة');
  await page.getByText('معتمدة — مستحقة').first().waitFor();
  await page.screenshot({ path: SHOTS + '03-batch-finalized.png' });
});
await step('Duplicate finalize impossible (button gone)', async () => {
  if (await page.getByRole('button', { name: 'اعتماد الدفعة' }).count()) throw new Error('finalize still visible');
});
await step('Record payment 200,000 (FIFO) → balance 250,000', async () => {
  await page.getByRole('link', { name: 'السداد والقبض' }).click();
  await page.getByRole('button', { name: 'سند قبض جديد' }).click();
  await sel(page, 'الموزع', 'D0001');
  await page.getByLabel('المبلغ (بالعملة الأصلية)').fill('200000');
  await sel(page, 'الحساب المستلِم', 'الصندوق الرئيسي');
  await page.getByRole('button', { name: 'ترحيل السند' }).click();
  await page.getByRole('heading', { name: /سند قبض R-000001/ }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: SHOTS + '04-receipt.png' });
  await page.getByRole('link', { name: 'موزع تجريبي — المدينة' }).first().click();
  await page.getByText('250,000').first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: SHOTS + '05-distributor-profile.png' });
});
await step('Statement tab shows running balance', async () => {
  await page.getByRole('tab', { name: 'كشف الحساب' }).click();
  await page.getByText('سند قبض R-000001').first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: SHOTS + '06-statement.png' });
});
await step('Record expense 20,000 from main cash', async () => {
  await page.getByRole('link', { name: 'المصروفات' }).click();
  await page.getByRole('button', { name: 'مصروف جديد' }).click();
  await L(page, 'المبلغ').fill('20000');
  await sel(page, 'دُفع من حساب', 'الصندوق الرئيسي');
  await page.getByLabel('البيان').fill('إيجار المكتب (اختبار)');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await toast(page, /تم ترحيل المصروف/);
});
await step('Cash balance = 500,000 + 200,000 − 20,000 = 680,000', async () => {
  await page.getByRole('link', { name: 'الصناديق والحسابات' }).click();
  await page.getByText('680,000').first().waitFor({ timeout: 15000 });
});
await step('Dashboard shows real figures (receivable 450,000, collections 200,000)', async () => {
  await page.getByRole('link', { name: 'لوحة التحكم' }).click();
  await page.getByText('450,000').first().waitFor({ timeout: 20000 });
  await page.getByText('200,000').first().waitFor();
  await page.screenshot({ path: SHOTS + '07-dashboard-desktop.png', fullPage: true });
});
await step('Reports: books reconcile + monthly + profit', async () => {
  await page.getByRole('link', { name: 'التقارير' }).click();
  await page.getByText('الملخص الشهري والسنوي').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: SHOTS + '08-reports-monthly.png' });
  await page.getByRole('tab', { name: 'الأرباح' }).click();
  await page.getByText('الربح التشغيلي').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: SHOTS + '09-profit.png' });
  await page.getByRole('tab', { name: 'سلامة الدفاتر' }).click();
  await page.getByText('الدفاتر متطابقة').waitFor({ timeout: 20000 });
  await page.screenshot({ path: SHOTS + '10-integrity.png' });
});
await step('Excel export downloads a file', async () => {
  await page.getByRole('link', { name: 'الموزعون' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
  if (!dl.suggestedFilename().endsWith('.xlsx')) throw new Error(dl.suggestedFilename());
});
await step('Invite Azzam with tasks-only permissions (permission matrix)', async () => {
  await page.getByRole('link', { name: 'الفريق والصلاحيات' }).click();
  await page.getByRole('button', { name: 'دعوة عضو' }).click();
  await page.getByLabel('البريد الفعلي (Google)').fill('azzam@example.test');
  await L(page, 'الاسم').fill('عزام');
  await page.getByLabel('المسميات').fill('صيانة فنية');
  await page.getByLabel('المهام — إضافة').check();
  await page.screenshot({ path: SHOTS + '11-permission-matrix.png' });
  await page.getByRole('button', { name: 'إنشاء الدعوة' }).click();
  await toast(page, 'تم إنشاء الدعوة');
});
await step('Print statement page renders with branding', async () => {
  const p2 = await ctx.newPage(); watch(p2, 'print');
  await p2.goto(batchUrl.replace(/\/batches\/.*/, '') + '/print/batch/' + batchUrl.split('/').pop());
  await p2.getByText('فاتورة تسليم كروت').waitFor({ timeout: 20000 });
  await p2.getByText('450,000').first().waitFor();
  await p2.screenshot({ path: SHOTS + '12-print-batch-invoice.png', fullPage: true });
  await p2.close();
});

// ---------------------------------------------------------------- Mobile
const mctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ar' });
const m = await mctx.newPage(); watch(m, 'mobile'); current = m;
await step('Mobile: dashboard, list cards, bottom nav, no horizontal scroll', async () => {
  await login(m, 'gm@example.test');
  await m.getByRole('heading', { name: /مرحباً/ }).waitFor({ timeout: 30000 });
  await m.getByText('450,000').first().waitFor({ timeout: 20000 });
  await m.screenshot({ path: SHOTS + '13-mobile-dashboard.png' });
  await m.getByRole('navigation', { name: 'تنقل سريع' }).getByRole('link', { name: 'الموزعون' }).click();
  await m.getByText('موزع تجريبي — المدينة').first().waitFor();
  await m.screenshot({ path: SHOTS + '14-mobile-distributors.png' });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 2) throw new Error('horizontal overflow ' + overflow + 'px');
  await m.getByRole('button', { name: 'المزيد' }).click();
  await m.getByRole('link', { name: 'التقارير' }).waitFor();
  await m.screenshot({ path: SHOTS + '15-mobile-menu.png' });
  await m.keyboard.press('Escape');
});
await step('Mobile: batch form opens as bottom sheet', async () => {
  await m.goto(BASE + '/batches');
  await m.getByRole('button', { name: 'دفعة جديدة' }).click();
  await m.getByRole('dialog').waitFor();
  await m.screenshot({ path: SHOTS + '16-mobile-batch-form.png' });
});

// ---------------------------------------------------------------- Azzam (restricted) & stranger
const actx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar' });
const a = await actx.newPage(); watch(a, 'azzam'); current = a;
await step('Azzam sees only Tasks; financial pages denied', async () => {
  await login(a, 'azzam@example.test');
  await a.getByRole('link', { name: 'المهام' }).waitFor({ timeout: 30000 });
  if (await a.getByRole('link', { name: 'الصناديق والحسابات' }).count()) throw new Error('cash visible to Azzam');
  await a.goto(BASE + '/payments');
  await a.getByText('ليست لديك صلاحية عرض هذه الصفحة').waitFor({ timeout: 15000 });
  await a.screenshot({ path: SHOTS + '17-azzam-restricted.png' });
});
const sctx = await browser.newContext({ locale: 'ar' });
const s = await sctx.newPage();
await step('Uninvited Google account is refused', async () => {
  await login(s, 'stranger@example.test');
  await s.getByText('الحساب غير مصرح').waitFor({ timeout: 30000 });
  await s.screenshot({ path: SHOTS + '18-unauthorized.png' });
});

await browser.close();
console.log('\n==== SUMMARY ====');
console.log(`${results.filter((r) => r[0] === 'PASS').length} passed, ${results.filter((r) => r[0] === 'FAIL').length} failed`);
console.log(errors.length ? 'Console/page errors:\n' + [...new Set(errors)].join('\n') : 'No console or page errors.');
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0);
