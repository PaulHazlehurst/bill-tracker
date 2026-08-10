"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import {
  ThumbsUp, Vote, GitBranch, Users2, BellRing, Download,
  Search, MousePointerClick, Mail,
} from "lucide-react";

// A plain public landing page - no session check required to view it, so
// unlike the old version of this file, it doesn't need force-dynamic or a
// server-side Supabase call at all. That sidesteps the whole class of
// build/runtime errors we were chasing with the old redirect-based version.
//
// It does a light client-side check (after the page has already rendered)
// just to swap the header buttons if you're already signed in - if that
// check fails for any reason, the page still works fine, it just shows the
// logged-out buttons.

const FEATURES = [
  {
    icon: ThumbsUp,
    title: "Take a real position",
    body: "Mark any bill Support, Oppose, or Watching. See your own stance at a glance, or how your whole team lines up on it.",
  },
  {
    icon: Vote,
    title: "Real vote results",
    body: "When a bill actually gets a floor vote, the yea/nay count and roll call number show up automatically - not just a status label.",
  },
  {
    icon: GitBranch,
    title: "Related bills",
    body: "See the House and Senate companion versions of a bill without hunting for them yourself.",
  },
  {
    icon: Users2,
    title: "Team consensus, visible",
    body: "Instantly see which tracked bills your team agrees on, and which ones are actually contested.",
  },
  {
    icon: BellRing,
    title: "Email and text alerts",
    body: "Get notified only for the bills you chose to follow, the moment their status changes.",
  },
  {
    icon: Download,
    title: "Export anytime",
    body: "Download your tracked bills, or your whole team's, as a CSV whenever you need it.",
  },
];

const STEPS = [
  { icon: Search, title: "Search a bill", body: "Look it up by keyword, or jump straight to it with a citation like \"HR 1234\"." },
  { icon: MousePointerClick, title: "Track it", body: "One click adds it to your dashboard - and your team's, if you're on one." },
  { icon: Mail, title: "Get notified", body: "We check daily and email or text you the moment something actually changes." },
];

export default function LandingPage() {
  const supabase = createClient();
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, []);

  return (
    <div>
      <nav className="nav">
        <span className="brand">Bill Tracker</span>
        <div className="nav-right">
          <ThemeSwitcher />
          {signedIn ? (
            <a href="/dashboard"><button className="primary">Go to dashboard</button></a>
          ) : (
            <>
              <a href="/login" className="landing-nav-link">Log in</a>
              <a href="/signup"><button className="primary">Sign up</button></a>
            </>
          )}
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 72, paddingBottom: 40 }}>
        <h1 style={{ fontSize: '2.125rem', fontWeight: 500, maxWidth: 620, lineHeight: 1.2 }}>
          Track federal bills without refreshing congress.gov all day.
        </h1>
        <p className="muted" style={{ fontSize: '1.0625rem', maxWidth: 540, marginTop: 14 }}>
          Search for a bill, take a position on it, and get an email or text
          the moment its status changes. See exactly what your whole team is
          tracking - and where you agree or disagree - in one place.
        </p>

        <div style={{ marginTop: 28, display: "flex", gap: 12 }}>
          <a href="/signup"><button className="primary">Get started</button></a>
          <a href="/login"><button className="ghost">Log in</button></a>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 56 }}>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card feature-card">
              <f.icon size={20} className="feature-icon" style={{ color: "var(--text-soft)", marginBottom: 10 }} />
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 500, margin: "0 0 6px" }}>{f.title}</h3>
              <p className="muted" style={{ margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 64 }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 500, marginBottom: 24, textAlign: "center" }}>How it works</h2>
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", maxWidth: 760, margin: "0 auto" }}>
          {STEPS.map((s, i) => (
            <div key={s.title} className="step" style={{ textAlign: "center" }}>
              <div
                className="step-number"
                style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: "var(--accent-soft)", color: "var(--accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 12px", fontWeight: 600,
                }}
              >
                {i + 1}
              </div>
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 500, margin: "0 0 6px" }}>{s.title}</h3>
              <p className="muted" style={{ margin: 0 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      <footer style={{ borderTop: "1px solid var(--border)", padding: "20px", textAlign: "center" }}>
        <a href="/terms" className="muted landing-nav-link" style={{ marginRight: 16 }}>Terms</a>
        <a href="/privacy" className="muted landing-nav-link">Privacy</a>
      </footer>
    </div>
  );
}
