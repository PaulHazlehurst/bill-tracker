# October 2026 update: how to install it

This zip holds only the files that changed or are new (108 of them), in their exact folders.
Four steps, about 15 minutes.

## 1. Upload the files to GitHub (one commit)

1. Unzip this file on your computer. You'll get a folder containing `app`, `components`, `lib`,
   `supabase`, `middleware.ts`, `README.md` and this guide.
2. On github.com, open the `bill-tracker` repository, then **Add file → Upload files**.
3. Open the unzipped folder, select **everything inside it** (the folders and files, not the
   outer folder itself), and drag it all onto the GitHub page at once. GitHub keeps the folder
   structure when you drag folders.
4. Commit message: `October update`, then **Commit changes**.

Upload everything in one go. The new files depend on each other, so a partial upload will make
the Vercel build fail. (You no longer need to upload `globals.css` on its own: the styles are
now split into four smaller files.)

## 2. Delete these files on GitHub

Open each one on github.com, click the **…** menu at the top right of the file, then
**Delete file**, then commit. Start with the first one: it's the Rural Health page, and until it's
deleted that page can still be reached by typing its address.

```
app/(app)/rural-health/page.tsx
app/api/rural-health/bills/route.ts
app/api/rural-health/hpsa/route.ts
app/api/rural-health/stats/route.ts
lib/ruralCareJourney-api.ts
components/RuralBillFinder.tsx
components/StateDelegation.tsx
app/api/public/stats/route.ts
components/ActivityMini.tsx
components/BillSearch.tsx
components/BillTable.tsx
components/CapitolWatermark.tsx
components/Onboarding.tsx
components/ProspectiveBills.tsx
components/StageFlow.tsx
components/TableSkeleton.tsx
components/TopicsHero.tsx
components/TrendingBills.tsx
components/VersionBadge.tsx
components/WelcomeBar.tsx
lib/version.ts
public/capitol-bg.png
```

Every file after the first seven is unused code. I checked that the app still builds if any of
them are left behind, so if you run out of patience partway through, nothing breaks.

## 3. Run two SQL files in Supabase

Supabase → **SQL Editor** → **New query**. Paste each file's whole contents, click **Run**, and
wait for "Success". Both are safe to run more than once.

1. `supabase/add-regulations-tables.sql`: creates the two tables the Regulations page needs.
   These were never in the repository, so if your Regulations page has always been empty, this
   is why.
2. `supabase/2026-10-activity-and-discovery.sql`: adds real action dates to activity, the
   "why it matched" notes on suggestions, the team task board's assignee and due-date columns,
   several speed indexes, and fixes every "View on congress.gov" link in the database.

If the second file reports that `bill_workspace_items` doesn't exist, run
`supabase/add-bill-workspace-table.sql` first, then the second file again.

## 4. Check one setting in Vercel

Vercel → your project → **Settings → Environment Variables**. Make sure
`NEXT_PUBLIC_APP_URL` exists and is set to your site's address, for example
`https://bill-tracker.vercel.app`. Alert emails use it for their links. If you add or change it,
go to **Deployments**, open the **…** menu on the latest deployment, and click **Redeploy**.

## Check that it worked

1. In the app, open **Data sources** (bottom of the sidebar) and click **Test all connections**.
   Every item should be green. Anything amber or red comes with the exact fix.
2. To run the morning check right away instead of waiting until tomorrow, visit
   `https://YOUR-SITE/api/cron/poll?secret=YOUR_CRON_SECRET`. A healthy run ends with
   `"timedOut": false` and `"failed": 0`.
3. On the dashboard, click **Check now** in Discover. You'll get a line per topic saying how many
   bills it found and how many were new.

## What to expect the first morning

- The first check re-reads every tracked bill's full history, so some bills will show a
  different (correct) stage. These corrections are silent: nobody gets an email for them.
- Bills that moved overnight produce one summary email per person, not one email per change.
