// SERVER-ONLY. Morning reminders for comment periods on regulations a team
// is following or writing a comment on (see deadlineNotifications). Runs from
// the notify cron. Does nothing until database update 0008 has been run.

import { addDays } from "@/lib/houseFloor";
import { deadlineNotifications, localToday } from "@/lib/regulations";
import { notify } from "@/lib/notifications";

type Admin = any;

export async function sendRegulationReminders(admin: Admin, now = new Date()): Promise<{ created: number; pushed: number }> {
  const today = localToday(now);
  const { data, error } = await admin
    .from("prospective_regulations")
    .select("regulation_id, organization_id, user_id, status, regulations!inner(title, comment_close_date)")
    .in("status", ["following", "commenting"])
    .eq("dismissed", false)
    .gte("regulations.comment_close_date", today)
    .lte("regulations.comment_close_date", addDays(today, 7));
  if (error || !data?.length) return { created: 0, pushed: 0 };

  const rows = (data as any[]).map((r) => {
    const reg = Array.isArray(r.regulations) ? r.regulations[0] : r.regulations;
    return { regulation_id: r.regulation_id, organization_id: r.organization_id, user_id: r.user_id, status: r.status, title: reg.title, comment_close_date: reg.comment_close_date };
  });
  const orgIds = Array.from(new Set(rows.map((r) => r.organization_id).filter(Boolean)));
  const members = new Map<string, string[]>();
  if (orgIds.length) {
    const { data: people } = await admin.from("profiles").select("id, organization_id").in("organization_id", orgIds);
    for (const p of (people as any[]) ?? []) {
      if (!members.has(p.organization_id)) members.set(p.organization_id, []);
      members.get(p.organization_id)!.push(p.id);
    }
  }
  return notify(admin, deadlineNotifications(rows, (org) => members.get(org) ?? [], today));
}
