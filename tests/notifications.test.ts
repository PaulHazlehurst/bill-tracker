import { afterEach, describe, expect, it, vi } from "vitest";

const sent: { endpoint: string; payload: any }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "PUB", privateKey: "PRIV" }),
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      if (failWith) throw Object.assign(new Error("gone"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
    },
  },
}));

import { notify, planPushes, pushText, vapidKeys } from "@/lib/notifications";
import { billNotifications } from "@/lib/billNotifications";
import { drugBoardNotification } from "@/lib/drugBoardAlerts";
import { isPushEndpoint, urlBase64ToUint8Array, deviceLabel } from "@/lib/pushClient";

// In-memory stand-in for the parts of the Supabase client used here.
function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = { notifications: [], push_subscriptions: [], profiles: [], app_secrets: [], ...seed };
  let n = 0;
  const query = (table: string) => {
    let rows = [...tables[table]];
    let patch: any = null;
    let del = false;
    const finish = () => {
      if (patch) for (const r of rows) Object.assign(r, patch);
      if (del) tables[table] = tables[table].filter((r) => !rows.includes(r));
    };
    const q: any = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (c: string, v: any) => ((rows = rows.filter((r) => r[c] === v)), finish(), q),
      in: (c: string, vs: any[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), finish(), q),
      is: (c: string, v: any) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      gte: () => q,
      then: (resolve: any) => resolve({ data: rows, error: null }),
      insert: (input: any[]) => {
        const added = [input].flat().map((r) => ({ id: `n${++n}`, ...r }));
        tables[table].push(...added);
        return { select: async () => ({ data: added, error: null }) };
      },
      upsert: async (input: any[]) => {
        for (const r of [input].flat()) if (!tables[table].some((x) => x.key === r.key)) tables[table].push(r);
        return { error: null };
      },
      update: (p: any) => ((patch = p), q),
      delete: () => ((del = true), q),
    };
    return q;
  };
  return { from: query, tables };
}

afterEach(() => {
  sent.length = 0;
  failWith = null;
});

describe("push alerts", () => {
  it("creates the app's key pair once and reuses it", async () => {
    const db = fakeDb({});
    expect(await vapidKeys(db)).toEqual({ publicKey: "PUB", privateKey: "PRIV" });
    expect(db.tables.app_secrets).toHaveLength(2);
  });

  it("records a notification, pushes it to every device, and never records it twice", async () => {
    const db = fakeDb({
      profiles: [{ id: "u1", notify_push: true }, { id: "u2", notify_push: false }],
      push_subscriptions: [{ id: "s1", user_id: "u1", endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a", failures: 0 }, { id: "s2", user_id: "u2", endpoint: "https://fcm.googleapis.com/b", p256dh: "k", auth: "a", failures: 0 }],
    });
    const items = [
      { userId: "u1", kind: "test" as const, title: "Hello", body: "World", url: "/x", dedupeKey: "k1" },
      { userId: "u2", kind: "test" as const, title: "Hello", dedupeKey: "k1" },
    ];
    expect(await notify(db, items)).toEqual({ created: 2, pushed: 1 });
    expect(sent).toEqual([{ endpoint: "https://fcm.googleapis.com/a", payload: { title: "Hello", body: "World", url: "/x", tag: expect.any(String) } }]);
    expect(db.tables.notifications.every((x) => x.push_sent_at)).toBe(true);
    expect(await notify(db, items)).toEqual({ created: 0, pushed: 0 });
  });

  it("records an alert once when one person is reached two ways in the same batch", async () => {
    const db = fakeDb({ profiles: [{ id: "u1", notify_push: false }] });
    const one = { userId: "u1", kind: "regulation" as const, title: "Comments close in 7 days", dedupeKey: "reg:1:week" };
    expect(await notify(db, [one, { ...one }])).toEqual({ created: 1, pushed: 0 });
  });

  it("forgets a device the browser says is gone", async () => {
    const db = fakeDb({ profiles: [{ id: "u1", notify_push: true }], push_subscriptions: [{ id: "s1", user_id: "u1", endpoint: "https://fcm.googleapis.com/a", p256dh: "k", auth: "a", failures: 0 }] });
    failWith = 410;
    await notify(db, [{ userId: "u1", kind: "test", title: "Hi" }]);
    expect(db.tables.push_subscriptions).toHaveLength(0);
    expect(db.tables.notifications).toHaveLength(1);
  });

  it("sends a busy morning as a few pushes, not twenty", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, title: `Bill ${i}`, body: "moved", url: `/bill/${i}` }));
    const plan = planPushes(items);
    expect(plan).toHaveLength(3);
    expect(plan[2]).toMatchObject({ title: "5 more updates", url: "/notifications" });
    expect(planPushes(items.slice(0, 2))).toHaveLength(2);
    expect(pushText({ title: "x".repeat(100), body: "a\n\nb" })).toEqual({ title: `${"x".repeat(79)}…`, body: "a b" });
  });
});

describe("what becomes a notification", () => {
  it("one per person per bill that moved, leading with the status change", () => {
    const events = new Map([["hr-1-119", [
      { id: "e1", bill_id: "hr-1-119", summary: "Referred to committee", event_type: "action", bills: { title: "Rural Health Act" } },
      { id: "e2", bill_id: "hr-1-119", summary: "Passed House", event_type: "status_change", bills: { title: "Rural Health Act" } },
    ]]]);
    const out = billNotifications([{ bill_id: "hr-1-119", user_id: "u1" }, { bill_id: "hr-1-119", user_id: "u1" }, { bill_id: "hr-1-119", user_id: "u2" }, { bill_id: "s-9-119", user_id: "u1" }], events);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ userId: "u1", kind: "bill_update", title: "H.R. 1: Rural Health Act", body: "Passed House (and 1 more change)", url: "/bill/hr-1-119" });
  });

  it("sums up the morning's drug board news in one line", () => {
    const n = drugBoardNotification({ documents: [{ id: "d1", state: "MD", mentions: ["Ozempic"] }, { id: "d2", state: "CO", mentions: [] }], pageChanges: [], filings: [{ id: "f1" }], bills: [] });
    expect(n.title).toBe("Drug boards: 2 new documents, 1 court filing");
    expect(n.body).toBe("Mentions Ozempic. From CO, MD.");
    expect(drugBoardNotification({ documents: [{ id: "d1", state: "MD" }], pageChanges: [], filings: [], bills: [] }).key).not.toBe(n.key);
  });
});

describe("devices", () => {
  it("accepts only real browser push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QG")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
  });

  it("decodes the app key and names the device", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID_-8"))).toEqual([1, 2, 3, 255, 239]);
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Safari/604.1")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit Chrome/131.0 Safari/537.36")).toBe("Chrome on Mac");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/131 Safari/537.36 Edg/131")).toBe("Edge on Windows");
  });
});
