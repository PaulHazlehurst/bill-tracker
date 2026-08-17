"use client";

// Tracks which "enacted" celebrations someone has already seen, so the
// confetti moment fires exactly once per bill per person - not every time
// they revisit a bill's page after it's already become law.
const KEY = "billtracker-seen-enacted";

export function hasSeenEnactedCelebration(billId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const seen: string[] = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return seen.includes(billId);
  } catch {
    return true;
  }
}

export function markEnactedCelebrationSeen(billId: string) {
  if (typeof window === "undefined") return;
  try {
    const seen: string[] = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    if (!seen.includes(billId)) {
      seen.push(billId);
      window.localStorage.setItem(KEY, JSON.stringify(seen.slice(-200))); // cap growth
    }
  } catch {
    // non-fatal
  }
}
