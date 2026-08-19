"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import Reveal from "@/components/Reveal";
import VersionBadge from "@/components/VersionBadge";
import {
  ThumbsUp, Vote, GitBranch, Users2, BellRing, Download,
  Search, MousePointerClick, Mail, Landmark, Sparkles,
} from "lucide-react";

// A plain public landing page - no session check required to view it, so
// unlike the old version of this file, it doesn't need force-dynamic or a
// server-side Supabase call at all.
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

const PREVIEW_ROWS = [
  { title: "Bipartisan Background Checks Act", position: "support", progress: 30 },
  { title: "One Big Beautiful Bill Act", position: "watching", progress: 100 },
  { title: "Healthcare Cybersecurity Act", position: "none", progress: 15 },
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
    <div>
      <div className="top-accent-bar" />
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

      <div className="hero-section">
        <div className="container" style={{ maxWidth: 1040, paddingTop: 64, paddingBottom: 56 }}>
          <div className="hero-grid">
            <div>
              {totalBills && (
                <div className="hero-stat-pill">
                  <span className="live-dot" />
                  <span><strong>{totalBills.toLocaleString()}</strong> bills introduced so far in the 119th Congress</span>
                </div>
              )}
              <h1 style={{ fontFamily: 'var(--font-display), Georgia, serif', fontSize: '3.5rem', fontWeight: 500, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
                Track federal bills without refreshing congress.gov all day.
              </h1>
              <p className="muted" style={{ fontSize: '1.0625rem', maxWidth: 500, marginTop: 16 }}>
                Search for a bill, take a position on it, and get an email or
                text the moment its status changes. Vote records, hearing
                history, lobbying activity, and official summaries - all in
                one place, for you and your whole team.
              </p>
              <div style={{ marginTop: 28, display: "flex", gap: 12 }}>
                <a href="/signup"><button className="primary">Get started</button></a>
                <a href="/login"><button className="ghost">Log in</button></a>
              </div>
            </div>

            <div className="hero-preview" aria-hidden="true">
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, fontSize: '0.75rem' }} className="muted">
                <Sparkles size={13} /> Your tracked bills
              </div>
              {PREVIEW_ROWS.map((r) => (
                <div key={r.title} className="hero-preview-row">
                  <span className={`hero-preview-badge hero-preview-badge-${r.position}`} style={{ flexShrink: 0 }}>
                    {r.position === "support" ? "Support" : r.position === "watching" ? "Watching" : "—"}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                    <div className="hero-preview-bar" style={{ marginTop: 5 }}>
                      <div className="hero-preview-bar-fill" style={{ width: `${r.progress}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 56, paddingTop: 8 }}>
        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 60}>
              <div className="card feature-card">
                <f.icon size={20} className="feature-icon" style={{ color: "var(--text-soft)", marginBottom: 10 }} />
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 500, margin: "0 0 6px" }}>{f.title}</h3>
                <p className="muted" style={{ margin: 0 }}>{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 64 }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 500, marginBottom: 24, textAlign: "center" }}>How it works</h2>
        <div style={{ display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", maxWidth: 760, margin: "0 auto" }}>
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 80}>
              <div className="step" style={{ textAlign: "center" }}>
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
            </Reveal>
          ))}
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 64, textAlign: "center" }}>
        <Reveal>
          <div className="card feature-card" style={{ maxWidth: 560, margin: "0 auto", padding: 32 }}>
            <Landmark size={24} style={{ color: "var(--accent)", marginBottom: 10 }} />
            <h3 style={{ fontSize: '1.125rem', fontWeight: 500, margin: "0 0 8px" }}>Built on official sources</h3>
            <p className="muted" style={{ margin: 0 }}>
              Every fact in this app traces back to congress.gov, the House
              and Senate's official lobbying disclosure database, or a
              government record - never a guess, never an AI-generated summary
              presented as fact.
            </p>
          </div>
        </Reveal>
      </div>

      <footer style={{ borderTop: "1px solid var(--border)", padding: "20px", textAlign: "center" }}>
        <a href="/terms" className="muted landing-nav-link" style={{ marginRight: 16 }}>Terms</a>
        <a href="/privacy" className="muted landing-nav-link">Privacy</a>
      </footer>
      <VersionBadge />
    </div>
  );
}
