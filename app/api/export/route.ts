import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/export?scope=personal|team
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const scope = req.nextUrl.searchParams.get("scope") ?? "personal";

  let query = supabase
    .from("tracked_bills")
    .select("bill_id, notify_email, notify_sms, position, bills(title, status_stage, progress_pct, latest_action, latest_action_date, congress_url)");

  if (scope === "team") {
    // No explicit filter needed - Row Level Security already restricts this
    // to "my own rows, plus anyone whose CURRENT organization matches mine"
    // (see schema.sql), which is exactly what a team export should include.
  } else {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }

  const rows = [
    ["Bill ID", "Title", "Position", "Stage", "Progress %", "Latest Action", "Date", "Link"],
    ...(data ?? []).map((row) => {
      const bill = Array.isArray(row.bills) ? row.bills[0] : row.bills;
      return [
        row.bill_id,
        bill?.title ?? "",
        (row as any).position ?? "none",
        bill?.status_stage ?? "",
        String(bill?.progress_pct ?? ""),
        bill?.latest_action ?? "",
        bill?.latest_action_date ?? "",
        bill?.congress_url ?? "",
      ];
    }),
  ];

  const csv = rows.map((r) => r.map(escapeCsv).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="tracked-bills-${scope}.csv"`,
    },
  });
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
