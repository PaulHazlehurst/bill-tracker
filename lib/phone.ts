// Phone numbers, safe to use in the browser and on the server.

/**
 * A phone number in the international format Twilio needs (+14105550123).
 * US numbers can be typed any common way; other countries need their +code.
 * Returns null when it can't be a real number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

