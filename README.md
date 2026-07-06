# Lead Pipeline

A scored, filterable list of outreach prospects for freelance web design work —
local small businesses (Google Places) and literary/creative publishers
(directory scrapes). **Discovery and scoring only.** This tool never sends
anything; outreach stays manual and personalized.

## How it works

1. **Scrape** — pull candidate leads from Google Places (local businesses) or a
   directory recipe (literary publishers).
2. **Enrich** — for each lead with a website, check for a public email and score
   how much their current site looks like it needs a rebuild (no SSL, no mobile
   viewport, page builder like Wix/Squarespace, stale copyright year, slow
   response). Leads with no website at all get a high default score, since
   "doesn't have a site" is itself a strong opportunity.
3. **Review** — from the dashboard (works fine from a phone), filter by status/
   source/score, and edit status/notes as you work leads.

Both scrape and enrich can be kicked off from the dashboard itself (as
background jobs you can poll), so the whole thing works from a phone without
needing to SSH in or run a local CLI. `cli.js` is kept around as a local-dev
convenience for the same operations.

## Local setup

```bash
npm install
cp .env.example .env      # fill in a real password + secret, see below
docker compose up -d      # local Postgres on :5432
npm start                 # http://localhost:3000
```

If you don't want to run Docker, `railway run npm start` (after `railway link`)
borrows the environment variables from your Railway project, including the real
`DATABASE_URL` — no local Postgres needed at all.

`GOOGLE_PLACES_API_KEY` is only needed for the Google Places scrape; everything
else works without it.

## Usage

**Dashboard** (`/`, behind the login page): filter leads, edit status/notes
inline, and trigger scrape/enrich runs from the "Run a scrape" panel. Each run
becomes a job you can watch finish without leaving the page.

**CLI** (local dev only):
```bash
node cli.js scrape-local --query bakery --city "Providence, RI"
node cli.js scrape-directory --recipe clmp
node cli.js enrich --limit 50
```

## Testing

```bash
npm test
```

Runs `siteAnalyzer`'s scoring logic (pure function, table-driven cases) and an
integration test of `db.js`'s upsert/dedup logic. The DB test runs against
[pg-mem](https://github.com/oguimbal/pg-mem), an in-memory Postgres emulator —
no real database needed to run the suite.

## Directory recipes

`scrapers/recipes/` holds one module per literary directory source. Each
exports `scrape({ fetchPage })` returning raw `{ name, site_url?, city?,
category? }` entries; `directoryScraper.js` handles dedup-key hashing and
403/blocked detection so recipes don't have to.

Current recipes (all verified against the live sites):

- **`clmp`** — scrapes the Community of Literary Magazines and Presses
  directory. Only the first ~24 unfiltered results are available without a
  browser (the rest load through a nonce-gated FacetWP AJAX endpoint); each of
  those 24 gets its profile page fetched for its real website/category/city.
- **`poets-writers`** — Poets & Writers' small press directory. Plain
  `?page=N` pagination; defaults to the first 2 pages (~50 presses) per run to
  keep each scrape to a reviewable batch — bump `MAX_PAGES` in the recipe file
  for a bigger pull.
- **`small-press-distribution`** — spdbooks.org is not scrapable with a plain
  HTTP fetch (curl gets a flat 403 from its edge/WAF; Node's fetch sometimes
  gets a 200 but it's a JS-only consent-manager shell with no real content
  either way). This recipe detects that and reports itself blocked rather than
  faking working selectors. Getting real data out of this source would require
  a headless browser working through the consent flow, which is out of scope
  (see "what this deliberately doesn't do" below).

To add a new source, drop a module in `scrapers/recipes/` following the same
contract and register it in `scrapers/directoryScraper.js`.

## Deployed

Live at **https://lead-scraper-production-58d0.up.railway.app** — bookmark it
on your phone. Deployed via Railway CLI, redeploys automatically on every push
to `main` (the app service is linked to the GitHub repo).

Project layout on Railway: a `Postgres` service and a `lead-scraper` service in
one project, both in the `production` environment.

### Redeploying / changing config

```bash
railway variable set KEY=value --service lead-scraper   # triggers a redeploy
railway redeploy --service lead-scraper --from-source -y # force a fresh deploy
railway logs --service lead-scraper --deployment --latest --lines 100
```

### Doing this from scratch on a new project

1. Push the repo to GitHub.
2. `railway login` (use `--browserless` — it prints a device-code link instead
   of trying to open a local browser, which is the more verifiable flow,
   especially if a CLI agent is driving this).
3. `railway init` to create the project, `railway add --database postgres` for
   the DB, `railway add --repo <owner>/<repo> --branch main --service <name>`
   to link the app to GitHub.

   None of the CLI commands above actually get push-to-deploy working by
   themselves -- confirmed by pushing after each one and watching nothing
   happen. Three separate things all had to be true, and the service
   settings page (Source section) told the real story each time:
   - The **Railway GitHub App** has to be installed on the GitHub account
     with access to the repo (`github.com/apps/railway-app` → Install →
     "Only select repositories"). Without it, the service settings page
     just shows "GitHub Repo not found" no matter what the CLI reports.
     Check `github.com/settings/installations` if unsure whether it's there.
   - After installing the app, the repo has to be **re-picked** from the
     Source Repo field in the service's Settings tab (the pencil icon) --
     the CLI-set reference doesn't retroactively pick up the new app grant.
   - Even with a valid repo connection, the branch section can still say
     **"Auto deploy is disabled"** with its own separate toggle. This is the
     one that actually gates whether a push triggers a build.
   `railway service source connect` (CLI) is a fine substitute for the second
   step, but there's no CLI equivalent found for the auto-deploy toggle --
   that one needs the dashboard.
4. Set env vars on the app service:
   - `DATABASE_URL=${{Postgres.DATABASE_URL}}` — references the Postgres
     service's connection string directly, no copy-pasting a value that'll go
     stale.
   - `GOOGLE_PLACES_API_KEY`, `DASHBOARD_PASSWORD`, `SESSION_SECRET` (generate
     with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   - **`PORT=3000`, set explicitly.** Railway assigns its own port dynamically
     per deploy if you don't pin one — found this the hard way on the first
     deploy here: the app bound to whatever Railway assigned (`:8080`), but
     the domain created via `railway domain --port 3000` was routing to a
     different port, so every request 502'd until `PORT` was pinned and the
     service redeployed.
5. `railway redeploy --service <name> --from-source -y`, then
   `railway domain --service <name> --port 3000` to get a public URL.

No data migration needed: the schema is created automatically on boot
(`db.migrate()`), and there's no prior production data to carry over.

## Design decisions (why, not just what)

- **Postgres over SQLite** — Railway's managed Postgres is a one-click addon
  with auto-injected `DATABASE_URL`; a SQLite file would need a persistent
  volume mounted by hand plus a native-module compile step. Postgres is the
  less fiddly option on this specific host.
- **Railway over Render/Fly.io** — Render's free tier sleeps after 15 min
  idle (bad for "check from mobile after a few hours away"); Fly.io dropped
  free compute and needs more manual config. Railway has no forced sleep,
  one-click Postgres, and zero-Dockerfile GitHub deploys.
- **Signed cookie over HTTP Basic auth** — Basic auth's browser-native prompt
  is clunky on mobile Safari and has no real logout. `auth.js` does a small
  login page instead: `DASHBOARD_PASSWORD` compared with
  `crypto.timingSafeEqual`, then an HMAC-signed, HttpOnly, Secure cookie good
  for 30 days.
- **No scraper evasion** — 403s, WAF blocks, and JS-only consent shells are
  reported as blocked and skipped, never worked around with header spoofing,
  proxy rotation, or a headless browser. This holds even where it costs real
  data (see the SPD recipe above).

## What this deliberately doesn't do

- No "send email" button, and never will — personalization matters for this
  kind of outreach and it's a deliberate scope boundary, not a missing feature.
- No login-bypass or behind-auth-wall scraping — public pages only.
- No anti-bot evasion (header spoofing, proxy rotation, solving consent/CAPTCHA
  challenges) — a source that blocks plain HTTP requests is treated as
  unavailable, not as a puzzle to get around.

