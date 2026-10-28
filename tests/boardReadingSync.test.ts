import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readNewDocuments, checkCourtCases } from "@/lib/boardReadingSync";
import { checkBoardPages } from "@/lib/drugBoardsSync";

// In-memory stand-in for the parts of the Supabase client these jobs use.
function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = { board_documents: [], board_dates: [], board_drugs: [], medicare_prices: [], board_page_changes: [], board_cases: [], board_case_filings: [], ...seed };
  let nextId = 1;
  function query(table: string) {
    let rows = [...(tables[table] ?? [])];
    let patch: any = null;
    const apply = () => {
      if (patch) for (const r of rows) Object.assign(r, patch);
    };
    const q: any = {
      select: () => q,
      order: () => q,
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      or: () => q,
      eq: (c: string, v: any) => ((rows = rows.filter((r) => r[c] === v)), apply(), q),
      is: (c: string, v: any) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      gte: (c: string, v: any) => ((rows = rows.filter((r) => r[c] >= v)), q),
      in: (c: string, vs: any[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), apply(), q),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
      insert: async (input: any) => {
        for (const r of [input].flat()) tables[table].push({ id: `row${nextId++}`, ...r });
        return { error: null };
      },
      upsert: async (input: any) => {
        for (const r of [input].flat()) if (!tables[table].some((x) => x.url === r.url)) tables[table].push({ id: `row${nextId++}`, ...r });
        return { error: null };
      },
      update: (p: any) => ((patch = p), q),
    };
    return q;
  }
  return { from: query, tables };
}

const pdf = readFileSync(path.resolve(__dirname, "fixtures/board-agenda.pdf"));

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.COURTLISTENER_API_TOKEN;
});

describe("reading new board documents", () => {
  it("opens a PDF agenda, notes the drugs it names and adds its dates to the calendar", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T12:00:00Z") });
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).includes("missing")
        ? new Response("gone", { status: 404 })
        : new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }),
    );
    const recent = new Date().toISOString();
    const db = fakeDb({
      board_documents: [
        { id: "d1", state: "MD", url: "https://pdab.maryland.gov/docs/agenda.pdf", title: "Board Meeting Agenda", kind: "agenda", baseline: false, first_seen_at: recent, text_status: null },
        { id: "d2", state: "MD", url: "https://pdab.maryland.gov/docs/missing.pdf", title: "Old minutes", kind: "minutes", baseline: false, first_seen_at: recent, text_status: null },
      ],
      board_drugs: [{ drug: "Ozempic" }, { drug: "Jardiance" }],
      medicare_prices: [{ id: "semaglutide-2027", brand_names: ["Ozempic", "Wegovy"], generic_name: "semaglutide", price_30_day: 274, list_price_30_day: 959, list_price_year: 2024, effective_year: 2027, source_url: "x" }],
    });

    const r = await readNewDocuments(db, 30_000);
    expect(r).toMatchObject({ read: 1, unreadable: 1, mentions: 1 });
    const [agenda, missing] = db.tables.board_documents;
    expect(agenda).toMatchObject({ text_status: "read", mentions: ["Ozempic"] });
    expect(agenda.mention_snippets[0].snippet).toContain("Upper payment limit for Ozempic");
    expect(missing).toMatchObject({ text_status: "unreadable", text_note: expect.stringMatching(/404/) });
    expect(db.tables.board_dates.map((d) => [d.kind, d.date, d.time])).toEqual([
      ["meeting", "2026-11-16", "1:00 PM"],
      ["comment_deadline", "2026-12-01", null],
      ["meeting", "2027-01-25", null],
    ]);
    for (const d of db.tables.board_dates) expect(d).toMatchObject({ state: "MD", source: "document", document_id: "d1", url: agenda.url });
    vi.useRealTimers();
  });
});

describe("watching board page wording", () => {
  it("records the first reading quietly, then a redline when the words change", async () => {
    let body = "<main><h1>Upper Payment Limits</h1><p>There are currently no drugs with an active UPL.</p></main>";
    vi.stubGlobal("fetch", async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } }));
    const db = fakeDb({ board_pages: [{ id: "p1", state: "MD", url: "https://pdab.maryland.gov/upper-payment-limits", last_checked_at: null, page_text: null, text_hash: null }] });

    expect(await checkBoardPages(db, 10_000)).toMatchObject({ checked: 1, wordingChanges: 0 });
    expect(db.tables.board_pages[0].page_text).toContain("no drugs with an active UPL");

    body = body.replace("There are currently no drugs with an active UPL.", "The UPL for Jardiance is now active.");
    expect(await checkBoardPages(db, 10_000)).toMatchObject({ wordingChanges: 1 });
    const change = db.tables.board_page_changes[0];
    expect(change).toMatchObject({ page_id: "p1", state: "MD" });
    expect(change.ops.some((op: any) => op.t === "ins" && op.s.includes("Jardiance"))).toBe(true);

    expect(await checkBoardPages(db, 10_000)).toMatchObject({ wordingChanges: 0 });
  });
});

describe("court cases", () => {
  const docket = { id: 777, absolute_url: "/docket/777/amgen-inc-v-mizner/", date_last_filing: "2026-10-01" };

  it("finds the docket, records existing filings quietly, then flags new ones", async () => {
    process.env.COURTLISTENER_API_TOKEN = "t";
    let entries = [{ id: 1, entry_number: 21, date_filed: "2026-09-29", description: "Motion to withdraw counsel" }];
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push(String(url));
      expect((init.headers as Record<string, string>).Authorization).toBe("Token t");
      if (String(url).includes("/dockets/?")) return Response.json({ results: [docket] });
      if (String(url).includes("/dockets/777/")) return Response.json(docket);
      return Response.json({ results: entries });
    });
    const db = fakeDb({ board_cases: [{ id: "c1", name: "Amgen Inc. v. Mizner", state: "CO", court_code: "cafc", docket_number: "26-2111", courtlistener_id: null, last_checked_at: null }] });

    expect(await checkCourtCases(db, 20_000)).toMatchObject({ checked: 1, newFilings: 0 });
    expect(seen[0]).toContain("court=cafc&docket_number=26-2111");
    expect(db.tables.board_cases[0]).toMatchObject({ courtlistener_id: 777, last_filing_date: "2026-10-01", last_error: null });
    expect(db.tables.board_case_filings[0]).toMatchObject({ baseline: true, entry_number: 21 });

    entries = [{ id: 2, entry_number: 23, date_filed: "2026-11-04", description: "Opening brief" }, ...entries];
    expect(await checkCourtCases(db, 20_000)).toMatchObject({ newFilings: 1 });
    expect(db.tables.board_case_filings.find((f) => f.entry_key === "2")).toMatchObject({ baseline: false, notified_at: null, url: "https://www.courtlistener.com/docket/777/amgen-inc-v-mizner/#entry-23" });
  });

  it("falls back to the latest filing date when entries need extra access", async () => {
    process.env.COURTLISTENER_API_TOKEN = "t";
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes("docket-entries") ? new Response("no", { status: 403 }) : Response.json(docket)));
    const db = fakeDb({ board_cases: [{ id: "c1", name: "Amgen", state: "CO", courtlistener_id: 777, last_checked_at: null }] });
    await checkCourtCases(db, 20_000);
    expect(db.tables.board_case_filings[0]).toMatchObject({ entry_key: "latest:2026-10-01", description: "New filing on the docket", baseline: true });
  });

  it("explains what's missing without a token", async () => {
    vi.stubGlobal("fetch", async () => new Response("auth", { status: 401 }));
    const db = fakeDb({ board_cases: [{ id: "c1", name: "Amgen", state: "CO", court_code: "cod", docket_number: "1:25-cv-03452", last_checked_at: null }] });
    const r = await checkCourtCases(db, 20_000);
    expect(r.errors[0]).toMatch(/COURTLISTENER_API_TOKEN/);
    expect(db.tables.board_cases[0].last_error).toMatch(/free API token/);
  });
});
