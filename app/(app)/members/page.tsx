"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import { useUI } from "@/components/UIProvider";
import { Users2, Plus, Trash2 } from "lucide-react";

// "Members" here means the people/stakeholders the firm works with -
// coalition partners, congressional contacts, clients - tracked for their
// stance on each bill. Distinct from the Team page's teammates-with-
// accounts (also informally called "members" there, but that's a
// separate, file-scoped concept - no relation to this table).
type StakeholderMember = { id: string; name: string; role: string | null; created_at: string };

export default function MembersPage() {
  const supabase = createClient();
  const router = useRouter();
  const { toast, confirm } = useUI();

  const [members, setMembers] = useState<StakeholderMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasTeam, setHasTeam] = useState(true);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
      if (!profile?.organization_id) {
        setHasTeam(false);
        setLoading(false);
        return;
      }
      load();
    })();
  }, []);

  function load() {
    fetch("/api/members")
      .then((r) => r.json())
      .then((b) => {
        if (b.error) setError(b.error);
        else setMembers(b.members ?? []);
      })
      .catch(() => setError("Couldn't load members"))
      .finally(() => setLoading(false));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast(body.error ?? "Couldn't add member", "error");
        return;
      }
      setMembers((prev) => [...prev, body.member].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setRole("");
    } finally {
      setAdding(false);
    }
  }

  async function handleAddToAll(member: StakeholderMember) {
    const res = await fetch("/api/members/add-to-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: member.id, position: "watching" }),
    });
    const body = await res.json();
    if (res.ok) {
      toast(body.added > 0 ? `Added ${member.name} to ${body.added} bill${body.added === 1 ? "" : "s"}` : `${member.name} already has a position on every tracked bill`, "success");
    } else {
      toast(body.error ?? "Couldn't add to all bills", "error");
    }
  }

  async function handleRemove(member: StakeholderMember) {
    if (!(await confirm(`Remove ${member.name}? This also removes their position on every bill.`, { confirmLabel: "Remove", danger: true }))) return;
    const res = await fetch(`/api/members?id=${member.id}`, { method: "DELETE" });
    if (res.ok) setMembers((prev) => prev.filter((m) => m.id !== member.id));
  }

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 500, margin: 0 }}>Members</h1>
          <p className="muted" style={{ marginTop: 4 }}>The people you work with - track where each one stands on every bill.</p>
        </div>
      </div>

      {!hasTeam ? (
        <EmptyState icon={Users2}>
          Members belong to a team. <a href="/settings">Create or join one</a> first.
        </EmptyState>
      ) : loading ? (
        <Spinner label="Loading members…" />
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <>
          <form onSubmit={handleAdd} className="card members-add-form">
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="toolbar-input"
              style={{ flex: 1, minWidth: 160 }}
            />
            <input
              placeholder="Role or title (optional)"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="toolbar-input"
              style={{ flex: 1, minWidth: 160 }}
            />
            <button className="primary" disabled={adding || !name.trim()}>
              <Plus size={14} /> Add member
            </button>
          </form>

          {members.length === 0 ? (
            <EmptyState icon={Users2}>No members yet - add the people your firm works with above.</EmptyState>
          ) : (
            <div className="members-grid">
              {members.map((m) => (
                <div key={m.id} className="card members-card">
                  <span className="entity-avatar" style={{ background: "var(--accent)" }}>
                    {m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{m.name}</div>
                    {m.role && <div className="muted" style={{ fontSize: '0.75rem' }}>{m.role}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="ghost" onClick={() => handleAddToAll(m)} title="Add to every tracked bill">
                      Add to all bills
                    </button>
                    <button className="ghost" onClick={() => handleRemove(m)} title="Remove member">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
