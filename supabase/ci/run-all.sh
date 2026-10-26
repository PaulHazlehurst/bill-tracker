#!/usr/bin/env bash
# Runs every SQL file in the order a brand-new install would, then runs all
# of them a second time to prove each one is safe to re-run. Used by the
# automatic checks on every pull request. Needs PG* environment variables
# pointing at a throwaway database.
set -euo pipefail
cd "$(dirname "$0")/.."

run() { echo "-- $1"; psql -v ON_ERROR_STOP=1 -q -f "$1"; }

run ci/supabase-stubs.sql
run schema.sql
for pass in 1 2; do
  echo "== pass $pass"
  for f in add-topics-columns.sql add-member-crm-columns.sql add-bill-workspace-table.sql add-regulations-tables.sql 2026-10-activity-and-discovery.sql migrations/*.sql; do
    run "$f"
  done
done

applied=$(psql -tA -c "select string_agg(id, ',' order by id) from public.schema_migrations")
expected=$(ls migrations/*.sql | xargs -n1 basename | cut -c1-4 | paste -sd, -)
echo "recorded: $applied"
[ "$applied" = "$expected" ] || { echo "schema_migrations ($applied) doesn't match the files ($expected)"; exit 1; }
run ci/rls-check.sql
echo "All SQL files ran cleanly, twice, and the security checks passed."
