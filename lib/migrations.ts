// The numbered database updates in supabase/migrations/, in the order they
// must be run. Each file ends by recording its own id in the
// schema_migrations table, so the Data sources page can compare this list
// with what the database says and show exactly which files are still
// waiting to be run. (tests/migrations.test.ts fails the build if this list
// and the folder ever disagree.)
//
// Safe to import anywhere: no secrets, no I/O.

export type Migration = {
  id: string;
  file: string;
  name: string;
  /** What someone gets once it's run, in plain words. */
  unlocks: string;
};

export const MIGRATIONS: Migration[] = [
  {
    id: "0001",
    file: "supabase/migrations/0001_update_log_and_job_runs.sql",
    name: "Update log and job runs",
    unlocks: "This list of database updates, and a record of every morning run.",
  },
  {
    id: "0002",
    file: "supabase/migrations/0002_week_ahead.sql",
    name: "Week ahead",
    unlocks: "Committee hearings, markups and the House floor schedule on the Week ahead page, and calendar links.",
  },
  {
    id: "0003",
    file: "supabase/migrations/0003_text_changes.sql",
    name: "Text changes",
    unlocks: "Saved comparisons between versions of a bill's text, so they open instantly the second time.",
  },
  {
    id: "0004",
    file: "supabase/migrations/0004_clients.sql",
    name: "Clients and the Monday report",
    unlocks: "The Clients pages and the weekly client report.",
  },
];

/** Splits the list into what's been run and what hasn't, given the ids the database reports. */
export function migrationStatus(applied: Iterable<string>) {
  const done = new Set(applied);
  return {
    applied: MIGRATIONS.filter((m) => done.has(m.id)),
    pending: MIGRATIONS.filter((m) => !done.has(m.id)),
  };
}
