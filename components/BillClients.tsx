"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import { POSITION_LABELS } from "@/lib/clientReport";
import { Briefcase } from "lucide-react";

type Row = { client_id: string; position: string; clients: { name: string } | { name: string }[] | null };

// On a bill's page: which of your clients follow it, and a quick way to add
// it to another one. Hidden entirely until the Clients update (0004) is run.
export default function BillClients({ billId }: { billId: string }) {
  const supabase = createClient();
  const { toast } = useUI();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [ready, setReady] = useState(true);

  async function load() {
    const [{ data, error }, { data: all }] = await Promise.all([
      supabase.from("client_bills").select("client_id, position, clients(name)").eq("bill_id", billId),
      supabase.from("clients").select("id, name").order("name"),
    ]);
    if (error) return setReady(false);
    setRows((data as Row[]) ?? []);
    setClients((all as { id: string; name: string }[]) ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  async function add(clientId: string) {
    const res = await fetch(`/api/clients/${clientId}/bills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billId }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast(body.error ?? "Couldn't add it.", "error");
    toast(`Added to ${clients.find((c) => c.id === clientId)?.name ?? "the client"}`, "success");
    load();
  }

  if (!ready || rows === null) return null;
  const on = new Set(rows.map((r) => r.client_id));
  const others = clients.filter((c) => !on.has(c.id));
  if (!rows.length && !clients.length) return null;

  return (
    <section className="card">
      <h2 className="card-title">Clients</h2>
      {rows.length === 0 ? (
        <p className="card-sub">None of your clients follow this bill.</p>
      ) : (
        <ul className="bc-list">
          {rows.map((r) => {
            const c = Array.isArray(r.clients) ? r.clients[0] : r.clients;
            return (
              <li key={r.client_id}>
                <Briefcase size={14} aria-hidden="true" />
                <Link href={`/clients/${r.client_id}`}>{c?.name ?? "Client"}</Link>
                <span className={`pos-tag pos-${r.position}`}>{POSITION_LABELS[r.position] ?? r.position}</span>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <label className="bc-add">
          <span className="sr-only">Add this bill to a client</span>
          <select className="select" value="" onChange={(e) => e.target.value && add(e.target.value)}>
            <option value="">Add to a client…</option>
            {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}
