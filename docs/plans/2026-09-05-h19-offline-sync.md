# H19 — Offline-first sync protocol (plan)

## 1. Snapshot scope

**What goes offline (IndexedDB, new `geor-offline` DB — Cache API stays as-is for shell/pages):**
- App shell + reader pages: keep current SW behavior (`geor-shell-v2` precache SAFE_ASSETS, `geor-pages-v1` network-first, RUNTIME_MAX 120, `/api/` never cached). No scope change.
- Search/data indexes (measured live `dist/wiki`, 2026-09-05): `search_index.json` 2.7 MB, `tags-index.json` 836 KB, `gazetteer-index.json` 118 KB, `statblocks-index.json` 60 KB, `search-extra-index.json` 23 KB, `timeline-index.json` 15 KB, `webs-index.json` 11 KB, `gallery-index.json` 10 KB, `calendar-index.json` 8 KB, `trees-index.json` 3 KB. Total snapshot ≈ **3.8 MB** — cache all ten in one IndexedDB `snapshot` store with a manifest `{ builtAt, wikiSha }`.
- Explicitly OUT of snapshot: `dist/wiki/World/` (~940 MB) and `Ge'or Arts` (~40 MB); full wiki is ~991 MB of a ~1.05 GB dist and never fits a quota-safe offline pack. Article bodies stay SW runtime-cached (last-120-visited) only.
- Member data: cross-device collections + workflow items stay server-side (D1, read-through on login, NOT snapshotted beyond last-seen render); local-only trail `geor_archive_trail_v1` (localStorage) and reading progress stay local-only, synced never.

**Store:** new IndexedDB DB `geor-offline` with stores `snapshot` (keyPath `name`), `outbox` (autoIncrement), `meta` (sync state). Rationale: Cache API holds opaque Response pages well but cannot query/queue; outbox needs structured records + ordering, so IndexedDB, not Cache, not localStorage (quota + sync API).

## 2. Queued writes (outbox)

- **Payload:** `{ id, op: 'additions.save', path, content, oldPath?, message?, baseSha?, createdAt, deviceId }` — mirrors `POST /api/additions/save {path, content, oldPath?, message?}` (900k char limit enforced client-side before enqueue).
- **Ordering:** FIFO per path (only latest pending save per path is live; superseded drafts collapsed), across paths in `createdAt` order; one in-flight flush at a time.
- **Backoff:** on reconnect flush sequentially; per-item retry with exponential backoff (5s → 1m, max ~10 tries), item-level failure never blocks later items for other paths; 401 → stop flush, force re-login; 409/sha-mismatch → mark conflicted, fetch server version, surface diff.
- **Honest queued labels:** every outbox-backed surface shows `Queued offline · not yet published` chip + pending count in manuscripts header; queued items are visually distinct (dimmed + clock badge) and never presented as saved; failure state reads `Sync failed — kept locally, retrying`.

## 3. Conflict rules per data type (given per-save GitHub commits, one SHA per save)

- **Manuscripts/additions (GitHub-backed):** last-writer-wins at flush time (worker re-reads `existingSha` then PUTs, so concurrent saves overwrite). Rule: send `baseSha` (sha seen at edit time); if server sha ≠ baseSha, do NOT auto-overwrite — stash local as `path.conflict-<ts>`, show side-by-side diff via existing `/api/additions/history`, user picks keep-mine / keep-server / merge-manually. Lost-update window is inherent to per-save commits; history view is the recovery path.
- **Collections / workflow items (D1-backed):** field-level merge by item id (add/remove sets union; status transitions only forward Draft→Review→Approved→Published; concurrent status edits → higher stage wins, logged to `workflow_history`).
- **Reading progress / trail (local-only):** last-write-wins locally, never synced, never conflicts.

## 4. What needs Mikhail (approvals)

1. **New D1 tables?** None proposed — outbox lives client-side in IndexedDB; server API unchanged. If a server-side pending-queue is ever wanted, that needs explicit owner approval (none requested now).
2. **SW scope change?** None — keep `/api/` uncached, keep network-first + 120-page cap. Any future precache of indexes into Cache API (vs IndexedDB) needs approval; not proposed.
3. **Approvals to proceed to build:** (a) 3.8 MB index snapshot list above — confirm set; (b) conflict UX (stash-as-conflict-file vs auto-merge) — confirm; (c) honest-queued chip copy — confirm. No secrets, hosting, or auth changes involved.

## 5. Future build phases (small, sequential)

- **Phase 1 — Snapshot reader:** create `geor-offline` IndexedDB, fetch + store the ten indexes with manifest, offline search reads snapshot, banner shows `Offline · indexes from <date>`.
- **Phase 2 — Outbox:** enqueue `additions.save` while offline with queued chips, FIFO flush with backoff on reconnect.
- **Phase 3 — Conflicts:** `baseSha` tracking, conflict stash + diff UI reusing `/api/additions/history`, pending-count badge and failure states.
