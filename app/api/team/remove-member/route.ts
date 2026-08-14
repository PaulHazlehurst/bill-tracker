import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// POST { memberId }
// Removes a member from the caller's team (sets their organization_id to
// null). Uses the admin client because this modifies someone ELSE's
// profile row, which normal RLS never allows (profiles can only update
// their own row) - so the ownership check below has to happen here, in
// code, before we reach for the privileged client.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { memberId } = await req.json();
  if (!memberId) return NextResponse.json({ error: "missing memberId" }, { status: 400 });
  if (memberId === user.id) return NextResponse.json({ error: "use 'Leave team' to remove yourself" }, { status: 400 });

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();

  const orgId = myProfile?.organization_id;
  if (!orgId) return NextResponse.json({ error: "you're not on a team" }, { status: 400 });

  const admin = createAdminClient();

  const { data: org } = await admin.from("organizations").select("created_by").eq("id", orgId).single();
  if (!org || org.created_by !== user.id) {
    return NextResponse.json({ error: "only the team owner can remove members" }, { status: 403 });
  }

  const { data: target } = await admin.from("profiles").select("organization_id").eq("id", memberId).single();
  if (!target || target.organization_id !== orgId) {
    return NextResponse.json({ error: "that person isn't on your team" }, { status: 400 });
  }

  const { error } = await admin.from("profiles").update({ organization_id: null }).eq("id", memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
