import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const callable = httpsCallable(functions, 'api', { timeout: 120000 });
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

type L = () => void;
const subs = new Set<L>();
let inflight = 0;
const bump = (d: number) => { inflight += d; subs.forEach((f) => f()); };
export const syncState = { get inflight() { return inflight; }, subscribe(f: L) { subs.add(f); return () => { subs.delete(f); }; } };

export class ApiError extends Error { constructor(message: string, public code?: string) { super(message); } }

/** Every write and every report goes through the server. requestId makes retries safe (idempotent). */
/** Remove undefined values (the callable SDK would send them as null). */
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  return v;
}

export async function api<T = any>(action: string, input: unknown = {}, requestId = uuid()): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    throw new ApiError('لا يوجد اتصال بالإنترنت. لم يتم حفظ أي شيء — أعد المحاولة عند عودة الاتصال.', 'offline');
  bump(1);
  try {
    const r = await callable({ action, input: clean(input), requestId });
    return r.data as T;
  } catch (e: any) {
    let code = String(e?.code || '').replace('functions/', '');
    // The callable SDK reports "no response at all" as code internal with the bare message "internal".
    // Real server errors always carry an Arabic message, so this is a connectivity failure.
    if (code === 'internal' && /^internal(\s*\[\d+\])?$/i.test(String(e?.message || '').trim())) code = 'unavailable';
    const msg = code === 'unavailable' || code === 'deadline-exceeded' ? 'تعذر الاتصال بالخادم — تحقق من الإنترنت وأعد المحاولة. لم يُحفظ شيء مكرر.'
      : e?.message && !/^internal$/i.test(e.message) ? e.message : 'حدث خطأ غير متوقع';
    throw new ApiError(msg, code);
  } finally { bump(-1); }
}
export { uuid };
