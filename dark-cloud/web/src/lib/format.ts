import { formatMoney, formatDate, fromMinor } from '@dc/shared';
export const money = (minor: number | null | undefined, precision = 0) => (minor == null ? '—' : formatMoney(minor, precision));
export const date = (iso?: string | null) => formatDate(iso);
export const major = (minor?: number | null) => (minor == null ? 0 : fromMinor(minor));
export const tsDate = (t: any) => {
  if (!t) return '—';
  const d: Date = t.toDate ? t.toDate() : new Date(t);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Aden', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
};
