// A single, simple HTML email template used for every notification. Kept
// as inline styles since most email clients strip <style> tags or ignore
// external CSS - this is standard practice for transactional email.

import type { ClientReport } from "@/lib/clientReport";
import { weekOfLabel, dayLabel, reportSummary } from "@/lib/clientReport";

export type DigestChange = { summary: string; date: string | null; type: string };
export type DigestBillUpdate = { billId: string; title: string; citation: string; changes: DigestChange[] };

const TYPE_LABEL: Record<string, string> = {
  status_change: "Moved forward",
  new_action: "New action",
  cosponsor_change: "Cosponsors",
  text_published: "New text",
  cbo_published: "CBO estimate",
  summary_published: "CRS summary",
};

// One email per person per day, covering every change on every bill they
// follow. Previously each individual change was its own email, so a busy
// bill could send four emails in one morning.
export function billUpdatesEmail({ bills, userId }: { bills: DigestBillUpdate[]; userId: string }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const settingsUrl = `${appUrl}/settings`;
  const activityUrl = `${appUrl}/activity`;
  const unsubscribeUrl = `${appUrl}/unsubscribe?uid=${userId}`;
  const changeCount = bills.reduce((n, b) => n + b.changes.length, 0);

  const blocks = bills
    .map((b) => {
      const items = b.changes
        .map(
          (c) => `<tr><td style="padding:6px 0 6px 0;vertical-align:top;width:96px;font-size:11px;color:#5b6478;">${escapeHtml(TYPE_LABEL[c.type] ?? "Update")}${c.date ? `<br/>${escapeHtml(c.date)}` : ""}</td><td style="padding:6px 0;font-size:14px;line-height:1.45;color:#0e1530;">${escapeHtml(c.summary)}</td></tr>`,
        )
        .join("");
      return `
  <div style="padding:18px 0;border-top:1px solid #dfe4ee;">
    <div style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#2b50f0;margin:0 0 4px;">${escapeHtml(b.citation)}</div>
    <a href="${appUrl}/bill/${b.billId}" style="font-size:16px;font-weight:600;color:#0e1530;text-decoration:none;line-height:1.35;">${escapeHtml(b.title)}</a>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;">${items}</table>
  </div>`;
    })
    .join("");

  const headline = `${changeCount} update${changeCount === 1 ? "" : "s"} on ${bills.length} bill${bills.length === 1 ? "" : "s"} you follow`;
  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0e1530;">
  <div style="padding:24px 0 14px;"><span style="font-size:15px;font-weight:700;color:#0e1530;">Bill Tracker</span></div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;line-height:1.25;">${headline}</h1>
  <p style="font-size:13px;color:#5b6478;margin:0 0 10px;">From this morning's check of congress.gov.</p>
  ${blocks}
  <div style="padding:18px 0;border-top:1px solid #dfe4ee;">
    <a href="${activityUrl}" style="display:inline-block;background:#2b50f0;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px;font-weight:600;">Open activity feed</a>
  </div>
  <p style="font-size:12px;color:#5b6478;margin:0 0 24px;">
    You're getting this because email alerts are on for these bills.
    <a href="${settingsUrl}" style="color:#5b6478;">Notification settings</a> &nbsp;|&nbsp;
    <a href="${unsubscribeUrl}" style="color:#5b6478;">Unsubscribe from all emails</a>
  </p>
</div>`.trim();

  const text = `${headline}\n\n${bills
    .map((b) => `${b.citation} - ${b.title}\n${b.changes.map((c) => `  - ${c.date ? `[${c.date}] ` : ""}${c.summary}`).join("\n")}\n  ${appUrl}/bill/${b.billId}`)
    .join("\n\n")}\n\nNotification settings: ${settingsUrl}\nUnsubscribe from all emails: ${unsubscribeUrl}`;

  const subject =
    bills.length === 1
      ? `${bills[0].citation}: ${bills[0].changes[0]?.summary.slice(0, 70) ?? "update"}`
      : `${changeCount} updates on ${bills.length} bills you follow`;

  return { html, text, subject };
}

export function weeklyDigestEmail({
  bills,
  totalCount,
  userId,
}: {
  bills: { billId: string; title: string; matchedTopic: string }[];
  totalCount: number;
  userId: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  // Topic discovery lives on the dashboard now (the standalone /discovery
  // page was retired), so point the digest's call-to-action there.
  const discoveryUrl = `${appUrl}/dashboard`;
  const settingsUrl = `${appUrl}/settings`;
  const unsubscribeUrl = `${appUrl}/unsubscribe?uid=${userId}`;

  const rows = bills
    .map(
      (b) => `
    <tr>
      <td style="padding: 10px 0; border-top: 1px solid #d5deea;">
        <span style="display: inline-block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #2c5f9e; background: #dfe9f8; border-radius: 4px; padding: 2px 7px; margin-bottom: 5px;">${escapeHtml(b.matchedTopic)}</span><br/>
        <a href="${appUrl}/bill/${b.billId}" style="font-size: 14px; font-weight: 500; color: #101a2c; text-decoration: none;">${escapeHtml(b.title)}</a>
      </td>
    </tr>`
    )
    .join("");

  const overflowNote =
    totalCount > bills.length
      ? `<p style="font-size: 13px; color: #526279; margin: 12px 0 0;">+ ${totalCount - bills.length} more waiting on your dashboard.</p>`
      : "";

  const html = `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #101a2c;">
  <div style="padding: 24px 0 16px; border-bottom: 1px solid #d5deea;">
    <span style="font-size: 15px; font-weight: 600; color: #2c5f9e;">Bill Tracker</span>
  </div>
  <div style="padding: 24px 0;">
    <p style="font-size: 13px; color: #526279; margin: 0 0 6px;">Your weekly discovery digest</p>
    <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 12px; line-height: 1.4;">
      ${totalCount === 1 ? "1 new bill" : `${totalCount} new bills`} matched your topics this week
    </h1>
    <table style="width: 100%; border-collapse: collapse;">${rows}</table>
    ${overflowNote}
    <a href="${discoveryUrl}" style="display: inline-block; margin-top: 20px; background: #2c5f9e; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-size: 14px; font-weight: 500;">
      Review suggestions
    </a>
  </div>
  <div style="padding: 16px 0; border-top: 1px solid #d5deea;">
    <p style="font-size: 12px; color: #526279; margin: 0;">
      You're getting this because email alerts are on for your account.
      <a href="${settingsUrl}" style="color: #526279;">Manage notification settings</a>
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color: #526279;">Unsubscribe from all emails</a>
    </p>
  </div>
</div>`.trim();

  const text = `${totalCount === 1 ? "1 new bill" : `${totalCount} new bills`} matched your topics this week:\n\n${bills
    .map((b) => `- [${b.matchedTopic}] ${b.title} - ${appUrl}/bill/${b.billId}`)
    .join("\n")}\n\nReview suggestions: ${discoveryUrl}\n\nManage your notification settings: ${settingsUrl}\nUnsubscribe from all emails: ${unsubscribeUrl}`;

  return { html, text };
}

// ── Week ahead, sent by a teammate from the Week ahead page ──────────

export type WeekEmailInput = {
  start: string;
  headline: string;
  senderName: string;
  days: { label: string; events: { time: string | null; kind: string; title: string; committees: string[]; bills: string[]; why: string[]; status: string }[] }[];
  floor: { citation: string; title: string; how: string }[];
  deadlines: { title: string; closes: string; agency: string | null }[];
};

export function weekAheadEmail(input: WeekEmailInput) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const weekUrl = `${appUrl}/week?start=${input.start}`;
  const weekLabel = new Date(`${input.start}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

  const dayBlocks = input.days
    .filter((d) => d.events.length)
    .map((d) => {
      const rows = d.events
        .map((e) => {
          const cancelled = e.status !== "Scheduled";
          return `<tr><td style="padding:8px 0;vertical-align:top;width:92px;font-size:12px;color:#5b6478;">${escapeHtml(e.time ?? "Time TBA")}<br/><span style="font-weight:600;color:${e.kind === "Markup" ? "#8a5300" : "#3c4560"};">${escapeHtml(e.kind)}</span></td><td style="padding:8px 0;font-size:14px;line-height:1.45;color:#0e1530;">${cancelled ? `<strong style="color:#a81d33;">${escapeHtml(e.status)}: </strong>` : ""}<strong>${escapeHtml(e.title)}</strong><br/><span style="font-size:12px;color:#5b6478;">${escapeHtml(e.committees.join("; "))}</span>${e.bills.length ? `<br/><span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#2b50f0;">${escapeHtml(e.bills.join(", "))}</span>` : ""}${e.why.length ? `<br/><span style="font-size:12px;color:#3c4560;">${escapeHtml(e.why.join(". "))}</span>` : ""}</td></tr>`;
        })
        .join("");
      return `<div style="padding:14px 0 4px;border-top:1px solid #dfe4ee;"><div style="font-size:14px;font-weight:700;margin-bottom:2px;">${escapeHtml(d.label)}</div><table style="width:100%;border-collapse:collapse;">${rows}</table></div>`;
    })
    .join("");

  const floor = input.floor.length
    ? `<div style="padding:14px 0;border-top:1px solid #dfe4ee;"><div style="font-size:14px;font-weight:700;margin-bottom:6px;">On the House floor this week</div>${input.floor
        .map((f) => `<p style="margin:0 0 6px;font-size:14px;line-height:1.45;"><span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#2b50f0;">${escapeHtml(f.citation)}</span> ${escapeHtml(f.title)} <span style="color:#5b6478;font-size:12px;">${escapeHtml(f.how)}</span></p>`)
        .join("")}</div>`
    : "";

  const deadlines = input.deadlines.length
    ? `<div style="padding:14px 0;border-top:1px solid #dfe4ee;"><div style="font-size:14px;font-weight:700;margin-bottom:6px;">Comment deadlines</div>${input.deadlines
        .map((d) => `<p style="margin:0 0 6px;font-size:14px;line-height:1.45;">${escapeHtml(d.title)} <span style="color:#5b6478;font-size:12px;">${escapeHtml([d.agency, `closes ${d.closes}`].filter(Boolean).join(", "))}</span></p>`)
        .join("")}</div>`
    : "";

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:580px;margin:0 auto;color:#0e1530;">
  <div style="padding:24px 0 14px;"><span style="font-size:15px;font-weight:700;">Bill Tracker</span></div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;line-height:1.25;">Week of ${escapeHtml(weekLabel)}</h1>
  <p style="font-size:14px;color:#3c4560;margin:0 0 10px;line-height:1.5;">${escapeHtml(input.headline)}</p>
  ${floor}${dayBlocks}${deadlines}
  <div style="padding:18px 0;border-top:1px solid #dfe4ee;"><a href="${weekUrl}" style="display:inline-block;background:#2b50f0;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px;font-weight:600;">Open Week ahead</a></div>
  <p style="font-size:12px;color:#5b6478;margin:0 0 24px;">${escapeHtml(input.senderName)} sent this from Bill Tracker. Times are Eastern. Schedules change; the page always has the latest.</p>
</div>`.trim();

  const text = [
    `Week of ${weekLabel}`,
    input.headline,
    input.floor.length ? `\nOn the House floor this week:\n${input.floor.map((f) => `- ${f.citation} ${f.title} (${f.how})`).join("\n")}` : "",
    ...input.days.filter((d) => d.events.length).map((d) => `\n${d.label}\n${d.events.map((e) => `- ${e.time ?? "Time TBA"} ${e.kind}${e.status !== "Scheduled" ? ` (${e.status})` : ""}: ${e.title} [${e.committees.join("; ")}]${e.bills.length ? ` ${e.bills.join(", ")}` : ""}`).join("\n")}`),
    input.deadlines.length ? `\nComment deadlines:\n${input.deadlines.map((d) => `- ${d.title} (closes ${d.closes})`).join("\n")}` : "",
    `\nOpen Week ahead: ${weekUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text, subject: `Week of ${weekLabel}: ${input.headline.split(".")[0]}` };
}

// ── The Monday client report ──────────────────────────────────────


export function clientReportEmail(report: ClientReport, opts: { replyName?: string | null; shareUrl?: string | null }) {
  const label = weekOfLabel(report.weekOf);
  const mono = "font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#2b50f0;";
  const section = (title: string, inner: string) => `<div style="padding:16px 0 6px;border-top:1px solid #dfe4ee;"><div style="font-size:15px;font-weight:700;margin:0 0 8px;">${escapeHtml(title)}</div>${inner}</div>`;

  const moved = report.moved.length
    ? report.moved
        .map(
          (m) => `<div style="margin:0 0 12px;"><span style="${mono}">${escapeHtml(m.citation)}</span> <strong style="font-size:14px;">${escapeHtml(m.title)}</strong>${m.lines
            .map((l) => `<div style="font-size:14px;line-height:1.5;color:#1d2440;margin-top:4px;">${escapeHtml(l.text)}${l.plain ? `<br/><span style="font-size:13px;color:#5b6478;">${escapeHtml(l.plain)}</span>` : ""}</div>`)
            .join("")}</div>`,
        )
        .join("")
    : `<p style="font-size:14px;color:#5b6478;margin:0 0 10px;">No congressional action on these bills last week.</p>`;

  const upcomingItems = [
    ...report.upcoming.map((u) => `<li style="margin:0 0 6px;">${escapeHtml(dayLabel(u.day))}${u.time ? `, ${escapeHtml(u.time)}` : ""}: ${u.cancelled ? "<strong>Cancelled.</strong> " : ""}${escapeHtml(u.kind.toLowerCase())} on <span style="${mono}">${escapeHtml(u.citations.join(", "))}</span> (${escapeHtml(u.committees.join("; "))})</li>`),
    ...report.floor.map((f) => `<li style="margin:0 0 6px;">House floor this week: <span style="${mono}">${escapeHtml(f.citation)}</span> ${escapeHtml(f.how.toLowerCase())}</li>`),
  ];
  const upcoming = upcomingItems.length ? `<ul style="margin:0 0 8px;padding-left:18px;font-size:14px;line-height:1.5;">${upcomingItems.join("")}</ul>` : `<p style="font-size:14px;color:#5b6478;margin:0 0 10px;">Nothing scheduled yet. Committees usually post notices about a week ahead.</p>`;

  const ask = report.ask ? `<div style="margin:16px 0 4px;padding:14px 16px;border-radius:10px;background:#fdf0d8;"><div style="font-size:13px;font-weight:700;color:#7a4a00;margin-bottom:4px;">What we need from you</div><div style="font-size:14px;line-height:1.5;color:#3a2a10;white-space:pre-line;">${escapeHtml(report.ask)}</div></div>` : "";

  const rows = report.portfolio
    .map((p) => `<tr><td style="padding:8px 8px 8px 0;border-top:1px solid #eef1f7;vertical-align:top;"><span style="${mono}">${escapeHtml(p.citation)}</span><br/><span style="font-size:13px;">${escapeHtml(p.title)}</span></td><td style="padding:8px 8px;border-top:1px solid #eef1f7;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(p.stageLabel)}</td><td style="padding:8px 0 8px 8px;border-top:1px solid #eef1f7;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(p.positionLabel)}</td></tr>`)
    .join("");

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#0e1530;">
  <p style="font-size:12px;font-weight:600;color:#5b6478;margin:24px 0 4px;">${escapeHtml(report.firmName)} for ${escapeHtml(report.clientName)}</p>
  <h1 style="font-size:24px;font-weight:700;margin:0 0 6px;line-height:1.2;">Week of ${escapeHtml(label)}</h1>
  <p style="font-size:14px;color:#3c4560;margin:0 0 6px;">${escapeHtml(reportSummary(report))}</p>
  ${ask}
  ${section("What moved last week", moved)}
  ${section("Coming up", upcoming)}
  ${section("Where everything stands", `<table style="width:100%;border-collapse:collapse;">${rows}</table>`)}
  ${opts.shareUrl ? `<p style="margin:18px 0 0;"><a href="${opts.shareUrl}" style="display:inline-block;background:#2b50f0;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px;font-weight:600;">See the live version</a></p>` : ""}
  <p style="font-size:12px;color:#5b6478;margin:22px 0 24px;">Prepared by ${escapeHtml(report.firmName)} from congress.gov and House records.${opts.replyName ? ` Reply to this email to reach ${escapeHtml(opts.replyName)}.` : ""} To stop receiving these updates, reply and let us know.</p>
</div>`.trim();

  const text = [
    `${report.firmName} for ${report.clientName}`,
    `Week of ${label}`,
    reportSummary(report),
    report.ask ? `\nWHAT WE NEED FROM YOU\n${report.ask}` : "",
    `\nWHAT MOVED LAST WEEK\n${report.moved.length ? report.moved.map((m) => `${m.citation} ${m.title}\n${m.lines.map((l) => `  - ${l.text}`).join("\n")}`).join("\n") : "No congressional action on these bills last week."}`,
    `\nCOMING UP\n${[...report.upcoming.map((u) => `- ${dayLabel(u.day)}${u.time ? `, ${u.time}` : ""}: ${u.cancelled ? "CANCELLED " : ""}${u.kind.toLowerCase()} on ${u.citations.join(", ")}`), ...report.floor.map((f) => `- House floor: ${f.citation} ${f.how.toLowerCase()}`)].join("\n") || "Nothing scheduled yet."}`,
    `\nWHERE EVERYTHING STANDS\n${report.portfolio.map((p) => `- ${p.citation} ${p.title}: ${p.stageLabel}. ${p.positionLabel}.`).join("\n")}`,
    opts.shareUrl ? `\nLive version: ${opts.shareUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { html, text, subject: `${report.clientName}: week of ${label}` };
}

// ── Drug affordability boards: new documents and state bills ─────────

export type DrugBoardEmailInput = {
  userId: string;
  documents: { state: string; title: string; url: string; kind: string; date: string | null }[];
  bills: { state: string; identifier: string; title: string; latestAction: string | null; url: string | null }[];
};

export function drugBoardEmail(input: DrugBoardEmailInput) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const pageUrl = `${appUrl}/drug-boards`;
  const settingsUrl = `${appUrl}/settings`;
  const unsubscribeUrl = `${appUrl}/unsubscribe?uid=${input.userId}`;
  const n = input.documents.length + input.bills.length;
  const chip = (s: string) => `<span style="display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;color:#1a35b8;background:#e8edff;border-radius:4px;padding:1px 6px;margin-right:6px;">${escapeHtml(s)}</span>`;

  const docs = input.documents.length
    ? `<div style="padding:14px 0;border-top:1px solid #dfe4ee;"><div style="font-size:15px;font-weight:700;margin-bottom:8px;">New on board websites</div>${input.documents
        .map((d) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.45;">${chip(d.state)}<a href="${escapeHtml(d.url)}" style="color:#0e1530;">${escapeHtml(d.title)}</a>${d.date ? ` <span style="color:#5b6478;font-size:12px;">${escapeHtml(d.date)}</span>` : ""}</p>`)
        .join("")}</div>`
    : "";
  const bills = input.bills.length
    ? `<div style="padding:14px 0;border-top:1px solid #dfe4ee;"><div style="font-size:15px;font-weight:700;margin-bottom:8px;">State bills on drug affordability boards</div>${input.bills
        .map((b) => `<p style="margin:0 0 10px;font-size:14px;line-height:1.45;">${chip(b.state)}<strong>${escapeHtml(b.identifier)}</strong> ${b.url ? `<a href="${escapeHtml(b.url)}" style="color:#0e1530;">${escapeHtml(b.title)}</a>` : escapeHtml(b.title)}${b.latestAction ? `<br/><span style="color:#5b6478;font-size:12px;">${escapeHtml(b.latestAction)}</span>` : ""}</p>`)
        .join("")}</div>`
    : "";

  const html = `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:580px;margin:0 auto;color:#0e1530;">
  <div style="padding:24px 0 14px;"><span style="font-size:15px;font-weight:700;">Bill Tracker</span></div>
  <h1 style="font-size:22px;font-weight:700;margin:0 0 6px;line-height:1.25;">${n} update${n === 1 ? "" : "s"} from state drug affordability boards</h1>
  <p style="font-size:13px;color:#5b6478;margin:0 0 10px;">Open each one to see what changed, then update the drug tracker if a status moved.</p>
  ${docs}${bills}
  <div style="padding:18px 0;border-top:1px solid #dfe4ee;"><a href="${pageUrl}" style="display:inline-block;background:#2b50f0;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:14px;font-weight:600;">Open Drug boards</a></div>
  <p style="font-size:12px;color:#5b6478;margin:0 0 24px;">You turned on drug board emails on the Drug boards page. <a href="${pageUrl}" style="color:#5b6478;">Turn them off there</a> &nbsp;|&nbsp; <a href="${settingsUrl}" style="color:#5b6478;">Notification settings</a> &nbsp;|&nbsp; <a href="${unsubscribeUrl}" style="color:#5b6478;">Unsubscribe from all emails</a></p>
</div>`.trim();

  const text = [
    `${n} update${n === 1 ? "" : "s"} from state drug affordability boards`,
    input.documents.length ? `\nNew on board websites:\n${input.documents.map((d) => `- [${d.state}] ${d.title}${d.date ? ` (${d.date})` : ""}\n  ${d.url}`).join("\n")}` : "",
    input.bills.length ? `\nState bills:\n${input.bills.map((b) => `- [${b.state}] ${b.identifier} ${b.title}${b.latestAction ? `\n  ${b.latestAction}` : ""}${b.url ? `\n  ${b.url}` : ""}`).join("\n")}` : "",
    `\nOpen Drug boards: ${pageUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  const subject = input.documents.length && input.bills.length
    ? `Drug boards: ${input.documents.length} new document${input.documents.length === 1 ? "" : "s"}, ${input.bills.length} state bill${input.bills.length === 1 ? "" : "s"}`
    : input.documents.length
      ? `Drug boards: ${input.documents.length} new document${input.documents.length === 1 ? "" : "s"} (${Array.from(new Set(input.documents.map((d) => d.state))).join(", ")})`
      : `Drug boards: ${input.bills.length} state bill update${input.bills.length === 1 ? "" : "s"}`;
  return { html, text, subject };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
