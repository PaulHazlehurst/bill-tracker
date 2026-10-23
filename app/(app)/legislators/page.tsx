"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Search, User } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";

type MemberRow = { bioguideId: string; name: string; party: string; state: string; district: string | null; chamber: string; imageUrl: string | null };

const PARTY_NAMES: Record<string, string> = { D: "Democrat", R: "Republican", I: "Independent" };

// Directory of every current member of Congress. Filtering happens on the
// already-loaded roster, so it's instant.
export default function LegislatorsPage() {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [chamber, setChamber] = useState<"all" | "Senate" | "House">("all");
  const [party, setParty] = useState<"all" | "D" | "R" | "I">("all");

  useEffect(() => {
    fetch("/api/legislators")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) setError(data.error ? "Couldn't reach congress.gov for the member list. Try again in a minute." : "Couldn't load members of Congress.");
        setMembers(data.members ?? []);
      })
      .catch(() => {
        setError("Couldn't load members of Congress.");
        setMembers([]);
      });
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const abbr = needle.length === 2 ? needle : null;
    return (members ?? []).filter((m) => {
      if (chamber !== "all" && m.chamber !== chamber) return false;
      if (party !== "all" && m.party !== party) return false;
      if (!needle) return true;
      return m.name.toLowerCase().includes(needle) || m.state.toLowerCase().includes(needle) || (abbr ? stateMatchesAbbr(m.state, abbr) : false);
    });
  }, [members, q, chamber, party]);

  return (
    <div className="page page-wide">
      <PageHeader title="Congress" description="Every current member of the House and Senate. Open anyone to see their bills and how they line up with your positions." />

      <div className="toolbar">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, state, or state code like MD" aria-label="Search members of Congress" autoFocus />
        </label>
        <div className="seg" role="group" aria-label="Chamber">
          {(["all", "Senate", "House"] as const).map((c) => (
            <button key={c} className={chamber === c ? "is-on" : ""} onClick={() => setChamber(c)}>{c === "all" ? "Both chambers" : c}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Party">
          {(["all", "D", "R", "I"] as const).map((p) => (
            <button key={p} className={party === p ? "is-on" : ""} onClick={() => setParty(p)}>{p === "all" ? "All parties" : PARTY_NAMES[p]}</button>
          ))}
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {members === null ? (
        <div className="member-grid">{Array.from({ length: 12 }, (_, i) => <div key={i} className="skel" style={{ height: 76 }} />)}</div>
      ) : shown.length === 0 ? (
        <div className="nomatch"><p>No members match{q ? ` “${q}”` : ""}.</p></div>
      ) : (
        <>
          <p className="result-count">{shown.length} member{shown.length === 1 ? "" : "s"}</p>
          <div className="member-grid">
            {shown.map((m) => (
              <Link key={m.bioguideId} href={`/legislator/${m.bioguideId}`} className="member-card">
                {m.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt="" className="member-photo" loading="lazy" />
                ) : (
                  <span className="member-photo member-photo-empty"><User size={20} /></span>
                )}
                <span className="member-card-text">
                  <span className="member-card-name">{m.name}</span>
                  <span className="member-card-meta">
                    <span className={`party-tag party-${m.party}`}>{m.party}</span>
                    {m.chamber === "Senate" ? "Senator" : "Representative"}, {m.state}{m.district ? ` ${m.district}` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const ABBR: Record<string, string> = { al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia", pr: "Puerto Rico" };
function stateMatchesAbbr(state: string, abbr: string) {
  return ABBR[abbr]?.toLowerCase() === state.toLowerCase();
}
