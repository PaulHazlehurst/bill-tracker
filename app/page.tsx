"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RouteLine, { StagePill } from "@/components/ui/RouteLine";
import { BrandMark } from "@/components/Sidebar";
import { HelpCircle, Sparkles, Users, BellRing, Check } from "lucide-react";

// Public landing page. A light client-side check swaps the header buttons if
// you're already signed in; the page works fine signed out.

const BOARD = [
  { cite: "H.R. 2407", title: "Rural Hospital Closure Relief Act", stage: "passed_house", type: "hr", note: "Passed the House, 381 to 37", fresh: true },
  { cite: "S. 1260", title: "Critical Access Hospital Relief Act", stage: "reported", type: "s", note: "Placed on the Senate calendar", fresh: true },
  { cite: "H.R. 5110", title: "Rural EMS Funding Extension Act", stage: "to_president", type: "hr", note: "Presented to the President", fresh: true },
  { cite: "H.R. 4206", title: "Telehealth Modernization Act", stage: "committee", type: "hr", note: "Referred to the Subcommittee on Health", fresh: false },
  { cite: "H.R. 1", title: "One Big Beautiful Bill Act", stage: "enacted", type: "hr", note: "Became Public Law 119-21", fresh: false },
];

export default function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setSignedIn(!!data.user)).catch(() => {});
  }, []);

  const primary = signedIn ? { href: "/dashboard", label: "Open my bills" } : { href: "/signup", label: "Start tracking" };

  return (
    <div className="landing">
      <nav className="lnav">
        <Link href="/" className="auth-brand"><BrandMark size={28} /><span>Bill Tracker</span></Link>
        <div className="lnav-right">
          {!signedIn && <Link href="/login" className="lnav-link">Log in</Link>}
          <Link href={primary.href} className="btn btn-primary">{primary.label}</Link>
        </div>
      </nav>

      <header className="lhero">
        <h1 className="lhero-title">Know where every bill stands, and what moved overnight.</h1>
        <p className="lhero-sub">
          Bill Tracker follows the federal legislation your work depends on. Every morning it checks congress.gov,
          draws each bill's path through Congress, and tells you in plain English what changed.
        </p>
        <div className="lhero-cta">
          <Link href={primary.href} className="btn btn-primary btn-lg">{primary.label}</Link>
          {!signedIn && <Link href="/login" className="btn btn-ghost btn-lg">I already have an account</Link>}
        </div>
      </header>

      <section className="board" aria-label="Example: a morning's view of tracked bills">
        <div className="board-head">
          <span className="board-title"><span className="live-dot" /> This morning</span>
          <span className="board-sub">3 of your 5 bills moved</span>
        </div>
        <ul className="board-list">
          {BOARD.map((b) => (
            <li key={b.cite} className="board-row">
              <div className="board-row-main">
                <div className="board-row-meta">
                  <span className="cite">{b.cite}</span>
                  <StagePill stage={b.stage} />
                  {b.fresh && <span className="flag flag-fresh">New</span>}
                </div>
                <p className="board-row-title">{b.title}</p>
                <p className="board-row-note">{b.note}</p>
              </div>
              <div className="board-row-route"><RouteLine stage={b.stage} billType={b.type} size="lg" animate /></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="lfeatures">
        <article className="lfeature">
          <div className="lfeature-art">
            <p className="lfa-action">Placed on the Union Calendar, Calendar No. 412.</p>
            <p className="explain"><HelpCircle size={14} /><span><strong>What this means:</strong> Now eligible for a House floor vote. House leadership decides when, or whether, it comes up.</span></p>
          </div>
          <h2>Every step explained</h2>
          <p>Congressional actions are written for clerks. Each one comes with a plain sentence about what it means and what usually happens next, so anyone on your team can read a bill's status.</p>
        </article>

        <article className="lfeature">
          <div className="lfeature-art">
            <div className="lfa-sugg">
              <div className="board-row-meta"><span className="cite">H.R. 6120</span><span className="lfa-topic"><Sparkles size={12} /> telehealth</span></div>
              <p className="lfa-sugg-title">Permanent Telehealth Flexibility for Seniors Act</p>
              <p className="lfa-why">Title mentions “telehealth”. Introduced this month.</p>
            </div>
          </div>
          <h2>New bills find you</h2>
          <p>Name the issues you care about. Each morning we search the full text of every bill in Congress and suggest the ones you aren't following yet, with the reason each one matched.</p>
        </article>

        <article className="lfeature">
          <div className="lfeature-art">
            <div className="lfa-team">
              <span className="pos-tag pos-support">Support</span>
              <span className="pos-tag pos-watching">Watching</span>
              <span className="pos-tag pos-oppose">Oppose</span>
            </div>
            <p className="lfa-team-note"><Users size={14} /> Your team is split on 1 bill</p>
          </div>
          <h2>Built for a team</h2>
          <p>Share one list of topics, take positions, track your contacts' stances, assign follow-ups, and print a client-ready briefing in one click.</p>
        </article>

        <article className="lfeature">
          <div className="lfeature-art">
            <div className="lfa-email">
              <p className="lfa-email-subject"><BellRing size={14} /> 4 updates on 3 bills you follow</p>
              <p><Check size={13} /> H.R. 2407 passed the House</p>
              <p><Check size={13} /> CBO published an estimate for S. 1260</p>
            </div>
          </div>
          <h2>One alert, not twenty</h2>
          <p>When something changes, you get a single email (or text) summarizing every update across every bill you follow. Nothing on days when nothing moved.</p>
        </article>
      </section>

      <section className="lclose">
        <h2>Every fact traces back to an official source.</h2>
        <p>Data comes from congress.gov, GovInfo, the Congressional Budget Office, the Federal Register and Senate lobbying disclosures. No AI writes your summaries.</p>
        <Link href={primary.href} className="btn btn-primary btn-lg">{primary.label}</Link>
      </section>

      <footer className="lfoot">
        <span>Bill Tracker</span>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}
