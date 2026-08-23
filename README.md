# World of Ge'or — worldofgeor.com

Professional marketing site for the world of Ge'or. Not a vault wiki.

- Stack: Vite + Tailwind 3 + vanilla JS
- Deploy: Cloudflare Pages (static)
- Domain: worldofgeor.com (Cloudflare Registrar)

## Dev
npm install
npm run dev # :5173
npm run build # -> dist/

## Deploy
Push to `main` -> Cloudflare Pages auto-build.
Or: Pages -> Create -> Connect to Git -> actualrat1984/worldofgeor
  Build command: npm run build
  Output: dist
