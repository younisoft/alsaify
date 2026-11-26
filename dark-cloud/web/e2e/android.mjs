/**
 * Android / PWA audit (Pixel 7 emulation). Requires: emulators + `vite preview --mode emulator --port 4173`,
 * and data created by e2e.mjs. Run: PW_CHROMIUM=... node web/e2e/android.mjs
 */
import { chromium, devices } from 'playwright';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SHOTS = new URL('../../docs/screenshots/android/', import.meta.url).pathname;
import { mkdirSync } from 'node:fs'; mkdirSync(SHOTS, { recursive: true });
const res = []; const errors = [];
const rec = (ok, name, detail = '') => { res.push([ok, name, detail]); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
// a real (non-incognito) profile: Chrome only offers installation outside incognito
const { defaultBrowserType, ...pixel } = devices['Pixel 7']; void defaultBrowserType;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'dc-android-')), { ...pixel, locale: 'ar', ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
const browser = { close: () => ctx.close() };
const page = ctx.pages()[0] ?? await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => { if (process.env.DEBUG_NET && /5001|8085|9099/.test(r.url())) console.log('REQFAIL', r.url().slice(0, 90), r.failure()?.errorText); });
page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|ERR_INTERNET_DISCONNECTED|offline|Could not reach Cloud Firestore/i.test(m.text())) errors.push(m.text().slice(0, 160)); });

await page.goto(BASE + '/');
await page.getByPlaceholder('gm@example.test').fill('gm@example.test');
await page.getByRole('button', { name: 'دخول تجريبي' }).click();
await page.getByRole('heading', { name: /مرحباً/ }).waitFor({ timeout: 30000 });

// ---------- PWA installability (Chrome's own checks)
const cdp = await ctx.newCDPSession(page);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.getByRole('heading', { name: /مرحباً/ }).waitFor({ timeout: 30000 });
const man = await cdp.send('Page.getAppManifest');
rec(!man.errors?.length, 'Manifest parses without errors', JSON.stringify(man.errors || []));
const inst = await cdp.send('Page.getInstallabilityErrors');
rec(!inst.installabilityErrors.length, 'Chrome installability check: no errors', JSON.stringify(inst.installabilityErrors));
const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
rec(controlled, 'Service worker installed and controlling the page');
const parsed = JSON.parse(man.data || '{}');
rec(parsed.display === 'standalone' && parsed.short_name === 'DARK-CLOUD' && parsed.start_url && parsed.scope === '/' && parsed.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'),
  'Manifest: standalone, short_name, start_url, scope, maskable 512 icon');

// ---------- every route on a phone: no horizontal scroll, touch targets
const firstHref = async (path, re) => { await page.goto(BASE + path); await page.waitForTimeout(1500); return page.locator(`a[href^="${re}"]`).first().getAttribute('href').catch(() => null); };
const distId = await (async () => { await page.goto(BASE + '/distributors'); await page.waitForTimeout(1500); await page.locator('ul li button').first().click(); await page.waitForTimeout(800); return new URL(page.url()).pathname; })();
const batch = await (async () => { await page.goto(BASE + '/batches'); await page.waitForTimeout(1500); await page.locator('ul li button').first().click(); await page.waitForTimeout(800); return new URL(page.url()).pathname; })();
const pay = await (async () => { await page.goto(BASE + '/payments'); await page.waitForTimeout(1500); await page.locator('ul li button').first().click(); await page.waitForTimeout(800); return new URL(page.url()).pathname; })();
void firstHref;
const routes = ['/', '/distributors', distId, '/batches', batch, '/payments', pay, '/collection', '/cash', '/expenses', '/purchases', '/suppliers', '/inventory', '/assets', '/reports', '/tasks', '/approvals', '/archive', '/team', '/audit', '/settings'];
let i = 0;
for (const r of routes) {
  i++;
  await page.goto(BASE + r); await page.waitForTimeout(1800);
  const m = await page.evaluate(() => {
    const ov = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const small = [...document.querySelectorAll('button, a[href], select, input:not([type=checkbox]):not([type=hidden])')].filter((e) => {
      const b = e.getBoundingClientRect(); if (!b.width || !b.height) return false;
      if (e.closest('table, p, nav[aria-label="مسار التنقل"]')) return false;   // inline links inside sentences (WCAG 2.5.8 inline exception), breadcrumbs
      return b.height < 36;
    }).map((e) => (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 25));
    return { ov, small };
  });
  rec(m.ov <= 1, `No horizontal scroll: ${r}`, m.ov > 1 ? `${m.ov}px` : '');
  rec(m.small.length === 0, `Touch targets ≥36px: ${r}`, m.small.slice(0, 6).join(' | '));
  await page.screenshot({ path: `${SHOTS}${String(i).padStart(2, '0')}${r.replace(/\//g, '_') || '_home'}.png` });
}

// ---------- dialogs fit the screen
await page.goto(BASE + '/batches'); await page.getByRole('button', { name: 'دفعة جديدة' }).click();
const box = await page.getByRole('dialog').boundingBox();
rec(box && box.width <= 412 && box.x >= 0, 'Form dialog fits the phone width (bottom sheet)');
await page.screenshot({ path: SHOTS + '30-dialog.png' });
await page.keyboard.press('Escape');

// ---------- offline behaviour
await ctx.setOffline(true);
await page.waitForTimeout(500);
await page.getByRole('status').filter({ hasText: 'غير متصل' }).first().waitFor({ timeout: 5000 }).then(() => rec(true, 'Offline state shown in header'), (e) => rec(false, 'Offline state shown in header', e.message));
await page.getByRole('button', { name: 'دفعة جديدة' }).click();
const disabled = await page.getByRole('dialog').getByRole('button', { name: 'حفظ وتسليم' }).isDisabled();
rec(disabled, 'Offline: save button disabled — nothing can appear saved');
await page.screenshot({ path: SHOTS + '31-offline-form.png' });
await page.keyboard.press('Escape');
await page.reload().catch(() => {});
await page.getByText(/لا يوجد اتصال بالإنترنت|تعذر الوصول إلى الخادم/).first().waitFor({ timeout: 20000 }).then(() => rec(true, 'Offline launch: app shell opens from cache with a clear offline screen (no data)'), (e) => rec(false, 'Offline launch screen', e.message));
await page.screenshot({ path: SHOTS + '32-offline-launch.png' });
rec(!(await page.getByText(/internal|غير مصرح/).count()), 'Offline launch: no technical text and no false "unauthorized"');
await ctx.setOffline(false);
await page.getByRole('heading', { name: 'الدفعات والتسليمات', level: 1 }).waitFor({ timeout: 40000 }).then(() => rec(true, 'Back online: recovers automatically on the same page with live data'), async (e) => { rec(false, 'Back online: recovers automatically', e.message); await page.screenshot({ path: SHOTS + 'FAIL-reconnect.png' }); console.log('BODY', (await page.textContent('body')).slice(0, 200), 'onLine=', await page.evaluate(() => navigator.onLine)); });

// ---------- nothing sensitive cached
const audit = await page.evaluate(async () => {
  const urls = [];
  for (const k of await caches.keys()) for (const req of await (await caches.open(k)).keys()) urls.push(req.url);
  const dbs = (await indexedDB.databases?.())?.map((d) => d.name) ?? [];
  return { urls, dbs };
});
const bad = audit.urls.filter((u) => /googleapis\.com\/(?!css)|firestore|cloudfunctions|identitytoolkit|securetoken|:5001|:8085|:9099|\/api\b|europe-west1/.test(u));
rec(bad.length === 0, `Service-worker cache holds only the public app shell (${audit.urls.length} files)`, bad.join(' '));
rec(!audit.dbs.some((n) => /firestore/i.test(n)), 'No Firestore data persisted on the device (IndexedDB)', audit.dbs.join(', '));

await browser.close();
const f = res.filter((r) => !r[0]);
console.log(`\n==== ${res.length - f.length} passed, ${f.length} failed ====`);
console.log(errors.length ? 'Page errors:\n' + [...new Set(errors)].join('\n') : 'No page errors.');
process.exit(f.length ? 1 : 0);
