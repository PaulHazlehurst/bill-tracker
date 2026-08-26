"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { Search, ExternalLink, User } from "lucide-react";

type MemberRow = {
  bioguideId: string;
  name: string;
  party: string;
  state: string;
  district: string | null;
  chamber: string;
  imageUrl: string | null;
};

const PARTY_COLORS: Record<string, string> = {
  D: "var(--party-dem)",
  R: "var(--party-rep)",
  I: "var(--party-ind)",
};

// Legislator directory — searchable list of current members of congress.
// Clicking a member opens their profile page showing their bills and
// overlap with your tracked portfolio.
export default function LegislatorsPage() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = q ? `/api/legislators?q=${encodeURIComponent(q)}` : "/api/legislators";
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      setMembers(data.members ?? []);
    } catch {
      setError("Couldn't load legislators right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(query.trim() || undefined);
  }

  // Client-side filter for instant results while the full list is loaded
  const displayed = query.trim()
    ? members.filter((m) =>
        m.name.toLowerCase().includes(query.trim().toLowerCase()) ||
        m.state.toLowerCase().includes(query.trim().toLowerCase())
      )
    : members;

  return (
    <div className="container-wide">
      <span className="page-eyebrow">Congress</span>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 500, marginBottom: 4 }}>Legislators</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Current members of Congress. Click anyone to see their bills and how they overlap with what you're tracking.</p>

      <form onSubmit={handleSearch} className="legislator-search">
        <div className="legislator-search-wrap">
          <Search size={16} className="muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or state..."
            className="legislator-search-input"
          />
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <div className="muted" style={{ padding: 40, textAlign: "center" }}>Loading members of Congress...</div>
      ) : displayed.length === 0 ? (
        <p className="muted" style={{ padding: 20 }}>No members found{query ? ` matching "${query}"` : ""}.</p>
      ) : (
        <div className="legislator-grid">
          {displayed.map((m) => (
            <a key={m.bioguideId} href={`/legislator/${m.bioguideId}`} className="legislator-card">
              <div className="legislator-card-photo">
                {m.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.imageUrl} alt="" className="legislator-photo" />
                ) : (
                  <div className="legislator-photo-placeholder"><User size={24} /></div>
                )}
              </div>
              <div className="legislator-card-info">
                <div className="legislator-card-name">{m.name}</div>
                <div className="legislator-card-meta">
                  <span className="legislator-party-badge" style={{ background: PARTY_COLORS[m.party] ?? "var(--text-soft)", color: "#fff" }}>
                    {m.party}
                  </span>
                  <span>{m.state}{m.district ? `-${m.district}` : ""}</span>
                  <span className="muted">{m.chamber}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
