# Pace Budget

A private, shared-password budgeting app for Matt & Allie. Built on Cloudflare
Pages (frontend + API) and D1 (SQLite). Code lives in GitHub; Cloudflare
auto-deploys on every push.

## Stack

- **Frontend:** React + Vite + Tailwind (single-page app)
- **API:** Cloudflare Pages Functions (TypeScript)
- **Database:** Cloudflare D1 (SQLite)
- **Auth:** Shared family password → HMAC-signed cookie (30 day session)
- **Deploy:** Push to GitHub `main` → Cloudflare Pages auto-builds and deploys

## Project layout

```
.
├── src/                  # React frontend (Vite)
│   ├── pages/            # Top-level pages (Login, Home, ...)
│   ├── components/       # Shared UI components
│   └── lib/              # Client-side helpers
├── functions/            # Cloudflare Pages Functions (the API)
│   ├── _middleware.ts    # Auth guard for /api/*
│   ├── lib/              # Server-side helpers
│   └── api/              # Each file = one API route
├── schema/
│   └── migrations/       # D1 migrations (numbered SQL files)
├── wrangler.toml         # Cloudflare config (D1 binding, build output)
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

## First-time setup

You'll do this once. Most of it is one-time clicking; the only command-line
step is creating the D1 database with `wrangler`.

### 1. Install Node.js

Download the **LTS** installer from <https://nodejs.org> and run it. This gives
you `node` and `npm`. To verify, open Terminal and run:

```bash
node --version
npm --version
```

### 2. Install dependencies

In Terminal, from this folder:

```bash
npm install
```

This installs React, Vite, Tailwind, Wrangler, etc.

### 3. Create the GitHub repo

In GitHub Desktop → File → Add Local Repository → select this folder → it'll
ask you to publish. Publish as **`pace-budget`** (public, since you confirmed
that's fine — sensitive data is `.gitignore`d).

### 4. Create the D1 database

In Terminal:

```bash
npx wrangler login          # one-time browser auth with Cloudflare
npx wrangler d1 create pace-budget
```

The second command prints a `database_id`. Copy it and paste it into
`wrangler.toml`, replacing `REPLACE_AFTER_CREATING_DB`.

Then run the schema migration:

```bash
npx wrangler d1 migrations apply pace-budget --remote
```

This creates all the tables and seeds the categories from your current budget.

### 5. Connect Cloudflare Pages to GitHub

1. <https://dash.cloudflare.com> → Workers & Pages → Create → Pages → Connect to Git
2. Select the `pace-budget` repo.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Save and deploy.

### 6. Bind D1 to Pages

In the Pages project → Settings → Functions → D1 database bindings:

- **Variable name:** `DB`
- **D1 database:** `pace-budget`

### 7. Set environment variables

In the Pages project → Settings → Environment variables, add (for Production):

- `APP_PASSWORD` — the shared password you and Allie will use. Mark as
  **Encrypted** (secret).
- `SESSION_SECRET` — a long random string. Mark as **Encrypted**. Generate
  one with: `openssl rand -hex 32` (or any password manager).

After saving, redeploy (Pages → Deployments → Retry deployment) so the
functions pick up the new env vars.

### 8. Test

Visit your `*.pages.dev` URL. You should see the login screen. Enter the
`APP_PASSWORD`. If the home page shows `db: "connected"`, Phase 1 is done.

## Local development

```bash
# One terminal: Vite frontend
npm run dev

# Another terminal: Wrangler with local D1
npx wrangler pages dev -- npm run dev
```

For purely local work, run the D1 migration against the local DB:

```bash
npx wrangler d1 migrations apply pace-budget --local
```

You'll also need a `.dev.vars` file (gitignored) with:

```
APP_PASSWORD=whatever-you-want-locally
SESSION_SECRET=any-long-random-string-for-local-dev
```

## Phases

Phase 1 — Scaffold project and deploy hello-world ← **you are here**
Phase 2 — Budget setup screen
Phase 3 — CSV upload + parser for main checking
Phase 4 — Transaction list + manual categorization
Phase 5 — Auto-categorize learning + transfer detection
Phase 6 — Scoreboard + savings balance
Phase 7 — Misc Income buckets
Phase 8 — Chase Reserve + Chase Amazon parsers
Phase 9 — Mobile polish + historical view

## Notes

- **Public repo:** the code is fine to be public. Never commit bank CSVs, the
  `.dev.vars` file, or any file containing real money amounts as data. The
  `.gitignore` blocks `*.csv` and `.env*` by default.
- **The reference Pace Budget.csv and AccountHistory CSV in this folder are
  gitignored.** They stay local for our reference but won't be pushed to GitHub.
