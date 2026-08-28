"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Users, ExternalLink } from "lucide-react";

// The second bridge on the Rural Health page: from "this state has a
// provider shortage" to "here are the people who can do something about it."
//
// Without this, the shortage data is a dead end - you learn Montana has 45
// shortage areas and then have to go somewhere else entirely to find out who
// represents Montana. Clicking a member opens their profile, which already
// shows their bills and how they overlap with what you track.

type Member = {
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

export default function StateDelegation({ stateName }: { stateName: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/legislators?q=${encodeURIComponent(stateName)}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        // The legislators endpoint matches on name OR state, so filter down
        // to genuine state matches - otherwise a member whose surname
        // happens to contain the state string would slip in.
        const list: Member[] = (b.members ?? []).filter(
          (m: Member) => (m.state ?? "").toLowerCase() === stateName.toLowerCase()
        );
        setMembers(list);
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stateName]);

  const senators = (members ?? []).filter((m) => m.chamber?.toLowerCase().includes("senate"));
  const reps = (members ?? []).filter((m) => !m.chamber?.toLowerCase().includes("senate"));

  return (
    <div className="rh-delegation">
      <h2 className="section-title">
        <Users size={16} style={{ color: "var(--accent)", marginRight: 8, verticalAlign: -2 }} />
        Who represents {stateName}
      </h2>
      <p className="settings-desc" style={{ marginTop: 4, marginBottom: 12 }}>
        The delegation for this state. Open anyone to see their legislation and where it overlaps with the bills you track.
      </p>

      {loading ? (
        <div className="rbf-loading">
          {[0, 1, 2].map((i) => <div key={i} className="rbf-skel" />)}
        </div>
      ) : !members || members.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.875rem" }}>
          Couldn't load the delegation for {stateName} right now.
        </p>
      ) : (
        <>
          {senators.length > 0 && (
            <div className="rh-deleg-group">
              <div className="rh-deleg-label">Senate</div>
              <div className="rh-deleg-grid">
                {senators.map((m) => <MemberChip key={m.bioguideId} m={m} />)}
              </div>
            </div>
          )}
          {reps.length > 0 && (
            <div className="rh-deleg-group">
              <div className="rh-deleg-label">House · {reps.length}</div>
              <div className="rh-deleg-grid">
                {reps.map((m) => <MemberChip key={m.bioguideId} m={m} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MemberChip({ m }: { m: Member }) {
  const color = PARTY_COLORS[m.party] ?? "var(--text-soft)";
  return (
    <Link href={`/legislator/${m.bioguideId}`} className="rh-deleg-chip">
      {m.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.imageUrl} alt="" className="rh-deleg-photo" />
      ) : (
        <span className="rh-deleg-photo rh-deleg-photo-blank" aria-hidden="true" />
      )}
      <span className="rh-deleg-info">
        <span className="rh-deleg-name">{m.name}</span>
        <span className="rh-deleg-meta">
          <span className="rh-deleg-party" style={{ background: color }}>{m.party}</span>
          {m.district ? `District ${m.district}` : "Statewide"}
        </span>
      </span>
    </Link>
  );
}
