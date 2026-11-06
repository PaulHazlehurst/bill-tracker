// SERVER-ONLY. Notifications: the bell in the app, and push alerts to the
// phones and computers people have turned them on for.
//
// Everything that should reach a person goes through notify(): it records
// the notification (so it's in their bell even if push is off) and then
// pushes it to their devices. Database triggers can also create
// notifications (task assignments); flushPending() pushes those.
//
// Push uses the Web Push standard. The key pair that signs pushes is made
// by the app itself the first time it's needed and kept in app_secrets,
// which only the server can read, so there's nothing to set up in Vercel.

import webpush from "web-push";

type Admin = any;

export type NewNotification = {
  userId: string;
  kind: "bill_update" | "drug_board" | "team" | "task" | "client_report" | "test";
  title: string;
  body?: string | null;
  url?: string | null;
  /** Same key for the same person = created once, however many times this runs. */
  dedupeKey?: string | null;
};

export type PushPayload = { title: string; body?: string; url?: string; tag?: string };

let cachedKeys: { publicKey: string; privateKey: string } | null = null;

/** The app's push key pair, created and saved on first use. */
export async function vapidKeys(admin: Admin): Promise<{ publicKey: string; privateKey: string }> {
  if (cachedKeys) return cachedKeys;
  const read = async () => {
    const { data } = await admin.from("app_secrets").select("key, value").in("key", ["vapid_public_key", "vapid_private_key"]);
    const map = new Map(((data as any[]) ?? []).map((r) => [r.key, r.value]));
    return map.get("vapid_public_key") && map.get("vapid_private_key") ? { publicKey: map.get("vapid_public_key")!, privateKey: map.get("vapid_private_key")! } : null;
  };
  let keys = await read();
  if (!keys) {
    const fresh = webpush.generateVAPIDKeys();
    // If two requests race, the first save wins and both read it back.
    await admin.from("app_secrets").upsert(
      [
        { key: "vapid_public_key", value: fresh.publicKey },
        { key: "vapid_private_key", value: fresh.privateKey },
      ],
      { onConflict: "key", ignoreDuplicates: true },
    );
    keys = await read();
    if (!keys) throw new Error("couldn't save the push key pair (has database update 0007 been run?)");
  }
  cachedKeys = keys;
  return keys;
}

function vapidSubject() {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (/^https:\/\//.test(app)) return app;
  const from = (process.env.RESEND_FROM_EMAIL ?? "").match(/[^<\s]+@[^>\s]+/)?.[0];
  return `mailto:${from ?? "alerts@example.com"}`;
}

/** Keeps a push short enough for a lock screen. */
export function pushText(n: { title: string; body?: string | null }): { title: string; body: string } {
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  return { title: clip(n.title, 80), body: clip((n.body ?? "").replace(/\s+/g, " ").trim(), 180) };
}

/**
 * What to push when someone has several new notifications at once: up to
 * three individually, then one summary pointing at the bell, so a busy
 * morning is one buzz per thing that matters rather than twenty.
 */
export function planPushes(items: { id: string; title: string; body?: string | null; url?: string | null }[]): PushPayload[] {
  if (items.length <= 3) return items.map((n) => ({ ...pushText(n), url: n.url ?? "/notifications", tag: n.id }));
  const first = items.slice(0, 2).map((n) => ({ ...pushText(n), url: n.url ?? "/notifications", tag: n.id }));
  return [...first, { title: `${items.length - 2} more updates`, body: items.slice(2, 5).map((n) => n.title).join(" · "), url: "/notifications", tag: "summary" }];
}

/** Sends to every device a person has. Removes devices the browser says are gone. Returns how many got it. */
export async function pushToUser(admin: Admin, userId: string, payloads: PushPayload[]): Promise<number> {
  if (!payloads.length) return 0;
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth, failures").eq("user_id", userId);
  if (!subs?.length) return 0;
  const keys = await vapidKeys(admin);
  webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
  let delivered = 0;
  for (const sub of subs as any[]) {
    let ok = false;
    for (const p of payloads) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(p), { TTL: 60 * 60 * 24, urgency: "normal", timeout: 8_000 });
        ok = true;
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          // The browser unsubscribed or the app was removed: forget the device.
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
          break;
        }
        await admin.from("push_subscriptions").update({ failures: (sub.failures ?? 0) + 1 }).eq("id", sub.id);
        if ((sub.failures ?? 0) + 1 >= 5) await admin.from("push_subscriptions").delete().eq("id", sub.id);
        console.error("push send failed", status, String(err?.body ?? err?.message ?? err).slice(0, 200));
        break;
      }
    }
    if (ok) {
      delivered++;
      await admin.from("push_subscriptions").update({ last_success_at: new Date().toISOString(), failures: 0 }).eq("id", sub.id);
    }
  }
  return delivered;
}

/**
 * Records notifications and pushes them right away. Skips ones already
 * recorded (same person and dedupe key). Push goes only to people who
 * haven't turned push off.
 */
export async function notify(admin: Admin, items: NewNotification[], opts: { push?: boolean } = {}): Promise<{ created: number; pushed: number }> {
  if (!items.length) return { created: 0, pushed: 0 };
  const keyed = items.filter((i) => i.dedupeKey);
  let skip = new Set<string>();
  if (keyed.length) {
    const { data: existing } = await admin
      .from("notifications")
      .select("user_id, dedupe_key")
      .in("user_id", Array.from(new Set(keyed.map((i) => i.userId))))
      .in("dedupe_key", Array.from(new Set(keyed.map((i) => i.dedupeKey!))));
    skip = new Set(((existing as any[]) ?? []).map((e) => `${e.user_id}|${e.dedupe_key}`));
  }
  const rows = items
    .filter((i) => !i.dedupeKey || !skip.has(`${i.userId}|${i.dedupeKey}`))
    .map((i) => ({ user_id: i.userId, kind: i.kind, title: i.title.slice(0, 200), body: i.body?.slice(0, 1000) ?? null, url: i.url ?? null, dedupe_key: i.dedupeKey ?? null }));
  if (!rows.length) return { created: 0, pushed: 0 };
  const { data: inserted, error } = await admin.from("notifications").insert(rows).select("id, user_id, title, body, url");
  if (error) throw new Error(`couldn't save notifications: ${error.message}`);
  const created = (inserted as any[]) ?? [];
  if (opts.push === false) return { created: created.length, pushed: 0 };
  const pushed = await pushCreated(admin, created);
  return { created: created.length, pushed };
}

async function pushCreated(admin: Admin, created: { id: string; user_id: string; title: string; body: string | null; url: string | null }[]): Promise<number> {
  if (!created.length) return 0;
  const userIds = Array.from(new Set(created.map((n) => n.user_id)));
  const { data: prefs } = await admin.from("profiles").select("id, notify_push").in("id", userIds);
  const wantsPush = new Set(((prefs as any[]) ?? []).filter((p) => p.notify_push !== false).map((p) => p.id));
  let pushed = 0;
  for (const userId of userIds) {
    const mine = created.filter((n) => n.user_id === userId);
    if (wantsPush.has(userId)) {
      try {
        pushed += (await pushToUser(admin, userId, planPushes(mine))) > 0 ? mine.length : 0;
      } catch (err) {
        console.error("push for user failed", err);
      }
    }
  }
  await admin.from("notifications").update({ push_sent_at: new Date().toISOString() }).in("id", created.map((n) => n.id));
  return pushed;
}

/**
 * Pushes notifications that were recorded but not pushed yet (for example
 * by the task-assignment trigger). Only recent ones: an alert from
 * yesterday isn't worth buzzing a phone for.
 */
export async function flushPending(admin: Admin, opts: { userId?: string; withinMinutes?: number } = {}): Promise<number> {
  const since = new Date(Date.now() - (opts.withinMinutes ?? 30) * 60_000).toISOString();
  let q = admin.from("notifications").select("id, user_id, title, body, url").is("push_sent_at", null).gte("created_at", since).order("created_at").limit(200);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const { data } = await q;
  return pushCreated(admin, (data as any[]) ?? []);
}

/** Old notifications go after 90 days so the bell stays useful. */
export async function pruneNotifications(admin: Admin) {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  await admin.from("notifications").delete().lt("created_at", cutoff);
}
