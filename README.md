# Bill Tracker

Track federal bills, get notified by email/SMS when they move, see the
week's hearings and markups, compare versions of a bill's text, and send
each client a Monday report.

Built to be set up entirely in the browser - GitHub's website and Vercel's
dashboard. No terminal, no CLI, no local installs required.

## The three services this uses

- **GitHub** - stores the code
- **Vercel** - builds and hosts the site, runs the scheduled bill-checker
- **Supabase** - the database, login system, and permissions

That's it. Email (Resend) and text (Twilio) are optional add-ons you can
skip at first and add later.

## Setup, step by step

### 1. Create the Supabase project

1. Go to supabase.com, sign in, click **New project**.
2. Name it, set a database password (save it somewhere), pick a region, click **Create**. Takes a minute or two.

### 2. Set up the database

1. In the Supabase dashboard, open **SQL Editor** in the left sidebar → **New query**.
2. Open `supabase/schema.sql` from this project, copy the whole file, paste it into the editor.
3. Click **Run**. You should see "Success" and new tables appear under **Table Editor**.
4. Repeat for each of these files, in this order: `add-topics-columns.sql`, `add-member-crm-columns.sql`, `add-bill-workspace-table.sql`, `add-regulations-tables.sql`, `2026-10-activity-and-discovery.sql`, then every file in `supabase/migrations/` in number order. Every file is safe to run more than once.

**Database updates from now on** are numbered files in `supabase/migrations/`
(`0001_...sql`, `0002_...sql`, ...). Each one records itself when it runs, so
the app's **Data sources** page always lists exactly which ones are still
waiting. Run them in number order.

### 3. Get your Supabase keys

1. In Supabase, go to **Project Settings** (gear icon) → **API**.
2. Keep this tab open - you'll copy three values from here in step 6: **Project URL**, the **anon public** key, and the **service_role** key.

### 4. Push this project to GitHub

1. On github.com, click **+** → **New repository**. Name it `bill-tracker`, set it to **Private**, click **Create repository**. Leave it empty.
2. Unzip this project on your computer.
3. On the repo page, click **Add file** → **Upload files**, then drag in everything *inside* the unzipped `bill-tracker` folder (not the folder itself).
4. Scroll down, write a commit message like "Initial scaffold", click **Commit changes**.

Files starting with a dot (like `.gitignore`) are sometimes hidden in your
file browser - if you drag the whole folder in at once (rather than picking
files one by one) they should come along anyway.

### 5. Import into Vercel

1. Go to vercel.com, sign in with GitHub.
2. Click **Add New** → **Project**, select your `bill-tracker` repo, click **Import**.
3. Don't click Deploy yet - expand **Environment Variables** first (next step).

### 6. Add environment variables in Vercel

Still on that import screen, add each of these as a name/value pair. Nothing
here needs a terminal - just type the name, paste the value.

| Name | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key |
| `CONGRESS_API_KEY` | Your congress.gov API key |
| `NEXT_PUBLIC_APP_URL` | Your site's address, e.g. `https://your-app.vercel.app`. Links inside alert emails use it. |
| `OPEN_STATES_API_KEY` | Optional. Free key from open.pluralpolicy.com. Turns on the state bill search on the Drug boards page. |
| `COURTLISTENER_API_TOKEN` | Optional. Free token from a courtlistener.com account (Profile, API). Lets the Drug boards page check court cases about the boards for new filings. |
| `ALERT_EMAIL` | Optional. Who gets an email if a scheduled run fails or stops running. Leave blank to alert team owners. Several addresses can be separated by commas. |
| `CRON_SECRET` | Make this up yourself - any long random string, e.g. mash your keyboard for 40+ characters. It's just a password nothing else needs to guess. |
| `RESEND_API_KEY` | Optional for now - leave blank, see "Turning on email" below |
| `RESEND_FROM_EMAIL` | Optional for now |
| `TWILIO_ACCOUNT_SID` | Optional for now - leave blank, see "Turning on text messages" below |
| `TWILIO_AUTH_TOKEN` | Optional for now |
| `TWILIO_FROM_NUMBER` | Optional for now (or `TWILIO_MESSAGING_SERVICE_SID`) |

Leaving the Resend/Twilio ones blank is fine - the site still works, tracking
and progress bars work, notifications just won't send until you fill those in.

### 7. Deploy

Click **Deploy**. Vercel installs everything and builds it in the cloud -
this is the one step that replaces "npm install" entirely. Takes 1-2 minutes.
Click **Visit** when it's done.

### 8. Test it

1. On your live site, click **Sign up**, create an account.
2. Search for a bill (try a keyword like "infrastructure") and click **Track**.
3. Go back to Supabase → Table Editor → `bills` - you should see a new row with real data. That confirms your `CONGRESS_API_KEY` is working.

## How the automatic bill-checking works

`vercel.json` schedules two things automatically, no setup needed beyond
what's above:

- `/api/cron/poll` runs once a day, checks every tracked bill against
  congress.gov, and records anything that changed.
  With time left over it copies the week's committee meetings and the House
  floor schedule for the **Week ahead** page, checks each state drug
  affordability board's web pages for new documents, and searches Open
  States for state bills about those boards.
- `/api/cron/notify` runs 15 minutes later and emails/texts anyone
  subscribed to a bill that changed. On Mondays it also sends client
  reports that are set to go out automatically.

Each job is logged, and each checks that the other one ran: if a run fails,
stops partway, or doesn't happen, `ALERT_EMAIL` (or the team owners) get one
email about it. The last few runs are listed on the **Data sources** page.

Vercel's free plan only allows cron jobs to run once a day - that's why it's
daily and not hourly. If you later want faster updates, either upgrade to
Vercel Pro (removes that limit) and edit the schedule in `vercel.json`, or
tell me and I'll show you a free workaround using an external scheduler.

**To trigger a check manually** (useful for testing, or right after you add
your first tracked bill): visit this URL directly in your browser, swapping
in your actual domain and your `CRON_SECRET` value:

```
https://your-app.vercel.app/api/cron/poll?secret=YOUR_CRON_SECRET
```

You should see a small JSON response like `{"polled":1,"changed":0}`.

## Turning on email

1. Sign up at resend.com (the free tier is plenty to start).
2. In Resend → **Domains**, add the domain you'll send from (for example
   `pinnaclestrategies.com`) and add the DNS records it shows you. Until the
   domain says **Verified**, Resend will only deliver to your own address.
3. In Resend → **API Keys**, create a key with "Sending access".
4. In Vercel → your project → **Settings** → **Environment Variables**, add
   `RESEND_API_KEY` (mark it **Sensitive**) and `RESEND_FROM_EMAIL`, for example
   `Bill Tracker <alerts@pinnaclestrategies.com>`. The address must be on the
   verified domain.
5. **Deployments** → the **...** menu on the latest one → **Redeploy**.
6. In the app, go to **Settings → Notifications** and press **Send a test** next
   to Email. If it doesn't arrive in a minute, check spam, then **Data sources**,
   which says whether the key and domain look right.

Team invitations are sent by email too, so this is worth doing before you
invite a client's team. (Without it, invitations still work: copy the link from
the Team page and send it yourself.)

## Turning on text messages

Texting from a US business number takes a few days, because carriers require
every business that texts to register first (this is called "A2P 10DLC"). Until
that's approved, texts are blocked or never arrive.

1. Sign up at twilio.com. A trial account can only text phone numbers you've
   verified with Twilio, and adds "Sent from your Twilio trial account" to every
   message. Upgrade (add a payment method) before anyone else needs texts.
2. **Phone Numbers → Buy a number**: pick a local number with SMS.
3. **Messaging → Regulatory compliance → A2P 10DLC**: register your business
   (a "Brand") and then a "Campaign". Use these answers:
   - Use case: *Account notifications*.
   - Description: *Alerts to staff and clients of Pinnacle Strategies when
     legislation they follow changes status.*
   - Sample message: *Bill Tracker: H.R. 1234 (Rural Health Access Act) passed
     the House. Reply STOP to stop.*
   - How people opt in: *Users add their own mobile number in the app's
     Settings and tick "Text me". They can untick it or reply STOP at any time.*
   Approval usually takes a few days. Add your number to the campaign once it's
   approved (Twilio makes a "Messaging Service" for this).
4. In Vercel, add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (Sensitive), and
   either `TWILIO_MESSAGING_SERVICE_SID` (the Messaging Service from step 3,
   preferred) or `TWILIO_FROM_NUMBER` (the number, like `+14105550123`). Redeploy.
5. In the app, **Settings → Notifications**: add your mobile number, then
   **Send a test** next to Text. If Twilio refuses, the message says why in plain
   words (still on trial, registration not finished, number replied STOP, and so on).

## Push notifications (phone and computer alerts)

These need no setup or accounts: the app makes its own signing keys the first
time someone turns them on (kept in the database, readable only by the server).
Each person turns them on for each device in **Settings → Notifications**.

- Computers (Chrome, Edge, Firefox, Safari): press **Turn on** and allow
  notifications when the browser asks.
- iPhone and iPad (iOS 16.4 or newer): open the site in Safari, tap **Share →
  Add to Home Screen**, open the app from the new icon, then press **Turn on**.
  Apple only allows web alerts for apps added to the Home Screen.
- Android: press **Turn on** in Chrome. Adding it to the Home Screen is optional.

Alerts arrive even when the app isn't open. Each morning a person gets up to
three individual alerts and then one "N more updates" summary, so a busy day
doesn't buzz their phone twenty times. Everything also lands in the bell.

## Security checklist

- [x] `CONGRESS_API_KEY` is only ever read in `lib/congress-api.ts`, imported only by server-side code. Never sent to the browser.
- [x] `SUPABASE_SERVICE_ROLE_KEY` is only used in `createAdminClient()` (`lib/supabase/server.ts`), only imported by the cron routes. Bypasses Row Level Security - treat it like a root password.
- [x] Every browser-facing table (`bills`, `tracked_bills`, `bill_events`, `profiles`) has Row Level Security policies in `schema.sql` - a user can only read/write their own data or their team's shared view.
- [x] `/api/cron/*` routes require `CRON_SECRET`, so a stranger can't trigger your poller (and burn your congress.gov quota) by hitting the URL directly.
- [x] Nothing in this repo ever contains real secrets - they only ever live in Vercel's and Supabase's dashboards.
- [ ] **Before inviting real users**: turn on Supabase email confirmation (Auth → Providers → Email) so unverified addresses can't receive notifications.
- [x] Phone numbers are checked and put in +1 format when saved (`lib/phone.ts`).

## Making changes safely

Changes arrive as pull requests on GitHub. Each one runs **Checks**
automatically (`.github/workflows/checks.yml`):

- the typecheck, the unit tests in `tests/`, and a full production build;
- every SQL file run twice against a throwaway database, plus security checks
  that one team can never see another team's clients;
- **Screens and speed**: every main page opened at desktop and phone size,
  signed in as a made-up user with made-up data. It fails if a page crashes,
  scrolls sideways on a phone, or goes over the speed limits in
  `e2e/budgets.json` (Lighthouse's mobile test). Screenshots are also
  compared with the base branch: the job summary lists the pages that look
  different, and the **screenshots** download shows before, after and the
  differences highlighted.

A green tick means it's safe to merge. Vercel also builds a preview link for
every pull request, so you can click through the change before it goes live.
Merging is what puts it on the live site.

For developers: `npm test` runs the unit tests, `npm run typecheck` the type
checker. `supabase/ci/run-all.sh` runs the database checks against any
Postgres reachable through the usual `PG*` environment variables. For the
screenshots, start `python3 e2e/mock/server.py`, build with
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, run `next start -p 3100`,
then `node e2e/shoot.mjs` and `node e2e/speed.mjs` (they need `playwright`,
`pixelmatch`, `pngjs` and `lighthouse`, which CI installs on the fly).

## If something breaks

Go to Vercel → your project → **Deployments** → click the failed one →
**Build Logs**, scroll to the error text near the bottom, and share that
exact text. That's almost always enough to pin down the fix.

## Checking that everything works

Open **Data sources** in the app's sidebar and click **Test all connections**. It checks every
outside service (congress.gov, GovInfo, LDA.gov, the Federal Register, Google News, Resend,
Twilio), confirms the database updates have been run, and flags it if the morning check has
stopped running. Anything that needs attention comes with the fix.

## Known limits

- Bill search covers the 119th Congress: the full text of every published bill (GovInfo) plus
  the ~500 most recently updated bills on congress.gov. Brand-new bills can take a few days to
  appear in GovInfo's full-text index; until then they're found by title.
- The morning check runs once a day (Vercel's free plan allows daily scheduled jobs). Any bill
  page has a **Check now** button for an immediate re-check.
- No self-service way to transfer team ownership yet.
- Week ahead covers committee meetings (both chambers) and the House floor. The Senate doesn't
  publish its floor schedule in advance in a form the app can read.
- Committees usually post meeting notices about a week ahead, so the following week fills in
  gradually.
- Comparing versions of a bill works for any bill GovInfo has published as text. Very long bills
  (over about 6 MB of text, such as an omnibus) are too large to compare in the app.
- State drug affordability boards don't offer data feeds. The **Drug boards** page checks each
  board's web pages for new documents (agendas, minutes, reports) and lists them; your team reads
  them and updates the drug tracker. If a board moves a page, the page shows a warning and the
  address can be changed at the bottom of Drug boards.
- The Monday client report goes out with the early-morning run (around 2 AM Eastern), because the
  free Vercel plan allows two daily jobs and both are in use.
