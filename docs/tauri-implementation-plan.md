# Mindforge — Tauri Design & Migration Plan (Deliverable 1)

*Plan only — no code has been applied. Written to be implemented by a future
model/session (Sonnet 5), one phase at a time, following the Project
Development Guide and the onboarding doc's working conventions: confirm
current file state before editing, before/after blocks (or full replacement
files for high-risk rewrites), validation tests run and reported before a
phase closes, `CACHE_VERSION` bumped on every browser-asset edit.*

---

## 0. Scope and targets

- **Primary desktop targets:** Linux, Windows, macOS — one codebase via
  Tauri 2.x.
- **Android:** two paths, both in scope. (a) The existing PWA continues to
  work on Android unchanged and can exchange data with Tauri installs via
  the backup-zip format (Phase T6). (b) A full native Android build via
  Tauri 2 mobile is planned as Phase T8, reusing the same `TauriAdapter`.
- **Browser/PWA mode remains fully functional throughout and after** —
  every phase in Group A is a pure-browser improvement with no Tauri
  dependency, and nothing in Group B/C removes or degrades the web build.

---

## 1. Resolved design decisions

### D1. Images: files on disk, not SQLite BLOBs

**Decision: images are stored as individual files under the app data
directory (`{appDataDir}/images/{filename}`), with only the filename
referenced from SQLite** (the `cards.image` field, unchanged in shape from
today's `data/images/{filename}` convention — keep the same path string
format so card data needs no rewriting).

Rationale, consistent with the existing R2 decision (binaries out of the
row store): large BLOBs bloat SQLite's page cache and slow unrelated
queries; whole-DB operations (backup, VACUUM, open) stay fast when the DB
holds only text; the OS handles image files natively (mmap'd reads,
thumbnailing); and it keeps one mental model across Tauri ("files on
disk") and D1 ("objects in R2"). The known cost — DB and folder can drift
(orphaned files, broken references) — is already mitigated by existing
machinery: `cleanupOrphanedImages()` in daily maintenance ports directly
to a directory scan, and image writes are create-only (images are never
edited in place), which removes most partial-write risk.

### D2. Rust surface: minimal — plugins over custom commands

**Decision: use `tauri-plugin-sql` (SQLite via sqlx, real on-disk file —
satisfying the original motivation of data outside browser storage
jurisdiction) for all entity/statistics/flag storage, and
`tauri-plugin-fs` for image file I/O.** No hand-written Rust beyond the
generated scaffold and the plugin registration/migration list.

Rationale: the whole storage abstraction already lives in JS
(`storage-adapter.js`); `TauriAdapter` can be pure JS issuing SQL through
the plugin, keeping the implementation reviewable by the same
one-file-at-a-time process used everywhere else in this project. Custom
Rust commands would buy nothing here and add a second language to the
review/validation loop. `tauri-plugin-sql` also supports Android/iOS in
Tauri 2, which keeps Phase T8 on the same adapter.

The implementing model must verify current plugin names/APIs against the
Tauri 2 docs at implementation time rather than trusting this document's
recollection of them — plugin APIs move.

### D3. SQLite schema (shared DDL with the D1 plan — see cross-check)

```sql
CREATE TABLE categories (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT              -- tombstone; NULL = live. Unused until D1 sync.
);

CREATE TABLE decks (
  id         TEXT PRIMARY KEY,
  categoryId TEXT NOT NULL,
  name       TEXT NOT NULL,
  createdAt  TEXT,
  updatedAt  TEXT NOT NULL,
  deletedAt  TEXT
);
CREATE INDEX idx_decks_categoryId ON decks(categoryId);

CREATE TABLE cards (
  id                   TEXT PRIMARY KEY,
  deckId               TEXT NOT NULL,
  front                TEXT NOT NULL,
  back                 TEXT NOT NULL,
  image                TEXT,            -- 'data/images/{filename}' or NULL
  difficulty           INTEGER,
  lastStudied          TEXT,
  nextReview           TEXT,
  interval             INTEGER,
  easeFactor           REAL,
  graduationStep       INTEGER,
  createdAt            TEXT,
  updatedAt            TEXT NOT NULL,
  deletedAt            TEXT,
  extra                TEXT             -- JSON: hiddenWordsDifficulty, recentRatings,
                                        -- and any future per-card fields
);
CREATE INDEX idx_cards_deckId ON cards(deckId);

CREATE TABLE statistics (
  key       TEXT PRIMARY KEY,           -- always 'main'
  json      TEXT NOT NULL,              -- the whole statistics object as JSON
  updatedAt TEXT NOT NULL
);

CREATE TABLE app_flags (
  key       TEXT PRIMARY KEY,           -- repair flags, migration flags,
  json      TEXT NOT NULL,              -- last-maintenance-date, etc.
  updatedAt TEXT NOT NULL
);

CREATE TABLE images_meta (
  filename     TEXT PRIMARY KEY,
  originalName TEXT,
  size         INTEGER,
  type         TEXT,
  savedAt      TEXT
);
```

Two deliberately non-normalized choices, flagged per the handover's
instruction to mark non-mechanical mappings:

- **`statistics` as a single JSON document row.** The statistics object is
  a nested doc (studySessions array, upcoming `dailyDeckActivity` map from
  the pending Issue A) that the app always reads/writes whole through
  `getStatistics()`/`putStatistics()`. Normalizing it would change the
  adapter contract for zero benefit. The D1 plan handles its sync as a
  special case regardless (see Deliverable 2, S4).
- **`cards.extra` JSON column.** Core scheduling fields get real columns
  (queryable, and the fields D1 conflict-resolution cares about);
  everything else rides in `extra`. This is the seam that lets future
  per-card fields ship without a schema migration on three desktop
  platforms plus Android. The adapter is responsible for
  splitting/merging `extra` transparently so callers still see one flat
  card object — this is the single most non-mechanical part of the
  `TauriAdapter` mapping and deserves its own validation tests (T5).

**Tombstone columns (`deletedAt`) and mandatory `updatedAt` exist from day
one** even though nothing uses `deletedAt` until D1 sync — adding them now
costs nothing; adding them later means a coordinated schema migration
across every installed desktop/Android build. (Cross-check item #1.)

### D4. StorageAdapter contract extension (approved by Stan)

Images and app-flags currently bypass the adapter (`card-manager.js` calls
`indexedDBManager` directly; repair/maintenance flags use the raw
`settings` store). Both must go through the adapter to be swappable. New
contract methods, implemented by **every** adapter (IndexedDB first, in
Phase T1):

```
async getImage(filename)        -> { filename, blob, originalName, size, type, savedAt } | undefined
async putImage(imageRecord)     -> saved record   (record includes blob)
async deleteImage(filename)     -> true | false
async listImages()              -> array of records (blob included; used by export & orphan cleanup)
async getFlag(key)              -> value | undefined
async putFlag(key, value)       -> saved value
```

In `IndexedDBAdapter` these map 1:1 onto the existing `images` and
`settings` stores (no data migration needed — same stores, same keys). In
`TauriAdapter`, `putImage` writes the blob to
`{appDataDir}/images/{filename}` via the fs plugin and the metadata row to
`images_meta`; `getImage` reads the file back into a Blob. `data.settings`
(theme, cardsPerSession) stays inside the entity tree/statistics world it
already lives in — it is *not* moved into `app_flags`, avoiding scope
creep; `app_flags` is only for what the raw `settings` IndexedDB store
holds today.

### D5. Adapter selection

One active adapter, chosen once at startup in a new small factory
(suggested: extend `storage-adapter.js` rather than a new file):
Tauri detection (`window.__TAURI_INTERNALS__` / the official `isTauri()`
helper — verify current API at implementation time) selects
`TauriAdapter`; otherwise `IndexedDBAdapter`. Everything downstream keeps
using `window.storageAdapter` and never knows which it has. `DataManager`
must contain **zero** environment checks — that's the whole point of the
contract.

### D6. Existing-user migration path: backup-zip import

A Tauri app cannot read the browser's IndexedDB — different storage
worlds. The bridge is the format that already round-trips everything: the
backup zip (`{data, images}` JSON, produced by Create Backup / daily
backup). First launch of the Tauri app with an empty database shows an
explicit import step: "Import from a Mindforge backup" (file picker) or
"Start fresh." The import path reuses `importData()` — which, after Group
A, already writes through the adapter — so the same code populates SQLite
that populates IndexedDB. The same mechanism is the PWA↔Tauri and
Android-PWA↔desktop interchange going forward: no bespoke transfer
protocol before D1 sync exists.

### D7. Legacy blob retirement (Guide rule #3: no two systems side by side)

After Group A's read cutover, the `appData/main` blob is a redundant write
path and must be retired in the same group, not left running "just in
case": T3 stops writing it, migrates any remaining reads, and clears the
store. Export/backup keeps producing the same external JSON format
(assembled from adapter reads), so user-facing backups are unchanged — the
blob dies as an internal storage mechanism, not as an interchange format.

### D8. Service worker inside Tauri

The SW exists to make a *website* work offline; a Tauri app serves its
assets locally and must never fight a cache layer during updates.
`service-worker-register.js` gets an environment guard: skip registration
under Tauri. The PWA keeps its SW exactly as-is.

---

## 2. Non-mechanical mappings (summary of flags)

1. `cards.extra` JSON split/merge inside `TauriAdapter` (D3) — callers see
   flat objects; adapter owns the seam.
2. Statistics stored as a JSON doc row, not normalized (D3) — deliberate.
3. Images move from "blob in a DB store" to "file on disk + metadata row"
   (D1/D4) — `getImage`/`putImage` hide this completely.
4. `deleteEntity` in SQLite should return `changes > 0` — the IndexedDB
   implementation currently resolves `true` unconditionally; match the
   *contract's* documented behavior (true | false) and note the IndexedDB
   adapter's looseness rather than replicating it.
5. `DEBUG.clearData()` in `app.js` hardcodes `indexedDB.deleteDatabase` —
   needs an adapter-level `clearAll()` or an environment-aware debug path
   in Group B.

---

## 3. Phases

Issue-format, one at a time, in order. Group A is pure browser work
(testable with the normal dev server + fresh tabs + CACHE_VERSION bumps);
Group B introduces the Tauri shell; Group C extends targets.

---

### Phase T1 — Extend StorageAdapter contract: images and app-flags

**Labels:** architecture, refactor
**Files:** `js/storage-adapter.js`, `js/card-manager.js`,
`js/data-manager.js`

**Description**
Images and one-time/maintenance flags bypass the adapter today
(`card-manager.js` → `indexedDBManager` for `saveImage`/`getImageDataUrl`/
`getImageObjectUrl`; `data-manager.js` → raw `settings` store for
`migration`, `escape-repair-v1`, `interval-repair-v1`,
`normalized-migration-v1`, `last-maintenance-date`). A `TauriAdapter` swap
is impossible while these side doors exist.

**Proposed fix**
Add the six methods from D4 to the contract comment and to
`IndexedDBAdapter` (1:1 onto existing `images`/`settings` stores — no data
migration). Reroute the three image call sites in `card-manager.js` and
every flag read/write in `data-manager.js` through
`window.storageAdapter`. Grep-audit before closing:
`grep -rn "indexedDBManager" js/ | grep -v indexedDB-manager.js` should
afterwards show only `storage-adapter.js` (constructor wiring),
`data-manager.js` legacy-blob calls (removed in T2/T3), and `app.js`
DEBUG (handled in T5).

**Validation tests**
1. Add a card with an image; image displays in study/preview; IndexedDB
   `images` store contains it (unchanged shape).
2. Delete that card; daily maintenance orphan cleanup still removes the
   file (`cleanupOrphanedImages()` now via `listImages`/`deleteImage`).
3. Repair flags: with flags present, reload — repairs skip (flags read
   through adapter). Console: `await window.storageAdapter.getFlag('interval-repair-v1')`.
4. Backup export/import round-trip unchanged.
5. Grep audit from Proposed Fix passes.

---

### Phase T2 — Read cutover: DataManager loads from the normalized stores

**Labels:** architecture, data-integrity
**Files:** `js/data-manager.js`

**Description**
The normalized stores are write-only (dual-write since Issue 7); the UI
reads only the legacy blob. `TauriAdapter` can't be the storage backend
until reads go through the adapter too.

**Proposed fix**
Replace `loadData()`'s blob read with an adapter-based load: read all
categories/decks/cards/statistics via
`listEntities`/`getStatistics`, reassemble the in-memory tree
(`{settings, categories:[{decks:[{cards:[]}]}], statistics}`) that every
UI manager already consumes — **the in-memory tree shape does not change
in this phase**, only where it's loaded from. `data.settings` needs a
home decision here: simplest is to persist it inside the statistics doc's
sibling (a dedicated `app_flags`-style record via `putFlag('user-settings',
…)`) — implementing model to confirm current settings read/write sites and
choose the least invasive placement, documenting it in the phase's
close-out. Keep the blob *write* path (dual-write) intact this phase —
removal is T3 — so a one-phase rollback is trivial. Fall back to the blob
with a console warning if the normalized stores are empty but the blob
isn't (a user whose one-time Issue 7 migration never ran), and trigger
`migrateToNormalizedStores()`.

**Validation tests**
1. Cold reload: all categories/decks/cards render identically; card counts
   match a pre-change export.
2. Console cross-check (existing pattern): live tree count vs
   `(await storageAdapter.listEntities('card')).length` — equal.
3. Mutate (add/edit/delete card), reload — change persisted (proves the
   loaded tree and write path agree).
4. Cross-tab: change in tab A appears in fresh tab B (BroadcastChannel
   handler now reloads via adapter).
5. Simulate the fallback: temporarily clear normalized stores in console,
   reload — data recovered from blob + re-migration, nothing lost.

---

### Phase T3 — Retire the legacy blob write path

**Labels:** architecture, refactor
**Files:** `js/data-manager.js`, possibly `js/app.js`

**Description**
After T2 the blob is written on every mutation but read only as a
fallback — exactly the "two systems side by side" the guide forbids.

**Proposed fix**
`saveData()` stops writing `appData/main` (keeps the BroadcastChannel
notification — rename or repurpose honestly, e.g. `notifyDataChanged()`,
since "saveData" no longer saves; grep-audit all `saveData()` call sites
first — there are many). Per-mutation persistence is now solely the
`_syncEntity`/`_syncStatistics` writes, which must therefore stop being
fire-and-forget for the mutation's own entity (await them; a failed write
must surface, not vanish in a console.warn). Keep the T2 empty-store
fallback for one release, then a follow-up flag-gated cleanup clears
`appData`. Export/backup assembles the same external JSON from adapter
reads (format unchanged — cross-check item #3).

**Validation tests**
1. Mutation → direct IndexedDB read shows normalized store updated and
   `appData/main` untouched/absent.
2. Kill-tab-mid-session persistence test (Issue 14's test) still passes.
3. Backup export byte-shape matches pre-T3 export for identical data
   (allowing key order); re-imports cleanly.
4. Cross-tab sync still instant.
5. Regression: study session end-to-end, statistics update, streak logic.

---

### Phase T4 — Tauri 2 scaffold (no storage changes)

**Labels:** architecture, tauri
**Files:** new `src-tauri/` tree, `js/service-worker-register.js`,
build config

**Description**
Stand up the desktop shell loading the existing static app, before any
SQLite work, so shell problems and storage problems never overlap.

**Proposed fix**
`npm create tauri-app` (or manual scaffold) pointed at the existing
`src/` as frontend dist — no bundler introduced; the app stays
no-build-step vanilla JS, Tauri serves the static files. Register
`tauri-plugin-sql` and `tauri-plugin-fs` (unused until T5). Add the
Tauri-detection guard to `service-worker-register.js` (D8). Confirm the
app runs fully against **IndexedDB inside the WebView** at this phase —
proving the frontend is environment-agnostic before the adapter exists.

**Validation tests**
1. `tauri dev` on the primary dev platform: app loads, all screens work,
   data persists across app restarts (WebView IndexedDB).
2. No service worker registered inside Tauri (`navigator.serviceWorker
   .getRegistrations()` empty); PWA in a normal browser still registers.
3. Browser build completely unaffected (fresh-tab regression pass).

---

### Phase T5 — SQLite schema + TauriAdapter

**Labels:** architecture, tauri, data-integrity
**Files:** `src-tauri/` (migration list), new `js/tauri-adapter.js`,
`js/storage-adapter.js` (factory), `index.html`, `sw.js` (new asset),
`js/app.js` (DEBUG.clearData)

**Description**
The real cutover: implement D3's schema via plugin-sql migrations and a
pure-JS `TauriAdapter` implementing the full extended contract, selected
by the D5 factory.

**Proposed fix**
Implement each contract method as SQL through the plugin;
`putEntity('card', …)` splits core columns vs `extra` JSON,
`getEntity`/`listEntities` merge them back (adapter-internal — add
explicit unit-style console tests for round-tripping `recentRatings`/
`hiddenWordsDifficulty`). Upserts via `INSERT … ON CONFLICT(id) DO
UPDATE`. Images: fs plugin file write + `images_meta` row (D1/D4).
`app_flags` for flags. Give `DEBUG.clearData()` an adapter-aware path.
Chunk this phase internally (schema/migrations → entity CRUD →
statistics/flags → images → factory switch), one chunk per session per
the working conventions.

**Validation tests**
1. Fresh Tauri launch: empty state renders; create category/deck/card
   (with image) → verify rows via a debug SQL query and the image file on
   disk at `{appDataDir}/images/`.
2. `extra` round-trip: set `hiddenWordsDifficulty` via a Hidden Words
   session; reload; value intact; column list of `cards` contains no
   `hiddenWordsDifficulty` column.
3. Full regression in Tauri: study session, ratings, statistics, streak,
   preview (incl. Issue 52 scheduling info), reset-all-progress.
4. Browser build untouched: same factory selects IndexedDBAdapter;
   regression pass.
5. `deleteEntity` returns false for a nonexistent id (contract behavior).

---

### Phase T6 — First-launch import wizard (backup-zip bridge)

**Labels:** enhancement, tauri, ux
**Files:** `js/ui-manager.js` or new small module, `index.html`
(template), `js/data-manager.js` (guard/entry point)

**Description**
D6: existing users' bridge from browser IndexedDB to desktop SQLite —
and the standing PWA↔Tauri / Android-PWA↔desktop interchange until D1
sync exists.

**Proposed fix**
On startup with a completely empty database (zero categories AND no
`import-completed` flag), present Import-from-backup / Start-fresh. Import
reuses the existing zip/JSON `importData()` path (already adapter-backed
after Group A), then sets the flag. Also reachable later from the
hamburger menu (it's just Import Data — verify the existing menu item
suffices and the wizard is only the first-run surfacing of it).

**Validation tests**
1. Create a backup in the browser PWA (real data, with images); fresh
   Tauri install; import it — counts, images, statistics, streaks match
   the source.
2. Start-fresh path: flag set; wizard never reappears; creating data works.
3. Import the same backup into the Android PWA (browser) — proving the
   interchange is symmetric.
4. Corrupt/wrong file: clear error, no partial state (verify `importData`'s
   failure behavior post-cutover; harden if it can half-apply).

---

### Phase T7 — Desktop packaging: Linux, Windows, macOS

**Labels:** tauri, release
**Files:** `src-tauri/tauri.conf.json`, CI or local build scripts

**Description**
Produce installable artifacts for the three primary targets.

**Proposed fix**
Configure bundle targets (AppImage/deb, MSI/NSIS, dmg — confirm current
Tauri 2 bundle options at implementation time). Decide signing posture
explicitly per platform (unsigned is acceptable for personal use;
document the SmartScreen/Gatekeeper consequences rather than discovering
them). Version the app from a single source (`tauri.conf.json`), and
decide the relationship to `APP_CONFIG.APP_VERSION` (recommend: keep them
manually aligned, documented in the onboarding doc; auto-sync is not worth
build tooling in a no-build project). Updater plugin explicitly deferred —
logged as a future issue, not silently omitted.

**Validation tests**
1. Install and run the artifact on each of the three OSes; data dir
   created in the platform-correct location; import wizard works.
2. Uninstall/reinstall on one platform: SQLite file survives per platform
   convention (or its removal is documented behavior).
3. App restart: data intact (the whole point — outside browser storage
   jurisdiction).

---

### Phase T8 — Android build (Tauri 2 mobile)

**Labels:** tauri, android, enhancement
**Files:** `src-tauri/` (mobile config), possibly `css/mobile.css` touch-ups

**Description**
Full native Android app from the same codebase and the same
`TauriAdapter`, alongside (not replacing) the Android PWA path.

**Proposed fix**
Enable Tauri 2 Android target; verify `tauri-plugin-sql` and
`tauri-plugin-fs` mobile support at implementation time (both are
documented as mobile-capable in Tauri 2 — confirm versions). App data dir
resolves via the same plugin APIs. The existing mobile CSS (Issue 8 work)
already covers small screens; expect only safe-area/WebView quirks. Import
wizard (T6) is the data path in, identical to desktop. Play-Store
distribution is explicitly out of scope for v1 — sideloaded APK for
personal devices; log store distribution as a future issue.

**Validation tests**
1. APK on a real device: full regression (study flow with touch, image
   add via Android file picker, preview, themes).
2. Import a backup zip produced by the desktop Tauri build and one
   produced by the browser PWA — both restore correctly.
3. Data survives app force-stop and device reboot.
4. The Android *PWA* still works untouched in Chrome on the same device
   (both paths coexist).

---

## 4. Cross-check against the D1/Worker/R2 plan (Deliverable 2)

1. **Sync-readiness lives in this plan's schema.** `updatedAt NOT NULL` and
   `deletedAt` tombstone columns (D3) exist from day one *because* the D1
   plan's conflict resolution (Deliverable 2, S4) requires them. If a
   future decision changes the D1 conflict strategy to something needing
   more metadata (e.g. per-device counters), that becomes a schema
   migration across all installed builds — raise it before T5 ships, not
   after.
2. **One DDL, two databases.** D1 is SQLite-dialect; Deliverable 2's schema
   is this schema plus `userId` and a server-assigned `seq` column. Any
   T5-time deviation from D3's DDL must be mirrored into Deliverable 2
   before it's implemented — treat the DDL as a single shared artifact.
3. **The backup zip is the universal interchange format** (T6, and
   Deliverable 2's pre-sync story). Neither plan may change its shape
   without updating the other; it is also the disaster-recovery path if
   sync ever corrupts, so it must keep working after every phase of both
   plans.
4. **The extended adapter contract (D4) is shared.** Deliverable 2's sync
   engine wraps *whatever* local adapter is active (IndexedDB in
   browser/PWA, TauriAdapter on desktop/Android) — it depends on the
   contract, including the image methods, being identical across both.
   Contract changes after T1 require touching both plans.
5. **`data.settings` placement (T2 decision)** affects what Deliverable 2
   syncs: settings are per-device by default (theme especially); the D1
   plan deliberately does *not* sync them in v1. If T2 places settings
   somewhere that would be swept into entity sync, flag it.
