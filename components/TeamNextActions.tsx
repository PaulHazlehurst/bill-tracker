"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import { timeAgo } from "@/lib/billMeta";
import { CheckSquare, Square, Plus, Trash2, ListChecks, AlertTriangle } from "lucide-react";

// The team's shared to-do board.
//
// It reads and writes the SAME table as the per-bill Workspace tab
// (bill_workspace_items, kind='task'), so this is one task list seen from two
// angles: add a task here against a bill and it shows up on that bill's
// Workspace; tick it off there and it disappears from here. Previously the
// only way to add a next action was to navigate to a bill, open its
// Workspace, and type it in - which meant nobody did it.
//
// bill_id is nullable (see supabase/add-team-next-actions.sql) so a task can
// also be general team work with no bill attached.

type Task = {
  id: string;
  body: string;
  done: boolean;
  bill_id: string | null;
  due_date: string | null;
  assigned_to: string | null;
  created_at: string;
  created_by: string | null;
  bills: { title: string } | { title: string }[] | null;
};

type BillOption = { bill_id: string; title: string };
type Member = { id: string; email: string };

function billTitle(t: Task): string | null {
  const b = Array.isArray(t.bills) ? t.bills[0] : t.bills;
  return b?.title ?? null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function TeamNextActions({ members }: { members: Member[] }) {
  const supabase = createClient();
  const { toast, confirm } = useUI();
  const { userId, profile, loading: sessionLoading } = useSession();
  const orgId = profile?.organization_id ?? null;

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [billOptions, setBillOptions] = useState<BillOption[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  // New-task form
  const [body, setBody] = useState("");
  const [billId, setBillId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");

  useEffect(() => {
    if (!sessionLoading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoading]);

  async function load() {
    // Tasks: RLS scopes these to the caller's org (or self), so no client
    // filter is needed beyond kind.
    const { data, error } = await supabase
      .from("bill_workspace_items")
      .select("id, body, done, bill_id, due_date, assigned_to, created_at, created_by, bills(title)")
      .eq("kind", "task")
      .order("done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      // Most likely the migration hasn't been run yet. Say so plainly
      // instead of rendering a broken-looking empty board.
      console.error("team tasks load failed:", error.message);
      setTableMissing(true);
      setTasks([]);
      return;
    }
    setTableMissing(false);
    setTasks((data as any) ?? []);

    // Bills to attach a task to: whatever this account can see.
    const { data: billRows } = await supabase
      .from("tracked_bills")
      .select("bill_id, bills(title)")
      .limit(300);
    const seen = new Set<string>();
    const opts: BillOption[] = [];
    for (const r of (billRows as any[]) ?? []) {
      if (seen.has(r.bill_id)) continue;
      seen.add(r.bill_id);
      const b = Array.isArray(r.bills) ? r.bills[0] : r.bills;
      opts.push({ bill_id: r.bill_id, title: b?.title ?? r.bill_id });
    }
    opts.sort((a, b) => a.title.localeCompare(b.title));
    setBillOptions(opts);
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !userId) return;
    setBusy(true);
    const owner = orgId
      ? { organization_id: orgId, user_id: null }
      : { organization_id: null, user_id: userId };
    const { error } = await supabase.from("bill_workspace_items").insert({
      kind: "task",
      body: text,
      bill_id: billId || null,
      assigned_to: assignee || null,
      due_date: due || null,
      created_by: userId,
      ...owner,
    });
    setBusy(false);
    if (error) {
      toast(`Couldn't add that: ${error.message}`, "error");
      return;
    }
    setBody(""); setBillId(""); setAssignee(""); setDue("");
    load();
  }

  async function toggle(t: Task) {
    setTasks((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    const { error } = await supabase
      .from("bill_workspace_items")
      .update({ done: !t.done, updated_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) {
      setTasks((prev) => (prev ?? []).map((x) => (x.id === t.id ? { ...x, done: t.done } : x)));
      toast("Couldn't update that task.", "error");
    }
  }

  async function remove(t: Task) {
    if (!(await confirm("Delete this next action?", { confirmLabel: "Delete", danger: true }))) return;
    const prev = tasks;
    setTasks((p) => (p ?? []).filter((x) => x.id !== t.id));
    const { error } = await supabase.from("bill_workspace_items").delete().eq("id", t.id);
    if (error) {
      setTasks(prev);
      toast("Couldn't delete that.", "error");
    }
  }

  const emailById = new Map(members.map((m) => [m.id, m.email]));
  const all = tasks ?? [];
  const open = all.filter((t) => !t.done);
  const done = all.filter((t) => t.done);
  const shown = showDone ? done : open;
  const today = todayISO();
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;

  return (
    <div className="tna">
      <div className="tna-head">
        <div>
          <h2 className="section-title">
            <ListChecks size={16} style={{ color: "var(--accent)", marginRight: 8, verticalAlign: -2 }} />
            Next actions
          </h2>
          <p className="settings-desc" style={{ marginTop: 4 }}>
            {orgId
              ? "Shared with everyone on the team. Anything attached to a bill also shows on that bill's Workspace tab."
              : "Your working list. Anything attached to a bill also shows on that bill's Workspace tab."}
          </p>
        </div>
        <div className="tna-counts">
          <span className="tna-pill"><strong>{open.length}</strong> open</span>
          {overdue > 0 && (
            <span className="tna-pill tna-pill-over"><AlertTriangle size={12} /> {overdue} overdue</span>
          )}
        </div>
      </div>

      {tableMissing ? (
        <p className="muted" style={{ fontSize: "0.8125rem" }}>
          Next actions need one quick database step — run <code>supabase/add-team-next-actions.sql</code> in the Supabase SQL Editor, then reload this page.
        </p>
      ) : (
        <>
          <form onSubmit={addTask} className="tna-form">
            <input
              className="toolbar-input tna-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What needs doing? e.g. Draft talking points for Sen. Daines' office"
              aria-label="Next action"
            />
            <select className="toolbar-select" value={billId} onChange={(e) => setBillId(e.target.value)} aria-label="Attach to bill">
              <option value="">No bill</option>
              {billOptions.map((b) => (
                <option key={b.bill_id} value={b.bill_id}>
                  {b.title.length > 60 ? b.title.slice(0, 60) + "…" : b.title}
                </option>
              ))}
            </select>
            {members.length > 0 && (
              <select className="toolbar-select" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assign to">
                <option value="">Anyone</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
            )}
            <input
              type="date"
              className="toolbar-select tna-due"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due date"
            />
            <button type="submit" className="primary" disabled={busy || !body.trim()}>
              <Plus size={14} style={{ verticalAlign: -2, marginRight: 4 }} />Add
            </button>
          </form>

          <div className="tna-tabs">
            <button className={!showDone ? "tna-tab tna-tab-on" : "tna-tab"} onClick={() => setShowDone(false)} aria-pressed={!showDone}>
              Open ({open.length})
            </button>
            <button className={showDone ? "tna-tab tna-tab-on" : "tna-tab"} onClick={() => setShowDone(true)} aria-pressed={showDone}>
              Done ({done.length})
            </button>
          </div>

          {tasks === null ? (
            <div className="rbf-loading">{[0, 1, 2].map((i) => <div key={i} className="rbf-skel" />)}</div>
          ) : shown.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.875rem" }}>
              {showDone ? "Nothing completed yet." : "No open actions. Add the first one above."}
            </p>
          ) : (
            <div className="tna-list">
              {shown.map((t) => {
                const isOverdue = !t.done && t.due_date && t.due_date < today;
                const title = billTitle(t);
                return (
                  <div key={t.id} className="tna-row">
                    <button
                      onClick={() => toggle(t)}
                      aria-label={t.done ? "Mark not done" : "Mark done"}
                      className="tna-check"
                    >
                      {t.done ? <CheckSquare size={18} /> : <Square size={18} />}
                    </button>
                    <div className="tna-main">
                      <div className={t.done ? "tna-body-text tna-body-done" : "tna-body-text"}>{t.body}</div>
                      <div className="tna-meta">
                        {t.bill_id && title && (
                          <Link href={`/bill/${t.bill_id}`} className="tna-billtag" title={title}>
                            {title.length > 44 ? title.slice(0, 44) + "…" : title}
                          </Link>
                        )}
                        {t.assigned_to && (
                          <span className="tna-assignee">{emailById.get(t.assigned_to) ?? "assigned"}</span>
                        )}
                        {t.due_date && (
                          <span className={isOverdue ? "tna-due-tag tna-due-over" : "tna-due-tag"}>
                            due {t.due_date}
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: "0.6875rem" }}>{timeAgo(t.created_at)}</span>
                      </div>
                    </div>
                    <button onClick={() => remove(t)} aria-label="Delete next action" className="tna-del">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
