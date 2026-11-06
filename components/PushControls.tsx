"use client";

import { useEffect, useState } from "react";
import { BellRing, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useUI } from "@/components/UIProvider";
import { pushState, turnOnPush, turnOffPush, type PushState } from "@/lib/pushClient";

const isApple = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

// Push alerts on this device: turn on (asks the browser's permission),
// turn off, and send a test. Lists the other devices that get them too.
export default function PushControls() {
  const supabase = createClient();
  const { toast } = useUI();
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<{ id: string; device_label: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setState(await pushState());
    const { data } = await supabase.from("push_subscriptions").select("id, device_label").order("created_at");
    setDevices((data as any[]) ?? []);
  }
  useEffect(() => {
    refresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function on() {
    setBusy(true);
    const r = await turnOnPush();
    setBusy(false);
    if (!r.ok) return toast(r.reason, "error");
    toast("Push alerts are on for this device", "success");
    refresh();
  }
  async function off() {
    setBusy(true);
    await turnOffPush();
    setBusy(false);
    toast("Push alerts are off for this device", "info");
    refresh();
  }
  async function test() {
    setBusy(true);
    const res = await fetch("/api/push/test", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    window.dispatchEvent(new CustomEvent("bt:notifications"));
    if (!res.ok) return toast(body.error ?? "Couldn't send a test.", "error");
    toast(body.delivered ? "Sent. It should appear in a few seconds." : "Added to your bell. No device got it; turn push on for this device first.", body.delivered ? "success" : "info");
  }

  const label =
    state === "on" ? <span className="channel-state is-on">On for this device</span>
    : state === "blocked" ? <span className="channel-state is-warn">Blocked in this browser</span>
    : state === "needs-install" ? <span className="channel-state is-warn">Add to Home Screen first</span>
    : state === "unsupported" ? <span className="channel-state">Not available in this browser</span>
    : state === "off" ? <span className="channel-state">Off for this device</span>
    : null;

  return (
    <div className="channel">
      <span className="channel-icon" aria-hidden="true"><BellRing size={17} /></span>
      <span className="channel-title">Push alerts {label}</span>
      <div className="channel-actions">
        {state === "on" && <button className="btn btn-ghost btn-sm" type="button" onClick={test} disabled={busy}>Send a test</button>}
        {state === "on" && <button className="btn btn-secondary btn-sm" type="button" onClick={off} disabled={busy}>Turn off here</button>}
        {state === "off" && <button className="btn btn-primary btn-sm" type="button" onClick={on} disabled={busy}>{busy ? "Turning on…" : "Turn on for this device"}</button>}
      </div>
      <p className="channel-desc">
        Alerts on your phone or computer's lock screen, even when Bill Tracker isn't open: bills you follow moving, drug board news, invitations, and tasks assigned to you. Turn them on separately on each device you use.
      </p>
      <div className="channel-extra">
        {state === "needs-install" && (
          <ol className="channel-steps">
            <li>In Safari, tap the Share button, then <strong>Add to Home Screen</strong>.</li>
            <li>Open Bill Tracker from the new icon on your Home Screen and sign in.</li>
            <li>Come back to Settings there and turn push alerts on. (Apple only allows them for apps on the Home Screen, on iOS 16.4 or later.)</li>
          </ol>
        )}
        {state === "blocked" && <p className="channel-desc">This browser was told not to show notifications from this site. Allow them in the browser's site settings (the icon beside the address bar), then reload this page.</p>}
        {state === "unsupported" && !isApple() && <p className="channel-desc">Try Chrome, Edge, Firefox or Safari, or install the app from the browser's menu.</p>}
        {devices.length > 0 && (
          <ul className="channel-devices" aria-label="Devices getting push alerts">
            {devices.map((d) => <li key={d.id}><Smartphone size={11} aria-hidden="true" /> {d.device_label ?? "A device"}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
