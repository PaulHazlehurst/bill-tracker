import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { createAdminClient } from "@/lib/supabase/server";
import { leaveTeam } from "@/lib/team";

// POST { name, leaveCurrent? } - start a new team; the creator is its owner and admin.
export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Give the team a name." }, { status: 400 });
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("organization_id").eq("id", auth.user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "Finish creating your account first." }, { status: 400 });
  if (me.organization_id && body.leaveCurrent !== true) return NextResponse.json({ error: "You're already on a team. Starting a new one means leaving it.", needsLeave: true }, { status: 409 });
  const { data: org, error } = await admin.from("organizations").insert({ name, created_by: auth.user.id }).select("id").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "A team with that name already exists." : error.message }, { status: 400 });
  if (me.organization_id) await leaveTeam(admin, auth.user.id);
  await admin.from("profiles").update({ organization_id: org.id, team_role: "admin" }).eq("id", auth.user.id);
  return NextResponse.json({ ok: true, id: org.id });
}
