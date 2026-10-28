import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBoardPages, searchStateBills } from "@/lib/drugBoardsSync";

// In-memory stand-in for the parts of the Supabase client the sync uses.
function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = { board_documents: [], state_bills: [], sync_state: [], ...seed };
  function query(table: string) {
    let rows = tables[table] ?? [];
    let pendingUpdate: any = null;
    const q: any = {
      select: (_c?: string, opts?: { count?: string; head?: boolean }) => ((q.countOnly = !!opts?.head), q),
      order: () => q,
      eq: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] === v);
        if (pendingUpdate) for (const r of rows) Object.assign(r, pendingUpdate);
        return q;
      },
      in: (c: string, vs: any[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), q),
      limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve(q.countOnly ? { count: rows.length, error: null } : { data: rows, error: null }),
      insert: async (input: any) => (tables[table].push(...[input].flat()), { error: null }),
      upsert: async (input: any, opts?: any) => {
        const key = opts?.onConflict ?? "key";
        for (const r of [input].flat()) {
          const i = tables[table].findIndex((x) => x[key] === r[key]);
          if (i >= 0) {
            if (!opts?.ignoreDuplicates) tables[table][i] = { ...tables[table][i], ...r };
          } else tables[table].push({ ...r });
        }
        return { error: null };
      },
      update: (patch: any) => ((pendingUpdate = patch), q),
    };
    return q;
  }
  return { from: query, tables };
}

const html = (links: string[]) => `<ul>${links.map((l) => `<li><a href="${l}">${l.split("/").pop()}</a></li>`).join("")}</ul>`;

describe("board page watcher", () => {
  let pageHtml = "";
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("broken") ? new Response("nope", { status: 404 }) : new Response(pageHtml, { status: 200 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records what's already there the first time, then flags only new documents", async () => {
    const db = fakeDb({ board_pages: [{ id: "p1", state: "MD", url: "https://pdab.example.gov/meetings", last_checked_at: null }, { id: "p2", state: "OR", url: "https://broken.example.gov/x", last_checked_at: null }] });
    pageHtml = html(["/docs/2026.9.21 Board Meeting Agenda.pdf", "/docs/2026.8.17 Board Meeting Minutes.pdf"]);

    const first = await checkBoardPages(db, 10_000);
    expect(first).toMatchObject({ checked: 1, newDocuments: 0 });
    expect(first.errors[0]).toMatch(/broken.*404/);
    expect(db.tables.board_documents).toHaveLength(2);
    expect(db.tables.board_documents.every((d) => d.baseline && d.notified_at)).toBe(true);
    expect(db.tables.board_pages.find((p) => p.id === "p2").last_error).toMatch(/404/);

    pageHtml = html(["/docs/2026.9.21 Board Meeting Agenda.pdf", "/docs/2026.8.17 Board Meeting Minutes.pdf", "/docs/2026.11.16 Board Meeting Agenda.pdf"]);
    const second = await checkBoardPages(db, 10_000);
    expect(second.newDocuments).toBe(1);
    const fresh = db.tables.board_documents.find((d) => !d.baseline);
    expect(fresh).toMatchObject({ state: "MD", kind: "agenda", doc_date: "2026-11-16", notified_at: null });
  });
});

describe("state bill search", () => {
  let calls: URL[] = [];
  let responder: (u: URL) => Response;
  beforeEach(() => {
    process.env.OPEN_STATES_API_KEY = "test-key";
    calls = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const u = new URL(url);
      expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("test-key");
      calls.push(u);
      return responder(u);
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.OPEN_STATES_API_KEY;
  });

  const bill = (id: string, state: string, date: string) => ({ id, identifier: `HB ${id}`, title: "Concerning the prescription drug affordability board", session: "2026", jurisdiction: { id: `ocd-jurisdiction/country:us/state:${state}/government` }, latest_action_date: date, latest_action_description: "Passed", openstates_url: `https://openstates.org/${state}/${id}` });

  it("saves bills quietly the first time, then only emails about recent new ones", async () => {
    const db = fakeDb({});
    responder = () => new Response(JSON.stringify({ results: [bill("1", "co", "2026-03-01"), bill("2", "va", "2026-10-20")], pagination: { max_page: 1 } }));
    const run = searchStateBills(db, 30_000);
    await vi.runAllTimersAsync();
    const first = await run;
    expect(first).toMatchObject({ found: 2, added: 2, complete: true });
    expect(db.tables.state_bills.every((b) => b.notified_at)).toBe(true);
    expect(db.tables.sync_state[0].key).toBe("open_states_bills");
    expect(calls[0].searchParams.get("q")).toBe("prescription drug affordability board");
    expect(calls[0].searchParams.get("updated_since")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    responder = () => new Response(JSON.stringify({ results: [bill("3", "il", new Date().toISOString().slice(0, 10)), bill("4", "ny", "2025-01-01"), bill("2", "va", "2026-10-27")], pagination: { max_page: 1 } }));
    const again = searchStateBills(db, 30_000);
    await vi.runAllTimersAsync();
    expect(await again).toMatchObject({ added: 2, updated: 1 });
    const byId = Object.fromEntries(db.tables.state_bills.map((b) => [b.id, b]));
    expect(byId["3"].notified_at).toBeNull(); // new and recent: worth an email
    expect(byId["4"].notified_at).toBeTruthy(); // new to us but old news
    expect(byId["2"].latest_action_date).toBe("2026-10-27");
  });

  it("stops politely at the rate limit and keeps its place", async () => {
    const db = fakeDb({});
    responder = () => new Response("slow down", { status: 429 });
    const run = searchStateBills(db, 30_000);
    await vi.runAllTimersAsync();
    expect(await run).toMatchObject({ complete: false, error: expect.stringMatching(/rate limit/) });
    expect(db.tables.sync_state).toHaveLength(0);
  });

  it("does nothing without a key", async () => {
    delete process.env.OPEN_STATES_API_KEY;
    expect(await searchStateBills(fakeDb({}), 10_000)).toMatchObject({ skipped: expect.stringMatching(/OPEN_STATES_API_KEY/) });
  });
});
