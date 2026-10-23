// A single, simple HTML email template used for every notification. Kept
// as inline styles since most email clients strip <style> tags or ignore
// external CSS - this is standard practice for transactional email.

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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
