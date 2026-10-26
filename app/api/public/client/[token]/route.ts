import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildReportFor, CLIENT_COLUMNS, type ClientRow } from "@/lib/clientReportData";
import { reportSummary } from "@/lib/clientReport";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET - the read-only client view behind a share link. No login: the
// unguessable token is the key, and the team can switch it off at any time.
//
// BOUNDARY: returns only the report (public congressional data, the
// positions and notes your team chose to put in front of this client, and
// the "what we need from you" line). Never the team's internal notes on the
// client, recipients, or anything about other clients.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.token)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select(CLIENT_COLUMNS).eq("share_token", params.token).maybeSingle();
  if (!client) return NextResponse.json({ error: "This link has been turned off." }, { status: 404 });
  const report = await buildReportFor(admin, client as ClientRow);
  return NextResponse.json({ report, summary: reportSummary(report) }, { headers: { "Cache-Control": "private, max-age=300" } });
}
