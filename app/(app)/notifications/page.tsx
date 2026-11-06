"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState from "@/components/EmptyState";
import { MotionItem } from "@/components/Motion";
import { animated } from "@/lib/motion";
import { timeAgo } from "@/lib/billMeta";
import { KIND_ICON, type NotificationRow } from "@/components/NotificationBell";

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "unread", label: "Unread" },
  { id: "bill_update", label: "Bills" },
  { id: "regulation", label: "Regulations" },
  { id: "drug_board", label: "Drug boards" },
  { id: "team", label: "Team and tasks" },
] as const;

// Every notification from the last 90 days, newest first.
export default function NotificationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

  useEffect(() => {
    supabase
      .from("notifications")
      .select("id, kind, title, body, url, created_at, read_at")
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (error) setError("Notifications need database update 0007. Ask whoever manages the app to run it.");
        else setRows((data as NotificationRow[]) ?? []);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (rows ?? []).filter((n) =>
    filter === "all" ? true : filter === "unread" ? !n.read_at : filter === "team" ? n.kind === "team" || n.kind === "task" : n.kind === filter,
  );
  const unread = (rows ?? []).filter((n) => !n.read_at).length;

  async function open(n: NotificationRow) {
    if (!n.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    window.dispatchEvent(new CustomEvent("bt:notifications"));
    if (n.url) router.push(n.url);
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    animated(() => setRows((prev) => prev?.map((n) => ({ ...n, read_at: n.read_at ?? now })) ?? null));
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
    window.dispatchEvent(new CustomEvent("bt:notifications"));
  }

  return (
    <div className="page">
      <PageHeader
        title="Notifications"
        description={<>Everything sent to you in the last 90 days. Choose what reaches your phone, computer and inbox in <Link href="/settings#notifications">Settings</Link>.</>}
        actions={unread > 0 ? <button className="btn btn-secondary" onClick={markAllRead}><CheckCheck size={15} /> Mark all read</button> : null}
      />
      <div className="seg nt-filters" role="tablist" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? "is-on" : ""} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="error-text">{error}</p>
      ) : rows === null ? (
        <div className="list-skel">{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-billrow" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Bell} title={filter === "unread" ? "You're all caught up" : "Nothing here yet"}>
          Bill changes, drug board news and anything your team sends you will appear here.
        </EmptyState>
      ) : (
        <ul className="nt-list settle">
          {shown.map((n) => {
            const Icon = KIND_ICON[n.kind] ?? Bell;
            return (
              <MotionItem key={n.id}>
                <li>
                  <button className={`nt-item${n.read_at ? "" : " is-unread"}`} onClick={() => open(n)}>
                    <span className="bell-icon" aria-hidden="true"><Icon size={16} /></span>
                    <span className="bell-text">
                      <span className="bell-item-title">{n.title}</span>
                      {n.body && <span className="bell-item-body nt-body">{n.body}</span>}
                    </span>
                    <span className="bell-item-time" title={new Date(n.created_at).toLocaleString()}>{timeAgo(n.created_at)}</span>
                  </button>
                </li>
              </MotionItem>
            );
          })}
        </ul>
      )}
    </div>
  );
}
