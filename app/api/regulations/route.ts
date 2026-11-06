import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { REG_STATUSES } from "@/lib/regulations";

export const maxDuration = 30;

const BASE = "id, regulation_id, matched_topic, discovered_at, dismissed, regulations(id, title, abstract, doc_type, docket_id, agencies, publication_date, comment_close_date, effective_date, html_url)";
const WITH_STATUS = `${BASE}, status, status_at, status_by_profile:profiles!prospective_regulations_status_by_fkey(full_name, email)`;

// GET /api/regulations
// The regulations the daily discovery run has matched to this account's
// topics. Row-level security keeps it to the caller's team (or own account).
// statusReady is false until database update 0008 has been run.
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const read = (cols: string) =>
    supabase.from("prospective_regulations").select(cols).eq("dismissed", false).order("discovered_at", { ascending: false }).limit(300);

  let statusReady = true;
  let { data, error } = await read(WITH_STATUS);
  if (error) {
    statusReady = false;
    ({ data, error } = await read(BASE));
  }
  if (error) {
    console.error("regulations fetch failed", error);
    return NextResponse.json({ error: "Couldn't read regulations.", regulations: [] }, { status: 500 });
  }
  return NextResponse.json({ regulations: data ?? [], statusReady });
}

// PATCH /api/regulations
// Body: { id, dismissed?: boolean, status?: "new" | "following" | "commenting" | "commented" }.
// Dismiss or bring back a match, or set the team's status on it. Who set the
// status, and when, is stamped by the database.
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (!body?.id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.dismissed === "boolean") patch.dismissed = body.dismissed;
  if (body.status !== undefined) {
    if (!REG_STATUSES.includes(body.status)) return NextResponse.json({ error: "unknown status" }, { status: 400 });
    patch.status = body.status;
  }
  if (!Object.keys(patch).length) patch.dismissed = true; // older clients sent just { id }

  const { data, error } = await supabase.from("prospective_regulations").update(patch).eq("id", body.id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
