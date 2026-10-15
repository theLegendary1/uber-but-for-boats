/** A US phone number as typed ("(516) 555-0199", "516.555.0199", "+1 516...") in E.164 form (+15165550199), or '' if it isn't one. */
export function toE164(phone) {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}
