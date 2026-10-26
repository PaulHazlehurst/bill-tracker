import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";

// POST { enabled: boolean } - turns the client's read-only link on (with a
// fresh, unguessable address) or off. Turning it off and on again makes a
// new address, so an old forwarded link stops working.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token = body.enabled ? randomUUID() : null;
  const { data, error } = await supabase.from("clients").update({ share_token: token, updated_at: new Date().toISOString() }).eq("id", params.id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
  return NextResponse.json({ url: token ? `${base}/share/client/${token}` : null });
}
