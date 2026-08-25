"use client";

import { useEffect, useState } from "react";
import { avatarColorFor, initialsFor } from "@/lib/billMeta";
import { Users2 } from "lucide-react";

type MemberRow = { id: string; name: string; role: string | null; position: string };

const POSITION_LABELS: Record<string, string> = { support: "Support", oppose: "Oppose", watching: "Watching", none: "No position" };

// Shows each of the org's members and their individual stance on THIS
// specific bill - distinct from the org's own tracked_bills.position.
// Silent (renders nothing) if the org has no members yet, rather than
// showing an empty-state nag on every single bill page.
export default function MemberPositions({ billId }: { billId: string }) {
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [billId]);

  async function load() {
    const [membersRes, positionsRes] = await Promise.all([
      fetch("/api/members").then((r) => r.json()).catch(() => ({ members: [] })),
      fetch(`/api/bills/member-positions?billId=${billId}`).then((r) => r.json()).catch(() => ({ positions: [] })),
    ]);
    const members = membersRes.members ?? [];
    const positionByMember: Record<string, string> = {};
    for (const p of positionsRes.positions ?? []) positionByMember[p.member_id] = p.position;

    setRows(members.map((m: any) => ({ id: m.id, name: m.name, role: m.role, position: positionByMember[m.id] ?? "none" })));
  }

  async function handleChange(memberId: string, position: string) {
    setUpdating(memberId);
    setRows((prev) => (prev ?? []).map((r) => (r.id === memberId ? { ...r, position } : r)));
    try {
      await fetch("/api/members/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, billId, position }),
      });
    } finally {
      setUpdating(null);
    }
  }

  if (rows === null || rows.length === 0) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: 4 }}>
        <Users2 size={15} style={{ marginRight: 8, verticalAlign: -2 }} />
        Members' positions
      </h2>
      <p className="settings-desc">Where each of your members stands on this bill.</p>
      <div className="entity-grid">
        {rows.map((r) => (
          <div key={r.id} className="entity-card member-position-card">
            <span className="entity-card-summary">
              <span className="entity-avatar" style={{ background: avatarColorFor(r.name) }}>{initialsFor(r.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="entity-card-name">{r.name}</span>
                {r.role && <span className="entity-card-meta">{r.role}</span>}
              </span>
            </span>
            <select
              className={`position-select position-${r.position}`}
              value={r.position}
              onChange={(e) => handleChange(r.id, e.target.value)}
              disabled={updating === r.id}
              style={{ marginTop: 8, width: "100%" }}
            >
              {Object.entries(POSITION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
