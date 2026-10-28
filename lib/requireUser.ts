import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The signed-in person and a database client that acts as them (row-level
// security applies), or a ready-made 401 response.
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) } as const;
  return { supabase, user } as const;
}
