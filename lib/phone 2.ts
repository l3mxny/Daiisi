// Digits-only (optionally with a leading "+"), 7-15 digits — a loose sanity
// check, not real phone validation. The phone number here is purely a
// farmer identifier (no OTP/password), so what matters is that the same
// farmer's number normalizes the same way every time they type it, not
// that it's a real, reachable number.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : digits;
}
