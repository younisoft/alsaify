import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { db } from './core/app';
import { runAction } from './core/api';
import { AppError } from './core/errors';
import './services/approvals';
import './services/team';
import './services/distribution';
import './services/finance';
import './services/reports';
import { runBackup } from './services/backup';
import { runDailyScan } from './services/scan';

setGlobalOptions({ region: process.env.FUNCTIONS_REGION || 'europe-west1', maxInstances: 10 });

const ENGINE_MESSAGES: Record<string, string> = {
  INVALID_AMOUNT: 'مبلغ غير صالح', INVALID_RATE: 'سعر صرف غير صالح', INVALID_COMMISSION: 'نسبة عمولة غير صالحة', INVALID_QUANTITY: 'كمية غير صالحة',
  INVALID_UNIT_PRICE: 'سعر وحدة غير صالح', BATCH_NO_LINES: 'الدفعة بلا أسطر', BASE_RATE_MUST_BE_1: 'سعر صرف العملة الأساسية يجب أن يكون 1',
  SUPPLIER_REQUIRED_FOR_CREDIT: 'الشراء الآجل يتطلب مورداً', CASH_ACCOUNT_REQUIRED: 'حدد الحساب النقدي', INVALID_PAID_AMOUNT: 'المبلغ المدفوع غير صالح',
};
export function toHttps(e: unknown): HttpsError {
  if (e instanceof HttpsError) return e;
  if (e instanceof AppError) return new HttpsError(e.code, e.message, e.details);
  const msg = (e as Error)?.message || '';
  const code = msg.split(':')[0];
  if (ENGINE_MESSAGES[code]) return new HttpsError('invalid-argument', ENGINE_MESSAGES[code]);
  if (/^JOURNAL_/.test(code)) { logger.error('journal error', e); return new HttpsError('internal', 'قيد محاسبي غير متوازن — تم رفض العملية'); }
  logger.error('unexpected', e);
  return new HttpsError('internal', 'حدث خطأ غير متوقع. لم يتم حفظ أي تغيير.');
}

/** The only write path. Every mutation runs in one Firestore transaction with idempotency. */
export const api = onCall({ enforceAppCheck: process.env.ENFORCE_APP_CHECK === 'true', timeoutSeconds: 120, memory: '512MiB' }, async (req) => {
  const { action, input, requestId } = (req.data || {}) as { action: string; input: unknown; requestId: string };
  const t = req.auth?.token;
  const caller = req.auth ? { uid: req.auth.uid, email: t?.email, emailVerified: t?.email_verified === true, name: t?.name as string | undefined } : null;
  try { return await runAction(db(), caller, action, input, requestId); } catch (e) { throw toHttps(e); }
});

export const dailyScan = onSchedule({ schedule: '0 6 * * *', timeZone: 'Asia/Aden' }, async () => { logger.info(await runDailyScan(db())); });
export const dailyBackup = onSchedule({ schedule: '30 2 * * *', timeZone: 'Asia/Aden', timeoutSeconds: 540, memory: '1GiB' }, async () => { logger.info(await runBackup(db(), 'scheduler')); });
