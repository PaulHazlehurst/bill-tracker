// Push alerts, from the browser's side. Used by Settings and the bell.
// Pure helpers first (tested in tests/notifications.test.ts), then the
// browser-only functions.

/** Push services browsers actually use. Anything else is refused. */
export function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return /(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com|push\.services\.mozilla\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** The VAPID public key arrives base64url-encoded; the browser wants bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A short name for this device, shown in Settings ("iPhone", "Chrome on Mac"). */
export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "this device";
  if (os === "iPhone" || os === "iPad") return os;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export type PushState =
  | "unsupported" // this browser can't do push
  | "needs-install" // iPhone/iPad: works only once added to the Home Screen
  | "blocked" // the person said no; only the browser's settings can undo it
  | "off"
  | "on";

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Asks permission (must be called from a click), signs this device up, and tells the server. */
export async function turnOnPush(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "This browser can't receive push alerts." };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission === "denied" ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again." : "Permission wasn't given." };
  const res = await fetch("/api/push/key");
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.publicKey) return { ok: false, reason: body.error ?? "Couldn't get the app's push key." };
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(body.publicKey) as BufferSource });
  const saved = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), label: deviceLabel(navigator.userAgent) }) });
  if (!saved.ok) return { ok: false, reason: "Couldn't save this device. Try again." };
  return { ok: true };
}

export async function turnOffPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
