<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules (Bill Tracker)

- Built for Pinnacle Strategies Consulting (rural healthcare policy). The owner isn't a developer: explain changes in plain words.
- No AI or LLM features in the product. Use plain rules and word matching, and show the source.
- Database changes go in a new numbered file in `supabase/migrations/` (safe to run twice, records itself in `schema_migrations`, listed in `lib/migrations.ts`). They're never applied automatically: the owner runs them in the Supabase SQL Editor.
- Every change goes through a branch and a pull request. Never push to `main`; Vercel deploys from `main` once the owner merges.
- Vercel Hobby limits: two scheduled jobs only (`poll` 06:00 UTC, `notify` 06:15 UTC) and 60 seconds per function. Fit new background work into those.
- Checks on every pull request: typecheck, unit tests and build; every SQL file run twice plus `supabase/ci/rls-check.sql`; screenshots and a Lighthouse speed budget (`e2e/`, run against the stand-in database in `e2e/mock`).
- Motion uses React's `<ViewTransition>` (see `components/Motion.tsx`, `lib/motion.ts`, `app/styles/motion.css`). Actions update the screen first and undo themselves if the save fails (`optimistic()`).
