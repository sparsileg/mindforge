# Mindforge — Handover for Fable 5: Migration Design Docs

*Given alongside: full Mindforge source, the project onboarding doc, and the
project development guidelines doc. This doc scopes two specific deliverables
requested from you.*

---

## Context

Mindforge is a vanilla JS flashcard/spaced-repetition PWA, currently feature-
complete and IndexedDB-backed, mid-way through a planned migration sequence:

1. Issue backlog (in progress/nearly complete)
2. **Tauri migration** — native SQLite via Rust, browser/PWA mode preserved
3. **Cloudflare D1 + Worker + R2 backend** — cross-device sync

You previously audited this codebase; the current backlog of issues being
worked through is a direct result of that audit. This handover is **not**
another audit request — it's a request for two forward-looking design
documents to plan phases 2 and 3 above, before any migration code is written.

---

## What's already decided (don't re-litigate unless you find a real problem)

- Browser/PWA-only mode must keep working after both migrations — never a
  hard backend requirement.
- `js/storage-adapter.js`'s `IndexedDBAdapter` (`getEntity`, `listEntities`,
  `putEntity`, `deleteEntity`, `getStatistics`, `putStatistics`) is the
  contract future adapters (`TauriAdapter`, `SyncedAdapter`) are expected to
  implement — it was built during Issue 7 specifically for this purpose.
- Images belong outside the row/blob-oriented store in both migrations
  (SQLite and D1) — same underlying reasoning in both cases, don't treat them
  as separate decisions.
- Sequence is fixed: Tauri first, D1 second. Plan them as two separate
  documents (see below), not one combined plan.

---

## Deliverable 1: Phased Tauri Design & Migration Plan

Please resolve, concretely (not leave open):

1. **Images: files-on-disk vs. SQLite BLOB.** Make an actual recommendation
   with tradeoffs, not just a menu of options — the app's existing R2
   decision (images out of the row store) is the relevant precedent.
2. **`TauriAdapter` mapping.** Show the concrete mapping from the existing
   `IndexedDBAdapter` contract to a Rust/SQLite-backed implementation. This
   should be close to mechanical given the contract already exists — treat
   any place where it *isn't* mechanical as a signal worth flagging.
3. **Browser/PWA mode impact.** Does the existing normalized-store dual-write
   logic in `data-manager.js` need to change at all for the browser build, or
   does Tauri get an entirely separate adapter with zero impact on the
   existing code path? State this explicitly.
4. **Existing-user migration path.** A user with months of IndexedDB history
   moving to a Tauri install needs an explicit one-time import step — not
   "new installs just use SQLite." Design this step.
5. **Phasing.** Break the migration into discrete, independently-testable
   phases/chunks, in the style already established in this project's issue
   backlog (see the onboarding doc's "what a good issue looks like" section,
   and Issue 7's chunk structure as a real precedent).

## Deliverable 2: Phased D1 / Worker / R2 Backend Design & Migration Plan

Please resolve, concretely:

1. **Auth strategy.** Cloudflare Access vs. an in-app token — this was left
   undecided in prior handover notes. Pick one, justify it, don't leave it
   open again.
2. **Conflict resolution for multi-device sync.** This is the genuinely hard
   problem in this phase and hasn't been designed in any depth yet. Give it
   real scrutiny — a rushed "last-write-wins" answer is a design smell worth
   naming as such if that's where the analysis actually leads, but don't
   default to it without justification.
3. **`SyncedAdapter` mapping**, same expectations as `TauriAdapter` above.
4. **R2 image sync** — relationship between local image storage (IndexedDB
   today, files-on-disk after Tauri) and R2, including what happens to images
   during the window before a device has synced.
5. **Phasing**, same expectations as above.

## Cross-check (do this explicitly, not implicitly)

Both plans touch the same `StorageAdapter` contract and will eventually need
to compose (a Tauri desktop install will *also* eventually want D1 sync).
Explicitly flag, in both documents, anywhere a decision in one plan
constrains or conflicts with a decision in the other — schema shape, adapter
contract changes, image-handling assumptions, etc. Don't assume this
cross-check happens implicitly just because you're writing both in the same
pass.

## Format

Follow the project development guidelines doc's issue-writing conventions
where applicable (Files, Description, Proposed Fix, Validation Tests) for
each individual phase/chunk within the two plans, so they can be copied
directly into the issue backlog when implementation begins.
