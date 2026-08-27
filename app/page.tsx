"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import Reveal from "@/components/Reveal";
import VersionBadge from "@/components/VersionBadge";
import {
  ThumbsUp, Vote, GitBranch, Users2, BellRing, Download,
  Search, MousePointerClick, Mail,
} from "lucide-react";

// Public landing page — no session check required to view it. A light
// client-side check (after render) swaps the header buttons if you're
// already signed in; if it fails, the page still works logged-out.

const FEATURES = [
  { icon: ThumbsUp, title: "Take a real position", body: "Mark any bill Support, Oppose, or Watching. See your own stance at a glance, or how your whole team lines up on it." },
  { icon: Vote, title: "Real vote results", body: "When a bill gets a floor vote, the yea/nay count and roll-call number show up automatically — not just a status label." },
  { icon: GitBranch, title: "Related bills", body: "See the House and Senate companion versions of a bill without hunting for them yourself." },
  { icon: Users2, title: "Team consensus, visible", body: "Instantly see which tracked bills your team agrees on, and which ones are actually contested." },
  { icon: BellRing, title: "Email and text alerts", body: "Get notified only for the bills you chose to follow, the moment their status changes." },
  { icon: Download, title: "Export anytime", body: "Download your tracked bills, or your whole team's, as a CSV or a client-ready briefing whenever you need it." },
];

const STEPS = [
  { icon: Search, title: "Search a bill", body: "Look it up by keyword, or jump straight to it with a citation like \"HR 1234\"." },
  { icon: MousePointerClick, title: "Track it", body: "One click adds it to your dashboard — and your team's, if you're on one." },
  { icon: Mail, title: "Get notified", body: "We check daily and email or text you the moment something actually changes." },
];

export default function LandingPage() {
  const supabase = createClient();
  const [signedIn, setSignedIn] = useState(false);
  const [totalBills, setTotalBills] = useState<number | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    fetch("/api/public/stats")
      .then((r) => r.json())
      .then((body) => setTotalBills(body.totalBills))
      .catch(() => setTotalBills(null));
  }, []);

  return (
    <div className="landing">
      <nav className="lnav">
        <span className="brand">Bill Tracker</span>
        <div className="lnav-right">
          <ThemeSwitcher />
          {signedIn ? (
            <a href="/dashboard"><button className="primary">Go to dashboard <span className="btn-arw">→</span></button></a>
          ) : (
            <>
              <a href="/login" className="landing-nav-link">Log in</a>
              <a href="/signup"><button className="primary">Get started <span className="btn-arw">→</span></button></a>
            </>
          )}
        </div>
      </nav>

      <header className="lhero">
        <span className="lkicker"><span className="lpip" /> Legislative intelligence · 119th Congress</span>
        <h1 className="lhero-title">Know where every bill stands. <em>Before it moves.</em></h1>
        <div className="lhero-lower">
          <p className="lhero-sub">
            Search for a bill, take a position, and get an email or text the
            moment its status changes — vote records, sponsors, and official
            summaries, for you and your whole team.
          </p>
          <div className="lhero-cta">
            <a href="/signup"><button className="primary">Start tracking <span className="btn-arw">→</span></button></a>
            <a href="/login" className="lhero-link">Log in →</a>
          </div>
        </div>
      </header>

      <section className="lstatband">
        <Reveal><div><div className="lsb-n">{totalBills ? totalBills.toLocaleString() : "5,000+"}</div><div className="lsb-l">Bills introduced in the 119th Congress</div></div></Reveal>
        <Reveal delay={60}><div><div className="lsb-n">1 click</div><div className="lsb-l">From a bill to your dashboard</div></div></Reveal>
        <Reveal delay={120}><div><div className="lsb-n">Daily</div><div className="lsb-l">Automatic checks for changes</div></div></Reveal>
        <Reveal delay={180}><div><div className="lsb-n">0</div><div className="lsb-l">Refreshing Congress.gov yourself</div></div></Reveal>
      </section>

      <section className="lsec">
        <div className="lsec-lead">
          <div>
            <span className="ltag">What it does</span>
            <h2>Everything your team needs to stay ahead.</h2>
          </div>
          <p>Watch legislation, take positions, brief a client, and know who's moving a bill — without living inside Congress.gov.</p>
        </div>
        <div className="lrows">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 40}>
              <div className="lrow">
                <div className="lrow-idx">{String(i + 1).padStart(2, "0")}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="lsec" style={{ paddingTop: 0 }}>
        <div className="lsec-lead">
          <div>
            <span className="ltag">How it works</span>
            <h2>Set it once. Get briefed when it matters.</h2>
          </div>
        </div>
        <div className="lrows">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 60}>
              <div className="lrow">
                <div className="lrow-idx">Step {i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <div className="lcta-wrap">
        <Reveal>
          <section className="lcta">
            <h2>Stop refreshing Congress.gov.</h2>
            <p>Start every week knowing exactly where your portfolio stands — and what changed while you slept. Every fact traces back to an official government source.</p>
            <a href="/signup"><button className="primary">Start tracking free <span className="btn-arw">→</span></button></a>
          </section>
        </Reveal>
      </div>

      <footer className="lfoot">
        <a href="/terms" className="landing-nav-link">Terms</a>
        <a href="/privacy" className="landing-nav-link">Privacy</a>
      </footer>
      <VersionBadge />
    </div>
  );
}
