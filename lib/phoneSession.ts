const STORAGE_KEY = "daiisi_phone";

// No password, no OTP — the phone number itself is the identifier. Stored
// client-side only; the server never issues a session token for it.
export function getStoredPhone(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredPhone(phone: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, phone);
  } catch {
    // Private browsing or storage disabled — sign-in still works for this
    // tab via React state, it just won't survive a refresh.
  }
}

export function clearStoredPhone(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
