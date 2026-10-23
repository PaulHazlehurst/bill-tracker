"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search, X, Check, Plus, ArrowUpRight } from "lucide-react";
import { useUI } from "@/components/UIProvider";
import { citationFor, formatDate } from "@/lib/billMeta";

type Result = {
  id: string;
  congress: number;
  type: string;
  number: string;
  title: string;
  reasons?: string[];
  date?: string | null;
  tracked?: boolean;
};

const EXAMPLES = ["telehealth", "critical access hospital", "340B", "H.R. 1"];

// Opened from the top bar ("Track a bill"), the command palette, or anything
// that dispatches `bt:find-bill`. Searches the full text of every bill in the
// current Congress plus recently updated titles; a bill number jumps straight
// to that bill. Fires `bt:tracked` after tracking so open pages can refresh.
export default function FindBillDialog() {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastQuery = useRef("");

  useEffect(() => {
    function onOpen(e: Event) {
      const query = (e as CustomEvent).detail?.query as string | undefined;
      setOpen(true);
      setError(null);
      if (query) {
        setQ(query);
        run(query);
      } else {
        setResults(null);
        setQ("");
      }
      setTimeout(() => inputRef.current?.focus(), 20);
    }
    window.addEventListener("bt:find-bill", onOpen);
    return () => window.removeEventListener("bt:find-bill", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function run(query: string) {
    const text = query.trim();
    if (text.length < 2) return;
    lastQuery.current = text;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bills/search?q=${encodeURIComponent(text)}`);
      const body = await res.json().catch(() => ({}));
      if (lastQuery.current !== text) return; // a newer search started
      if (!res.ok) {
        setError(body.error ?? "Search is unavailable right now. Try again in a minute.");
        setResults([]);
      } else {
        setResults(body.bills ?? []);
        setPartial(!!body.partial);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setResults([]);
    } finally {
      if (lastQuery.current === text) setLoading(false);
    }
  }

  async function track(r: Result) {
    setBusy(r.id);
    try {
      const res = await fetch("/api/bills/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ congress: r.congress, billType: r.type, billNumber: Number(r.number) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error ?? "Couldn't track that bill.", "error");
        return;
      }
      setResults((prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, tracked: true } : x)));
      toast(`Tracking ${citationFor(r.id)}`, "success");
      window.dispatchEvent(new CustomEvent("bt:tracked", { detail: { billId: r.id } }));
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={() => setOpen(false)}>
      <div className="dialog dialog-find" role="dialog" aria-modal="true" aria-label="Track a bill" onMouseDown={(e) => e.stopPropagation()}>
        <form
          className="find-bar"
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
        >
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            id="bill-search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search any bill by topic, or enter a number like H.R. 1234"
            autoComplete="off"
          />
          {loading ? <span className="spinner" aria-label="Searching" /> : <button type="submit" className="btn btn-primary btn-sm">Search</button>}
          <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
        </form>

        <div className="find-body">
          {results === null && !loading && (
            <div className="find-intro">
              <p>Searches the full text of every bill in the 119th Congress, plus the latest updates from congress.gov.</p>
              <div className="find-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => { setQ(ex); run(ex); }}>{ex}</button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}

          {results && results.length === 0 && !loading && !error && (
            <div className="find-intro">
              <p><strong>No bills matched “{lastQuery.current}”.</strong> Try a shorter or more general phrase, or the bill number if you know it.</p>
            </div>
          )}

          {partial && results && results.length > 0 && (
            <p className="find-note">One of the search sources didn't respond, so these results may be incomplete.</p>
          )}

          {results && results.length > 0 && (
            <ul className="find-results">
              {results.map((r) => (
                <li key={r.id} className="find-row">
                  <div className="find-row-main">
                    <div className="find-row-top">
                      <span className="cite">{citationFor(r.id)}</span>
                      {r.date && <span className="find-date">{formatDate(r.date)}</span>}
                    </div>
                    <Link href={`/bill/${r.id}`} className="find-title" onClick={() => setOpen(false)}>{r.title}</Link>
                    {r.reasons && r.reasons.length > 0 && <p className="find-why">{r.reasons.slice(0, 2).join(". ")}</p>}
                  </div>
                  <div className="find-row-act">
                    {r.tracked ? (
                      <span className="tracked-tag"><Check size={14} /> Tracking</span>
                    ) : (
                      <button className="btn btn-secondary btn-sm" onClick={() => track(r)} disabled={busy === r.id}>
                        <Plus size={14} /> {busy === r.id ? "Tracking…" : "Track"}
                      </button>
                    )}
                    <Link href={`/bill/${r.id}`} className="icon-btn" aria-label="Open bill" onClick={() => setOpen(false)}>
                      <ArrowUpRight size={16} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
