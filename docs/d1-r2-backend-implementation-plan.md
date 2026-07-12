# Mindforge — D1 / Worker / R2 Backend Design & Migration Plan (Deliverable 2)

*Plan only — no code has been applied. Written to be implemented by a
future model/session (Sonnet 5), one phase at a time, after the Tauri
plan's Group A (adapter contract extension + read cutover + blob
retirement) is complete. Backend phases S-P1…S-P2 can begin before the
Tauri shell exists; sync must run identically on browser
(IndexedDBAdapter) and desktop/Android (TauriAdapter). Follow the Project
Development Guide and onboarding conventions throughout.*

---

## 0. Scope

Optional cross-device sync for a **single-user** deployment (Stan, across
his own devices; possibly a few trusted family members later — each as a
separate userId). Browser/PWA-only mode remains fully functional with
sync disabled; sync is a feature you turn on, never a requirement. The
`/api/*` service-worker bypass shipped in Issue 6 already reserves the
URL space.

---

## 1. Resolved design decisions

### S1. Auth: in-app bearer token (not Cloudflare Access)

**Decision: a per-user opaque bearer token.** One long random secret
(≥128 bits, e.g. 32 hex chars from `crypto.getRandomValues`), sent as
`Authorization: Bearer <token>` on every request, validated by the Worker
against a **hash** stored in D1 (`users.tokenHash` — SHA-256 is adequate
here; the token is high-entropy random, not a human password, so no slow
KDF needed), mapping to the `userId` that scopes every query. The token
*is* the identity — no separate userId entered by the user.

Why not Cloudflare Access: Access authenticates via a browser login
redirect, which is hostile to a PWA making background `fetch` calls and
to offline-first behavior (a queued sync firing after token expiry hits a
redirect, not a 401 it can handle). The token approach fails cleanly
(401 → surface "sync needs attention" in the UI) and works identically in
a browser, an installed PWA, and a Tauri WebView.

Accepted weaknesses, stated honestly: the secret lives in client storage
(readable by anything that can read the app's storage — same trust level
as the data itself, so nothing is *newly* exposed); no automatic expiry;
no per-device revocation granularity in v1 (one token per user — leak it,
rotate it, re-enter it on each device). **Rotation is mandatory in v1**:
a `wrangler d1 execute` statement (documented in the repo) that replaces
`tokenHash`; every device then re-prompts on its next 401. You outgrow
this design when users are strangers rather than family — at that point,
per-device tokens and a real account system; logged as an explicit future
issue, not designed now.

Provisioning in v1 is deliberately manual: generate the token locally,
insert `users(id, tokenHash)` via wrangler. No signup endpoint exists —
the absence of a registration surface is itself a security feature for a
personal deployment.

### S2. Tenancy: one shared D1 database, row-level scoping

**Decision: a single D1 database with `userId` on every synced table**,
every Worker query filtered by the authenticated user; R2 object keys
prefixed `{userId}/images/{filename}`. Per-user databases are a
large-scale pattern; for a handful of users they add provisioning
machinery for nothing. The Worker is the only thing holding D1/R2
credentials — clients never talk to D1/R2 directly, so tenancy holds as
long as every query is written scoped (a Worker-side helper that *forces*
the userId parameter, rather than N hand-written WHERE clauses, is the
implementation requirement).

### S3. Sync architecture: local-first with an outbox — not a remote adapter

**Decision: `SyncedAdapter` is a thin decorator over the active local
adapter, not a network-backed implementation of the contract.** This is
the single most important non-mechanical mapping in this plan, so stated
plainly: a naive `SyncedAdapter` where `putEntity` = HTTP call would make
every card rating a network round-trip, break offline completely, and
violate the "browser-only mode always works" constraint.

Instead:

- Every write goes to the **local** adapter first (IndexedDB or SQLite),
  exactly as today — the app's behavior with sync enabled is
  indistinguishable from sync disabled, minus a background process.
- The decorator additionally appends a compact change record to a local
  **outbox** (`{seqLocal, type, id, op: put|delete, at}` — not the full
  entity; the entity is read fresh at push time so rapid successive edits
  collapse naturally).
- A **sync engine** (new `js/sync-manager.js`) periodically — and on
  app-start, on regaining focus/network, and after a mutation burst
  settles (debounced) — pushes the outbox and pulls remote changes since
  its **cursor** (see S5), applying them through the local adapter and
  refreshing the UI via the existing `_refreshFromOtherTab()` machinery
  (which already knows how to reload-and-rerender).

The existing dual-write helpers (`_syncEntity` etc.) are the natural
interception point: after Tauri Group A they are the *sole* write path,
so the outbox hook lives in exactly one place.

### S4. Conflict resolution: per-entity LWW with tombstones — plus a real merge for the one place LWW is wrong

Scrutiny first, per the handover's instruction, then the decision.

**The honest analysis.** The gold-standard options — an operation log
replayed on every device, or CRDTs — buy convergence guarantees this app
does not need at its actual conflict rate: one user, whose devices are
rarely offline *and* mutating the same entity simultaneously. The
realistic conflict cases are:

1. *Content edits* to the same card on two offline devices → LWW loses
   one edit. Rare (you don't edit the same card's text on two devices in
   one offline window), and the loser is recoverable from the other
   device's backup. Acceptable.
2. *Scheduling state* after studying the same card on two offline
   devices → LWW keeps one device's `interval`/`nextReview`. The result
   is still a *valid* schedule, merely not the theoretically ideal one,
   and it self-corrects on the next review. Acceptable, and this is the
   overwhelmingly most common conflict.
3. *Statistics* — and here LWW is genuinely wrong, not merely lossy.
   `statistics` is one JSON doc; two devices each add their own study
   sessions offline; LWW silently discards one device's entire
   contribution (streak, daysStudied, dailyDeckActivity). This is not an
   edge case, it is the *normal* case of studying on two devices in one
   day. So: LWW everywhere **except** statistics is a defensible
   engineering judgment; LWW *including* statistics would be the rushed
   answer the handover warned about.

**Decision.**

- **Entities (categories/decks/cards):** last-writer-wins at entity
  granularity, ordered by `updatedAt` with `deviceId` as a deterministic
  tiebreak (every install generates a persistent random `deviceId` at
  sync-enable time). Deletes are tombstones (`deletedAt` set, row
  retained), synced like any update, so a delete on one device reliably
  beats a stale resurrect from another. Client clock skew is accepted as
  a bounded risk for a single user's devices (they're NTP-synced in
  practice); the Worker additionally rejects `updatedAt` values further
  than 24h in the future as corruption guarding, not as security.
- **Statistics:** synced as a special-cased document with a **merge
  function**, not LWW. Merge rules, field by field: `recordStreak` → max;
  `currentStreak`/`lastStudyDate` → take the pair from the doc with the
  later `lastStudyDate`; `daysStudied`, `totalTimeStudied`,
  `totalCardInstances` → max (an approximation that never double-counts;
  it can undercount when both devices studied in the same window — the
  documented, accepted anomaly, chosen over sum which double-counts on
  every re-sync); `studySessions` → union by a synthetic session id
  (device+timestamp — requires adding an `id` to session records when
  sync ships, a small pre-phase), trimmed by the existing 7-day rule;
  `dailyDeckActivity` (pending Issue A) → per `(date, deckId)` key, max.
  The merge runs on the **Worker** during push (server state + pushed
  doc → merged doc), making the server the single merge point and
  keeping clients simple.
- **Tombstone retention:** 90 days, pruned by a scheduled Worker cron —
  a device offline longer than that must full-resync (detected via
  cursor age; the pull response tells it to). Bounded growth, decided
  now per Guide rule #2.

### S5. Schema and change tracking

D1 schema = the Tauri plan's DDL (Deliverable 1, D3 — one shared
artifact, cross-check item) **plus**, on every synced table: `userId TEXT
NOT NULL` and `seq INTEGER NOT NULL` — a per-user, server-assigned,
strictly-increasing change sequence (from a `sync_state(userId, lastSeq)`
counter row, incremented inside the Worker's write transaction). Pull is
then simply `WHERE userId = ? AND seq > ? ORDER BY seq LIMIT n`
(paginated), and the client's **cursor** is the highest `seq` it has
applied. Plus tables: `users(id, tokenHash, createdAt)` and
`sync_state`. `statistics` syncs as its JSON doc row (S4);
`app_flags`/`data.settings` do **not** sync in v1 — flags are per-storage
by definition (repair flags describe *that* database), and settings like
theme are per-device by intent (cross-check item #5 in Deliverable 1).

### S6. R2 image sync

Images are immutable in Mindforge (created and deleted, never edited) —
which makes their sync almost trivial and worth keeping trivial:

- **Push:** when the outbox contains a card whose `image` references a
  file the server hasn't confirmed, upload it first
  (`PUT /api/images/{filename}`, Worker streams to R2 at
  `{userId}/images/{filename}`; idempotent — re-upload of an existing
  key is a no-op 200), then push the entity change. Metadata rides in an
  `images_meta` D1 table mirroring the local one.
- **Pull:** entity changes may reference images the device doesn't have.
  Do **not** block sync on image downloads: the UI already renders a
  graceful "Image not found" placeholder (existing behavior), and the
  sync engine maintains a small missing-images queue fetched in the
  background (`GET /api/images/{filename}`), refreshing affected views on
  arrival. Eager-fetch-all-on-first-sync is offered once at sync-enable
  time ("Download all images now? N MB") since first sync on a new device
  is the one case where lazy loading feels broken.
- **Delete:** local orphan cleanup (daily maintenance) is extended so
  that with sync enabled, image deletion emits an outbox op; the Worker
  deletes the R2 object and tombstones the meta row. Devices then drop
  their local copy via pull.
- **The pre-sync window** (the handover's explicit question): before a
  device has synced, its images are local-only — invisible elsewhere
  until that device pushes. This is inherent and acceptable; the UI's
  sync-status indicator (S-P6) shows pending-push counts so it is at
  least *visible* rather than mysterious.

### S7. API surface (Worker / Pages Functions, plain JS — no Rust)

```
POST /api/sync         body: { deviceId, cursor, changes: [...], statistics? }
                       resp: { newCursor, changes: [...], statistics?, fullResyncRequired? }
PUT  /api/images/:filename    (binary body; idempotent)
GET  /api/images/:filename
GET  /api/health       (unauthenticated liveness only)
```

All under `/api/*` (already SW-bypassed). Push and pull share one
endpoint deliberately: one transaction assigns `seq`s to pushed changes
and computes the pull diff, so a device can never observe its own push as
a later conflicting pull. Payload limits (D1 statement size, Worker body
limits) mean `changes` is paginated on both directions — the implementing
model must check current Cloudflare limits at implementation time and set
page sizes accordingly, not hardcode this document's assumptions.

---

## 2. Phases

Prerequisite: Tauri plan Group A complete (extended adapter contract is
the sole write path). Each phase is independently deployable and
testable; sync stays invisible to users until S-P6.

---

### Phase S-P1 — Worker, D1 schema, auth middleware

**Labels:** backend, architecture
**Files:** new `worker/` (or `functions/`) tree, `wrangler.toml`, D1
migration SQL, repo docs for token provisioning/rotation

**Description**
Stand up the deployable backend skeleton: D1 database with the shared DDL
(+ `userId`/`seq`/sync tables), bearer-token middleware, `/api/health`,
and a stub `/api/sync` that authenticates and returns an empty diff.

**Proposed fix**
Per S1/S2/S5/S7. The scoped-query helper (forced userId binding) is built
here and used for everything after. Document, in-repo: creating the D1
db, applying migrations, generating/inserting a token, rotating it.
Decide Worker vs Pages Functions here (recommend Pages Functions —
Mindforge already deploys on Pages; one project, one deploy) and record
the choice.

**Validation tests**
1. `curl /api/health` → 200 without auth; `/api/sync` without/with-wrong
   token → 401; with valid token → 200 empty diff.
2. Second user row inserted; each token sees only its own (empty) world —
   the scoping helper provably applied (attempt a hand-crafted cross-user
   query in a test route, confirm impossible via the helper's API).
3. D1 tables match the shared DDL artifact (diff the migration SQL
   against Deliverable 1 §D3 + S5 additions).

---

### Phase S-P2 — Device identity + outbox (local only, no network)

**Labels:** architecture, data-integrity
**Files:** new `js/sync-manager.js` (skeleton), `js/data-manager.js`
(outbox hooks in `_syncEntity`/`_syncStatistics`/`_deleteEntitySync`),
`js/storage-adapter.js` (outbox persistence via flags or a small store —
implementing model chooses and documents), `index.html`, `sw.js`

**Description**
Everything client-side that sync needs, testable with zero network:
persistent `deviceId`, a durable outbox appended on every mutation, and
its inspection tooling.

**Proposed fix**
Outbox records per S3 (op metadata only, entity read at push time; puts
to the same id collapse). Session records gain the synthetic `id` field
S4's statistics merge requires (small, backward-compatible addition —
old records without ids merge by LWW of the doc once, acceptable).
Outbox capped (e.g. 10k ops → oldest collapsed into a
full-resync-on-next-push marker) — growth bounded at design time.
`DEBUG.dumpOutbox()` added.

**Validation tests**
1. With sync off (no token configured): mutations produce outbox entries;
   app behavior otherwise byte-identical (regression pass).
2. Rapid edits to one card → one collapsed outbox entry for that id.
3. Delete → tombstone-op recorded.
4. Outbox survives reload and kill-tab (durable, not in-memory).
5. Works identically in browser and (once T5 exists) Tauri — same tests.

---

### Phase S-P3 — Push/pull engine + cursor (entities only)

**Labels:** backend, architecture, data-integrity
**Files:** `worker/` (`/api/sync` real implementation), `js/sync-manager.js`

**Description**
The core loop: push outbox, receive `seq`-ordered remote changes since
cursor, apply via local adapter, advance cursor. Entities only —
statistics (S-P4) and images (S-P5) deliberately excluded so conflict
behavior is validated on the simple shape first.

**Proposed fix**
Worker: single transaction per S7; LWW comparison per S4 on each pushed
change against server state; tombstone handling; `seq` assignment;
paginated pull. Client: apply pulled changes through the adapter, then
`_refreshFromOtherTab()`; scheduling per S3 (start, focus, online,
debounced post-mutation); exponential backoff on failure; 401 → mark
sync-needs-attention, never retry-loop. `fullResyncRequired` path: clear
cursor, pull everything, reconcile by LWW.

**Validation tests**
1. Two browser profiles (device A/B), one token: create on A → sync →
   appears on B (through the adapter and UI, not just the network tab).
2. Offline conflict: edit same card's front on A and B while both
   offline; sync A then B → deterministic winner by (updatedAt,
   deviceId); loser's device converges to winner on next pull.
3. Delete on A while B offline edits the same card; sync both orders →
   tombstone wins; card stays deleted on both.
4. Cursor correctness: kill the app mid-pull; restart; no change lost or
   double-applied (idempotent apply).
5. Stale device (cursor older than tombstone retention, simulated) →
   full resync path exercised, converges.
6. Sync disabled: zero `/api/` requests issued (network tab clean).

---

### Phase S-P4 — Statistics merge

**Labels:** backend, data-integrity
**Files:** `worker/` (merge function), `js/sync-manager.js`,
`js/data-manager.js` (session `id` already from S-P2)

**Description**
The one place LWW is wrong (S4 analysis). Server-side field-wise merge of
the statistics document.

**Proposed fix**
Implement S4's per-field rules exactly, as a pure function with its own
table-driven test cases (this is the highest-subtlety code in the plan —
treat the merge function like the scheduling algorithm: pure, in one
place, exhaustively tested). Client pushes its statistics doc when dirty;
pull returns the merged doc, applied via `putStatistics` +
`updateSidebarStats()`.

**Validation tests**
1. Study on A (streak day) and B (same day) offline; sync both →
   `studySessions` union (both sessions present by id), streak correct,
   `recordStreak` = max, no double-count in `daysStudied`.
2. `dailyDeckActivity` (once Issue A ships): same deck same day on both
   devices → per-key max survives; different decks → both keys present.
3. Re-sync idempotence: syncing the same state repeatedly changes nothing
   (max/union rules are idempotent by construction — verify anyway).
4. Regression: single-device sync user sees statistics identical to
   pre-S-P4 behavior.

---

### Phase S-P5 — R2 image sync

**Labels:** backend, enhancement
**Files:** `worker/` (image routes, R2 binding, `images_meta`),
`js/sync-manager.js`, `js/data-manager.js` (orphan-cleanup emits ops)

**Description**
Per S6: upload-before-entity-push, lazy background download with the
existing placeholder as the interim UI, optional eager first-sync fetch,
tombstoned deletes.

**Proposed fix**
As S6. Missing-images queue persists (survives reload); affected preview/
study views refresh on arrival (reuse the object-URL machinery from Issue
42 — images arrive as Blobs into the adapter, display paths unchanged).

**Validation tests**
1. Card with image created on A → syncs → B shows placeholder, then the
   image, without user action; object URL lifecycle clean (no leak —
   heap-snapshot spot check per Issue 42's method).
2. Eager option at sync-enable downloads everything; count matches
   `listImages()` on the source device.
3. Delete card+image on A; after both sync, B's local image file/blob and
   the R2 object are gone (verify R2 via wrangler).
4. Interrupted upload (kill mid-push) → retried next cycle; idempotent
   PUT confirmed (no duplicate/corrupt object).

---### Phase S-P6 — Sync settings UI + status

**Labels:** ux, enhancement
**Files:** `js/ui-manager.js`, `index.html` (settings template),
`js/sync-manager.js`

**Description**
The user-facing switch: token entry, enable/disable, status, and the
eager-image-download offer. Until this phase sync exists only for
console-driven testing; after it, it's a real feature.

**Proposed fix**
Settings modal gains a Sync section: token field (stored via adapter
flag), Enable/Disable, "last synced" + pending-push count, Sync Now,
and the S1 needs-attention state (401 → banner directing here). Disable
= stop engine + clear token; explicitly ask whether to also clear the
outbox (keep local data always). First-enable runs the S-P3 initial
pull/push and offers S-P5's eager image fetch.

**Validation tests**
1. Fresh device end-to-end through the UI only (no console): enter token
   → enable → full data appears, images follow.
2. Wrong token → clear error, nothing half-enabled.
3. Rotate token server-side → both devices surface needs-attention on
   next cycle; re-entering new token resumes with no data loss.
4. Disable → zero network calls, app fully functional offline-forever
   (the founding constraint, verified last and explicitly).

---

### Phase S-P7 — Tauri parity pass

**Labels:** tauri, backend
**Files:** ideally none — this phase *proves* none are needed

**Description**
Run the complete S-P2…S-P6 validation suite on the Tauri desktop build
(TauriAdapter underneath) and, once T8 exists, the Android build. The
sync engine was built against the adapter contract; this phase is the
evidence, and any environment-specific fix it forces is a contract leak
to be fixed at the right layer, not patched around.

**Validation tests**
1. Full S-P3/4/5/6 suites with one browser device and one Tauri device
   syncing against the same user.
2. Mixed trio once available: browser PWA + desktop Tauri + Android,
   converging on shared state.
3. Backup-zip export from any synced device restores correctly into a
   fresh, sync-disabled install (disaster-recovery path intact —
   cross-check item #3).

---

## 3. Cross-check against the Tauri plan (Deliverable 1)

1. **Shared DDL** — this plan's schema is Deliverable 1 §D3 plus
   `userId`/`seq`/`users`/`sync_state`. Any change on either side is a
   change to one shared artifact; D3's `updatedAt NOT NULL` and
   `deletedAt` columns exist specifically because S4/S5 need them —
   if S4's strategy ever changes to need more per-row metadata, that is
   a coordinated migration across every installed build and must be
   raised before Tauri T5 ships.
2. **Adapter contract is the sync engine's foundation** — including the
   T1 image/flag extensions. The engine must never reach around the
   adapter; if a phase here is tempted to, the contract is what gets
   extended (in both plans), not bypassed.
3. **Backup zip stays sacred** — unchanged format, working at every
   phase of both plans; it is the interchange (Tauri T6), the Android-PWA
   bridge, and the disaster-recovery path if sync misbehaves (S-P7 test 3).
4. **Settings and flags don't sync (S5)** — Deliverable 1's T2 must not
   place `data.settings` anywhere that entity sync would sweep up; theme
   and cardsPerSession are per-device by intent.
5. **Statistics session `id`s (S-P2)** slightly predate their consumer
   (S-P4) and land in client code that Tauri T5's adapter also
   round-trips through the statistics JSON doc — no schema impact, but
   the implementing model should carry the field through T5's tests once
   both plans are in flight.
