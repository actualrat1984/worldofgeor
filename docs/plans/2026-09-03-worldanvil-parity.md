# World Anvil Parity Plan — worldofgeor

> For Hermes: execute wave-by-wave with subagent-driven-development. One wave per run.
> Everything private: geor_token gate, noindex everywhere, no community, no monetization.

**Goal:** clone World Anvil's full toolset, adapted to a private two-reader archive (Mikhail + invitees).

**Architecture:** build-time indexes (Python generators beside `generate_nav.py` → JSON in `dist/wiki/`) for canon data; D1 for member state (reveals, notes, manuscripts meta, arcs); worker routes serve both; vanilla JS + Tailwind frontends in `public/`.

**Tech stack:** Vite 6 + Tailwind 3, Cloudflare Workers + D1, MkDocs wiki pipeline, node:test.

---

## Wave A — Foundation (M, ~60 min, 4 tasks)

1. **Migration 0006:** `role` on users (owner/editor/viewer), `reveals` (member, secret_id, state), `notes` (member, page, anchor, body, shared flag), `arcs`/`plots`/`threads` tables, `boards` (whiteboard JSON). Acceptance: migrate up+down on local D1, tests pass.
2. **Generators:** `generate_tags.py` (page → tags from vault frontmatter/paths), `generate_timeline.py` (events from `World/Dates/`), `generate_calendar.py` (Ge'orian months/festivals). Each first does a read-only inventory report (what exists, counts, gaps) before emitting JSON. Acceptance: JSON in `dist/wiki/`, committed, counts logged.
3. **Worker scaffolding:** route stubs + authz helper (`requireRole`), all failing closed, tests for 401/403 matrix. Acceptance: 401 logged-out, 403 viewer-on-editor-route.
4. **Compass + Cmd+K:** index new pages (timeline, trees, studio, arcs, calendar) in omnibox. Acceptance: every new page reachable via Ctrl+K.

## Wave B — Reading (M, ~60 min, 4 tasks)

1. **Article layouts:** path-driven templates (Character sheet, Nation dossier, Event record, default) applied to wiki HTML via HTMLRewriter. Acceptance: 3 sample pages per layout render, no layout on list pages.
2. **Secrets:** `:::secret id="x"` blocks in lore → locked UI; reveal state per member in D1; owner can reveal globally. Acceptance: logged-out sees lock, reveal persists, GM-notes field never leaves server.
3. **Related sidebar:** `tags-index.json` → "see also" on every article. Acceptance: no empty sidebar (fallback: same-folder siblings).
4. **TOC + reader polish:** sticky TOC, reading progress already in compass — wire per-article. Acceptance: keyboard nav, mobile clean.

## Wave C — Time & space (L, split C1/C2, ~2 runs)

1. **Timeline of the 12 Ages:** eras + events from `timeline-index.json`, scrubber UI, event → wiki links. Acceptance: all 12 ages render, event counts match index.
2. **Chronicles:** timeline scrub drives atlas zoom (event has coords → map flies there). Acceptance: 5 demo events fly correctly.
3. **Map chaining + pins:** world→region→city drill-down; wire existing `wikiUrl` features to article pins. Acceptance: click pin → article opens; chain navigates 3 levels.
4. **Gazetteer tables:** filterable/sortable nation table over Central Erisdar dataset. Acceptance: 246 rows, filters combine, links out.

## Wave D — Relations (M, ~60 min, 3 tasks)

1. **Family trees:** kinship pass over Characters (inventory first — if sparse, seed from named houses) → SVG graphs. Acceptance: 3 houses render, no overlapping labels.
2. **Diplomacy webs:** faction relation matrix (allied/tense/war) → interactive web. Acceptance: click edge → context card with wiki link.
3. **Character gallery:** extend species-page pattern to key characters. Acceptance: filters + counts + lore links.

## Wave E — Writing studio (L, ~2 runs, 5 tasks)

1. **Manuscripts:** chapters/scenes stored via additions pipeline (`Books/` tree in Website-additions), labels, draft versioning via additions/history, DOCX/export via print CSS. Acceptance: write → save → version → export round-trip.
2. **Notebook + TODOs:** per-member quick notes + checklists (D1), notebook search. Acceptance: survives logout, private per member.
3. **Whiteboards:** infinite canvas, cards link wiki pages, arrows, persists to D1 `boards`. Acceptance: 50 cards smooth, reload restores.
4. **Marginalia merge:** page-anchored notes from Wave A surface inside studio reader. Acceptance: note created on wiki appears in studio.
5. **Prompt oracle:** random lore-combination generator (rolltables over tags) for broad-first ideation. Acceptance: 3 modes (character/place/conflict).

## Wave F — Play, adapted (L, ~2 runs, 5 tasks)

Campaign tools with no table to run → author tools. No dice, no SRDs, no VTT.

1. **Story arcs + plot trees:** master plot + subplots (WA plot-tree logic verbatim), threads with states (seed/active/resolved). Acceptance: tree renders, loop guard (WA's own pitfall: parent-loop detection).
2. **Reader's primer:** spoiler-gated collection (built on secrets) — the "what Arcady may know" lens. Acceptance: primer view hides unrevealed secrets.
3. **Author's desk:** single-tab command view — notes, timeline ref, audio, arc status. Acceptance: everything reachable, no page-hopping.
4. **Lore quest board:** in-world guild boards rendered as lore + author thread tracker. Acceptance: board shows open threads per arc.
5. **Ge'or systems statblocks:** structured blocks (magic ranks, species traits, units, currencies) + custom template builder (WA homebrew equivalent). Acceptance: 3 system templates render from wiki data.

## Wave G — System depth (M, ~60 min, 5 tasks)

1. **Calendar UI:** Ge'orian months/festivals, BGD/AGD converter. 2. **Audio player:** site-wide player, playlists, progress sync. 3. **PWA offline:** scope `sw.js` to wiki + reader pages. 4. **Search v2:** pins + timeline events in `search.html`. 5. **Admin charts + landing:** charts over `/api/admin/stats`, live counters on index.

---

## Execution (Ultra Mode v2)

Per wave: slice plan → todo → serial implementer cards (exact paths, acceptance, evidence) → spec review → quality/security review → `node --test` + `check-site.mjs` green → `[verified]` commit. **Push + `wrangler deploy` only on Mikhail's word** (AGENTS.md). Dist stays committed until he rules on the untrack question. Model-gate note: AGENTS.md demands Sol; Hermes waves run on Spark per his standing direction — flag per wave, proceed.
