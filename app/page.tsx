import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// This checks the signed-in user's session, which only exists at request
// time - there's no static version of "redirect based on who's logged in."
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/dashboard" : "/login");
}
