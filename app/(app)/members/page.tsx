"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Spinner from "@/components/Spinner";
import EmptyState from "@/components/EmptyState";
import { useUI } from "@/components/UIProvider";
import { Users2, Plus, Trash2, Mail, Phone, Pencil, Check, X, StickyNote } from "lucide-react";

// "Members" here means the people/stakeholders the firm works with -
// coalition partners, congressional contacts, clients - tracked for their
// stance on each bill AND as a lightweight relationship CRM (category,
// contact details, notes). Distinct from the Team page's teammates-with-
// accounts (also informally called "members" there, but that's a separate,
// file-scoped concept - no relation to this table).
type StakeholderMember = {
  id: string;
  name: string;
  role: string | null;
  category: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  bioguide_id: string | null;
  created_at: string;
};

const CATEGORIES = ["Legislator", "Staffer", "Coalition partner", "Client", "Agency", "Other"];

const CATEGORY_COLORS: Record<string, string> = {
  Legislator: "var(--accent)",
  Staffer: "var(--party-ind)",
  "Coalition partner": "var(--pos-support)",
  Client: "var(--accent-gold)",
  Agency: "var(--party-dem)",
  Other: "var(--text-soft)",
};

type Draft = { role: string; category: string; email: string; phone: string; notes: string };
const EMPTY_DRAFT: Draft = { role: "", category: "", email: "", phone: "", notes: "" };

export default function MembersPage() {
  const supabase = createClient();
  const router = useRouter();
  const { toast, confirm } = useUI();

  const [members, setMembers] = useState<StakeholderMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasTeam, setHasTeam] = useState(true);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  // Filter + inline edit
  const [filter, setFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [savingEdit, setSavingEdit] = useState(false);

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
        body: JSON.stringify({ name, ...draft }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast(body.error ?? "Couldn't add member", "error");
        return;
      }
      setMembers((prev) => [...prev, body.member].sort((a, b) => a.name.localeCompare(b.name)));
      setName("");
      setDraft(EMPTY_DRAFT);
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(m: StakeholderMember) {
    setEditingId(m.id);
    setEditDraft({
      role: m.role ?? "",
      category: m.category ?? "",
      email: m.email ?? "",
      phone: m.phone ?? "",
      notes: m.notes ?? "",
    });
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    try {
      const res = await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editDraft }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast(body.error ?? "Couldn't save changes", "error");
        return;
      }
      setMembers((prev) => prev.map((m) => (m.id === id ? body.member : m)));
      setEditingId(null);
    } finally {
      setSavingEdit(false);
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

  const categoriesPresent = Array.from(new Set(members.map((m) => m.category).filter(Boolean))) as string[];
  const shown = filter === "all" ? members : members.filter((m) => m.category === filter);

  return (
    <div className="container-wide">
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Stakeholders</span>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 500, margin: 0 }}>Members</h1>
          <p className="muted" style={{ marginTop: 4 }}>The people you work with - category, contact, notes, and where each one stands on every bill.</p>
        </div>
        {hasTeam && !loading && (
          <button className="primary" onClick={() => setShowAdd((v) => !v)}>
            <Plus size={14} /> Add member
          </button>
        )}
      </div>

      {!hasTeam ? (
        <EmptyState icon={Users2}>
          Members belong to a team. <Link href="/settings">Create or join one</Link> first.
        </EmptyState>
      ) : loading ? (
        <Spinner label="Loading members…" />
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : (
        <>
          {showAdd && (
            <form onSubmit={handleAdd} className="card member-form">
              <div className="member-form-grid">
                <input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} className="toolbar-input" />
                <input placeholder="Role or title" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="toolbar-input" />
                <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="toolbar-input">
                  <option value="">Category…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input placeholder="Email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="toolbar-input" />
                <input placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="toolbar-input" />
              </div>
              <textarea placeholder="Notes — who owns the relationship, meeting history, outstanding asks…" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="toolbar-input member-notes-input" rows={2} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="ghost" onClick={() => { setShowAdd(false); setDraft(EMPTY_DRAFT); setName(""); }}>Cancel</button>
                <button className="primary" disabled={adding || !name.trim()}><Plus size={14} /> Add member</button>
              </div>
            </form>
          )}

          {members.length === 0 ? (
            <EmptyState icon={Users2}>No members yet - add the people your firm works with.</EmptyState>
          ) : (
            <>
              {categoriesPresent.length > 0 && (
                <div className="member-filters">
                  <button className={`member-filter ${filter === "all" ? "member-filter-on" : ""}`} onClick={() => setFilter("all")}>All ({members.length})</button>
                  {categoriesPresent.map((c) => (
                    <button key={c} className={`member-filter ${filter === c ? "member-filter-on" : ""}`} onClick={() => setFilter(c)}>
                      {c} ({members.filter((m) => m.category === c).length})
                    </button>
                  ))}
                </div>
              )}

              <div className="members-grid">
                {shown.map((m) => (
                  <div key={m.id} className="card members-card">
                    {editingId === m.id ? (
                      <div style={{ width: "100%" }}>
                        <div className="member-form-grid">
                          <input placeholder="Role" value={editDraft.role} onChange={(e) => setEditDraft({ ...editDraft, role: e.target.value })} className="toolbar-input" />
                          <select value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} className="toolbar-input">
                            <option value="">Category…</option>
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input placeholder="Email" value={editDraft.email} onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })} className="toolbar-input" />
                          <input placeholder="Phone" value={editDraft.phone} onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })} className="toolbar-input" />
                        </div>
                        <textarea placeholder="Notes…" value={editDraft.notes} onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })} className="toolbar-input member-notes-input" rows={2} />
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="ghost" onClick={() => setEditingId(null)}><X size={13} /> Cancel</button>
                          <button className="primary" disabled={savingEdit} onClick={() => saveEdit(m.id)}><Check size={13} /> Save</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="members-card-head">
                          <span className="entity-avatar" style={{ background: CATEGORY_COLORS[m.category ?? "Other"] ?? "var(--accent)" }}>
                            {m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{m.name}</div>
                            <div className="member-sub">
                              {m.role && <span>{m.role}</span>}
                              {m.category && <span className="member-cat-badge" style={{ color: CATEGORY_COLORS[m.category] ?? "var(--text-soft)" }}>{m.category}</span>}
                            </div>
                          </div>
                          <button className="member-icon-btn" onClick={() => startEdit(m)} title="Edit details" aria-label={`Edit details for ${m.name}`}><Pencil size={13} /></button>
                        </div>

                        {(m.email || m.phone) && (
                          <div className="member-contact">
                            {m.email && <a href={`mailto:${m.email}`} className="member-contact-chip"><Mail size={12} /> {m.email}</a>}
                            {m.phone && <a href={`tel:${m.phone}`} className="member-contact-chip"><Phone size={12} /> {m.phone}</a>}
                          </div>
                        )}

                        {m.notes && (
                          <div className="member-notes"><StickyNote size={12} className="muted" /> <span>{m.notes}</span></div>
                        )}

                        <div className="members-card-actions">
                          <button className="ghost" onClick={() => handleAddToAll(m)} title="Add to every tracked bill">Add to all bills</button>
                          <button className="ghost" onClick={() => handleRemove(m)} title="Remove member"><Trash2 size={13} /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
