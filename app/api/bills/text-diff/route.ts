import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getBillTextVersions } from "@/lib/congress-api";
import { comparableVersions, fetchVersionSections, TextTooLargeError, type ComparableVersion } from "@/lib/billText";
import { diffVersions, diffHeadline, type DiffResult } from "@/lib/textDiff";

// Two downloads plus the comparison; long bills take a few seconds.
export const maxDuration = 60;

// GET ?billId=hr-4120-119[&from=BILLS-...&to=BILLS-...]
// Compares two published versions of a bill (by default the latest two).
// Each comparison is saved, so it's instant the next time anyone opens it.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const billId = req.nextUrl.searchParams.get("billId") ?? "";
  const m = billId.match(/^(hr|s|hjres|sjres|hconres|sconres|hres|sres)-(\d{1,5})-(\d{2,3})$/);
  if (!m) return NextResponse.json({ error: "That isn't a valid bill id." }, { status: 400 });

  // Version list: the cached copy from the Text tab, or fresh from congress.gov.
  const { data: bill } = await supabase.from("bills").select("text_versions").eq("id", billId).maybeSingle();
  let raw = (bill?.text_versions as any[]) ?? null;
  if (!raw || raw.length < 2) {
    try {
      raw = await getBillTextVersions(Number(m[3]), m[1], m[2]);
    } catch {
      raw = raw ?? [];
    }
  }
  const versions = comparableVersions(raw ?? []);
  const summary = versions.map((v) => ({ packageId: v.packageId, label: v.label, date: v.date }));
  if (versions.length < 2) return NextResponse.json({ versions: summary, result: null, reason: "only-one-version" });

  const pick = (id: string | null, fallback: ComparableVersion) => versions.find((v) => v.packageId === id) ?? fallback;
  const to = pick(req.nextUrl.searchParams.get("to"), versions[versions.length - 1]);
  const from = pick(req.nextUrl.searchParams.get("from"), versions[versions.indexOf(to) - 1] ?? versions[0]);
  if (from.packageId === to.packageId) return NextResponse.json({ error: "Pick two different versions." }, { status: 400 });

  const { data: cached, error: cacheError } = await supabase
    .from("bill_text_diffs")
    .select("result")
    .eq("bill_id", billId)
    .eq("from_package", from.packageId)
    .eq("to_package", to.packageId)
    .maybeSingle();
  if (cached?.result) {
    return NextResponse.json({ versions: summary, from: from.packageId, to: to.packageId, result: cached.result, headline: diffHeadline(cached.result as DiffResult), cached: true });
  }

  let result: DiffResult;
  try {
    const [oldS, newS] = await Promise.all([fetchVersionSections(from), fetchVersionSections(to)]);
    result = diffVersions(oldS, newS);
  } catch (err) {
    if (err instanceof TextTooLargeError) {
      return NextResponse.json({ versions: summary, from: from.packageId, to: to.packageId, result: null, reason: "too-large" });
    }
    console.error("text diff failed", err);
    return NextResponse.json({ error: "Couldn't download the bill text from GovInfo just now. Try again in a minute." }, { status: 502 });
  }

  // Save it for next time (skipped quietly until migration 0003 is run).
  if (!cacheError && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await createAdminClient()
      .from("bill_text_diffs")
      .upsert({ bill_id: billId, from_package: from.packageId, to_package: to.packageId, result, computed_at: new Date().toISOString() })
      .then(({ error }) => error && console.error("text diff cache write failed", error.message));
  }

  return NextResponse.json({ versions: summary, from: from.packageId, to: to.packageId, result, headline: diffHeadline(result), cached: false });
}
