"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, X } from "lucide-react";

const DISMISS_KEY = "billtracker-onboarding-dismissed";

type Step = { done: boolean; label: string; href: string; cta: string };

// Every step here is computed from REAL account data the parent page already
// has (tracked bill count, profile fields) - not a static "did you click
// through this" tutorial. That's what lets it disappear on its own once
// someone's actually set up, rather than needing to be manually dismissed.
export default function OnboardingChecklist({
  hasTrackedBill,
  hasEmailEnabled,
  hasTeam,
  hasPhone,
}: {
  hasTrackedBill: boolean;
  hasEmailEnabled: boolean;
  hasTeam: boolean;
  hasPhone: boolean;
}) {
  const [dismissed, setDismissed] = useState(true); // default true avoids a flash before we check localStorage

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const steps: Step[] = [
    { done: hasTrackedBill, label: "Track your first bill", href: "#track", cta: "Search above ↑" },
    { done: hasEmailEnabled, label: "Turn on email notifications", href: "/settings", cta: "Go to Settings" },
    { done: hasTeam, label: "Join or create a team", href: "/settings", cta: "Go to Settings" },
    { done: hasPhone, label: "Add a phone number for text alerts", href: "/settings", cta: "Go to Settings" },
  ];

  const allDone = steps.every((s) => s.done);
  if (allDone || dismissed) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div className="card onboarding-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h2 style={{ fontSize: '0.9375rem', fontWeight: 500, margin: 0 }}>Get set up</h2>
        <button onClick={dismiss} aria-label="Dismiss" className="onboarding-dismiss">
          <X size={14} />
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        {steps.map((s) => (
          <div key={s.label} className="onboarding-step">
            {s.done ? <CheckCircle2 size={16} className="onboarding-check-done" /> : <Circle size={16} className="onboarding-check-todo" />}
            <span className={s.done ? "onboarding-step-done" : ""}>{s.label}</span>
            {!s.done && (
              <a href={s.href} className="onboarding-cta">{s.cta}</a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
