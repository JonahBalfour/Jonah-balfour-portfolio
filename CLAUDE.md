# jonahbalfour.com

## Purpose

This repo is the single source of truth for **jonahbalfour.com** — Jonah's
personal site. It hosts three things under one GitHub Pages deployment:

- Writing portfolio (root `index.html`)
- Blog (`blog/`)
- "Claude Projects" — a showcase of side projects built with Claude,
  currently **Nefesh** (a board game prototype) and the **Job Search
  Dashboard**

## Deployment

- Repo: `JonahBalfour/Jonah-balfour-portfolio`, branch `main`
- GitHub Pages, custom domain via `CNAME` → `jonahbalfour.com`
- Any push to `main` deploys live automatically — there is no build step,
  no CI. What's committed is what's served.

## Site structure

```
/
├── index.html            portfolio home (nav: Writing / Blog / Claude Projects / Contact)
├── style.css, app.js
├── blog/
│   ├── index.html
│   └── posts/
└── projects/
    ├── index.html         hub page, links to dashboard + game
    ├── dashboard/
    │   ├── index.html     Job Search Dashboard — EDIT DIRECTLY HERE (see below)
    │   └── firestore.rules
    └── game/
        ├── index.html     Nefesh — synced copy, do NOT edit directly (see below)
        ├── manifest.json
        ├── sw.js
        ├── icons/
        └── sounds/
```

Live URLs:
- `https://jonahbalfour.com/`
- `https://jonahbalfour.com/projects/index.html` (hub)
- `https://jonahbalfour.com/projects/dashboard/`
- `https://jonahbalfour.com/projects/game/`

## Where each project is actually developed

**Job Search Dashboard** — developed **directly in this repo** at
`projects/dashboard/index.html`. It's a single self-contained HTML file
(Firebase Auth + Firestore, no build step), so there's no separate source
to keep in sync — this file *is* the project. The local folder
`Job Search Dashboard/` (outside this repo) still holds personal,
non-code material — CV, application tracking notes, leads — and is not
part of the site.

- Firebase project: `jobs-dashboard-ecfd7`
- The `apiKey` embedded in `index.html` is expected to be public (normal
  for Firebase web apps); real access control is via `firestore.rules`,
  not by hiding the key.
- If Firebase config, security rules, or the Firebase project itself ever
  change, update `firestore.rules` here too and re-publish rules in the
  Firebase console.
- `jonahbalfour.com` must be in Firebase's **Authorized domains**
  (Authentication → Settings → Authorized domains) or Google sign-in
  breaks on this deployment.

**Nefesh** — developed in its own separate Claude Code project/repo
(`JonahBalfour/nefesh`), which also contains dev-only tooling (MCTS
scripts, rule sweeps, simulators, design spec) that has no reason to be
copied here. `projects/game/` in this repo holds only the deployable
subset. Do not hand-edit files in `projects/game/` — changes will be lost
next sync. Make changes in the `nefesh` repo, then sync.

### Syncing Nefesh into this repo

From the `nefesh` repo, after changes are ready to publish:

1. Copy only these into this repo's `projects/game/`, overwriting what's there:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - `icons/` (full folder)
   - `sounds/` (full folder)
2. Do **not** copy the dev/analysis scripts (`nefesh-mcts*.js`,
   `nefesh-rule-sweep*.js`, `nefesh-sim.js`, `nefesh-spec.md`, etc.) —
   they're not part of the playable build.
3. Check `index.html`, `manifest.json`, and `sw.js` for any newly
   introduced **absolute** paths (`/icons/...`, `/sounds/...`,
   `href="/..."`) — since the game now lives at `/projects/game/` instead
   of repo root, absolute paths will 404. Relative paths (`./icons/...`,
   `icons/...`) are required.
4. Bump `sw.js`'s `CACHE_NAME` if `index.html` changed meaningfully, so
   returning visitors don't get served a stale cached copy.
5. Test locally (see below) before committing.
6. Commit and push to `main` in this repo. The old `nefesh` GitHub Pages
   deployment (if any) and repo are left alone — this repo is now the
   live copy.

## Testing changes locally before pushing

Serve the repo root with a static file server and click through all three
areas (portfolio nav, blog, `projects/index.html`, and both sub-projects
at their nested paths) — nested paths are exactly where absolute-path
bugs show up that don't show up when testing a project standalone at its
own repo root.

```bash
npx --yes serve -l 8123 .
```

Then visit `http://localhost:8123/`, `http://localhost:8123/projects/index.html`,
`http://localhost:8123/projects/dashboard/`, and `http://localhost:8123/projects/game/`.

A `.claude/launch.json` in this repo is already configured to do this via
the Claude Code browser preview (`static-preview`).

## Admin tool (`admin/`)

A hand-rolled, git-backed blog admin at `admin/` lets Jonah write, edit,
and delete blog posts from a browser instead of hand-editing HTML.

- Unlisted (not in any nav) but **publicly reachable** at
  `jonahbalfour.com/admin/` — it carries no secrets of its own and does
  nothing without a token.
- Auth: paste a GitHub **fine-grained personal access token** (scoped to
  this repo only, Contents read/write, 90-day expiration recommended).
  It's stored only in that browser's `localStorage` and used solely for
  direct browser → `api.github.com` calls — never committed, never sent
  anywhere else.
- Publishing/editing/deleting a post = real commits straight to `main`
  via the GitHub Contents API (new post: media → post file → index
  update; edit/delete follow the same pattern). No server, no build step
  — consistent with the rest of this repo.
- No external JS library — the rich-text editor is hand-rolled
  (`contenteditable` + `document.execCommand`) to keep the site's
  zero-dependency pattern intact.
- **Residual risk, by design, not oversight**: anyone with access to that
  browser session/profile (shared or compromised machine, devtools, a
  malicious extension) could read the token and publish/edit/delete until
  it's revoked. Security rests on URL obscurity plus a narrowly-scoped,
  time-limited PAT, revocable anytime at
  `github.com/settings/tokens?type=beta`. There's no undo beyond a manual
  follow-up edit/delete — same "what's committed is what's served"
  model as everything else in this repo.
- v1 has no image resize/compression (GitHub's Contents API caps files at
  ~1MB) and no atomic multi-file commits (sequential PUTs, chosen for
  simplicity over Git Data API atomicity — see partial-failure handling
  in the tool's status log / retry buttons).

## Decisions on record

- Dashboard and game are kept as **static output only** in this repo, not
  full source (except the dashboard, which now lives here as its actual
  source — see above). Nefesh's full source stays in its own repo.
- "Claude Projects" nav uses a **hub page** (`projects/index.html`)
  rather than a dropdown, so more projects can be added later without a
  nav redesign.
- The old `job-search-dashboard` and `nefesh` GitHub repos and their Pages
  deployments are **left live** as a safety net / in case of external
  links. Not archived or deleted. Revisit once this merged site has been
  live and stable for a while.

## Outstanding

- [ ] Confirm `jonahbalfour.com` is added to Firebase Authorized domains
      for project `jobs-dashboard-ecfd7` (see above) — sign-in was
      verified to load the page correctly but full OAuth sign-in should
      be tested by hand.
- [ ] Decide, at some point, whether to archive/disable the old
      `job-search-dashboard` and `nefesh` repos once this site has proven
      stable.
