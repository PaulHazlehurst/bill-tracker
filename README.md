# Bill Tracker

Track federal bills, get notified by email/SMS when they move, personal +
team pages, CSV export.

## Architecture

- **Next.js (App Router)** on Vercel — frontend + API routes
- **Supabase** — Postgres, Auth, Row Level Security
- **Resend** — email notifications
- **Twilio** — SMS notifications
- **congress.gov API** — bill data, called only from server-side code

See `supabase/schema.sql` for the full data model.

## Setup

### 1. Supabase

1. Create a project at supabase.com.
2. Open the SQL editor and run the contents of `supabase/schema.sql`.
3. Settings → API: copy your Project URL, `anon` public key, and
   `service_role` secret key.

### 2. Environment variables

```
cp .env.example .env.local
```

Fill in every value. See the comments in `.env.example` — it tells you
which keys are safe for the browser and which are server-only.

### 3. Local dev

```
npm install
npm run dev
```

### 4. Deploy to Vercel

1. Push this repo to GitHub (see below).
2. Import the repo in Vercel.
3. Add every variable from `.env.local` under Project Settings →
   Environment Variables. Generate `CRON_SECRET` with:
   ```
   openssl rand -hex 32
   ```
4. Deploy. `vercel.json` registers the two cron jobs automatically
   (poll hourly, notify five minutes later).

### 5. Push to GitHub

```
git init
git add .
git commit -m "Initial scaffold"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bill-tracker.git
git push -u origin main
```

## Security checklist

- [x] `CONGRESS_API_KEY` only ever read in `lib/congress-api.ts`, which is
      imported only by server-side route handlers. Never sent to the browser.
- [x] `SUPABASE_SERVICE_ROLE_KEY` only used in `createAdminClient()`
      (`lib/supabase/server.ts`), only imported by the cron routes.
      Bypasses Row Level Security — treat it like a root password.
- [x] Every browser-facing table (`bills`, `tracked_bills`, `bill_events`,
      `profiles`) has Row Level Security policies in `schema.sql` — a user
      can only read/write their own data or their team's shared view.
- [x] `/api/cron/*` routes check a `CRON_SECRET` bearer token so a stranger
      can't trigger your poller (and burn your congress.gov quota) by
      hitting the URL directly.
- [x] `.env.local` is git-ignored. Real secrets live only in Vercel's
      environment variable store and Supabase's dashboard.
- [ ] **Before going live**: enable Supabase's email confirmation on signup
      (Auth → Providers → Email) so unverified addresses can't receive
      notifications.
- [ ] **Before going live**: validate phone number format server-side
      (E.164) before saving — a malformed number will just fail silently
      at Twilio otherwise.
- [ ] Consider rate-limiting `/api/bills/search` per user (e.g. with
      Vercel's `@vercel/kv` or Upstash) so one account can't hammer your
      congress.gov quota by scripting searches.

## Rate-limit design

The poller (`app/api/cron/poll/route.ts`) is deduped by design: it queries
`bills` (one row per unique bill) rather than looping over users, so
request volume scales with **distinct tracked bills**, not user count.
Bills are polled on a tiered schedule (`poll_priority`: hot = 30 min,
normal = 2 hr, dormant = daily) and terminal-stage bills (enacted, vetoed,
failed) automatically drop to the dormant tier. Adjust `TIER_INTERVAL_MIN`
in that file as your user base grows.

## Not yet built

This is a working scaffold, not a finished product. Known gaps:

- No profile-editing UI (phone/org changes require a DB edit for now)
- No individual bill detail page yet — team page and dashboard link out
  to congress.gov directly for now
- Search result shape assumes congress.gov's default JSON response;
  verify field names against your actual API responses before relying on it
- No password reset flow (Supabase Auth supports it — just needs a page)
