# World of Ge'or — worldofgeor.com

Private, invite-only worldbuilding archive for Mikhail & Ichi. The public landing page and updates ledger introduce Ge'or; the wiki, atlas, species gallery, search, Battlestation, dashboard, admin room, and Atlas Studio are protected by the Cloudflare Worker.

## Architecture

- Vite 6 + Tailwind 3 + vanilla JavaScript, built into `dist/`
- Cloudflare Workers + Assets, configured by `wrangler.jsonc`
- D1-backed invitations, accounts, activity, shared maps, cross-device reading collections, editorial workflow, and privacy-preserving abuse throttles
- PBKDF2 password hashes with transparent upgrades from the legacy format
- HttpOnly, Secure, SameSite=Strict JWT session cookie
- Private additions published to `actualrat1984/Website-additions` through the GitHub API
- A unified private archive shell with an omnibox, contextual wiki reading tools, Atlas split view, PWA shell, and mobile dock
- No public indexing: pages and responses carry `noindex`, and private files are gated in the Worker
- Offline mode caches only public shell assets. Private pages require a live membership check; an offline retry screen replaces saved private HTML, and old private page caches are removed when the service worker updates.

## Local development

```sh
npm ci
npm run dev
```

Vite opens on port 5173 by default. The static frontend can be built without the private lore vault:

```sh
npm run build:vite
npm run check:site
```

## Full build

The wiki build expects a MkDocs source directory containing `mkdocs.yml`, `generate_nav.py`, and `optimize_assets.py`. It defaults to the maintainer's existing lore location. Set `GEOR_LORE_SITE` to use a different checkout:

```sh
GEOR_LORE_SITE=/path/to/Lore/site npm run build:wiki
npm run build
npm run verify
```

The wiki build writes the wiki and all supporting indexes to this repository's own `dist/wiki` directory regardless of where it is cloned. `npm run build` builds the frontend only and preserves the wiki output.

To regenerate the archive indexes from the lore vault without rebuilding MkDocs, run `npm run build:indices`. Set `GEOR_LORE_VAULT` to the directory containing `World/`; otherwise it defaults to the parent of `GEOR_LORE_SITE` or the maintainer's existing vault. Index generation only reads the vault. The full test suite (`npm run verify`) requires these generated indexes; a fresh checkout may not contain them.

## Cloudflare deployment

Apply D1 migrations before deploying Worker changes, then verify the Worker bundle:

```sh
npx wrangler d1 migrations apply worldofgeor-db --remote
npm run build
npx wrangler deploy --dry-run
```

Production requires the `JWT_SECRET` and `GITHUB_TOKEN` Worker secrets. Do not commit either value. Deploy for real only after reviewing the dry run.
