// Client-side helpers for reading bill_events. The Oct 2026 migration adds
// `action_date` (the real date of the congressional action) - until it's
// run, the query falls back to the older columns and uses the time the
// change was detected instead.

export type BillEventRow = {
  id: string;
  bill_id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
  action_date?: string | null;
  details?: any;
  bills?: { title: string } | { title: string }[] | null;
};

/** The date an event actually happened in Congress (falls back to detection time). */
export function eventDate(e: Pick<BillEventRow, "action_date" | "occurred_at">): string {
  return e.action_date ?? e.occurred_at;
}

export async function fetchEvents(
  supabase: any,
  opts: { billIds?: string[]; since?: string; limit?: number; withTitles?: boolean },
): Promise<{ rows: BillEventRow[]; error: string | null }> {
  const base = `id, bill_id, event_type, summary, occurred_at${opts.withTitles ? ", bills(title)" : ""}`;
  const build = (cols: string) => {
    let q = supabase.from("bill_events").select(cols).order("occurred_at", { ascending: false }).limit(opts.limit ?? 100);
    if (opts.billIds) q = q.in("bill_id", opts.billIds);
    if (opts.since) q = q.gte("occurred_at", opts.since);
    return q;
  };
  if (opts.billIds && opts.billIds.length === 0) return { rows: [], error: null };
  let { data, error } = await build(`${base}, action_date, details`);
  if (error && /action_date|details/.test(error.message ?? "")) {
    ({ data, error } = await build(base));
  }
  return { rows: (data as BillEventRow[]) ?? [], error: error?.message ?? null };
}

const LAST_VISIT_KEY = "billtracker-last-dashboard-visit";

/**
 * Returns when the person last opened the dashboard (before this visit), and
 * records this visit. A visit within the same hour doesn't count as "new",
 * so refreshing the page doesn't wipe the catch-up list.
 */
export function readAndMarkVisit(): string | null {
  try {
    const raw = window.localStorage.getItem(LAST_VISIT_KEY);
    const prev = raw ? JSON.parse(raw) : null; // { previous, current }
    const now = Date.now();
    if (prev?.current && now - prev.current < 60 * 60_000) {
      return prev.previous ? new Date(prev.previous).toISOString() : null;
    }
    window.localStorage.setItem(LAST_VISIT_KEY, JSON.stringify({ previous: prev?.current ?? null, current: now }));
    return prev?.current ? new Date(prev.current).toISOString() : null;
  } catch {
    return null;
  }
}
