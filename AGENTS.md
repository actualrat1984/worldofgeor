# AGENTS — World of Ge'or

> You are running on **gpt-5.6-sol with `model_reasoning_effort = "xhigh"`**.
> Do NOT downgrade the model. If you are launched with a different model, stop and tell Mikhail.
> Verify at start: read `~/.codex/config.toml` and confirm `model = "gpt-5.6-sol"` and `model_reasoning_effort = "xhigh"`.

## Project — worldofgeor.com

Private, invite-only worldbuilding archive for Mikhail & Ichi. **Never add SEO, sitemap, or public indexing.** Gated by invite code + JWT cookie `geor_token`.

- **Stack:** Vite 6.4.3 + Tailwind 3.4 + vanilla JS (src/main.js, style.css) → `dist/`
- **Hosting:** Cloudflare Workers + Assets (worker.js + wrangler.jsonc). `run_worker_first: true`, SPA fallback.
- **Auth:** Worker handles `/api/register` `/api/login` `/api/me` `/api/additions` — D1 `worldofgeor-db`, PBKDF2 100k + HMAC HS256 JWT (30d), HttpOnly cookie. Invite codes live only in `D1.invites`. ENV secrets: `JWT_SECRET`, `GITHUB_TOKEN`.
- **Additions:** Authenticated users commit markdown via `worker.js` → `actualrat1984/Website-additions` (branch main) via GitHub API. Sanitize paths strictly — no `..`, no `//`, max 180 chars, segments max 80.
- **Wiki:** MkDocs build from `C:/Users/pc/Documents/Lore/Lore/site/` into `dist/wiki/` via `npm run build:wiki` (generate_nav.py + mkdocs build + optimize_assets.py + generate-wiki-index.py). Never break wiki generation.
- **Design:** Premium, not functional. `slate/amber` + `gold/cream/ink` palette, Cinzel + Cormorant + Inter. Polish matters — concierge feel, not stock.

## Rules

1. **Don't expose secrets.** Never log `JWT_SECRET`, `GITHUB_TOKEN`, or `DB` ids in output. Never commit `.env`.
2. **Keep private.** No SEO, no robots.txt allowing crawl, no public sitemap. Respect `geor_token` gate.
3. **Verify live.** After any build/worker change: `npm run build && npx wrangler deploy --dry-run` (or real deploy only if Mikhail asks), then `curl -I https://worldofgeor.com` expect 200/302. Test `/api/me` without token → 401.
4. **No mass renames without ask.** Vault files (Lore) are not yours — check placement via `Knowledge/` index.
5. **Close is better than clever.** Prefer small, correct patches. Test with `npm run dev` if touching frontend.
6. **You run on Sol Extra High for a reason** — think deep, verify, don't rush artifacts. Quality > speed.

## Common Tasks

```bash
# dev
npm run dev          # vite
npm run build        # vite + wiki (full)
npm run build:vite   # vite only

# deploy (needs CLOUDFLARE_API_TOKEN or `wrangler login`)
npx wrangler deploy
npx wrangler d1 execute worldofgeor-db --command "SELECT * FROM users LIMIT 5"

# audit
npm run build && npx wrangler deploy --dry-run
```

## When Mikhail says "run over the site"

Do a full pass:
1. `read_file` package.json, vite.config.js, wrangler.jsonc, worker.js, src/main.js, index.html
2. Check: security (JWT timing, PBKDF2, sanitizeAdditionsPath, cookie flags Secure/HttpOnly/SameSite, CORS), performance (fonts, image preload, tailwind purge), correctness (SPA routing, /wiki, /updates, auth flows), a11y, premium polish
3. Propose patches — don't push until approved
4. Verify with build + curl

Keep this file short. Update it only when architecture changes.
