import { describe, expect, it } from "vitest";
import { restoreItems, optimistic } from "@/lib/motion";

const a = { id: "a", v: 1 };
const b = { id: "b", v: 2 };
const c = { id: "c", v: 3 };

describe("Undo puts back only what it undoes", () => {
  it("restores the undone item in its old place and leaves later changes alone", () => {
    // A dismissed, then B dismissed, then Undo on A: B must stay gone.
    expect(restoreItems([c], [a, b, c], ["a"])).toEqual([a, c]);
  });

  it("keeps newer versions of items and anything added since", () => {
    const c2 = { id: "c", v: 30 };
    const d = { id: "d", v: 4 };
    expect(restoreItems([c2, d], [a, b, c], ["b"])).toEqual([b, c2, d]);
  });
});

describe("optimistic updates", () => {
  it("applies first and reverts when the save fails", async () => {
    const log: string[] = [];
    const ok = await optimistic({ apply: () => log.push("apply"), revert: () => log.push("revert"), save: async () => new Response("no", { status: 500 }), onError: () => log.push("error") });
    expect(ok).toBe(false);
    expect(log).toEqual(["apply", "revert", "error"]);
  });

  it("keeps the change when the save works", async () => {
    const log: string[] = [];
    expect(await optimistic({ apply: () => log.push("apply"), revert: () => log.push("revert"), save: async () => true })).toBe(true);
    expect(log).toEqual(["apply"]);
  });
});
