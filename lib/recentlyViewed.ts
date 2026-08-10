"use client";

// Purely client-side (localStorage) - no database write, no API call.
// Just remembers the last few bills someone actually looked at, so the
// dashboard can surface "jump back in" without any new backend cost.

const KEY = "billtracker-recently-viewed";
const MAX_ITEMS = 8;

export type RecentBill = { billId: string; title: string; viewedAt: string };

export function recordView(billId: string, title: string) {
  if (typeof window === "undefined") return;
  try {
    const existing: RecentBill[] = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    const filtered = existing.filter((b) => b.billId !== billId);
    filtered.unshift({ billId, title, viewedAt: new Date().toISOString() });
    window.localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, MAX_ITEMS)));
  } catch {
    // localStorage can throw in private-browsing edge cases - not worth surfacing
  }
}

export function getRecentlyViewed(): RecentBill[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
