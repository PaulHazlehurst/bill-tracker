import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";

const STATUSES = new Set(["active", "limited", "dissolved", "proposed"]);

// PATCH { state, summary?, authority?, status?, website?, email_signup?, summary_source? } - correct a board's details.
export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  const b = await req.json().catch(() => ({}));
  if (typeof b.state !== "string") return NextResponse.json({ error: "missing state" }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: auth.user.id };
  for (const f of ["summary", "authority", "website", "email_signup", "summary_source", "name", "agency"]) {
    if (typeof b[f] === "string") patch[f] = b[f].trim().slice(0, f === "summary" ? 1200 : 300) || null;
  }
  if (typeof b.status === "string" && STATUSES.has(b.status)) patch.status = b.status;
  for (const f of ["website", "email_signup", "summary_source"]) {
    if (patch[f] && !/^https?:\/\//i.test(String(patch[f]))) return NextResponse.json({ error: "Web addresses should start with https://" }, { status: 400 });
  }
  const { error } = await auth.supabase.from("drug_boards").update(patch).eq("state", b.state);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
