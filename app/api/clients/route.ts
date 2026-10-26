import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const NOT_READY = "Clients need a one-time database update. Run supabase/migrations/0004_clients.sql in Supabase, SQL Editor.";

// GET - your team's clients, with how many bills each follows and how many
// of those moved in the last seven days.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("clients")
    .select("id, name, report_enabled, share_token, updated_at, client_bills(bill_id), client_recipients(id)")
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: NOT_READY, ready: false, clients: [] }, { status: 200 });

  const rows = (data as any[]) ?? [];
  const allIds = Array.from(new Set(rows.flatMap((c) => (c.client_bills ?? []).map((b: any) => b.bill_id))));
  const moved = new Set<string>();
  if (allIds.length) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: ev } = await supabase
      .from("bill_events")
      .select("bill_id")
      .in("bill_id", allIds.slice(0, 500))
      .in("event_type", ["status_change", "new_action", "text_published", "cbo_published"])
      .gte("occurred_at", since);
    for (const e of (ev as any[]) ?? []) moved.add(e.bill_id);
  }

  return NextResponse.json({
    ready: true,
    clients: rows.map((c) => {
      const ids: string[] = (c.client_bills ?? []).map((b: any) => b.bill_id);
      return {
        id: c.id,
        name: c.name,
        reportEnabled: c.report_enabled,
        shared: !!c.share_token,
        billCount: ids.length,
        movedCount: ids.filter((id) => moved.has(id)).length,
        recipientCount: (c.client_recipients ?? []).length,
        updatedAt: c.updated_at,
      };
    }),
  });
}

// POST { name } - adds a client to your team (or to you, if you're not on one).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "Give the client a name." }, { status: 400 });

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  const owner = profile?.organization_id ? { organization_id: profile.organization_id, user_id: null } : { organization_id: null, user_id: user.id };

  const { data, error } = await supabase
    .from("clients")
    .insert({ ...owner, name, created_by: user.id, lead_user_id: user.id })
    .select("id")
    .single();
  if (error) {
    if (/relation .*clients|does not exist|schema cache/i.test(error.message)) return NextResponse.json({ error: NOT_READY }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
