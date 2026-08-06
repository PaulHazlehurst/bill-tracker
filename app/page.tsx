"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ThemeSwitcher from "@/components/ThemeSwitcher";

// A plain public landing page - no session check required to view it, so
// unlike the old version of this file, it doesn't need force-dynamic or a
// server-side Supabase call at all. That sidesteps the whole class of
// build/runtime errors we were chasing with the old redirect-based version.
//
// It does a light client-side check (after the page has already rendered)
// just to swap the header buttons if you're already signed in - if that
// check fails for any reason, the page still works fine, it just shows the
// logged-out buttons.
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
              <a href="/login">Log in</a>
              <a href="/signup"><button className="primary">Sign up</button></a>
            </>
          )}
        </div>
      </nav>

      <div className="container" style={{ paddingTop: 64, paddingBottom: 64 }}>
        <h1 style={{ fontSize: 32, fontWeight: 500, maxWidth: 600 }}>
          Track federal bills without refreshing congress.gov all day.
        </h1>
        <p className="muted" style={{ fontSize: 16, maxWidth: 520, marginTop: 12 }}>
          Search for a bill, track it, and get an email or text the moment
          its status changes. Share a team view so everyone in your
          organization sees the same list.
        </p>

        <div style={{ marginTop: 28, display: "flex", gap: 12 }}>
          <a href="/signup"><button className="primary">Get started</button></a>
          <a href="/login"><button className="ghost">Log in</button></a>
        </div>

        <div style={{ marginTop: 56, display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", maxWidth: 720 }}>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 6px" }}>Progress at a glance</h3>
            <p className="muted">Every tracked bill shows a visual progress bar from introduced through enacted.</p>
          </div>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 6px" }}>Email and text alerts</h3>
            <p className="muted">Get notified only for the bills you actually chose to follow.</p>
          </div>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 6px" }}>Shared team view</h3>
            <p className="muted">Join an organization at signup and see everything your team is tracking in one place.</p>
          </div>
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 6px" }}>Export anytime</h3>
            <p className="muted">Download your tracked bills, or your team's, as a CSV whenever you need it.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
