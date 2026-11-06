// Regulations: the pure parts, shared by the page, the API and the morning
// alerts. Tested in tests/regulations.test.ts.

export type RegStatus = "new" | "following" | "commenting" | "commented";
export const REG_STATUSES: RegStatus[] = ["new", "following", "commenting", "commented"];
export const REG_STATUS_LABELS: Record<RegStatus, string> = {
  new: "Not following",
  following: "Following",
  commenting: "Writing a comment",
  commented: "Comment sent",
};

export type DocType = "proposed" | "final" | "notice" | "other";
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  proposed: "Proposed rule",
  final: "Final rule",
  notice: "Notice",
  other: "Other",
};

/** Today's date as YYYY-MM-DD in local time (Federal Register dates are bare days). */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

export function commentOpen(closes: string | null | undefined, today: string): boolean {
  return !!closes && closes >= today;
}

/** "today", "tomorrow", "in 5 days". */
export function whenText(days: number): string {
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

/**
 * The regulations.gov page where comments are filed, from a Federal Register
 * docket id such as "CMS-2026-0142" or "Docket No. FDA-2026-N-1234". Null
 * for docket numbers regulations.gov doesn't use (some agencies run their own).
 */
export function regulationsGovUrl(docket: string | null | undefined): string | null {
  if (!docket) return null;
  const first = docket.split(/[;,]/)[0].replace(/^\s*(docket\s*(no\.?|number|id)?\s*:?\s*)/i, "").trim();
  if (!/^[A-Z]{2,10}(-[A-Z0-9]{1,10}){2,4}$/i.test(first) || !/\d{4}/.test(first)) return null;
  return `https://www.regulations.gov/docket/${encodeURIComponent(first.toUpperCase())}`;
}

export type Section = "open" | "final" | "other";
export const SECTION_LABELS: Record<Section, { title: string; desc: string }> = {
  open: { title: "Open for comment", desc: "Agencies are taking public comments. Closest deadline first." },
  final: { title: "Final rules", desc: "Decided. Shows when each takes effect." },
  other: { title: "Everything else", desc: "Notices, and proposed rules whose comment period has closed." },
};

export function sectionFor(reg: { doc_type: string | null; comment_close_date: string | null }, today: string): Section {
  if (commentOpen(reg.comment_close_date, today)) return "open";
  if (reg.doc_type === "final") return "final";
  return "other";
}

/** Sort within a section: deadlines soonest, final rules by effective date (upcoming first), the rest newest first. */
export function sortForSection<T extends { reg: { comment_close_date: string | null; effective_date: string | null; publication_date: string } }>(items: T[], section: Section, today: string): T[] {
  const s = [...items];
  if (section === "open") return s.sort((a, b) => (a.reg.comment_close_date ?? "").localeCompare(b.reg.comment_close_date ?? ""));
  if (section === "final") {
    const key = (x: T) => {
      const e = x.reg.effective_date;
      // Upcoming effective dates first (soonest), then already in effect (newest).
      return e && e >= today ? `0${e}` : `1${String(99999999 - Number((e ?? x.reg.publication_date).replace(/-/g, "")))}`;
    };
    return s.sort((a, b) => key(a).localeCompare(key(b)));
  }
  return s.sort((a, b) => b.reg.publication_date.localeCompare(a.reg.publication_date));
}

// ── Morning deadline alerts ───────────────────────────────────────────

export type DeadlineRow = {
  regulation_id: string;
  organization_id: string | null;
  user_id: string | null;
  status: string;
  title: string;
  comment_close_date: string;
};

/**
 * Reminders for comment periods on regulations someone is following or
 * writing a comment on: once a week out, and once the day before. A comment
 * already sent needs no reminder.
 */
export function deadlineNotifications(rows: DeadlineRow[], membersOf: (orgId: string) => string[], today: string) {
  const out: { userId: string; kind: "regulation"; title: string; body: string; url: string; dedupeKey: string }[] = [];
  for (const r of rows) {
    if (r.status !== "following" && r.status !== "commenting") continue;
    const days = daysBetween(today, r.comment_close_date);
    if (days < 0 || days > 7) continue;
    const stage = days <= 1 ? "last" : "week";
    const people = r.organization_id ? membersOf(r.organization_id) : r.user_id ? [r.user_id] : [];
    const short = r.title.length > 90 ? `${r.title.slice(0, 89).trimEnd()}…` : r.title;
    for (const userId of people) {
      out.push({
        userId,
        kind: "regulation",
        title: `Comments close ${whenText(days)}`,
        body: `${short}${r.status === "commenting" ? " (your team is writing a comment)" : ""}`,
        url: `/regulations?focus=${encodeURIComponent(r.regulation_id)}`,
        dedupeKey: `reg:${r.regulation_id}:${stage}`,
      });
    }
  }
  return out;
}
