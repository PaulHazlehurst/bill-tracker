"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, FileText, Pill, Users, ListChecks, Briefcase, BellRing } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/billMeta";

export type NotificationRow = { id: string; kind: string; title: string; body: string | null; url: string | null; created_at: string; read_at: string | null };

export const KIND_ICON: Record<string, typeof Bell> = { bill_update: FileText, drug_board: Pill, team: Users, task: ListChecks, client_report: Briefcase, test: BellRing };

// The bell in the top bar: everything that was sent to you (bill changes,
// drug board news, team invitations and tasks), whether or not push or
// email is on. Refreshes every minute, when you come back to the tab, and
// the moment a push alert arrives.
export default function NotificationBell() {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [{ data, error }, { count }] = await Promise.all([
      supabase.from("notifications").select("id, kind, title, body, url, created_at, read_at").order("created_at", { ascending: false }).limit(12),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);
    if (error) {
      setReady(false); // database update 0007 not run yet
      return;
    }
    setItems((data as NotificationRow[]) ?? []);
    setUnread(count ?? 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
    const every = setInterval(load, 60_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    const onMessage = (e: MessageEvent) => e.data?.type === "bt:notification" && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("bt:notifications", load);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("bt:notifications", load);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function openItem(n: NotificationRow) {
    setOpen(false);
    if (!n.read_at) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? null);
      setUnread((u) => Math.max(0, u - 1));
      supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id).then(() => {});
    }
    if (n.url) router.push(n.url);
  }

  async function markAllRead() {
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((x) => ({ ...x, read_at: x.read_at ?? now })) ?? null);
    setUnread(0);
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  }

  if (!ready) return null;

  return (
    <div className="bell" ref={box}>
      <button className="icon-btn bell-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
        <Bell size={18} />
        {unread > 0 && <span className="bell-count" aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <span className="bell-title">Notifications</span>
            {unread > 0 && (
              <button className="link-btn" onClick={markAllRead}>
                <CheckCheck size={14} aria-hidden="true" /> Mark all read
              </button>
            )}
          </div>
          {items === null ? (
            <div className="bell-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="bell-empty">Nothing yet. Bill changes, drug board news and team updates will show up here.</div>
          ) : (
            <ul className="bell-list">
              {items.map((n) => {
                const Icon = KIND_ICON[n.kind] ?? Bell;
                return (
                  <li key={n.id}>
                    <button className={`bell-item${n.read_at ? "" : " is-unread"}`} onClick={() => openItem(n)}>
                      <span className="bell-icon" aria-hidden="true"><Icon size={15} /></span>
                      <span className="bell-text">
                        <span className="bell-item-title">{n.title}</span>
                        {n.body && <span className="bell-item-body">{n.body}</span>}
                        <span className="bell-item-time">{timeAgo(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="bell-foot">
            <Link href="/notifications" onClick={() => setOpen(false)}>See all</Link>
            <Link href="/settings#notifications" onClick={() => setOpen(false)}>Alert settings</Link>
          </div>
        </div>
      )}
    </div>
  );
}
