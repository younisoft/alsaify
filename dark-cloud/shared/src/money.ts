/**
 * Money is stored everywhere as INTEGER minor units (1/100 of the currency unit).
 * This avoids floating-point drift in sums. Display precision (e.g. 0 decimals for
 * YER) is applied with roundToPrecision() at the points the accounting policy says so.
 */
export const SCALE = 100;
export type Minor = number;

const clean = (x: number) => Number(x.toPrecision(15));

/** Round half away from zero. */
export function roundHalfUp(x: number): number {
  const c = clean(x);
  return Math.sign(c) * Math.round(Math.abs(c));
}

/** Major units (e.g. 1500.5 YER) -> minor units (150050). */
export function toMinor(major: number | string): Minor {
  const n = typeof major === 'string' ? Number(major.replace(/[,\s]/g, '')) : major;
  if (!Number.isFinite(n)) throw new Error('INVALID_AMOUNT');
  return roundHalfUp(n * SCALE);
}

export function fromMinor(minor: Minor): number {
  return minor / SCALE;
}

/** Round a minor amount to `precision` decimal places of the major unit (0..2). */
export function roundToPrecision(minor: number, precision: number): Minor {
  const p = Math.min(2, Math.max(0, Math.trunc(precision)));
  const unit = 10 ** (2 - p);
  return roundHalfUp(minor / unit) * unit;
}

/** Percentage of an amount, rounded to precision. pct is a PERCENT (10 = 10%). */
export function percentOf(minor: Minor, pct: number, precision: number): Minor {
  return roundToPrecision(clean(minor * pct) / 100, precision);
}

/** Original amount × exchange rate -> base-currency amount (rounded to precision). */
export function applyRate(originalMinor: Minor, rate: number, precision: number): Minor {
  if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('INVALID_RATE');
  return roundToPrecision(clean(originalMinor * rate), precision);
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce((a, b) => a + b, 0);
}

export function isMinor(x: unknown): x is Minor {
  return typeof x === 'number' && Number.isSafeInteger(x);
}

/** Display: Latin digits, thousands separators. */
export function formatMoney(minor: Minor, precision = 0, currencyLabel?: string): string {
  const v = fromMinor(minor);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return currencyLabel ? `${s} ${currencyLabel}` : s;
}
