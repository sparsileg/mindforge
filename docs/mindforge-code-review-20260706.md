# Mindforge Code Review — Issues & Implementation Plan

*Review of v2.0.2 source. Scope: bugs, data integrity, UI efficiency,
architecture, and D1 migration readiness.*

---

## Summary

The codebase is clean, disciplined, and feature-complete, but has one
critical data-integrity flaw and one architectural disconnect that must
both be resolved **before** the D1 migration.

**Critical:** HTML escaping is applied at *storage* time instead of
*render* time. This causes progressive double-escaping every time a card is
edited (`&` → `&amp;` → `&amp;amp;`), visible corruption of card fronts
during study, an XSS hole via CSV import and category rename (which don't
escape at all, while other paths do), and broken duplicate-name checks. Any
cards containing `&`, `<`, or `>` that have been edited are already
corrupted in storage. The fix is a single principle applied consistently —
store raw, escape at render — plus a one-time repair pass over existing
data.

**Architectural:** All app data is stored as a single monolithic JSON blob
in IndexedDB. Every card rating rewrites the entire dataset, cross-tab
conflicts are last-writer-wins on everything, and the shape is the opposite
of what a relational D1 backend needs. Normalizing into per-entity stores
(categories, decks, cards) behind a `StorageAdapter` interface is the key
refactor that makes the D1 backend, the IndexedDB-only mode, and future
Android/Tauri modes all share one contract.

**Definite bugs found:** blank screen after deleting a category
(`'welcome'` vs `'welcome-screen'`), UTC/local timezone mismatch in the
study scheduler (cards misclassified as overdue after ~7–8pm Eastern),
`app.js` wiping the `window.DEBUG` namespace built by earlier files, a
deep-link startup race that can crash the app before data loads, and a
service worker that will break non-GET requests the moment a backend API
exists.

**On the D1 question:** Rust is **not** required. Cloudflare Workers (the
compute layer in front of D1) is natively JavaScript. The recommended stack
is Pages (existing) + a plain-JS Worker/Pages Function exposing a small
REST API with D1 bindings + R2 for image blobs (D1 is unsuitable for binary
data). Rust via `workers-rs` is possible but buys nothing here; the Rust
association likely comes from Tauri, which is the desktop-shell question,
orthogonal to the backend. Keeping the Worker in JS allows sharing
validation and spaced-repetition logic between client and server. A
web-accessible backend requires authentication (Cloudflare Access is the
lowest-effort option for a personal app).

**Recommended dual-mode architecture:**

```
DataManager (business logic, unchanged API)
       │
StorageAdapter interface
   ├── IndexedDBAdapter   (normalized entity stores — standalone/offline mode)
   └── SyncedAdapter      (IndexedDB as local cache + background sync to Worker/D1)
```

Offline-first: reads and writes always hit IndexedDB immediately; a sync
layer exchanges per-entity deltas (via `updatedAt` timestamps) with the
Worker when online.

---

## GitHub Issues

Each issue below is self-contained for copy/paste. Implementation will
follow the standard process: one file at a time, before/after snapshots,
validation test after each chunk.

---

### Issue 1 — Data corruption: HTML escaping applied at storage time instead of render time

**Labels:** `bug`, `critical`, `data-integrity`, `security` **Files:**
`js/card-manager.js`, `js/category-manager.js`, `js/data-manager.js`,
`js/ui-manager.js`, `js/utils.js`

**Description**

Text is HTML-escaped when stored (`addCategory`, `handleAddCard`,
`handleEditCard`, `handleRenameDeck`) rather than when rendered. This
causes four related defects:

1. **Progressive double-escaping.** `editCard()` populates the edit form
   with the stored (escaped) value; `textarea.value` does not decode
   entities, so saving re-escapes: `Salt & Pepper` → `Salt &amp; Pepper` →
   `Salt &amp;amp; Pepper`. Every edit adds a layer.
2. **Visible corruption during study.** `displayCurrentCard()` renders the
   card front via `textContent`, which displays stored entities literally
   (`&amp;` appears on screen). The back, rendered via `innerHTML`, decodes
   correctly — the same data displays inconsistently.
3. **XSS via unescaped paths.** `handleImportDeck` (CSV) and
   `handleEditCategory` store raw text, while other paths escape. Since
   names and card content are rendered with `innerHTML`, imported or
   renamed content containing `<img src=x onerror=...>` executes. Becomes a
   genuine vulnerability once the app is web-accessible.
4. **Broken duplicate checks.** `handleAddCategory` compares raw input
   against stored escaped names, so `A&B` is not detected as a duplicate of
   stored `A&amp;B`.

**Proposed fix**

- Remove all `escapeHtml()` calls from storage paths (`addCategory` in
  data-manager, `handleAddCard`/`handleEditCard` in card-manager,
  `handleRenameDeck` in category-manager).
- Apply `escapeHtml()` at every point where user text is interpolated into
  `innerHTML`: `renderCategories`, `renderDecks`, `renderHomeOverview`,
  preview cards in `loadPreviewBatch`, delete-confirmation messages,
  `showDeckIdInfo`, `showRenameDeckModal` (input value attribute), and
  inside `parseSimpleMarkdown` (escape first, then apply bold markup).
- Add a one-time data repair routine that unescapes stored text, looping
  until stable to unwind multi-layer escaping, gated by a settings flag so
  it runs once.

**Validation tests**

1. Create a card with front `Salt & Pepper <test>` and back `**bold** &
   "quotes"`. Study it: front displays exactly as typed; back shows bold
   formatting with `&` and quotes intact.
2. Edit that card three times without changing text, saving each
   time. Export the data and confirm the stored value is the raw original
   with no `&amp;` layering.
3. Import a CSV containing `"<img src=x onerror=alert(1)>","test"`. Open
   preview: the literal text displays; no alert fires.
4. Rename a category to `A & B <script>`. Sidebar shows the literal text;
   no script executes.
5. Create category `A&B`; attempt to create a second `A&B` — duplicate is
   now detected.
6. After the repair routine runs on existing data, spot-check previously
   corrupted cards for correct display.

---

### Issue 2 — Blank screen after deleting a category

**Labels:** `bug` **Files:** `js/category-manager.js`

**Description**

`handleDeleteCategory()` calls
`window.uiManager.showScreen('welcome')`. The actual element ID is
`welcome-screen`. `showScreen` hides all screens, fails to find `welcome`,
and activates nothing — the main content area is blank until the user
navigates.

**Proposed fix**

Change `'welcome'` to `'welcome-screen'`.

**Validation tests**

1. Create a category, select it, delete it via the sidebar menu. The
   welcome/home overview screen appears immediately.
2. Repeat while a second category exists; welcome screen still appears (not
   the other category).

---

### Issue 3 — UTC vs. local timezone mismatch in study scheduling

**Labels:** `bug`, `scheduling` **Files:** `js/utils.js`

**Description**

`calculateNextReview` and `updateCardStudyData` correctly use
`getLocalDateString()`, but `getCardsForStudySession()` and
`calculateAdvancedStudyStats()` compute "today" with `new
Date().toISOString().split('T')[0]`, which is UTC. In US Eastern, from
7–8pm until midnight, UTC is already tomorrow: cards due today are
misclassified as overdue, `dueToday` counts are wrong, and the "needs
practice" number disagrees with what the scheduler actually selects.

**Proposed fix**

Replace both UTC-based date computations with `getLocalDateString()`. Audit
`debugStreakData()` for the same pattern (cosmetic only).

**Validation tests**

1. Set system clock to 9:00pm local. Create a card whose `nextReview`
   equals today's local date (rate a new card "Getting there", then adjust
   via console if needed). Deck stats show it as "due today", not overdue.
2. At the same clock setting, the "needs practice" count on the home screen
   matches the number of cards the study session actually offers.
3. `grep -n "toISOString" js/utils.js` returns no scheduling-related hits.

---

### Issue 4 — `app.js` overwrites the `window.DEBUG` namespace

**Labels:** `bug`, `dev-experience` **Files:** `js/app.js`

**Description**

`data-manager.js` and `utils.js` register debug helpers with the guarded
pattern `if (!window.DEBUG) window.DEBUG = {}`. `app.js` loads last and
assigns `window.DEBUG = { ... }` unconditionally, destroying
`debugStreakData`, `debugCardIntervals`, and
`debugRecentSessions`. Additionally, `DEBUG.clearData` only clears
localStorage, which no longer holds app data post-IndexedDB migration — it
silently fails to clear anything meaningful.

**Proposed fix**

- In `app.js`, use the same guarded pattern and
  `Object.assign(window.DEBUG, { ... })` instead of reassignment.
- Update `clearData` to delete the IndexedDB database
  (`indexedDB.deleteDatabase('MindforgeDB')`) in addition to localStorage
  before reloading.

**Validation tests**

1. In the console after load: `window.DEBUG.debugStreakData`,
   `debugCardIntervals`, `debugRecentSessions`, and `getAppInfo` are all
   functions.
2. `window.DEBUG.clearData()` on a test dataset: after reload, app shows
   first-time welcome state and DevTools → Application → IndexedDB shows no
   MindforgeDB.

---

### Issue 5 — Deep-link startup race: router can fire before data is loaded

**Labels:** `bug`, `architecture`, `startup` **Files:** `js/app.js`,
`js/router.js`

**Description**

The router self-triggers `handleRoute()` on `window load + 100ms`, while
`dataManager.init()` (IndexedDB open + data load) runs asynchronously from
`DOMContentLoaded`. On a slow device or cold cache, a bookmarked
`#/study/...` URL invokes `findCategory()` while `this.data` is still
`null`, throwing `TypeError` and leaving the app dead. `setupRouting()`'s
`setTimeout(50)` is a timing-based workaround, not a guarantee.

**Proposed fix**

- Remove the self-triggering `load` listener and its `setTimeout` from
  `RouterManager.init()` (keep only the `hashchange` listener).
- Remove the `setTimeout(50)` wrapper in `TheApp.setupRouting()`; register
  routes synchronously.
- At the end of `TheApp.init()` — after `dataManager.init()` has resolved
  and all managers are initialized — explicitly call
  `window.routerManager.handleRoute()` once to process any deep link.
- `checkInitialState()` may need a small adjustment so it doesn't fight
  with the explicit initial route dispatch (only show first-time guidance
  when there is no hash *and* no categories, as now — verify ordering).

**Validation tests**

1. DevTools → Network → throttle to "Slow 3G", hard-reload a deep link like
   `#/study/<catId>/<deckId>`: study session starts, no console errors.
2. Reload with no hash: welcome screen shows; first-time guidance still
   appears on an empty dataset.
3. Navigate between category/study/preview via URLs and back/forward
   buttons — all still work.
4. Temporarily add a 2-second artificial delay inside `dataManager.init()`
   (dev only), reload a deep link: app waits, then routes correctly. Remove
   the delay after testing.

---

### Issue 6 — Service worker breaks non-GET requests and will fight the future API

**Labels:** `bug`, `pwa`, `d1-readiness` **Files:** `sw.js`

**Description**

The fetch handler runs `caches.match` / `cache.put` on every
request. `cache.put()` throws on non-GET requests, so the first POST to a
future Worker API will error inside the SW. Cache-first for everything also
means any future `/api/` GET would be served stale forever.

**Proposed fix**

At the top of the fetch handler: if `event.request.method !== 'GET'`,
return without calling `respondWith` (let the browser handle it
natively). Also bypass caching for any URL whose path starts with `/api/`
(network-only). Bump `CACHE_VERSION` alongside `APP_VERSION` per existing
convention.

**Validation tests**

1. After deploying with a bumped version, in the app's console run
   `fetch('/', { method: 'POST' })` — the request fails at the server
   (405/404) but **no error originates from sw.js** in the console.
2. Offline mode (DevTools → Network → Offline): app still loads fully from
   cache.
3. `fetch('/api/ping')` while online goes to network (visible in Network
   tab, not "(ServiceWorker)" as the source), returning 404 for now.

---

### Issue 7 — Normalize IndexedDB storage into per-entity stores behind a StorageAdapter

**Labels:** `architecture`, `d1-readiness`, `epic` **Files:**
`js/indexedDB-manager.js`, `js/data-manager.js` (primary); minor touches
elsewhere

**Description**

All app data lives in one JSON blob (`appData/main`). Consequences:

- Rating one card serializes and rewrites the entire dataset — write
  amplification grows with collection size.
- Cross-tab sync is last-writer-wins on *everything*: two tabs editing
  within one 2-second poll window silently lose one tab's changes. The
  saving tab also detects its own `data-sync-timestamp` and pointlessly
  reloads its own data every cycle.
- The monolithic shape is the opposite of what D1 needs (rows in
  `categories`, `decks`, `cards` tables with foreign keys).

**Proposed fix (phased within the issue)**

1. Bump `dbVersion` to 2; in `onupgradeneeded`, create object stores
   `categories` (keyPath `id`), `decks` (keyPath `id`, index on
   `categoryId`), `cards` (keyPath `id`, index on `deckId`), `statistics`
   (keyPath `key`); migrate the existing blob into rows; keep the old store
   until migration is verified, then remove in v3.
2. Add `updatedAt` (ISO timestamp) to every entity on write — this is the
   future sync cursor.
3. Introduce a `StorageAdapter` interface (get/put/delete/list per entity
   type) with `IndexedDBAdapter` as the first implementation; `DataManager`
   keeps its public API but delegates persistence to the adapter and writes
   only the entity that changed.
4. Replace the cross-tab polling with `BroadcastChannel` messages carrying
   entity-level change notices (fall back to the timestamp poll only if
   needed), and stop self-notifying.

**Validation tests**

1. After migration: DevTools → IndexedDB shows the new stores populated
   with correct row counts matching the previous data (compare against a
   pre-migration backup export).
2. Rate one card during study; inspect IndexedDB — only that card row's
   `updatedAt` changed; categories/decks untouched.
3. Full regression: create/edit/delete category, deck, card; study session;
   statistics; export/import backup — all functional.
4. Two tabs open: edit card A in tab 1 and card B in tab 2 within 2
   seconds; both edits survive.
5. Export a backup, wipe DB via `DEBUG.clearData()`, re-import — data fully
   restored (export/import must be updated to traverse the new stores).

---

### Issue 8 — Use object URLs instead of base64 data URLs for image display

**Labels:** `performance`, `ui` **Files:** `js/card-manager.js`,
`js/ui-manager.js`

**Description**

`getImageDataUrl()` converts stored Blobs to base64 data URLs for every
display (~33% memory inflation, main-thread FileReader work per image). The
preview screen can materialize dozens of large base64 strings into the DOM
at once.

**Proposed fix**

Add `getImageObjectUrl(imagePath)` using `URL.createObjectURL(blob)`; use
it in `renderCardImage`, `getImageHtml`, and `showImagePreviewAsync`. Track
created URLs and call `URL.revokeObjectURL` when a card display changes,
the preview screen is cleared, or the image modal closes. Keep the data-URL
path only where a self-contained string is genuinely required (backup
export).

**Validation tests**

1. Study a deck with images: images display; card-to-card navigation shows
   no broken images.
2. Preview a deck with 20+ images; DevTools → Memory heap snapshot shows no
   accumulation of large strings after navigating away (compare
   before/after the change).
3. Image zoom modal still opens and closes correctly.
4. Backup export still embeds images and re-imports successfully (data-URL
   path preserved there).

---

### Issue 9 — Script load order: `config.js` and `utils.js` should load first

**Labels:** `bug-risk`, `maintenance` **Files:** `index.html`

**Description**

Scripts load alphabetically: `card-manager.js` and `category-manager.js`
load *before* `config.js`, and `utils.js` loads second-to-last. This
currently works only because no file references `APP_CONFIG` or utility
functions at parse time — a single load-time reference breaks the app. This
contradicts the intended "config loaded first" convention.

**Proposed fix**

Reorder the script block: `config.js`, `utils.js`, `include/jszip.min.js`,
then managers (`indexedDB-manager`, `data-manager`, `router`, `ui-manager`,
`card-manager`, `category-manager`, `study-manager`,
`service-worker-register`), then `app.js` last. Update `ASSETS_TO_CACHE`
order in `sw.js` is not required (order there is irrelevant) but bump
`CACHE_VERSION`.

**Validation tests**

1. Hard reload with cache disabled: no console errors; app initializes.
2. Full smoke test: create category/deck/card, study, open every hamburger
   menu item.
3. Temporarily add `console.log(APP_CONFIG.APP_NAME)` at the top level of
   `card-manager.js`; reload — it logs correctly (would have thrown
   before). Remove after testing.

---

### Issue 10 — Cross-tab data-loss risk from whole-blob last-writer-wins sync

**Labels:** `bug`, `data-integrity` **Files:** `js/data-manager.js`

**Description**

Documented in detail under Issue 7 (root cause is the monolithic
blob). Tracked separately so the risk is visible in the tracker; **resolved
by Issue 7** — no independent fix planned unless Issue 7 is deferred. If
deferred, an interim mitigation is a `beforeunload`-style warning when a
second tab is detected via `BroadcastChannel`.

---

### Issue 11 — CSV format is not RFC 4180 compatible

**Labels:** `enhancement`, `interop`, `decision-needed` **Files:**
`js/utils.js`, `js/category-manager.js`

**Description**

`escapeCSVField` replaces embedded newlines with the literal two characters
`\n`, and import splits the file on raw newlines before parsing quotes. The
app's own round-trip works, but exports won't open cleanly in
Excel/Sheets/Anki when cards contain newlines, and standards-compliant CSVs
from other tools (with real quoted newlines) fail import.

**Proposed fix (if interop is desired)**

Export: keep real newlines inside quoted fields (RFC 4180). Import: replace
line-splitting with a stateful parser that tracks quote state across
newlines. Retain backward compatibility by also unescaping literal `\n`
sequences on import so old exports still work.

**Decision needed:** Is interop with Excel/Anki a goal? If not, close as
won't-fix and document the format.

**Validation tests**

1. Export a deck containing a multi-line card; open in Excel/LibreOffice —
   the card occupies one logical row with a visible line break.
2. Re-import that file into a new deck — card content identical, line break
   preserved.
3. Import a legacy export (pre-change, with literal `\n`) — still imports
   correctly.

---

### Issue 12 — Duplicate deck export code paths

**Labels:** `refactor`, `maintenance` **Files:** `js/category-manager.js`

**Description**

`exportDeck()` and `exportDeckById(deckId)` are ~40-line
near-duplicates. Any CSV format change (Issue 11) must currently be made
twice.

**Proposed fix**

Extract a private `exportDeckToCSV(categoryId, deckId)`; have both public
methods delegate to it (or remove `exportDeck()` if nothing calls it —
audit call sites first).

**Validation tests**

1. Export a deck from the deck context menu — file downloads with correct
   content.
2. `grep` confirms only one CSV-construction block exists in the file.

---

### Issue 13 — Silent automatic daily backup download is surprising UX

**Labels:** `ux`, `enhancement` **Files:** `js/data-manager.js`

**Description**

`performDailyMaintenance()` triggers a file download
(`mindforge-daily.json`) with no notice on the first study session of each
day — the user clicks "study" and a download appears. It's also
uncompressed JSON, unlike the zip-based manual backup.

**Proposed fix**

Short-term: show a toast ("Daily backup saved") and reuse the zip pipeline
from `createBackup()`. Longer-term: this mechanism becomes obsolete once D1
is the source of truth (server-side backups); consider making it a setting.

**Validation tests**

1. Clear `last-maintenance-date` via console; start a study session — zip
   downloads and a toast explains it.
2. Start a second session same day — no second download.

---

### Issue 14 — Redundant save machinery

**Labels:** `refactor`, `cleanup` **Files:** `js/app.js`

**Description**

Every mutation already calls `saveData()`, so the 30-second auto-save
interval rewrites identical data continuously, and the `beforeunload` save
cannot reliably complete async IndexedDB work anyway (misleading
safety). Both become actively wasteful after Issue 7 (they'd rewrite
nothing meaningful or need entity-level rework).

**Proposed fix**

Remove the auto-save `setInterval` and the `beforeunload` save handler. (Do
after or alongside Issue 7.)

**Validation tests**

1. Create a card, immediately close the tab, reopen — card persists
   (proving per-mutation saves suffice).
2. Study several cards, kill the tab mid-session, reopen — all ratings up
   to the last completed card persist.

---

### Issue 15 — Streak logic has dead code and dual sources of truth

**Labels:** `refactor`, `low-priority` **Files:** `js/data-manager.js`

**Description**

In `updateStudyStatistics`, the branch `stats.lastStudyDate === today` is
unreachable (it contradicts `isFirstValidSessionToday`). Streak resets live
in two places (`checkStreakValidity` and the gap-detection branch), making
the logic hard to verify. Behavior is believed correct; this is a clarity
refactor.

**Proposed fix**

Remove the dead branch; consolidate reset logic so `checkStreakValidity` is
the single authority for gap resets, and `updateStudyStatistics` only
starts/extends streaks.

**Validation tests**

1. Console-simulate: set `lastStudyDate` to 3 days ago with `currentStreak:
   5`; call `checkStreakValidity()` — streak becomes 0.
2. Complete a valid (10+ card) session — streak becomes 1; `recordStreak`
   unchanged if higher.
3. Set `lastStudyDate` to yesterday, complete a valid session — streak
   increments.

---

### Issue 16 — D1 backend architecture (design + build)

**Labels:** `epic`, `feature`, `d1` **Depends on:** Issues 1, 5, 6, 7

**Description**

Add an optional Cloudflare-hosted backend while preserving pure-IndexedDB
standalone mode.

**Key decisions (settled during review):**

- **No Rust required.** Cloudflare Workers is natively JavaScript; the
  backend is a plain-JS Worker (or Pages Function) with D1 bindings. Rust
  (`workers-rs`) is possible but adds a toolchain for no benefit
  here. (Tauri remains a separate, desktop-shell decision.)
- **Images go to R2, not D1.** D1 is SQLite with row-size limits and
  per-row pricing; card rows store an R2 object key. This also resolves the
  previously logged "split backup files" concern.
- **Authentication is required** once web-accessible. Cloudflare Access is
  the zero-code option for a personal deployment; a Worker-issued session
  token is the code-owned alternative.
- **Offline-first sync:** IndexedDB remains the immediate read/write target
  in synced mode; a sync layer exchanges per-entity deltas using
  `updatedAt` cursors (provided by Issue 7).

**Proposed scope (own phased plan when reached):**

1. D1 schema: `categories`, `decks`, `cards`, `study_sessions`, `settings`
   (+ `user_id` columns if multi-user — see open question).
2. Worker REST API: CRUD per entity + `/sync` delta endpoint; shared
   validation module used by both client and Worker.
3. `SyncedAdapter` implementing the `StorageAdapter` interface from Issue
   7.
4. R2 image upload/download with signed URLs; migration of existing images.
5. Mode selection UI (standalone vs. synced) + auth flow.
6. Conflict policy: per-entity last-writer-wins by `updatedAt` initially
   (acceptable for a single user across devices); revisit if multi-user.

**Open questions (blocking schema design):**

- Single-user (personal, behind a login) or multiple accounts eventually?
- Cloudflare Access vs. in-app auth preference?

---

## Phased Implementation Plan

Each phase gates the next. Within a phase, changes are delivered one file
at a time with before/after snapshots and a validation test per chunk, per
standard process.

**Phase 1 — Data integrity (do first, before anything touches storage
format)**
- Issue 1 — Escaping overhaul + one-time data repair
- Issue 2 — `welcome-screen` fix (trivial, bundled here)
- Issue 3 — UTC → local date fixes
- *Gate:* full regression on card create/edit/study/import/export; repaired
  data verified against a pre-change backup.

**Phase 2 — Stability & hygiene**
- Issue 9 — Script load order
- Issue 4 — DEBUG namespace + `clearData` fix
- Issue 5 — Startup sequencing / deep-link race
- Issue 6 — Service worker: skip non-GET and `/api/*`
- *Gate:* deep links work under throttled network; offline PWA mode still
  works.

**Phase 3 — D1-readiness refactor (the big one)**
- Issue 7 — Normalized entity stores + StorageAdapter + `updatedAt` +
  BroadcastChannel (resolves Issue 10)
- Issue 14 — Remove redundant save machinery
- Issue 8 — Object URLs for images
- *Gate:* full backup/restore round-trip on new schema; two-tab concurrent
  edit test passes; performance sanity check on a large deck.

**Phase 4 — Polish (parallelizable, low risk)**
- Issue 12 — Export code dedup
- Issue 13 — Daily backup UX
- Issue 11 — CSV RFC 4180 (pending decision)
- Issue 15 — Streak logic cleanup

**Phase 5 — Backend**
- Issue 16 — D1 + Worker + R2 + auth + sync (gets its own detailed phased
  plan when Phase 3 is complete)

---

## Open Questions

1. **Single-user or multi-user?** Affects the D1 schema from day one
   (`user_id` columns are cheap to add now, painful later).
2. **Auth preference:** Cloudflare Access (zero code, protects the whole
   route) vs. in-app token auth (more control, more code)?
3. **CSV interop (Issue 11):** Is compatibility with Excel/Anki a goal, or
   is the current app-internal format acceptable?
4. **Do you have a recent backup that predates heavy card editing?** For
   Issue 1's repair routine, an old backup is useful as a cross-check that
   unescaping restores original text correctly.
