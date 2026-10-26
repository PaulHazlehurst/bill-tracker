"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { useUI } from "@/components/UIProvider";
import { useSession } from "@/components/SessionProvider";
import { Briefcase, Plus } from "lucide-react";

type ClientSummary = { id: string; name: string; reportEnabled: boolean; shared: boolean; billCount: number; movedCount: number; recipientCount: number; updatedAt: string };

export default function ClientsPage() {
  const router = useRouter();
  const { toast } = useUI();
  const { org } = useSession();
  const [clients, setClients] = useState<ClientSummary[] | null>(null);
  const [ready, setReady] = useState(true);
  const [notReadyMessage, setNotReadyMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((b) => {
        setReady(b.ready !== false);
        if (b.ready === false) setNotReadyMessage(b.error);
        setClients(b.clients ?? []);
      })
      .catch(() => setClients([]));
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setAdding(true);
    const res = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok) return toast(body.error ?? "Couldn't add the client.", "error");
    router.push(`/clients/${body.id}`);
  }

  return (
    <div className="page clients-page">
      <PageHeader
        title="Clients"
        description={`The organizations ${org?.name ? `${org.name} represents` : "you represent"}: the bills each one cares about, where you stand for them, and a report that writes itself every Monday.`}
      />

      {!ready ? (
        <div className="empty">
          <div className="empty-icon"><Briefcase size={20} /></div>
          <p className="empty-title">Clients need a one-time database update</p>
          <p className="empty-body">{notReadyMessage}</p>
          <div className="empty-action"><Link className="btn btn-secondary" href="/api-usage">Open Data sources</Link></div>
        </div>
      ) : (
        <>
          <form className="cl-add" onSubmit={add}>
            <label className="sr-only" htmlFor="new-client">Client name</label>
            <input id="new-client" className="input" placeholder="Client name, like Valley Regional Health Network" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <button className="btn btn-primary" disabled={!name.trim() || adding}><Plus size={15} /> {adding ? "Adding…" : "Add client"}</button>
          </form>

          {clients === null ? (
            <div className="cl-grid">{[0, 1, 2].map((i) => <div key={i} className="skel skel-block" />)}</div>
          ) : clients.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><Briefcase size={20} /></div>
              <p className="empty-title">No clients yet</p>
              <p className="empty-body">Add the organizations you work for. Give each one its bills and your position on each, and they can get a short update every Monday: what moved, what&apos;s coming, and what you need from them.</p>
            </div>
          ) : (
            <ul className="cl-grid">
              {clients.map((c) => (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="cl-card">
                    <span className="cl-card-name">{c.name}</span>
                    <span className="cl-card-meta">
                      {c.billCount} bill{c.billCount === 1 ? "" : "s"}
                      {c.movedCount > 0 && <span className="cl-moved">{c.movedCount} moved this week</span>}
                    </span>
                    <span className="cl-card-report">
                      {c.reportEnabled
                        ? c.recipientCount
                          ? `Monday report on, to ${c.recipientCount} ${c.recipientCount === 1 ? "person" : "people"}`
                          : "Monday report on, but nobody to send it to"
                        : "Monday report off"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
