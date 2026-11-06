// Turns a morning's bill changes into bell notifications: one per person
// per bill that moved, for everyone following the bill. Pure; tested in
// tests/notifications.test.ts.

import { citationFor } from "@/lib/billMeta";
import type { NewNotification } from "@/lib/notifications";

type Tracker = { bill_id: string; user_id: string };
type Event = { id: string; bill_id: string; summary: string; event_type: string; bills?: { title?: string } | { title?: string }[] | null };

export function billNotifications(trackers: Tracker[], eventsByBill: Map<string, Event[]>): NewNotification[] {
  const out: NewNotification[] = [];
  const seen = new Set<string>();
  for (const t of trackers) {
    const evs = eventsByBill.get(t.bill_id);
    if (!evs?.length || seen.has(`${t.user_id}|${t.bill_id}`)) continue;
    seen.add(`${t.user_id}|${t.bill_id}`);
    const lead = evs.find((e) => e.event_type === "status_change") ?? evs[evs.length - 1];
    const bill = Array.isArray(evs[0].bills) ? evs[0].bills[0] : evs[0].bills;
    const title = bill?.title ? `${citationFor(t.bill_id)}: ${shorten(bill.title, 70)}` : citationFor(t.bill_id);
    const more = evs.length > 1 ? ` (and ${evs.length - 1} more change${evs.length > 2 ? "s" : ""})` : "";
    out.push({
      userId: t.user_id,
      kind: "bill_update",
      title,
      body: `${lead.summary}${more}`,
      url: `/bill/${t.bill_id}`,
      dedupeKey: `bill:${t.bill_id}:${evs.map((e) => e.id).sort().join(",").slice(-120)}`,
    });
  }
  return out;
}

function shorten(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
