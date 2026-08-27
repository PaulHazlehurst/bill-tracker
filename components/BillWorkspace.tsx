"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import { avatarColorFor, initialsFor, timeAgo } from "@/lib/billMeta";
import { StickyNote, CheckSquare, Square, Plus, Trash2, ListChecks } from "lucide-react";

// The per-bill Workspace: shared team notes + a task checklist, scoped to
// this one bill. Reads and writes go through the RLS-secured client directly
// (same pattern as TopicsHero) - row-level security guarantees a caller only
// ever touches items owned by their own org or account, so no server route is
// needed. For a team, items are shared across everyone; for a solo user,
// they're private. Turns the bill page from a read-only dossier into a place
// the team actually works the bill.
type WorkspaceItem = {
  id: string;
  kind: "note" | "task";
  body: string;
  done: boolean;
  created_by: string | null;
  created_at: string;
  author: { email: string } | { email: string }[] | null;
};

function authorEmail(it: WorkspaceItem): string | null {
  const a = Array.isArray(it.author) ? it.author[0] : it.author;
  return a?.email ?? null;
}

export default function BillWorkspace({ billId }: { billId: string }) {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const [items, setItems] = useState<WorkspaceItem[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState("");
  const [newTask, setNewTask] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
    setOrgId(profile?.organization_id ?? null);

    const { data, error } = await supabase
      .from("bill_workspace_items")
      .select("id, kind, body, done, created_by, created_at, author:profiles(email)")
      .eq("bill_id", billId)
      .order("created_at", { ascending: false });
    if (error) {
      // Most likely the table hasn't been created yet (migration not run).
      // Fail quietly to an empty state rather than throwing on the page.
      console.error("workspace load failed:", error.message);
      setItems([]);
      return;
    }
    setItems((data as any) ?? []);
  }

  async function addItem(kind: "note" | "task", body: string) {
    const text = body.trim();
    if (!text || !userId) return;
    setBusy(true);
    const owner = orgId ? { organization_id: orgId, user_id: null } : { organization_id: null, user_id: userId };
    const { error } = await supabase.from("bill_workspace_items").insert({
      bill_id: billId,
      kind,
      body: text,
      created_by: userId,
      ...owner,
    });
    setBusy(false);
    if (error) {
      toast(`Couldn't save that: ${error.message}`, "error");
      return;
    }
    if (kind === "note") setNewNote("");
    else setNewTask("");
    load();
  }

  async function toggleTask(it: WorkspaceItem) {
    // Optimistic - tasks get ticked often, and a round-trip lag feels broken.
    setItems((prev) => (prev ?? []).map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)));
    const { error } = await supabase
      .from("bill_workspace_items")
      .update({ done: !it.done, updated_at: new Date().toISOString() })
      .eq("id", it.id);
    if (error) {
      setItems((prev) => (prev ?? []).map((x) => (x.id === it.id ? { ...x, done: it.done } : x)));
      toast("Couldn't update that task.", "error");
    }
  }

  async function remove(it: WorkspaceItem) {
    if (!(await confirm(`Delete this ${it.kind}?`, { confirmLabel: "Delete", danger: true }))) return;
    const prev = items;
    setItems((p) => (p ?? []).filter((x) => x.id !== it.id));
    const { error } = await supabase.from("bill_workspace_items").delete().eq("id", it.id);
    if (error) {
      setItems(prev);
      toast("Couldn't delete that.", "error");
    }
  }

  if (items === null) return null;

  const notes = items.filter((i) => i.kind === "note");
  const tasks = items.filter((i) => i.kind === "task");
  const openTasks = tasks.filter((t) => !t.done).length;

  const listStyle = { display: "flex", flexDirection: "column" } as const;
  const rowStyle = { display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--border)" } as const;

  return (
    <div className="bill-workspace">
      {/* Tasks */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <ListChecks size={17} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: "1rem", fontWeight: 500, margin: 0 }}>Tasks</h2>
          {tasks.length > 0 && (
            <span className="muted" style={{ fontSize: "0.75rem", marginLeft: "auto" }}>
              {openTasks} open · {tasks.length - openTasks} done
            </span>
          )}
        </div>
        <p className="settings-desc">Follow-ups for this bill{orgId ? " — shared with your team" : ""}.</p>

        <form
          onSubmit={(e) => { e.preventDefault(); addItem("task", newTask); }}
          style={{ display: "flex", gap: 8, margin: "10px 0 14px" }}
        >
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Add a task, e.g. Draft one-pager for Rep. Smith's office"
            className="toolbar-input"
            style={{ flex: 1 }}
          />
          <button type="submit" className="primary" disabled={busy || !newTask.trim()}>
            <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Add
          </button>
        </form>

        {tasks.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.8125rem" }}>No tasks yet. Add the first follow-up above.</p>
        ) : (
          <div style={listStyle}>
            {tasks.map((t) => {
              const email = authorEmail(t);
              return (
                <div key={t.id} style={rowStyle}>
                  <button
                    onClick={() => toggleTask(t)}
                    aria-label={t.done ? "Mark not done" : "Mark done"}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: t.done ? "var(--accent)" : "var(--text-soft)", flexShrink: 0 }}
                  >
                    {t.done ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.9rem", textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--text-soft)" : "var(--text)" }}>
                      {t.body}
                    </div>
                    <div className="muted" style={{ fontSize: "0.6875rem", marginTop: 2 }}>
                      {email ? `${email} · ` : ""}{timeAgo(t.created_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(t)}
                    aria-label="Delete task"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-soft)", padding: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <StickyNote size={17} style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: "1rem", fontWeight: 500, margin: 0 }}>{orgId ? "Team notes" : "Notes"}</h2>
        </div>
        <p className="settings-desc">
          {orgId ? "Analysis and context, visible to everyone on your team." : "Your private analysis and context for this bill."}
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); addItem("note", newNote); }}
          style={{ margin: "10px 0 14px" }}
        >
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note — what matters about this bill, who to talk to, what to watch for…"
            rows={3}
            className="toolbar-input"
            style={{ width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button type="submit" className="primary" disabled={busy || !newNote.trim()}>
              <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Add note
            </button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.8125rem" }}>No notes yet{orgId ? " — leave the first for your team." : "."}</p>
        ) : (
          <div style={listStyle}>
            {notes.map((n) => {
              const email = authorEmail(n);
              return (
                <div key={n.id} style={rowStyle}>
                  <span className="entity-avatar" style={{ background: avatarColorFor(email ?? "note"), flexShrink: 0 }}>
                    {initialsFor(email ?? "?")}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="muted" style={{ fontSize: "0.6875rem", marginBottom: 3 }}>
                      {email ?? "Someone"} · {timeAgo(n.created_at)}
                    </div>
                    <div style={{ fontSize: "0.875rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{n.body}</div>
                  </div>
                  <button
                    onClick={() => remove(n)}
                    aria-label="Delete note"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-soft)", padding: 4, flexShrink: 0 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
