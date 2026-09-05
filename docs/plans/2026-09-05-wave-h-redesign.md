# Wave H — Redesign & Depth Plan (60 items from the 50-list + 5 audit adds)

> Execute card-by-card, serial, proven pipeline: implementer (inventory provided,
> no exploration, plain-prose DONE) → verdict-only quality review → `npm run verify`
> green → `[verified]` commit → push → deploy + live curl proof.
> Vault read-only. dist/site.css/package-lock churn always reverted. No new D1
> tables unless card says so. Private gate holds on everything new.

## Phase H1 — Design system (cards 1–4)
- **H1 tokens+type:** lock type scale 12/14/16/20/28/38/52, ban one-off px; decide JetBrains Mono (dates/stats/coords) or remove the download. Evidence: no off-scale sizes in changed files, tests green.
- **H2 shell+cards+buttons:** one shared header (logo, compass trigger, member pill) on all pages; 3 card tiers; solid-gold = only primary. Evidence: check-site clean, visual diff per page.
- **H3 a11y:** gold focus visible on every interactive element; cream/60 body-text floor; reduced-motion audit all pages; contrast spot-checks. Evidence: tests assert focus style presence + no sub-60 body text in changed files.
- **H4 loading states:** mirror-layout skeletons on all index-fetching rooms; empty states with next-step actions; one page-transition class + single easing (150/400ms). Evidence: new tests per room.

## Phase H2 — Landing + trust (cards 5–6)
- **H5 landing:** one primary CTA (Request Access), hero rooms-before-lore, gated teaser thumbnails, feature tour with sample spreads. Evidence: check-site + copy review PASS.
- **H6 numbers pipeline:** one generator → one JSON → strip/hero/dashboard/world-stats read it; changelog entry becomes ship-checklist item. Evidence: test asserts all surfaces equal.

## Phase H3 — Fixes + search + dashboard (cards 7–9)
- **H7 trust fixes:** admin gate generic denial (no owner email leak); form errors rewritten as next-step sentences; request-access adds name/inviter; clear-trail wipes both or says so; merge twin ledgers into one pulse feed. Evidence: adversary review on gate change.
- **H8 search:** typo-tolerant local matching; per-article find; slide-over search panel (context-preserving). Evidence: search tests green.
- **H9 dashboard life:** continue-working strip (last 5 folios); per-member task list; single pulse feed. Evidence: dashboard tests green.

## Phase H4 — Content depth (cards 10–13)
- **H10 secrets:** reveal-state previews; pin visibility via reveals table; owner/Mikhail/Arcady/invitee tiers. Evidence: double review (adversary hunts leaks).
- **H11 writing:** @mentions in manuscripts; inventories on entities; dual-date journals; POV voice; chapter transcripts synced to audio. Evidence: per-feature tests, no invented data.
- **H12 structure:** living calendar (events/ages/moons); quest rewards+flags; nested locations with breadcrumbs; editable relationship manager. Evidence: per-feature tests.
- **H13 curation:** gallery image mass-edit; manuscript presence dots (no block, presence only v1). Evidence: tests green.

## Phase H5 — Big features (cards 14–19)
- **H14 live whiteboards:** shared cards + live cursors (websocket or 5s poll v1). Needs new D1 table or Durable Object — plan first, approve before build.
- **H15 DM run-mode:** fullscreen desk, secrets+pins+oracle in reach. Evidence: keyboard-only run-through test.
- **H16 relation explorer:** full vault graph for any entity (build-time edges JSON + SVG). Evidence: no invented edges (test pins every edge to vault).
- **H17 compiler:** DOCX/EPUB export with Ge'or styling. Evidence: round-trip test.
- **H18 modules:** one-click canon import packs (generator + manifest + test). Evidence: re-import of gazetteer PDF data green.
- **H19 offline-first:** local vault snapshot + queued writes sync on reconnect. Needs sync protocol — plan first.

## Phase H6 — Systems (cards 20–25)
- **H20 guided entry:** template forms per entity writing vault-shaped markdown. Evidence: output passes vault lint.
- **H21 recap engine:** session entries auto-link entities, pin to timeline+calendar. Evidence: entity-link test.
- **H22 co-authors:** Arcady editor role + review queue (draft→review→canon). Evidence: double review (auth).
- **H23 world clock:** date-advance ages characters/flags stale pages. Needs canon rules from Mikhail first — spec gate before build.
- **H24 mobile+perf+print:** touch-native atlas; perf budget in CI (landing <1.5s/4G); print CSS for articles. Evidence: budget test.
- **H25 Arcady onboarding:** 5-step first-login tour. Evidence: tour completes in test.

## Acceptance per card
`npm run verify` (tests + check-site) green · review PASS · `[verified]` commit ·
push · deploy + anon curl proof (200 public / 302 gated). Fuse: 2 fix cycles per
gate, then escalate to Mikhail. Checkpoint: todo list after every card.
