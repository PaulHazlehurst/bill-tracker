import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { citationFor, publicBillUrl } from "@/lib/billMeta";
import { STAGE_LABELS } from "@/lib/billStage";

// GET ?scope=personal|team - CSV of tracked bills. RLS decides what "team"
// can include (your bills plus your current teammates').
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") === "team" ? "team" : "personal";

  let query = supabase
    .from("tracked_bills")
    .select("bill_id, user_id, position, notify_email, notify_sms, bills(title, status_stage, latest_action, latest_action_date)")
    .order("created_at", { ascending: false });
  if (scope === "personal") query = query.eq("user_id", user.id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "export failed" }, { status: 500 });

  const emails = new Map<string, string>();
  if (scope === "team") {
    const ids = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    if (ids.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", ids);
      for (const p of profiles ?? []) emails.set(p.id, p.email);
    }
  }

  const header = ["Citation", "Title", "Stage", "Position", "Latest action", "Latest action date", ...(scope === "team" ? ["Tracked by"] : []), "Link"];
  const rows = (data ?? []).map((row: any) => {
    const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
    return [
      citationFor(row.bill_id),
      bill?.title ?? "",
      STAGE_LABELS[bill?.status_stage] ?? bill?.status_stage ?? "",
      row.position ?? "none",
      bill?.latest_action ?? "",
      bill?.latest_action_date ?? "",
      ...(scope === "team" ? [emails.get(row.user_id) ?? ""] : []),
      publicBillUrl(row.bill_id),
    ];
  });

  const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(",")).join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bills-${scope}-${date}.csv"`,
    },
  });
}

function escapeCsv(raw: string) {
  // A cell starting with = + - or @ is treated as a formula by Excel and
  // Sheets; prefix it so text from congress.gov can never execute.
  const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
