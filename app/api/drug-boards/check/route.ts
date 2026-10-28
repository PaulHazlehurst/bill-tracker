import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/requireUser";
import { syncDrugBoards } from "@/lib/drugBoardsSync";

export const maxDuration = 60;

// POST - checks every watched board page, reads new documents, checks court
// cases and searches state bills now, instead of waiting for tomorrow morning.
export async function POST() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "The database admin key isn't set." }, { status: 500 });
  try {
    return NextResponse.json(await syncDrugBoards(createAdminClient(), 50_000, { read: true }));
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 502 });
  }
}
