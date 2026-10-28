import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS, migrationStatus } from "@/lib/migrations";

const dir = path.resolve(__dirname, "../supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

describe("numbered database updates", () => {
  it("lists every file in supabase/migrations, in order, and nothing else", () => {
    expect(MIGRATIONS.map((m) => path.basename(m.file))).toEqual(files);
    expect(MIGRATIONS.map((m) => m.id)).toEqual(files.map((f) => f.slice(0, 4)));
  });

  it("has each file record itself and be safe to run twice", () => {
    for (const m of MIGRATIONS) {
      const sql = readFileSync(path.resolve(__dirname, "..", m.file), "utf8");
      expect(sql, m.file).toContain(`values ('${m.id}',`);
      expect(sql, m.file).toMatch(/on conflict \(id\) do nothing/);
      // Every create is guarded so a second run is harmless.
      const creates = sql.match(/create (table|index|unique index)\b(?! if not exists)/gi) ?? [];
      expect(creates, m.file).toEqual([]);
      const policies = sql.match(/create policy "([^"]+)"/g) ?? [];
      for (const p of policies) expect(sql, m.file).toContain(`drop policy if exists ${p.replace("create policy ", "")}`);
    }
  });

  it("works out what's still waiting", () => {
    const all = MIGRATIONS.map((m) => m.id);
    expect(migrationStatus(["0001", "0003"]).pending.map((m) => m.id)).toEqual(all.filter((id) => id !== "0001" && id !== "0003"));
    expect(migrationStatus(all).pending).toEqual([]);
  });
});
