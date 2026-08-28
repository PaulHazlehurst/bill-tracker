// A single, simple HTML email template used for every notification. Kept
// as inline styles since most email clients strip <style> tags or ignore
// external CSS - this is standard practice for transactional email.

export function billUpdateEmail({
  billTitle,
  billId,
  summary,
  userId,
}: {
  billTitle: string;
  billId: string;
  summary: string;
  userId: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const billUrl = `${appUrl}/bill/${billId}`;
  const settingsUrl = `${appUrl}/settings`;
  // A genuine one-click unsubscribe, no login required - CAN-SPAM requires
  // this to actually be one click, and the old "manage settings" link
  // (which required signing in first) didn't meet that bar. Uses the
  // profile's own id as the token: it's already an unguessable UUID, and
  // the only thing this link can do is turn off email notifications for
  // that one account - low-stakes and reversible, so a dedicated signed
  // token isn't needed for something with this limited a blast radius.
  const unsubscribeUrl = `${appUrl}/unsubscribe?uid=${userId}`;

  const html = `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #101a2c;">
  <div style="padding: 24px 0 16px; border-bottom: 1px solid #d5deea;">
    <span style="font-size: 15px; font-weight: 600; color: #2c5f9e;">Bill Tracker</span>
  </div>
  <div style="padding: 24px 0;">
    <p style="font-size: 13px; color: #526279; margin: 0 0 6px;">Update on a bill you're tracking</p>
    <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 12px; line-height: 1.4;">${escapeHtml(billTitle)}</h1>
    <p style="font-size: 14px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(summary)}</p>
    <a href="${billUrl}" style="display: inline-block; background: #2c5f9e; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-size: 14px; font-weight: 500;">
      View this bill
    </a>
  </div>
  <div style="padding: 16px 0; border-top: 1px solid #d5deea;">
    <p style="font-size: 12px; color: #526279; margin: 0;">
      You're getting this because you turned on email alerts for this bill.
      <a href="${settingsUrl}" style="color: #526279;">Manage notification settings</a>
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color: #526279;">Unsubscribe from all emails</a>
    </p>
  </div>
</div>`.trim();

  const text = `${billTitle}\n\n${summary}\n\nView this bill: ${billUrl}\n\nManage your notification settings: ${settingsUrl}\nUnsubscribe from all emails: ${unsubscribeUrl}`;

  return { html, text };
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
      ? `<p style="font-size: 13px; color: #526279; margin: 12px 0 0;">+ ${totalCount - bills.length} more on your Discovery page.</p>`
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
      Review on Discovery
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
    .join("\n")}\n\nReview on Discovery: ${discoveryUrl}\n\nManage your notification settings: ${settingsUrl}\nUnsubscribe from all emails: ${unsubscribeUrl}`;

  return { html, text };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
