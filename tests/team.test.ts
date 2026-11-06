import { describe, expect, it } from "vitest";
import { parseEmails, displayName, initialsFor, inviteProblem, roleChangeProblem, nextOwner, isAdmin } from "@/lib/team";
import { normalizePhone } from "@/lib/phone";
import { explainTwilioError } from "@/lib/sms";

describe("inviting people", () => {
  it("reads addresses however they're pasted", () => {
    expect(parseEmails("jane@client.org, Sam Lee <SAM@client.org>; jane@client.org\nmailto:pat@x.co")).toEqual({ emails: ["jane@client.org", "sam@client.org", "pat@x.co"], invalid: [] });
    expect(parseEmails("not-an-email@, ok@fine.com").invalid).toEqual(["not-an-email@"]);
    expect(parseEmails("").emails).toEqual([]);
    expect(parseEmails(Array.from({ length: 80 }, (_, i) => `p${i}@x.com`).join(",")).emails).toHaveLength(50);
  });

  it("explains why an invitation can't be used", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const ok = { email: "a@b.c", expires_at: "2026-11-20T00:00:00Z", accepted_at: null, revoked_at: null };
    expect(inviteProblem(ok, now)).toBeNull();
    expect(inviteProblem(null, now)).toMatch(/isn't valid/);
    expect(inviteProblem({ ...ok, revoked_at: "x" }, now)).toMatch(/cancelled/);
    expect(inviteProblem({ ...ok, accepted_at: "x" }, now)).toMatch(/already been used/);
    expect(inviteProblem({ ...ok, expires_at: "2026-11-01T00:00:00Z" }, now)).toMatch(/expired/);
  });
});

describe("roles", () => {
  it("treats the owner as an admin", () => {
    expect(isAdmin({ id: "o", team_role: "member" }, "o")).toBe(true);
    expect(isAdmin({ id: "m", team_role: "member" }, "o")).toBe(false);
    expect(isAdmin({ id: "a", team_role: "admin" }, null)).toBe(true);
  });

  it("keeps the owner an admin and the team with at least one admin", () => {
    expect(roleChangeProblem({ id: "o", team_role: "admin" }, "member", "o", 3)).toMatch(/owner/);
    expect(roleChangeProblem({ id: "a", team_role: "admin" }, "member", "o", 1)).toMatch(/at least one admin/);
    expect(roleChangeProblem({ id: "a", team_role: "admin" }, "member", "o", 2)).toBeNull();
    expect(roleChangeProblem({ id: "m", team_role: "member" }, "admin", "o", 1)).toBeNull();
  });

  it("passes ownership to another admin first, then the longest-standing member", () => {
    const team = [
      { id: "owner", team_role: "admin", created_at: "2026-01-01" },
      { id: "early", team_role: "member", created_at: "2026-02-01" },
      { id: "admin2", team_role: "admin", created_at: "2026-05-01" },
    ];
    expect(nextOwner(team, "owner")).toBe("admin2");
    expect(nextOwner(team.filter((m) => m.id !== "admin2"), "owner")).toBe("early");
    expect(nextOwner([team[0]], "owner")).toBeNull();
  });
});

describe("names", () => {
  it("shows a name when there is one, otherwise the start of the email", () => {
    expect(displayName({ full_name: " Ben Hazlehurst ", email: "ben@x.com" })).toBe("Ben Hazlehurst");
    expect(displayName({ full_name: "", email: "jane.doe@x.com" })).toBe("jane.doe");
    expect(initialsFor({ full_name: "Ben Hazlehurst" })).toBe("BH");
    expect(initialsFor({ full_name: "Cher" })).toBe("CH");
    expect(initialsFor({ email: "zoe@x.com" })).toBe("ZO");
  });
});

describe("text messages", () => {
  it("puts phone numbers in the format Twilio needs", () => {
    expect(normalizePhone("(410) 555-0123")).toBe("+14105550123");
    expect(normalizePhone("1-410-555-0123")).toBe("+14105550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555-0123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("turns Twilio's error codes into what to do next", () => {
    expect(explainTwilioError(21608, "x")).toMatch(/free trial/);
    expect(explainTwilioError(30034, "x")).toMatch(/A2P 10DLC/);
    expect(explainTwilioError(21610, "x")).toMatch(/STOP/);
    expect(explainTwilioError(99999, "fallback")).toBe("fallback");
  });
});
