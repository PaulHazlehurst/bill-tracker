import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildReportFor, CLIENT_COLUMNS, type ClientRow } from "@/lib/clientReportData";
import { sendClientReport } from "@/lib/clientReportSend";
import { reportSummary } from "@/lib/clientReport";

export const maxDuration = 30;

// GET - this week's report, built from live data (the preview and PDF page).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: client } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("id", params.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });
  const report = await buildReportFor(supabase, client as ClientRow);
  return NextResponse.json({ report, summary: reportSummary(report) });
}

// POST { test?: boolean } - sends it now. A test goes only to you.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: client } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("id", params.id).maybeSingle();
  if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const isTest = body.test === true;
  if (isTest && !user.email) return NextResponse.json({ error: "Your account has no email address." }, { status: 400 });

  try {
    // Recording the sent report needs the admin key (clients can't write
    // that table directly); access was checked above with the person's own session.
    const { sentTo } = await sendClientReport(createAdminClient(), client as ClientRow, {
      to: isTest ? [user.email!] : undefined,
      sentBy: user.id,
      isTest,
      replyTo: user.email,
    });
    return NextResponse.json({ sentTo });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err) }, { status: 400 });
  }
}
