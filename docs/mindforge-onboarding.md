# Mindforge — Onboarding Doc

*This is a durable reference doc, not a session log. It describes the app,
the architecture, and how Stan likes to work — intended to stay accurate
across many future sessions. (For "what happened last time" / current
in-flight state, see the separate session handover doc instead.)*

---

## What Mindforge is

Mindforge is a vanilla JavaScript flashcard / spaced-repetition Progressive
Web App. Stan is the sole developer. The app is feature-complete and in an
iteration/polish phase — mobile support, PWA capabilities, code quality,
and now a backend migration.

**Goals, in order of how they shape decisions:**

- Cross-platform: browser (installed PWA), Android (planned), desktop (via
  Tauri, planned).
- Data portability: whatever storage backend is active, the same data
  should be usable across platforms eventually (this is the driving reason
  behind the ongoing D1/Tauri work).
- Clean architecture over cleverness — Stan explicitly values
  maintainability and being able to reason about the code later, more than
  terseness or cleverness.
- The app should always retain a **pure IndexedDB, browser-only mode** —
  even after a D1 backend and/or Tauri exist. Never assume a backend is
  required.

Stan also maintains a separate Electron app, **Scriptum**, and has explored
Tauri as a shared migration target for both.

---

## Tech stack

- Vanilla HTML/CSS/JS — no framework, no build step.
- IndexedDB for local storage (currently mid-migration from a single
  monolithic blob to normalized per-entity object stores — see
  "Architecture" below).
- JSZip for backup compression.
- Cloudflare Pages for hosting (`https://mindforge-9ai.pages.dev`),
  deployed manually.
- GitHub for version control, managed via GitHub Desktop (not raw git CLI
  for commits — Stan uses Emacs + bash for editing, GitHub Desktop for the
  actual commit/push).

**Where things are heading:**

- **Cloudflare D1** (SQLite-based) as an optional networked backend, via a
  plain-JavaScript Cloudflare Worker/Pages Function (no Rust needed for
  this layer — Workers run JS natively).
- **R2** for image storage (not D1 — D1 has row-size/pricing
  characteristics that make it unsuitable for binary blobs).
- **Tauri** as a planned desktop-shell migration (both for Mindforge and,
  separately, Scriptum away from Electron), specifically using a **native
  SQLite file via Rust** rather than the WebView's IndexedDB — the
  deliberate reason is that only a real on-disk file is outside the
  browser's storage-clearing jurisdiction (Stan's primary motivation: local
  data shouldn't be at risk from a user clearing browser site
  data/cookies).
- Planned sequence: finish current issue backlog → Tauri migration (keeping
  PWA/browser mode alive) → D1 backend for true cross-device sync.

---

## Architecture

### File structure

```
index.html, manifest.json, sw.js          (root)
css/base.css, css/mobile.css
css/themes/dark.css | light.css | matrix.css
js/app.js                — orchestrator, calls init() on everything else, last to load
js/config.js              — APP_CONFIG constants, loads FIRST
js/utils.js                — pure helper functions (dates, scheduling algorithm, escaping), loads SECOND
js/indexedDB-manager.js   — generic IndexedDB key-value engine (store-name-agnostic)
js/storage-adapter.js     — IndexedDBAdapter: entity-type-aware contract on top of indexedDB-manager
js/data-manager.js         — business logic; DataManager is the single source of truth for app state
js/router.js                — hash-based routing
js/ui-manager.js            — screen/modal rendering
js/card-manager.js          — card CRUD UI logic
js/category-manager.js     — category/deck CRUD UI logic
js/study-manager.js         — study session flow
js/service-worker-register.js
include/jszip.min.js
icons/
```

**Script load order in `index.html` is dependency-ordered, not
alphabetical** (this was itself a past bug — Issue 9): config → utils →
vendor (jszip) → storage (indexedDB-manager → storage-adapter →
data-manager) → routing/UI (router → ui-manager) → feature managers
(card-manager → category-manager → study-manager) → service-worker-register
→ app.js last.

### Data model (in transition)

**Legacy / still primary today:** `DataManager.data` is one big in-memory tree:

```
{ settings, categories: [{ id, name, decks: [{ id, name, cards: [{...}] }] }], statistics: {...} }
```

This entire tree is read/written by every UI manager directly
(`ui-manager.js`, `card-manager.js`, `category-manager.js`,
`study-manager.js` all touch `dataManager.getCategories()` and walk the
nested tree). `saveData()` persists this whole tree as one JSON blob under
`appData/main` in IndexedDB on every single mutation.

**New / being built out (Issue 7):** Normalized per-entity IndexedDB object
stores — `categories`, `decks`, `cards`, `statistics` — keyed by `id`, with
indexes on `categoryId` (decks) and `deckId` (cards). Accessed only through
`js/storage-adapter.js`'s `IndexedDBAdapter`, which exposes a
storage-agnostic contract:

```
getEntity(type, id)
listEntities(type, query?)   // query: { categoryId } or { deckId }
putEntity(type, entity)      // auto-stamps updatedAt
deleteEntity(type, id)
getStatistics() / putStatistics(stats)
```

**Currently, both layers are kept in sync via dual-write**: every mutation
in `data-manager.js` updates the legacy tree/blob (still the actual source
of truth read by the UI) *and* fire-and-forget syncs the changed entity to
the normalized store. The normalized store is not yet actually read by
anything in production — it exists so it's continuously correct and ready
for a future cutover (e.g. a `SyncedAdapter` for D1, or a `TauriAdapter`
for local SQLite) without another big migration.

**Why this matters for future work:** any new mutation method added to
`DataManager` should follow the same dual-write pattern (call the existing
`_syncEntity`/`_syncStatistics`/`_deleteEntitySync` helpers) — this keeps
the normalized store from silently going stale again, which already
happened once (Issue 7 Chunk 2 → 4a gap) and had to be caught and fixed.

### Cross-tab sync

Uses `BroadcastChannel('mindforge-data-sync')` — every `saveData()` posts a
`{ type: 'data-changed' }` message; every *other* open tab reloads from
IndexedDB and re-renders on receipt. A `visibilitychange` listener also
forces a refresh when a tab regains focus, since browsers throttle
background-tab message handling (can delay delivery by over a minute in a
hidden tab — this is normal browser behavior, not a bug to chase).

### PWA / service worker

`sw.js` precaches a fixed asset list (`ASSETS_TO_CACHE`) at install time
and serves cache-first at runtime — this is specifically because Mindforge
is an installable PWA, which makes two promises an ordinary website
doesn't: (1) full offline functionality from first visit, even for
screens/assets never yet touched, and (2) atomic versioning, so a user
never runs a mixed old/new asset set mid-update. The fetch handler
explicitly skips non-GET requests (required — `cache.put()` throws on
non-GET) and any `/api/*` path (reserved for the future backend, always
network-only).

**`CACHE_VERSION` (sw.js) and `APP_VERSION` (config.js) are intentionally
decoupled.** Bump `CACHE_VERSION` — a plain incrementing counter,
e.g. `mindforge-cache-12` — on literally every edit to any cached file, no
exceptions and no judgment calls; this is what makes the service worker
actually pick up new code. Bump `APP_VERSION` (a real semantic-ish version
shown in the UI) only when Stan decides something is milestone-worthy.

Any new file added to the project needs to be added to `ASSETS_TO_CACHE` in
`sw.js`, or it silently won't be available offline.

### Spaced repetition algorithm

Lives in `calculateNextReview()` (`utils.js`). Ratings 1–4
("Nope!"/"Getting there"/"Almost"/"Perfect") drive interval and ease-factor
growth for graduated cards. **`MAX_INTERVAL` (config.js) caps how far in
the future a card can ever be scheduled** — added after a real bug where
uncapped multiplicative growth on repeatedly-rated cards overflowed `Date`
math into `NaN`. Any future change to this algorithm should preserve that
cap.

`getCardsForStudySession()` (`utils.js`) builds each session with an
intentional, fixed prioritization: overdue cards first (up to 40% of
session size), then new cards (also capped at 40%, regardless of how many
exist — this is deliberate, to avoid overwhelming a large unstudied/reset
deck with new material all at once), then due-today, then future cards as
filler. This means a session can come in **under** the configured
`cardsPerSession` if there isn't enough inventory in the due/overdue
buckets yet — that's correct behavior, not a bug, and is most visible right
after a bulk reset or on a young deck.

---

## How Stan likes to work

- **One file at a time.** Changes are presented as explicit before/after
  code blocks, applied, and tested before moving to the next file or the
  next chunk.
- **Never guess at file contents.** Always ask for (or re-view) the current
  version of a file before drafting an edit against it — especially for
  files that have been edited more than once in a session. Stale
  assumptions about file state caused real breakage more than once; asking
  first is cheap, guessing wrong is expensive.
- **No inline JavaScript in HTML files.**
- **No raw logic in initialization methods** — logic belongs in named
  functions/methods, not inlined into `init()`-style entry points.
- **Incremental validation.** Every change ships with a concrete test
  procedure (often console snippets) run before moving on — see "Testing"
  below.
- **Issues are tracked and worked through systematically**, numbered, one
  at a time, in an agreed phase order — not opportunistically jumped around
  unless Stan explicitly redirects.
- **Prefers `this.methodName()` over `window.theApp.methodName()`** for
  internal references within a manager class.
- **For large/risky rewrites of a single file** (e.g. a file that's had
  several sequential diffs applied and is getting risky to keep patching
  incrementally), prefer delivering a complete replacement file over
  another chain of diffs — this was adopted mid-project after diff-based
  edits caused two real breakages in `data-manager.js`.
- **Wants to understand *why*, not just *what*** — Stan regularly asks for
  the reasoning behind a bug or a design choice (e.g. "what does
  MAX_INTERVAL actually do") and engages with genuine curiosity;
  explanations should be concrete and traceable to the actual code, not
  hand-wavy.
- **Catches things independently and should be taken seriously when he
  does** — e.g. correctly spotting the 73/69≈4 arithmetic coincidence that
  explained a scheduling mystery. Verify his hypotheses with real data
  rather than dismissing or rubber-stamping them.

---

## Testing & environment notes

- **Local dev:** `http-server -p 8443 -S -C localhost.pem -K
  localhost-key.pem` (Windows PowerShell) from `G:\mindforge\src`; also
  tested against `localhost:3000` in some sessions. WSL network isolation
  prevents Python-based servers from being reachable by the Windows browser
  — always use Windows PowerShell directly for the dev server.
- **Browser:** Vivaldi (Chromium-based) primarily.
- **Service worker caching is the single biggest source of false debugging
  leads.** Before concluding any code change "isn't working," check: is
  `CACHE_VERSION` actually bumped? Is "Bypass for network" checked in
  DevTools (note: this only applies while DevTools is open, not
  persistently)? Is the tab being tested actually a *fresh* tab opened
  after the change (any tab left open across an edit is running stale JS,
  independent of caching entirely)?
- **`node --check <file>.js`** is the fastest way to confirm a hand-applied
  edit didn't break syntax, before even reloading the browser.
- **When behavior seems wrong, inspect the live function before assuming
  the logic is wrong:** `window.someManager.someMethod.toString()` in the
  console shows exactly what code is actually running — this has repeatedly
  distinguished "real bug" from "stale cache" faster than any other single
  check.
- **Multi-tab / cross-tab testing:** always use genuinely fresh tabs (not
  ones left open from earlier), and remember background/unfocused tabs are
  throttled by the browser — delayed sync behavior in a backgrounded tab is
  expected, not necessarily a bug.
- **Destructive test actions** (`window.DEBUG.clearData()`, full-collection
  resets, etc.) should always be preceded by a fresh backup (hamburger menu
  → Create Backup) and explicitly flagged as destructive before running.
- Common useful console diagnostics: direct IndexedDB reads (bypassing the
  in-memory cache) to isolate "did it save" vs. "did it load correctly";
  cross-checking normalized-store counts against the live in-memory tree;
  checking `caches.keys()` and `navigator.serviceWorker.getRegistrations()`
  to confirm two tabs are actually running identical cached code before
  trusting a comparative test between them.

---

## What a good issue looks like

Stan wants issues written so they can be copy-pasted directly into
GitHub. Standard shape:

```
### [Short, specific title]

**Labels:** [bug | enhancement | refactor | architecture | ...], [severity/area labels as relevant]
**Files:** [exact file paths expected to change]

**Description**
What's wrong or missing, concretely — cite the actual function/line/behavior,
not a vague symptom. If it's a bug, explain the mechanism (why it happens),
not just what's observed.

**Proposed fix**
Specific enough to implement from — name the functions/methods that change,
the general approach, and any explicit tradeoffs or decisions being made
(e.g. "chose 365 days as a default cap, tune as needed").

**Validation tests**
Numbered, concrete, runnable — console snippets where applicable, exact
UI steps where not. Should cover: the direct fix, at least one regression
check against unrelated functionality, and (for data-affecting changes)
a check that existing data survives correctly.
```

When implementing an issue, the working pattern is: confirm current file
state → present before/after snippets (or a complete replacement file for
high-risk files) → give validation tests → wait for confirmation before
moving to the next chunk or issue. Larger issues get explicitly broken into
numbered chunks (e.g. "Chunk 3 of 6") agreed up front, rather than
delivered as one large diff.

Commit messages, when requested, follow a similar shape: one-line summary
naming the issue number(s) closed, then a paragraph per issue explaining
root cause and fix (not just "fixed X"), then a file list.
