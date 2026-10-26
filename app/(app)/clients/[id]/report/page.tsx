"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ClientReportView from "@/components/ClientReportView";
import type { ClientReport } from "@/lib/clientReport";
import { ArrowLeft, Printer } from "lucide-react";

// The report on its own, laid out for paper. "Print or save as PDF" uses the
// browser's print dialog, where every browser offers Save as PDF.
export default function ClientReportPrintPage() {
  const params = useParams();
  const id = params.id as string;
  const [report, setReport] = useState<ClientReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/clients/${id}/report`)
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b.error);
        setReport(b.report);
      })
      .catch((e) => setError(e?.message || "Couldn't build the report."));
  }, [id]);

  return (
    <div className="page cr-print-page">
      <div className="cr-print-bar no-print">
        <Link href={`/clients/${id}`} className="backlink"><ArrowLeft size={15} /> Back to client</Link>
        <button className="btn btn-primary" onClick={() => window.print()} disabled={!report}><Printer size={15} /> Print or save as PDF</button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {report ? <ClientReportView report={report} linkBills={false} /> : !error && <div className="skel skel-block" style={{ height: 600 }} />}
    </div>
  );
}
