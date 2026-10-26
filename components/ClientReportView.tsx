import Link from "next/link";
import RouteLine from "@/components/ui/RouteLine";
import { formatDate } from "@/lib/billMeta";
import { weekOfLabel, dayLabel, reportSummary, type ClientReport } from "@/lib/clientReport";

// The client report as a page: used for the in-app preview, the print/PDF
// page and the client's read-only link. The email is the same content in
// email-safe HTML (lib/emailTemplate.ts).
export default function ClientReportView({ report, linkBills = true }: { report: ClientReport; linkBills?: boolean }) {
  const billLink = (billId: string, title: string) => (linkBills ? <Link href={`/bill/${billId}`}>{title}</Link> : title);

  return (
    <article className="cr-paper">
      <p className="cr-from">{report.firmName} for {report.clientName}</p>
      <h2 className="cr-title">Week of {weekOfLabel(report.weekOf)}</h2>
      <p className="cr-summary">{reportSummary(report)}</p>

      {report.ask && (
        <section className="cr-ask" aria-label="What we need from you">
          <h3>What we need from you</h3>
          <p>{report.ask}</p>
        </section>
      )}

      <section className="cr-section">
        <h3>What moved last week</h3>
        {report.moved.length === 0 ? (
          <p className="cr-quiet">No congressional action on these bills last week.</p>
        ) : (
          <ul className="cr-moved">
            {report.moved.map((m) => (
              <li key={m.billId}>
                <p className="cr-bill"><span className="cite">{m.citation}</span> {billLink(m.billId, m.title)}</p>
                <ul>
                  {m.lines.map((l, i) => (
                    <li key={i}>
                      <span className="cr-date">{formatDate(l.date)}</span> {l.text}
                      {l.plain && <span className="cr-plain">{l.plain}</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cr-section">
        <h3>Coming up</h3>
        {report.upcoming.length === 0 && report.floor.length === 0 ? (
          <p className="cr-quiet">Nothing scheduled yet. Committees usually post notices about a week ahead.</p>
        ) : (
          <ul className="cr-upcoming">
            {report.upcoming.map((u, i) => (
              <li key={i} className={u.cancelled ? "is-cancelled" : ""}>
                <strong>{dayLabel(u.day)}{u.time ? `, ${u.time}` : ""}</strong>
                {u.cancelled ? " Cancelled: " : ": "}
                {u.kind.toLowerCase()} on <span className="cite">{u.citations.join(", ")}</span>
                <span className="cr-committee">{u.committees.join("; ")}</span>
              </li>
            ))}
            {report.floor.map((f) => (
              <li key={f.citation}>
                <strong>House floor this week:</strong> <span className="cite">{f.citation}</span> {f.how.toLowerCase()}
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.quiet.length > 0 && (
        <section className="cr-section">
          <h3>Gone quiet</h3>
          <p className="cr-quiet">
            {report.quiet.map((q) => `${q.citation} (no action in ${q.days} days)`).join(", ")}.
          </p>
        </section>
      )}

      <section className="cr-section">
        <h3>Where everything stands</h3>
        <ul className="cr-portfolio">
          {report.portfolio.map((p) => (
            <li key={p.billId}>
              <div className="cr-p-top">
                <span className="cite">{p.citation}</span>
                <span className={`cr-pos pos-${p.position}`}>{p.positionLabel}</span>
              </div>
              <p className="cr-p-title">{billLink(p.billId, p.title)}</p>
              <div className="cr-p-route">
                <RouteLine stage={p.stage} billType={p.billType} />
                <span>{p.stageLabel}{p.lastActionDate ? `. Last action ${formatDate(p.lastActionDate)}` : ""}</span>
              </div>
              {p.note && <p className="cr-note">{p.note}</p>}
            </li>
          ))}
          {report.portfolio.length === 0 && <li className="cr-quiet">No bills on this client's list yet.</li>}
        </ul>
      </section>

      <p className="cr-foot">Prepared by {report.firmName} from congress.gov and House records. Updated {new Date(report.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</p>
    </article>
  );
}
