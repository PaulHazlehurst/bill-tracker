// A single, simple HTML email template used for every notification. Kept
// as inline styles since most email clients strip <style> tags or ignore
// external CSS - this is standard practice for transactional email.

export function billUpdateEmail({
  billTitle,
  billId,
  summary,
}: {
  billTitle: string;
  billId: string;
  summary: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const billUrl = `${appUrl}/bill/${billId}`;
  const settingsUrl = `${appUrl}/settings`;

  const html = `
<div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #16211d;">
  <div style="padding: 24px 0 16px; border-bottom: 1px solid #d9d4c4;">
    <span style="font-size: 15px; font-weight: 600; color: #0f7a5c;">Bill Tracker</span>
  </div>
  <div style="padding: 24px 0;">
    <p style="font-size: 13px; color: #566259; margin: 0 0 6px;">Update on a bill you're tracking</p>
    <h1 style="font-size: 18px; font-weight: 600; margin: 0 0 12px; line-height: 1.4;">${escapeHtml(billTitle)}</h1>
    <p style="font-size: 14px; line-height: 1.5; margin: 0 0 20px;">${escapeHtml(summary)}</p>
    <a href="${billUrl}" style="display: inline-block; background: #0f7a5c; color: #ffffff; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-size: 14px; font-weight: 500;">
      View this bill
    </a>
  </div>
  <div style="padding: 16px 0; border-top: 1px solid #d9d4c4;">
    <p style="font-size: 12px; color: #566259; margin: 0;">
      You're getting this because you turned on email alerts for this bill.
      <a href="${settingsUrl}" style="color: #566259;">Manage notification settings</a>
    </p>
  </div>
</div>`.trim();

  const text = `${billTitle}\n\n${summary}\n\nView this bill: ${billUrl}\n\nManage your notification settings: ${settingsUrl}`;

  return { html, text };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
