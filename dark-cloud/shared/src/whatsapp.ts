/** Yemeni numbers: 7XXXXXXXX (mobile, 9 digits) or with leading 0 / +967 / 00967. */
export function normalizeYemeniPhone(raw: string): { local: string; international: string } | null {
  let s = (raw || '').replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('967')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  if (!/^\d+$/.test(s)) return null;
  if (!/^7[0-9]{8}$/.test(s) && !/^[1-9][0-9]{6,7}$/.test(s)) return null;
  return { local: s, international: '967' + s };
}

export function whatsappLink(international: string, text: string): string {
  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`;
}
