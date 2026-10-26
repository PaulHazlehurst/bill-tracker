"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ClientReportView from "@/components/ClientReportView";
import { BrandMark } from "@/components/Sidebar";
import type { ClientReport } from "@/lib/clientReport";

// A client's read-only view. No login, no app chrome: just their report,
// always current. Reads only /api/public/client/[token].
export default function SharedClientReportPage() {
  const params = useParams();
  const token = params.token as string;
  const [report, setReport] = useState<ClientReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/client/${token}`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error);
        setReport(b.report);
      })
      .catch((e) => setError(e?.message || "This link isn't working."));
  }, [token]);

  return (
    <div className="share cr-share">
      <div className="cr-share-inner">
        {error ? (
          <div className="empty">
            <p className="empty-title">This link isn&apos;t available</p>
            <p className="empty-body">{error} Ask the person who sent it for a new one.</p>
          </div>
        ) : report ? (
          <ClientReportView report={report} linkBills={false} />
        ) : (
          <div className="skel skel-block" style={{ height: 600 }} />
        )}
        <p className="cr-powered"><BrandMark size={18} /> Kept up to date with Bill Tracker</p>
      </div>
    </div>
  );
}
