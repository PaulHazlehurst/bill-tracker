"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

const DISMISS_KEY = "billtracker-onboarding-dismissed";

// Built from real account data, so each step ticks itself off once it's
// actually done and the whole card disappears when setup is complete.
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
  const [dismissed, setDismissed] = useState(true); // avoids a flash before localStorage is read

  useEffect(() => {
    try { setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1"); } catch { setDismissed(false); }
  }, []);

  const steps = [
    { done: hasTrackedBill, label: "Track a bill" },
    { done: hasEmailEnabled, label: "Turn on email alerts" },
    { done: hasTeam, label: "Join or create a team" },
    { done: hasPhone, label: "Add a phone for text alerts" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length || dismissed) return null;

  return (
    <div className="setup">
      <div className="setup-progress" aria-hidden="true"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
      <p className="setup-title">Finish setting up <span>{doneCount} of {steps.length}</span></p>
      <ul className="setup-steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? "is-done" : ""}>
            <span className="setup-check">{s.done && <Check size={12} strokeWidth={3} />}</span>
            {s.done ? s.label : <Link href="/settings">{s.label}</Link>}
          </li>
        ))}
      </ul>
      <button
        className="icon-btn setup-x"
        onClick={() => {
          try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch {}
          setDismissed(true);
        }}
        aria-label="Hide setup checklist"
      >
        <X size={15} />
      </button>
    </div>
  );
}
