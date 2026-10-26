import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCommitteeMeetings } from "@/lib/meetings";

// Skip the usage log (it writes to the real database).
vi.mock("@/lib/apiUsageTracker", () => ({ trackedFetch: (url: string, init: RequestInit) => fetch(url, init) }));

// A tiny in-memory stand-in for the Supabase client: just the calls the sync makes.
function fakeDb(seed: Record<string, any[]> = {}) {
  const tables: Record<string, any[]> = { sync_state: [], committee_meetings: [], api_call_log: [], ...seed };
  const keyOf: Record<string, string> = { sync_state: "key", committee_meetings: "event_id" };
  function query(table: string) {
    let rows = tables[table] ?? [];
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => ((rows = rows.filter((r) => r[c] === v)), q),
      in: (c: string, vs: any[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
      insert: async (r: any) => (tables[table].push(...[r].flat()), { error: null }),
      upsert: async (input: any) => {
        const k = keyOf[table];
        for (const r of [input].flat()) {
          const i = tables[table].findIndex((x) => x[k] === r[k]);
          if (i >= 0) tables[table][i] = { ...tables[table][i], ...r };
          else tables[table].push(r);
        }
        return { error: null };
      },
    };
    return q;
  }
  return { from: query, tables };
}

const listItem = (id: string, updated: string, chamber = "House") => ({ eventId: id, chamber, updateDate: updated, url: `https://api.congress.gov/v3/committee-meeting/119/${chamber.toLowerCase()}/${id}?format=json` });
const detail = (id: string, chamber = "House") => ({ committeeMeeting: { eventId: id, congress: 119, chamber, date: "2026-10-27T14:00:00Z", title: `Meeting ${id}`, type: "Hearing", meetingStatus: "Scheduled", committees: [], relatedItems: { bills: [{ type: "HR", number: "1", congress: 119 }] } } });

describe("committee meeting sync", () => {
  let calls: string[] = [];
  beforeEach(() => {
    process.env.CONGRESS_API_KEY = "test-key";
    calls = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (/committee-meeting\/119\/house$/.test(u.pathname)) return json({ committeeMeetings: [listItem("1", "2026-10-22 19:04:11+00:00"), listItem("2", "2026-10-23 08:00:00+00:00")] });
      if (/committee-meeting\/119\/senate$/.test(u.pathname)) return json({ committeeMeetings: [listItem("3", "2026-10-21 10:00:00+00:00", "Senate")] });
      const id = u.pathname.split("/").pop()!;
      return json(detail(id, id === "3" ? "Senate" : "House"));
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves new meetings, then only re-fetches ones that changed", async () => {
    const db = fakeDb();
    const first = await syncCommitteeMeetings(db, 20_000);
    expect(first).toMatchObject({ listed: 3, changed: 3, saved: 3, complete: true });
    expect(db.tables.committee_meetings.map((m) => m.event_id).sort()).toEqual(["1", "2", "3"]);
    expect(db.tables.committee_meetings[0]).toMatchObject({ bill_ids: ["hr-1-119"], source_updated_at: "2026-10-22T19:04:11.000Z" });

    // The cursor moved forward and the lock was released.
    const state = db.tables.sync_state.find((s) => s.key === "committee_meetings");
    expect(state.cursor).toBeTruthy();
    expect(state.locked_until).toBeNull();

    // Second run: same edit times, so no detail requests at all.
    calls = [];
    const second = await syncCommitteeMeetings(db, 20_000);
    expect(second).toMatchObject({ listed: 3, changed: 0, saved: 0, complete: true });
    expect(calls.every((c) => /committee-meeting\/119\/(house|senate)\?/.test(c))).toBe(true);
    // And the list request asked only for records edited since the last sync.
    expect(new URL(calls[0]).searchParams.get("fromDateTime")).toBe(state.cursor.replace(/\.\d{3}Z$/, "Z"));
  });

  it("stays out of the way while another sync holds the lock", async () => {
    const db = fakeDb({ sync_state: [{ key: "committee_meetings", cursor: null, last_run_at: null, locked_until: new Date(Date.now() + 60_000).toISOString() }] });
    expect(await syncCommitteeMeetings(db, 20_000)).toMatchObject({ skipped: "another sync is running" });
    expect(calls).toHaveLength(0);
  });
});
