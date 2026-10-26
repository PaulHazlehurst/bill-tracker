import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { loadWeekContext, loadMeetings, loadDeadlines } from "@/lib/weekData";
import { buildWeek, reasonsFor } from "@/lib/weekAhead";
import { weekMonday, addDays } from "@/lib/houseFloor";
import { buildIcs, type IcsEvent } from "@/lib/ics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/calendar/feed/<token>.ics - a calendar app subscribes to this.
// No login (calendar apps can't sign in); the unguessable token in the link
// is the key, and it can be reset from the Week ahead page. Only meetings
// that touch the person's bills, clients or topics are included, for the
// last week and the next four.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token.replace(/\.ics$/i, "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new NextResponse("Not found", { status: 404 });

  const admin = createAdminClient();
  const { data: feed } = await admin.from("calendar_feeds").select("user_id").eq("token", token).maybeSingle();
  if (!feed) return new NextResponse("This calendar link was reset. Copy the new one from Week ahead.", { status: 404 });

  const ctx = await loadWeekContext(admin, feed.user_id);
  const start = addDays(weekMonday(), -7);
  const { rows } = await loadMeetings(admin, start, 35);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  const events: IcsEvent[] = [];
  for (let w = 0; w < 5; w++) {
    const view = buildWeek(addDays(start, w * 7), rows, [], ctx, "mine");
    for (const day of view.days) {
      for (const e of day.events) {
        if (!e.startsAt) continue;
        const why = reasonsFor(e);
        events.push({
          uid: `meeting-${e.id}@billtracker`,
          title: `${e.kind}: ${e.title}`,
          start: e.startsAt,
          durationMinutes: 120,
          location: e.location,
          description: [e.committees.join("; "), e.bills.length ? `Bills: ${e.bills.map((b) => b.citation).join(", ")}` : "", why.join(". "), e.url].filter(Boolean).join("\n"),
          url: e.url || null,
          cancelled: e.status === "Canceled" || e.status === "Postponed",
        });
      }
    }
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  for (const d of await loadDeadlines(admin, ctx, feed.user_id, today, 60)) {
    events.push({
      uid: `comment-deadline-${d.id}@billtracker`,
      title: `Comments close: ${d.title}`,
      allDay: d.closes,
      description: [d.agency, `Matches your topic: ${d.topic}`, d.url].filter(Boolean).join("\n"),
      url: d.url ?? `${appUrl}/regulations`,
    });
  }

  return new NextResponse(buildIcs(events, { name: "Bill Tracker: your week" }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="bill-tracker.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
