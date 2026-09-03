// worldofgeor — Worker + Assets + D1 invite-only auth
// Serves /dist via ASSETS, handles /api/register + /api/login + /api/me + /api/additions
// Invite codes stored in D1.invites — you own the DB.
// Additions: commits to https://github.com/actualrat1984/Website-additions via GITHUB_TOKEN secret

const JWT_EXP_SEC = 60 * 60 * 24 * 30; // 30 days
const JWT_ISSUER = 'worldofgeor';
const COOKIE_NAME = 'geor_token';
const ADMIN_EMAIL = 'ichieisenheart@gmail.com';
const PASSWORD_ITERATIONS = 600_000;
const LEGACY_PASSWORD_ITERATIONS = 100_000;
const PASSWORD_HASH_SCHEME = 'pbkdf2-sha256';
const MAX_JSON_BYTES = 4_096;
const MAX_SAVE_JSON_BYTES = 1_000_000;
const MAX_MAP_JSON_BYTES = 512_000;
const MAP_SLUGS = new Set(['world', 'grimmel']);
const MAP_DIMENSIONS = Object.freeze({
  world: { width: 3840, height: 1920 },
  grimmel: { width: 3840, height: 5715 },
});
const RELEASE_CHANGELOG = Object.freeze([
  { id: 'release-unified-archive', action: 'feature', path: '/dashboard', summary: 'A unified archive shell, cross-device collections, contextual lore tools, deep links, and an editorial workflow connected every room', created_at: '2026-09-02T20:00:00Z' },
  { id: 'release-reader-experience', action: 'feature', path: '/dashboard', summary: 'Personal reading trails, saved folios, richer search, fullscreen maps, and recoverable Atlas drafts joined the archive', created_at: '2026-09-02T12:00:00Z' },
  { id: 'release-compass', action: 'feature', path: '/search', summary: 'Archive Compass added instant Cmd/Ctrl+K navigation across every private room', created_at: '2026-09-01T13:10:00Z' },
  { id: 'release-auth-v2', action: 'security', path: '/', summary: 'Password hashing and abuse protection received a transparent security upgrade', created_at: '2026-09-01T13:09:59Z' },
  { id: 'release-species', action: 'feature', path: '/species', summary: 'Species Gallery opened with 34 filterable folios', created_at: '2026-09-01T03:56:24Z' },
  { id: 'release-stats', action: 'feature', path: '/dashboard', summary: 'World Stats joined the private member dashboard', created_at: '2026-09-01T03:56:23Z' },
  { id: 'release-studio', action: 'map', path: '/map-editor', summary: 'Atlas Studio and archive search went live', created_at: '2026-09-01T02:53:10Z' },
  { id: 'release-reserve', action: 'security', path: '/', summary: 'Reserve hardening strengthened the private archive', created_at: '2026-08-31T07:03:16Z' },
  { id: 'release-atlas', action: 'map', path: '/atlas', summary: 'The interactive Leaflet Atlas opened its first folios', created_at: '2026-08-31T03:58:50Z' },
  { id: 'release-ledger', action: 'launch', path: '/updates', summary: 'The public, privacy-safe updates ledger launched', created_at: '2026-08-31T03:58:49Z' },
]);
const DUMMY_PASSWORD_SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const RATE_LIMITS = Object.freeze({
  login: { attempts: 8, windowSeconds: 15 * 60 },
  register: { attempts: 5, windowSeconds: 60 * 60 },
  requestAccess: { attempts: 3, windowSeconds: 60 * 60 },
});
const ALLOWED_ADDITION_EXTENSIONS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'csv']);
const PRIVATE_ASSET_PATHS = new Set([
  '/wiki-index.json',
  '/world-map.jpg',
  '/world-map.webp',
  '/world-map-thumb.jpg',
  '/world-map-thumb.webp',
  '/grimmel-peninsula.jpg',
  '/grimmel-peninsula.webp',
  '/central-erisdar.jpg',
  '/central-erisdar.webp',
  '/central-erisdar-thumb.jpg',
  '/map-editor.css',
  '/map-editor.js',
  '/species.css',
  '/species.js',
  '/search.js',
  '/archive-compass.css',
  '/archive-compass.js',
]);
const ROUTE_ALIASES = new Map([
  ['/updates', '/updates.html'],
  ['/updates/', '/updates.html'],
  ['/atlas', '/atlas.html'],
  ['/atlas/', '/atlas.html'],
  ['/map-editor', '/map-editor.html'],
  ['/map-editor/', '/map-editor.html'],
  ['/species', '/species.html'],
  ['/species/', '/species.html'],
  ['/search', '/search.html'],
  ['/search/', '/search.html'],
  ['/dashboard', '/dashboard.html'],
  ['/dashboard/', '/dashboard.html'],
  ['/admin', '/admin.html'],
  ['/admin/', '/admin.html'],
  ['/app', '/app/index.html'],
]);
const ADDITIONS_OWNER = 'actualrat1984';
const ADDITIONS_REPO = 'Website-additions';
const ADDITIONS_BRANCH = 'main';

function b64url(bytes) {
  let s = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}
async function hmacSha256(keyStr, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
async function verifyHmacSha256(keyStr, data, signature) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(data));
}
async function pbkdf2Hash(password, saltB64, iterations = 100000) {
  const salt = b64urlDecode(saltB64);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return b64url(new Uint8Array(bits));
}
function parsePasswordHash(value) {
  if (typeof value !== 'string') return null;
  const modern = value.match(/^pbkdf2-sha256\$(\d{6,7})\$([A-Za-z0-9_-]{40,48})$/);
  if (modern) {
    const iterations = Number(modern[1]);
    if (!Number.isSafeInteger(iterations) || iterations < LEGACY_PASSWORD_ITERATIONS || iterations > 2_000_000) return null;
    return { digest: modern[2], iterations, modern: true };
  }
  return /^[A-Za-z0-9_-]{40,48}$/.test(value)
    ? { digest: value, iterations: LEGACY_PASSWORD_ITERATIONS, modern: false }
    : null;
}
async function createPasswordHash(password, saltB64, iterations = PASSWORD_ITERATIONS) {
  const digest = await pbkdf2Hash(password, saltB64, iterations);
  return `${PASSWORD_HASH_SCHEME}$${iterations}$${digest}`;
}
async function verifyPassword(password, saltB64, storedHash) {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return { ok: false, needsUpgrade: false };
  const digest = await pbkdf2Hash(password, saltB64, parsed.iterations);
  // Keep legacy-account checks close to the modern work factor so response
  // timing does not reveal which addresses still need a transparent upgrade.
  if (parsed.iterations < PASSWORD_ITERATIONS) {
    await pbkdf2Hash(password, DUMMY_PASSWORD_SALT, PASSWORD_ITERATIONS - parsed.iterations);
  }
  return { ok: constantTimeEqual(digest, parsed.digest), needsUpgrade: !parsed.modern || parsed.iterations < PASSWORD_ITERATIONS };
}
function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return b64url(a);
}
async function signJwt(payload, secret) {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const sig = await hmacSha256(secret, data);
  return `${data}.${b64url(sig)}`;
}
async function verifyJwt(token, secret) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;
    const signature = b64urlDecode(parts[2]);
    if (signature.length !== 32) return null;
    const data = `${parts[0]}.${parts[1]}`;
    if (!(await verifyHmacSha256(secret, data, signature))) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(payload?.exp) || payload.exp <= now || payload.exp > now + JWT_EXP_SEC + 60) return null;
    if (!Number.isSafeInteger(payload.iat) || payload.iat > now + 60 || payload.iat >= payload.exp) return null;
    if (payload.iss !== JWT_ISSUER) return null;
    if (typeof payload.email !== 'string' || !isValidEmail(payload.email)) return null;
    return payload;
  } catch { return null; }
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...extra,
    },
  });
}
function parseCookies(req) {
  const h = req.headers.get('Cookie') || '';
  const o = {};
  h.split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (!k) return;
    try { o[k] = decodeURIComponent(v.join('=')); } catch { o[k] = ''; }
  });
  return o;
}

function getJwtSecret(env) {
  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('JWT configuration unavailable');
  return secret;
}
function readBearerToken(request) {
  const match = request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}
function readAuthToken(request) {
  return parseCookies(request)[COOKIE_NAME] || readBearerToken(request);
}
function authCookie(token, maxAge = JWT_EXP_SEC) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}
function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanArchivePath(value) {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('\0') || path.length > 500) return null;
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (decoded.split('/').some(segment => segment === '..')) return null;
  return path;
}

function cleanArchiveTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 180) : null;
}

function cleanWorkflowKind(value) {
  return value === 'map' || value === 'addition' ? value : null;
}

function cleanWorkflowStatus(value) {
  return ['draft', 'review', 'approved', 'published'].includes(value) ? value : null;
}
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let left;
  let right;
  try { left = b64urlDecode(a); right = b64urlDecode(b); } catch { return false; }
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
async function readJson(request, maxBytes = MAX_JSON_BYTES) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError('Request too large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new RangeError('Request too large');
  try { return JSON.parse(text); } catch { throw new SyntaxError('Invalid JSON'); }
}
function isTrustedMutation(request, url) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return false;
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}
async function rateLimitKey(request, env, scope) {
  const address = request.headers.get('CF-Connecting-IP');
  if (!address) return null;
  const signature = await hmacSha256(getJwtSecret(env), `${scope}\0${address}`);
  return `${scope}:${b64url(signature).slice(0, 32)}`;
}
async function consumeRateLimit(request, env, scope) {
  const config = RATE_LIMITS[scope];
  if (!config || !env.DB) return { allowed: true, retryAfter: 0, key: null };
  const key = await rateLimitKey(request, env, scope);
  if (!key) return { allowed: true, retryAfter: 0, key: null };
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + config.windowSeconds;
  await env.DB.prepare(`INSERT INTO rate_limits (key, attempts, reset_at, updated_at)
    VALUES (?, 1, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.attempts + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
    .bind(key, resetAt, now, now).run();
  const record = await env.DB.prepare('SELECT attempts, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  const attempts = Number(record?.attempts || 0);
  const retryAfter = Math.max(1, Number(record?.reset_at || resetAt) - now);
  return { allowed: attempts <= config.attempts, retryAfter, key };
}
async function clearRateLimit(env, key) {
  if (env.DB && key) await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
function rateLimited(retryAfter) {
  return json({ error: 'Too many attempts — wait a little before trying again' }, 429, { 'Retry-After': String(retryAfter) });
}
function cleanInviteCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '_') : '';
  return /^[A-Z0-9][A-Z0-9_-]{5,63}$/.test(code) ? code : null;
}
function randomInviteCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `GEOR_${b64url(bytes).toUpperCase()}`;
}
function validPositiveId(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
function isPrivatePath(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch {}
  return decoded === '/wiki' || decoded.startsWith('/wiki/') ||
    decoded === '/app' || decoded.startsWith('/app/') ||
    ['/atlas', '/map-editor', '/species', '/search', '/dashboard', '/admin']
      .some(root => decoded === root || decoded === `${root}/` || decoded === `${root}.html`) ||
    PRIVATE_ASSET_PATHS.has(decoded);
}

function cleanMapSlug(value) {
  return typeof value === 'string' && MAP_SLUGS.has(value) ? value : null;
}
function cleanMapText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
function cleanMapPoint(value, slug) {
  if (!isJsonObject(value)) return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const dimensions = MAP_DIMENSIONS[slug];
  if (!dimensions || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 0 || lng < 0 || lat > dimensions.height || lng > dimensions.width) return null;
  return { lat: Math.round(lat), lng: Math.round(lng) };
}
function sanitizeMapDocument(value, slug) {
  if (!isJsonObject(value) || value.version !== 1 || value.slug !== slug || !Array.isArray(value.layers)) return null;
  if (value.layers.length < 1 || value.layers.length > 12) return null;
  const seenLayers = new Set();
  const seenFeatures = new Set();
  let featureCount = 0;
  const layers = [];
  for (const layer of value.layers) {
    if (!isJsonObject(layer) || !Array.isArray(layer.features) || layer.features.length > 250) return null;
    const id = cleanMapText(layer.id, 48);
    const name = cleanMapText(layer.name, 64);
    if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(id) || !name || seenLayers.has(id)) return null;
    seenLayers.add(id);
    const features = [];
    for (const feature of layer.features) {
      featureCount++;
      if (featureCount > 500 || !isJsonObject(feature)) return null;
      const featureId = cleanMapText(feature.id, 64);
      const type = feature.type;
      if (!/^[a-z0-9][a-z0-9_-]{5,63}$/i.test(featureId) || seenFeatures.has(featureId) || !['marker', 'label', 'polygon'].includes(type)) return null;
      seenFeatures.add(featureId);
      const nameValue = cleanMapText(feature.name, 100);
      const note = cleanMapText(feature.note, 500);
      const wikiUrl = cleanMapText(feature.wikiUrl, 240);
      if (wikiUrl && (!wikiUrl.startsWith('/wiki/') || wikiUrl.includes('..') || wikiUrl.includes('\\'))) return null;
      const color = /^#[0-9a-f]{6}$/i.test(feature.color) ? feature.color.toLowerCase() : '#d9b77a';
      const icon = ['keep', 'city', 'port', 'ruin', 'star'].includes(feature.icon) ? feature.icon : 'keep';
      if (type === 'polygon') {
        if (!Array.isArray(feature.points) || feature.points.length < 3 || feature.points.length > 250) return null;
        const points = feature.points.map(point => cleanMapPoint(point, slug));
        if (points.some(point => !point)) return null;
        features.push({ id: featureId, type, name: nameValue, note, wikiUrl, color, points });
      } else {
        const point = cleanMapPoint(feature.point, slug);
        if (!point) return null;
        features.push({ id: featureId, type, name: nameValue, note, wikiUrl, color, icon, point });
      }
    }
    layers.push({ id, name, visible: layer.visible !== false, locked: layer.locked === true, features });
  }
  return {
    version: 1,
    slug,
    title: cleanMapText(value.title, 100) || (slug === 'world' ? 'World Atlas' : 'Grimmel Peninsula'),
    layers,
  };
}

// --- Additions helpers ---
async function requireUser(request, env) {
  try {
    const secret = getJwtSecret(env);
    const token = readAuthToken(request);
    if (!token) return null;
    return await verifyJwt(token, secret);
  } catch { return null; }
}
function sanitizeAdditionsPath(p) {
  if (p == null) return null;
  p = String(p).trim();
  if (p.startsWith('/')) return null;
  if (!p) return null;
  if (p.includes('\\') || p.includes('//')) return null;
  if (!/^[A-Za-z0-9._\-\/ ]+$/.test(p)) return null;
  if (p.length > 180) return null;
  if (p.startsWith('.') || p.startsWith('/')) return null;
  const parts = p.split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const seg of parts) {
    if (seg.length > 80) return null;
    if (seg === '.' || seg === '..' || seg.startsWith('.') || seg.endsWith('.')) return null;
  }
  const filename = parts.at(-1);
  if (!filename.includes('.')) parts[parts.length - 1] += '.md';
  const extension = parts.at(-1).split('.').pop().toLowerCase();
  if (!ALLOWED_ADDITION_EXTENSIONS.has(extension)) return null;
  return parts.join('/');
}
function sanitizeFolderPath(p) {
  if (p == null) return null;
  p = String(p).trim();
  if (p.startsWith('/')) return null;
  p = p.replace(/\/+$/, '');
  if (!p) return null;
  if (p.includes('\\') || p.includes('//')) return null;
  if (!/^[A-Za-z0-9._\-\/ ]+$/.test(p)) return null;
  if (p.length > 180) return null;
  if (p.startsWith('.') || p.startsWith('/')) return null;
  const parts = p.split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const seg of parts) {
    if (seg.length > 80) return null;
    if (seg === '.' || seg === '..' || seg.startsWith('.') || seg.endsWith('.')) return null;
  }
  return parts.join('/');
}
function safeAdditionListPath(value) {
  if (typeof value !== 'string' || value.startsWith('.')) return null;
  if (value.endsWith('/.gitkeep')) {
    const folder = sanitizeFolderPath(value.slice(0, -'/.gitkeep'.length));
    return folder ? value : null;
  }
  const safe = sanitizeAdditionsPath(value);
  return safe === value ? safe : null;
}
function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function b64DecodeUtf8(b64) {
  // strip whitespace/newlines GitHub may include
  b64 = b64.replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function ghApi(path, init, env) {
  const token = env.GITHUB_TOKEN;
  if (!token) throw new Error('GitHub integration unavailable');
  const url = `https://api.github.com${path}`;
  return fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'worldofgeor-worker',
      ...(init.headers || {})
    }
  });
}

function withPrivateArchiveShell(response) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/html') || response.status < 200 || response.status >= 300 || typeof HTMLRewriter === 'undefined') return response;
  return new HTMLRewriter()
    .on('head', { element(element) { element.append('<link rel="stylesheet" href="/archive-compass.css"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0f0e0d">', { html: true }); } })
    .on('body', { element(element) { element.append('<script type="module" src="/archive-compass.js"></script>', { html: true }); } })
    .transform(response);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    // Crawlers must never infer a public sitemap: unknown paths fall through to
    // the SPA shell, so answer these two explicitly (private archive, no SEO).
    if (url.pathname === '/sitemap.xml') return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });
    // --- API routes ---
    if (url.pathname.startsWith('/api/')) {
      // auto-migrate tables if missing (so /api/register 500 never happens)
      async function ensureTables() {
        if (!env.DB) throw new Error('Database unavailable');
        await env.DB.batch([
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, invite_code TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, used_by TEXT, used_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, path TEXT, summary TEXT NOT NULL, actor_email TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS map_documents (slug TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS member_library (user_email TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'folio', progress INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, last_visited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (user_email, path))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', content_json TEXT NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), UNIQUE(kind, path))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_history (id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, actor_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_member_library_recent ON member_library(user_email, last_visited_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_member_library_saved ON member_library(user_email, saved, updated_at DESC) WHERE saved = 1`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_workflow_status_updated ON workflow_items(status, updated_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_workflow_history_item ON workflow_history(workflow_id, created_at DESC)`),
        ]);
      }

      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isTrustedMutation(request, url)) {
        return json({ error: 'Cross-origin request rejected' }, 403);
      }
      // CORS is granted only to this exact origin; other preflights fail closed.
      if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin');
        if (origin !== url.origin) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Credentials': 'true',
            'Access-Control-Max-Age': '600',
            'Vary': 'Origin',
          },
        });
      }

      // POST /api/register  {email, password, inviteCode}
      if (url.pathname === '/api/register' && request.method === 'POST') {
        try {
          const secret = getJwtSecret(env);
          await ensureTables();
          const throttle = await consumeRateLimit(request, env, 'register');
          if (!throttle.allowed) return rateLimited(throttle.retryAfter);
          const body = await readJson(request);
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const { email, password, inviteCode } = body;
          if (!email || !password || !inviteCode) return json({ error: 'Missing fields' }, 400);
          if (typeof password !== 'string' || password.length < 12 || password.length > 256) return json({ error: 'Password must be 12–256 characters' }, 400);
          const normEmail = normalizeEmail(email);
          if (!isValidEmail(normEmail)) return json({ error: 'Valid email required' }, 400);
          const cleanCode = cleanInviteCode(inviteCode);
          if (!cleanCode) return json({ error: 'Invalid or unavailable invite code' }, 403);
          const salt = randomSalt();
          const [exists, hash] = await Promise.all([
            env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normEmail).first(),
            createPasswordHash(password, salt),
          ]);
          if (exists) return json({ error: 'Invalid or unavailable invite code' }, 403);
          const results = await env.DB.batch([
            env.DB.prepare(`INSERT INTO users (email, password_hash, salt, invite_code)
              SELECT ?, ?, ?, ? WHERE EXISTS (
                SELECT 1 FROM invites WHERE code = ? AND used_by IS NULL
              )`).bind(normEmail, hash, salt, cleanCode, cleanCode),
            env.DB.prepare(`UPDATE invites SET used_by = ?, used_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
              WHERE code = ? AND used_by IS NULL
                AND EXISTS (SELECT 1 FROM users WHERE email = ? AND invite_code = ?)`).bind(normEmail, cleanCode, normEmail, cleanCode),
          ]);
          if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1) {
            return json({ error: 'Invalid or unavailable invite code' }, 403);
          }
          const now = Math.floor(Date.now() / 1000);
          const token = await signJwt({ email: normEmail, iss: JWT_ISSUER, iat: now, exp: now + JWT_EXP_SEC }, secret);
          return json({ ok: true, email: normEmail }, 200, { 'Set-Cookie': authCookie(token) });
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Registration is temporarily unavailable' }, 500);
        }
      }

      // POST /api/login  {email, password}
      if (url.pathname === '/api/login' && request.method === 'POST') {
        try {
          await ensureTables();
          const throttle = await consumeRateLimit(request, env, 'login');
          if (!throttle.allowed) return rateLimited(throttle.retryAfter);
          const body = await readJson(request);
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const { email, password } = body;
          if (!email || !password) return json({ error: 'Missing fields' }, 400);
          if (typeof password !== 'string' || password.length > 256) return json({ error: 'Invalid email or password' }, 401);
          const normEmail = normalizeEmail(email);
          if (!isValidEmail(normEmail)) return json({ error: 'Invalid email or password' }, 401);
          const user = await env.DB.prepare('SELECT email, password_hash, salt FROM users WHERE email = ?').bind(normEmail).first();
          const passwordCheck = user
            ? await verifyPassword(password, user.salt, user.password_hash)
            : (await pbkdf2Hash(password, DUMMY_PASSWORD_SALT, PASSWORD_ITERATIONS), { ok: false, needsUpgrade: false });
          if (!user || !passwordCheck.ok) return json({ error: 'Invalid email or password' }, 401);
          const secret = getJwtSecret(env);
          const now = Math.floor(Date.now() / 1000);
          const token = await signJwt({ email: normEmail, iss: JWT_ISSUER, iat: now, exp: now + JWT_EXP_SEC }, secret);
          await clearRateLimit(env, throttle.key);
          if (passwordCheck.needsUpgrade) {
            const upgradedSalt = randomSalt();
            const upgradedHash = await createPasswordHash(password, upgradedSalt);
            const upgrade = env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE email = ? AND password_hash = ?')
              .bind(upgradedHash, upgradedSalt, normEmail, user.password_hash).run().catch(() => {});
            if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(upgrade); else await upgrade;
          }
          return json({ ok: true, email: normEmail }, 200, { 'Set-Cookie': authCookie(token) });
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Login is temporarily unavailable' }, 500);
        }
      }

      // GET /api/updates — public, privacy-safe archive activity.
      if (url.pathname === '/api/updates' && request.method === 'GET') {
        const requestedLimit = Number(url.searchParams.get('limit') || 18);
        const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 18;
        try {
          await ensureTables();
          const { results } = await env.DB.prepare(`SELECT id, action, summary, created_at
            FROM activity ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit).all();
          const hasActivity = Array.isArray(results) && results.length > 0;
          return json({
            updates: hasActivity ? results : RELEASE_CHANGELOG.slice(0, limit),
            source: hasActivity ? 'activity' : 'changelog',
            refreshedAt: new Date().toISOString(),
          }, 200, {
            'Cache-Control': 'public, max-age=15, stale-while-revalidate=120',
          });
        } catch {
          return json({ updates: RELEASE_CHANGELOG.slice(0, limit), source: 'changelog', liveUnavailable: true, refreshedAt: new Date().toISOString() }, 200, {
            'Cache-Control': 'public, max-age=15',
          });
        }
      }

      // GET /api/world-stats — authenticated rollup of the built vault index + D1 activity.
      if (url.pathname === '/api/world-stats' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        try {
          await ensureTables();
          const indexResponse = await env.ASSETS.fetch(new Request(new URL('/wiki-index.json', url), { headers: { Accept: 'application/json' } }));
          if (!indexResponse.ok) throw new Error('Archive index unavailable');
          const index = await indexResponse.json();
          if (!Array.isArray(index) || !index.every(item => typeof item?.url === 'string')) throw new Error('Archive index invalid');
          const countPrefix = prefix => index.reduce((total, item) => total + Number(item.url.startsWith(prefix)), 0);
          const [activity, mapFolios, workflow, savedFolios] = await env.DB.batch([
            env.DB.prepare('SELECT COUNT(*) AS count FROM activity'),
            env.DB.prepare('SELECT COUNT(*) AS count FROM map_documents'),
            env.DB.prepare("SELECT COUNT(*) AS count FROM workflow_items WHERE status != 'published'"),
            env.DB.prepare("SELECT COUNT(*) AS count FROM member_library WHERE saved = 1 AND kind != 'system'"),
          ]);
          return json({
            // Canonical counts derive from the built archive index (live data, not
            // hardcoded memory); ages = 12 Ages + Lost Era, continents per map canon.
            canonical: { nations: countPrefix('/wiki/World/Nations/'), species: countPrefix('/wiki/World/Species/'), ages: 13, continents: 17 },
            archive: {
              pages: index.length,
              nations: countPrefix('/wiki/World/Nations/'),
              species: countPrefix('/wiki/World/Species/'),
              history: countPrefix('/wiki/World/History/'),
              locations: countPrefix('/wiki/World/Locations/'),
              systems: countPrefix('/wiki/World/Systems/'),
            },
            live: {
              activity: activity.results?.[0]?.count || 0,
              mapFolios: mapFolios.results?.[0]?.count || 0,
              workflow: workflow.results?.[0]?.count || 0,
              savedFolios: savedFolios.results?.[0]?.count || 0,
            },
            refreshedAt: new Date().toISOString(),
          });
        } catch {
          return json({ error: 'World ledger is temporarily unavailable' }, 503);
        }
      }

      // POST /api/request-access  {email, message} — public, creates pending request + emails admin
      if (url.pathname === '/api/request-access' && request.method === 'POST') {
        try {
          await ensureTables();
          const throttle = await consumeRateLimit(request, env, 'requestAccess');
          if (!throttle.allowed) return rateLimited(throttle.retryAfter);
          const body = await readJson(request);
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const { email, message } = body;
          const norm = normalizeEmail(email);
          if (!isValidEmail(norm)) return json({ error: 'Valid email required' }, 400);
          if (message != null && typeof message !== 'string') return json({ error: 'Message must be text' }, 400);
          const existsUser = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(norm).first();
          if (existsUser) return json({ error: 'Email already registered — try login' }, 409);
          const existsReq = await env.DB.prepare('SELECT id FROM requests WHERE email = ? AND status = "pending"').bind(norm).first();
          if (existsReq) return json({ error: 'Request already pending — we will email you' }, 409);
          await env.DB.prepare('INSERT INTO requests (email, message) VALUES (?, ?)').bind(norm, (message||'').slice(0,500)).run();
          // notify admin via MailChannels (Cloudflare Workers email) — best effort, never blocks response
          const adminEmail = 'ichieisenheart@gmail.com';
          const notifyFrom = 'noreply@worldofgeor.com';
          ctx.waitUntil((async () => {
            try {
              const subject = `New access request: ${norm}`;
              const text = `New request for World of Ge'or\n\nEmail: ${norm}\nMessage: ${(message||'(no message)').slice(0,800)}\n\nApprove in /admin.html or D1: INSERT INTO invites(code) VALUES ('INVITE_...'); then share code with user.\nTime: ${new Date().toISOString()}\n`;
              await fetch('https://api.mailchannels.net/tx/v1/send', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  personalizations: [{ to: [{ email: adminEmail, name: 'Mikhail' }] }],
                  from: { email: notifyFrom, name: "World of Ge'or" },
                  subject,
                  content: [{ type: 'text/plain', value: text }],
                })
              });
            } catch {}
          })());
          return json({ ok: true });
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Request could not be saved' }, 500);
        }
      }

      // GET /api/me  -> {email} if logged in
      if (url.pathname === '/api/me' && request.method === 'GET') {
        try {
          const token = readAuthToken(request);
          if (!token) return json({ error: 'Authentication required', user: null }, 401);
          const payload = await verifyJwt(token, getJwtSecret(env));
          if (!payload) return json({ error: 'Invalid or expired session', user: null }, 401, { 'Set-Cookie': authCookie('', 0) });
          return json({ user: { email: payload.email } }, 200);
        } catch {
          return json({ error: 'Authentication unavailable', user: null }, 503);
        }
      }

      // POST /api/logout
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, { 'Set-Cookie': authCookie('', 0) });
      }

      // POST /api/change-password {currentPassword, newPassword}
      if (url.pathname === '/api/change-password' && request.method === 'POST') {
        const session = await requireUser(request, env);
        if (!session) return json({ error: 'Authentication required' }, 401);
        let body;
        try { body = await readJson(request); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const { currentPassword, newPassword } = body;
        if (typeof currentPassword !== 'string' || currentPassword.length > 256) return json({ error: 'Current password is incorrect' }, 401);
        if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 256) return json({ error: 'New password must be 12–256 characters' }, 400);
        if (currentPassword === newPassword) return json({ error: 'Choose a different password' }, 400);
        try {
          await ensureTables();
          const user = await env.DB.prepare('SELECT password_hash, salt FROM users WHERE email = ?').bind(session.email).first();
          if (!user) return json({ error: 'Account not found' }, 404);
          const currentCheck = await verifyPassword(currentPassword, user.salt, user.password_hash);
          if (!currentCheck.ok) return json({ error: 'Current password is incorrect' }, 401);
          const salt = randomSalt();
          const passwordHash = await createPasswordHash(newPassword, salt);
          await env.DB.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE email = ?').bind(passwordHash, salt, session.email).run();
          return json({ ok: true });
        } catch {
          return json({ error: 'Password could not be changed' }, 500);
        }
      }

      // Member reading state and saved folios, synchronized across signed-in devices.
      if (url.pathname === '/api/archive-state' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        try {
          await ensureTables();
          const [recent, saved, marker] = await env.DB.batch([
            env.DB.prepare(`SELECT path, title, kind, progress, saved, last_visited_at, updated_at FROM member_library
              WHERE user_email = ? AND kind != 'system' ORDER BY last_visited_at DESC LIMIT 20`).bind(user.email),
            env.DB.prepare(`SELECT path, title, kind, progress, saved, last_visited_at, updated_at FROM member_library
              WHERE user_email = ? AND saved = 1 AND kind != 'system' ORDER BY updated_at DESC LIMIT 50`).bind(user.email),
            env.DB.prepare(`SELECT updated_at FROM member_library WHERE user_email = ? AND path = '/__archive_last_seen__'`).bind(user.email),
          ]);
          const since = marker.results?.[0]?.updated_at || '1970-01-01T00:00:00Z';
          const unseen = await env.DB.prepare(`SELECT id, action, path, summary, created_at FROM activity
            WHERE created_at > ? ORDER BY created_at DESC, id DESC LIMIT 24`).bind(since).all();
          return json({ recent: recent.results || [], saved: saved.results || [], unseen: unseen.results || [], lastSeenAt: since, syncedAt: new Date().toISOString() });
        } catch {
          return json({ error: 'Archive state is temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/archive-state' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        let body;
        try { body = await readJson(request, 16_384); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const action = body.action;
        try {
          await ensureTables();
          if (action === 'seen') {
            await env.DB.prepare(`INSERT INTO member_library (user_email, path, title, kind, progress, saved)
              VALUES (?, '/__archive_last_seen__', 'Archive activity marker', 'system', 0, 0)
              ON CONFLICT(user_email, path) DO UPDATE SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`).bind(user.email).run();
            return json({ ok: true, seenAt: new Date().toISOString() });
          }
          const path = cleanArchivePath(body.path);
          const title = cleanArchiveTitle(body.title);
          if (!path || !title) return json({ error: 'Valid archive path and title required' }, 400);
          const kind = ['folio', 'atlas', 'species', 'workspace'].includes(body.kind) ? body.kind : 'folio';
          const progress = Number.isFinite(Number(body.progress)) ? Math.min(100, Math.max(0, Math.round(Number(body.progress)))) : 0;
          const saved = action === 'save' ? 1 : action === 'unsave' ? 0 : Number(Boolean(body.saved));
          await env.DB.prepare(`INSERT INTO member_library (user_email, path, title, kind, progress, saved)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_email, path) DO UPDATE SET title = excluded.title, kind = excluded.kind,
              progress = MAX(member_library.progress, excluded.progress), saved = CASE WHEN ? = 'visit' THEN member_library.saved ELSE excluded.saved END,
              last_visited_at = CASE WHEN ? = 'visit' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE member_library.last_visited_at END,
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
            .bind(user.email, path, title, kind, progress, saved, action, action).run();
          return json({ ok: true, path, saved: Boolean(saved), progress });
        } catch {
          return json({ error: 'Archive state could not be saved' }, 500);
        }
      }

      // Shared Draft → Review → Approved → Published queue for additions and maps.
      if (url.pathname === '/api/workflow' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        try {
          await ensureTables();
          const requestedId = typeof url.searchParams.get('id') === 'string' ? url.searchParams.get('id') : '';
          if (requestedId) {
            const item = await env.DB.prepare(`SELECT id, kind, path, title, status, content_json, created_by, updated_by, created_at, updated_at
              FROM workflow_items WHERE id = ?`).bind(requestedId.slice(0, 80)).first();
            if (!item) return json({ error: 'Workflow item not found' }, 404);
            const history = await env.DB.prepare(`SELECT status, summary, actor_email, created_at FROM workflow_history
              WHERE workflow_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`).bind(item.id).all();
            return json({ item: { ...item, content: JSON.parse(item.content_json), content_json: undefined }, history: history.results || [] });
          }
          const status = url.searchParams.get('status');
          const query = cleanWorkflowStatus(status)
            ? env.DB.prepare(`SELECT id, kind, path, title, status, created_by, updated_by, created_at, updated_at FROM workflow_items WHERE status = ? ORDER BY updated_at DESC LIMIT 80`).bind(status)
            : env.DB.prepare(`SELECT id, kind, path, title, status, created_by, updated_by, created_at, updated_at FROM workflow_items ORDER BY updated_at DESC LIMIT 80`);
          const { results } = await query.all();
          return json({ items: results || [] });
        } catch {
          return json({ error: 'Workflow is temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/workflow' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        let body;
        try { body = await readJson(request, MAX_SAVE_JSON_BYTES); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const transitionStatus = cleanWorkflowStatus(body.status);
        if (typeof body.id === 'string' && body.id && transitionStatus && body.content == null) {
          try {
            await ensureTables();
            const id = body.id.slice(0, 80);
            const existing = await env.DB.prepare('SELECT id, title, status FROM workflow_items WHERE id = ?').bind(id).first();
            if (!existing) return json({ error: 'Workflow item not found' }, 404);
            await env.DB.batch([
              env.DB.prepare(`UPDATE workflow_items SET status = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).bind(transitionStatus, user.email, id),
              env.DB.prepare('INSERT INTO workflow_history (workflow_id, status, summary, actor_email) VALUES (?, ?, ?, ?)').bind(id, transitionStatus, cleanArchiveTitle(body.summary) || `Moved ${existing.title} to ${transitionStatus}`, user.email),
            ]);
            return json({ ok: true, id, status: transitionStatus, updatedAt: new Date().toISOString() });
          } catch {
            return json({ error: 'Workflow status could not be changed' }, 500);
          }
        }
        const kind = cleanWorkflowKind(body.kind);
        const path = kind === 'map' ? cleanMapSlug(body.path) : sanitizeAdditionsPath(body.path);
        const title = cleanArchiveTitle(body.title);
        const status = cleanWorkflowStatus(body.status);
        if (!kind || !path || !title || !status || !isJsonObject(body.content)) return json({ error: 'Valid workflow item required' }, 400);
        const contentJson = JSON.stringify(body.content);
        if (contentJson.length > 900_000) return json({ error: 'Workflow item is too large' }, 413);
        try {
          await ensureTables();
          const existing = await env.DB.prepare('SELECT id, status FROM workflow_items WHERE kind = ? AND path = ?').bind(kind, path).first();
          const id = existing?.id || crypto.randomUUID();
          await env.DB.batch([
            env.DB.prepare(`INSERT INTO workflow_items (id, kind, path, title, status, content_json, created_by, updated_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(kind, path) DO UPDATE SET title = excluded.title, status = excluded.status,
                content_json = excluded.content_json, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
              .bind(id, kind, path, title, status, contentJson, user.email, user.email),
            env.DB.prepare('INSERT INTO workflow_history (workflow_id, status, summary, actor_email) VALUES (?, ?, ?, ?)')
              .bind(id, status, cleanArchiveTitle(body.summary) || `Moved ${title} to ${status}`, user.email),
          ]);
          return json({ ok: true, id, kind, path, title, status, updatedAt: new Date().toISOString() });
        } catch {
          return json({ error: 'Workflow item could not be saved' }, 500);
        }
      }

      // --- Admin (only ichieisenheart@gmail.com) ---
      const isAdmin = async () => {
        const token = readAuthToken(request);
        if (!token) return false;
        const p = await verifyJwt(token, getJwtSecret(env));
        return p && p.email === ADMIN_EMAIL;
      };
      if (url.pathname.startsWith('/api/admin/')) {
        try {
          if (!(await isAdmin())) return json({ error: 'Admin access required' }, 403);
          await ensureTables();
        } catch {
          return json({ error: 'Admin service unavailable' }, 503);
        }
        if (url.pathname === '/api/admin/invites' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT code, used_by, used_at, created_at FROM invites ORDER BY created_at DESC').all();
          return json({ invites: results });
        }
        if (url.pathname === '/api/admin/invites' && request.method === 'POST') {
          let body;
          try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const clean = cleanInviteCode(body.code);
          if (!clean) return json({ error: 'Use 6–64 letters, numbers, underscores, or hyphens' }, 400);
          const result = await env.DB.prepare('INSERT OR IGNORE INTO invites (code) VALUES (?)').bind(clean).run();
          if (result.meta?.changes !== 1) return json({ error: 'Invite already exists' }, 409);
          return json({ ok: true, code: clean });
        }
        if (url.pathname.startsWith('/api/admin/invites/') && request.method === 'DELETE') {
          let code;
          try { code = cleanInviteCode(decodeURIComponent(url.pathname.split('/').pop())); } catch { code = null; }
          if (!code) return json({ error: 'Invalid invite code' }, 400);
          await env.DB.prepare('DELETE FROM invites WHERE code = ?').bind(code).run();
          return json({ ok: true });
        }
        if (url.pathname === '/api/admin/users' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT id, email, invite_code, created_at FROM users ORDER BY created_at DESC').all();
          return json({ users: results });
        }
        if (url.pathname === '/api/admin/requests' && request.method === 'GET') {
          await ensureTables();
          const { results } = await env.DB.prepare('SELECT id, email, message, status, created_at FROM requests ORDER BY created_at DESC').all();
          return json({ requests: results });
        }
        if (url.pathname === '/api/admin/requests/approve' && request.method === 'POST') {
          let body;
          try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const id = validPositiveId(body.id);
          if (!id) return json({ error: 'Valid request id required' }, 400);
          const req = await env.DB.prepare('SELECT email, status FROM requests WHERE id = ?').bind(id).first();
          if (!req) return json({ error: 'Request not found' }, 404);
          if (req.status !== 'pending') return json({ error: 'Request has already been resolved' }, 409);
          const clean = body.code ? cleanInviteCode(body.code) : randomInviteCode();
          if (!clean) return json({ error: 'Invalid invite code' }, 400);
          const [created, resolved] = await env.DB.batch([
            env.DB.prepare(`INSERT OR IGNORE INTO invites (code)
              SELECT ? WHERE EXISTS (SELECT 1 FROM requests WHERE id = ? AND status = 'pending')`).bind(clean, id),
            env.DB.prepare(`UPDATE requests SET status = 'approved' WHERE id = ? AND status = 'pending'
              AND changes() = 1 AND EXISTS (SELECT 1 FROM invites WHERE code = ?)`).bind(id, clean),
          ]);
          if (created.meta?.changes !== 1) return json({ error: 'Invite already exists' }, 409);
          if (resolved.meta?.changes !== 1) return json({ error: 'Request could not be resolved' }, 409);
          return json({ ok: true, code: clean, email: req.email });
        }
        if (url.pathname === '/api/admin/requests/reject' && request.method === 'POST') {
          let body;
          try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const id = validPositiveId(body.id);
          if (!id) return json({ error: 'Valid request id required' }, 400);
          const result = await env.DB.prepare('UPDATE requests SET status = "rejected" WHERE id = ? AND status = "pending"').bind(id).run();
          if (result.meta?.changes !== 1) return json({ error: 'Request not found or already resolved' }, 409);
          return json({ ok: true });
        }
        if (url.pathname === '/api/admin/stats' && request.method === 'GET') {
          const [users, openInvites, pendingRequests, additions] = await env.DB.batch([
            env.DB.prepare('SELECT COUNT(*) AS count FROM users'),
            env.DB.prepare('SELECT COUNT(*) AS count FROM invites WHERE used_by IS NULL'),
            env.DB.prepare('SELECT COUNT(*) AS count FROM requests WHERE status = ?').bind('pending'),
            env.DB.prepare('SELECT COUNT(*) AS count FROM activity'),
          ]);
          return json({
            stats: {
              users: users.results?.[0]?.count || 0,
              openInvites: openInvites.results?.[0]?.count || 0,
              pendingRequests: pendingRequests.results?.[0]?.count || 0,
              additions: additions.results?.[0]?.count || 0,
            },
          });
        }
        return json({ error: 'Not found' }, 404);
      }

      // --- Atlas map documents — archive members may view and save shared overlays. ---
      const mapMatch = url.pathname.match(/^\/api\/maps\/([a-z0-9_-]+)$/);
      if (mapMatch && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        const slug = cleanMapSlug(mapMatch[1]);
        if (!slug) return json({ error: 'Map not found' }, 404);
        try {
          await ensureTables();
          const record = await env.DB.prepare('SELECT title, document_json, updated_by, updated_at FROM map_documents WHERE slug = ?').bind(slug).first();
          if (!record) return json({ map: null, slug });
          const document = sanitizeMapDocument(JSON.parse(record.document_json), slug);
          if (!document) return json({ error: 'Stored map document is invalid' }, 500);
          return json({ map: document, updatedBy: record.updated_by, updatedAt: record.updated_at });
        } catch {
          return json({ error: 'Map could not be loaded' }, 500);
        }
      }
      if (mapMatch && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        const slug = cleanMapSlug(mapMatch[1]);
        if (!slug) return json({ error: 'Map not found' }, 404);
        let body;
        try { body = await readJson(request, MAX_MAP_JSON_BYTES); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const document = sanitizeMapDocument(body.map, slug);
        if (!document) return json({ error: 'Invalid map document' }, 400);
        try {
          await ensureTables();
          const encoded = JSON.stringify(document);
          await env.DB.prepare(`INSERT INTO map_documents (slug, title, document_json, updated_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET title = excluded.title, document_json = excluded.document_json,
              updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
            .bind(slug, document.title, encoded, user.email).run();
          ctx.waitUntil(env.DB.prepare('INSERT INTO activity (action, path, summary, actor_email) VALUES (?, ?, ?, ?)')
            .bind('map', `maps/${slug}.json`, 'Updated an atlas overlay', user.email).run().catch(() => {}));
          const saved = await env.DB.prepare('SELECT updated_at FROM map_documents WHERE slug = ?').bind(slug).first();
          return json({ ok: true, slug, updatedAt: saved?.updated_at || new Date().toISOString() });
        } catch {
          return json({ error: 'Map could not be saved' }, 500);
        }
      }

      // --- Additions (Website-additions repo) — requires auth ---
      // GET /api/additions/list -> {files:[{path, sha, size, html_url}]}
      if (url.pathname === '/api/additions/list' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        try {
          // try git trees recursive — most complete
          const treeRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/git/trees/${ADDITIONS_BRANCH}?recursive=1`, { method: 'GET' }, env);
          if (treeRes.ok) {
            const j = await treeRes.json();
            const files = (j.tree || [])
              .filter(n => n.type === 'blob')
              .map(n => {
                const path = safeAdditionListPath(n.path);
                return path ? { path, sha: n.sha, size: n.size || 0 } : null;
              })
              .filter(Boolean)
              .sort((a,b) => a.path.localeCompare(b.path));
            return json({ files, via: 'tree' });
          }
          // fallback: /contents at root
          const cRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (cRes.ok) {
            const arr = await cRes.json();
            const files = (Array.isArray(arr) ? arr : [])
              .filter(x => x.type === 'file')
              .map(x => {
                const path = safeAdditionListPath(x.path);
                return path ? { path, sha: x.sha, size: x.size } : null;
              })
              .filter(Boolean);
            return json({ files, via: 'contents' });
          }
          const txt = await treeRes.text();
          void txt;
          return json({ error: 'Additions repository is unavailable' }, 502);
        } catch (e) {
          return json({ error: 'Additions list is temporarily unavailable' }, 500);
        }
      }

      // GET /api/additions/file?path=foo.md -> {path, content, sha, html_url}
      if (url.pathname === '/api/additions/file' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        const rawPath = url.searchParams.get('path') || '';
        const path = sanitizeAdditionsPath(rawPath);
        if (!path) return json({ error: 'Invalid path' }, 400);
        try {
          const r = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (r.status === 404) return json({ error: 'File not found' }, 404);
          if (!r.ok) {
            const t = await r.text();
            void t;
            return json({ error: 'Additions repository is unavailable' }, 502);
          }
          const j = await r.json();
          if (j.type !== 'file' || !j.content) return json({ error: 'Not a file' }, 400);
          const content = b64DecodeUtf8(j.content);
          return json({ path: j.path, sha: j.sha, size: j.size, html_url: j.html_url, content });
        } catch (e) {
          return json({ error: 'Addition could not be loaded' }, 500);
        }
      }

      // GET /api/additions/history?path=foo.md[&sha=...] — commit history and safe textual diffs.
      if (url.pathname === '/api/additions/history' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive history is unavailable' }, 503);
        const path = sanitizeAdditionsPath(url.searchParams.get('path') || '');
        if (!path) return json({ error: 'Invalid path' }, 400);
        const sha = (url.searchParams.get('sha') || '').trim();
        if (sha && !/^[a-f0-9]{7,40}$/i.test(sha)) return json({ error: 'Invalid revision' }, 400);
        try {
          if (sha) {
            const response = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/commits/${sha}`, { method: 'GET' }, env);
            if (!response.ok) return json({ error: 'Revision could not be loaded' }, response.status === 404 ? 404 : 502);
            const commit = await response.json();
            const files = (commit.files || []).filter(file => file.filename === path || file.previous_filename === path).slice(0, 10).map(file => ({
              filename: file.filename,
              previousFilename: file.previous_filename || null,
              status: file.status,
              additions: file.additions,
              deletions: file.deletions,
              patch: typeof file.patch === 'string' ? file.patch.slice(0, 120_000) : '',
            }));
            return json({ revision: { sha: commit.sha, message: commit.commit?.message || '', author: commit.commit?.author?.name || 'Archive member', date: commit.commit?.author?.date || '', files } });
          }
          const response = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/commits?path=${encodeURIComponent(path)}&sha=${ADDITIONS_BRANCH}&per_page=40`, { method: 'GET' }, env);
          if (!response.ok) return json({ error: 'History could not be loaded' }, 502);
          const commits = await response.json();
          return json({ path, revisions: (Array.isArray(commits) ? commits : []).map(commit => ({
            sha: commit.sha,
            message: commit.commit?.message || '',
            author: commit.commit?.author?.name || 'Archive member',
            date: commit.commit?.author?.date || '',
          })) });
        } catch {
          return json({ error: 'History is temporarily unavailable' }, 500);
        }
      }

      // POST /api/additions/save {path, content, oldPath?, message?} -> commit to GitHub
      if (url.pathname === '/api/additions/save' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        let body;
        try { body = await readJson(request, MAX_SAVE_JSON_BYTES); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
        const rawOld = typeof body.oldPath === 'string' ? body.oldPath.trim() : '';
        const content = body.content;
        const message = (typeof body.message === 'string' ? body.message : '').trim().slice(0,200) || `edit ${rawPath} via /app`;
        if (typeof content !== 'string') return json({ error: 'content required (string)' }, 400);
        if (content.length > 900000) return json({ error: 'File too large (900k char limit)' }, 413);
        const path = sanitizeAdditionsPath(rawPath);
        if (!path) return json({ error: 'Invalid path — use A-Z 0-9 . _ - / — e.g. my-idea.md' }, 400);
        const oldPath = rawOld && rawOld !== path ? sanitizeAdditionsPath(rawOld) : null;
        if (rawOld && rawOld !== path && !oldPath) return json({ error: 'Invalid previous path' }, 400);
        try {
          // check existing sha for path (if file exists, we need sha to update)
          let existingSha = null;
          const check = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (check.ok) {
            const jc = await check.json();
            if (jc.sha) existingSha = jc.sha;
          } else if (check.status !== 404) {
            const t = await check.text();
            void t;
            return json({ error: 'Additions repository is unavailable' }, 502);
          }
          const b64 = b64EncodeUtf8(content);
          const putBody = {
            message: `${message} — by ${user.email}`,
            content: b64,
            branch: ADDITIONS_BRANCH,
          };
          if (existingSha) putBody.sha = existingSha;
          const putRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
          }, env);
          if (!putRes.ok) {
            const t = await putRes.text();
            void t;
            return json({ error: 'Commit could not be saved', status: putRes.status }, 502);
          }
          const pj = await putRes.json();
          // if rename: delete old file
          if (oldPath) {
            try {
              const oldCheck = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(oldPath).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
              if (oldCheck.ok) {
                const oj = await oldCheck.json();
                if (oj.sha) {
                  await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(oldPath).replace(/%2F/g,'/')}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: `rename ${oldPath} → ${path} — by ${user.email}`, sha: oj.sha, branch: ADDITIONS_BRANCH })
                  }, env);
                }
              }
            } catch {}
          }
          const action = oldPath ? 'move' : (existingSha ? 'edit' : 'create');
          const activitySummary = oldPath ? 'Moved an archive addition' : (existingSha ? 'Revised an archive addition' : 'Created an archive addition');
          if (env.DB) ctx.waitUntil(env.DB.prepare('INSERT INTO activity (action, path, summary, actor_email) VALUES (?, ?, ?, ?)')
            .bind(action, path, activitySummary, user.email).run().catch(() => {}));
          return json({ ok: true, path, sha: pj.content?.sha || pj.commit?.sha, html_url: pj.content?.html_url, commit: pj.commit?.html_url });
        } catch (e) {
          return json({ error: 'Addition could not be saved' }, 500);
        }
      }

      // POST /api/additions/delete {path}
      if (url.pathname === '/api/additions/delete' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        let body; try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const p = sanitizeAdditionsPath(body.path || '');
        if (!p) return json({ error: 'Invalid path' }, 400);
        try {
          const check = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(p).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (check.status === 404) return json({ error: 'File not found' }, 404);
          if (!check.ok) { await check.text(); return json({ error: 'Additions repository is unavailable' }, 502); }
          const jc = await check.json();
          const del = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(p).replace(/%2F/g,'/')}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `delete ${p} — by ${user.email}`, sha: jc.sha, branch: ADDITIONS_BRANCH })
          }, env);
          if (!del.ok) { await del.text(); return json({ error: 'Addition could not be deleted' }, 502); }
          if (env.DB) ctx.waitUntil(env.DB.prepare('INSERT INTO activity (action, path, summary, actor_email) VALUES (?, ?, ?, ?)')
            .bind('delete', p, 'Removed an archive addition', user.email).run().catch(() => {}));
          return json({ ok: true, path: p });
        } catch (e) {
          return json({ error: 'Addition could not be deleted' }, 500);
        }
      }

      // POST /api/additions/mkdir {path} -> create folder via .gitkeep
      if (url.pathname === '/api/additions/mkdir' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        let body; try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const raw = typeof body.path === 'string' ? body.path.trim() : '';
        const folder = sanitizeFolderPath(raw);
        if (!folder) return json({ error: 'Invalid folder — use A-Z 0-9 _ - / and space, e.g. lore/characters' }, 400);
        const keepPath = folder + '/.gitkeep';
        try {
          // if folder already has any file, no need to create keep
          const treeRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/git/trees/${ADDITIONS_BRANCH}?recursive=1`, { method: 'GET' }, env);
          if (treeRes.ok) {
            const tj = await treeRes.json();
            const hasContent = (tj.tree||[]).some(n => n.path === keepPath || n.path.startsWith(folder + '/'));
            if (hasContent) return json({ ok: true, path: folder, existed: true });
          } else {
            // fallback check via contents
            const c = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(keepPath).replace(/%2F/g,'/')}?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
            if (c.ok) return json({ ok: true, path: folder, existed: true });
          }
          const b64 = b64EncodeUtf8('');
          const put = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(keepPath).replace(/%2F/g,'/')}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `create folder ${folder} — by ${user.email}`, content: b64, branch: ADDITIONS_BRANCH })
          }, env);
          if (!put.ok) { await put.text(); return json({ error: 'Folder could not be created' }, 502); }
          const pj = await put.json();
          if (env.DB) ctx.waitUntil(env.DB.prepare('INSERT INTO activity (action, path, summary, actor_email) VALUES (?, ?, ?, ?)')
            .bind('folder', folder, 'Created an archive folder', user.email).run().catch(() => {}));
          return json({ ok: true, path: folder, sha: pj.content?.sha });
        } catch (e) {
          return json({ error: 'Folder could not be created' }, 500);
        }
      }

      return json({ error: 'Not found' }, 404);
    }

    // --- Gated archive: private HTML, wiki/search indexes, and full-resolution maps.
    const needsAuth = isPrivatePath(url.pathname);
    if (needsAuth) {
      const token = parseCookies(request)[COOKIE_NAME];
      let payload = null;
      try { payload = token ? await verifyJwt(token, getJwtSecret(env)) : null; } catch {}
      if (!payload) {
        const accept = request.headers.get('Accept') || '';
        const destination = request.headers.get('Sec-Fetch-Dest');
        if (accept.includes('application/json') || (destination && destination !== 'document')) return json({ error: 'Authentication required' }, 401);
        const next = encodeURIComponent(url.pathname + url.search);
        return new Response(null, {
          status: 302,
          headers: {
            'Location': `${url.origin}/?next=${next}`,
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
          },
        });
      }

      if (url.pathname === '/admin.html' || url.pathname === '/admin') {
        if (payload.email !== ADMIN_EMAIL) return new Response(null, {
          status: 302,
          headers: {
            'Location': `${url.origin}/dashboard.html`,
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
          },
        });
      }
    }

    // --- Static assets fallback ---
    // ROUTE_ALIASES handles pretty URLs (/updates -> /updates.html etc).
    // With html_handling:none we must also map wiki/app directories to index.html explicitly,
    // otherwise /wiki/ would 404 -> SPA fallback serves /index.html (looks broken).
    let targetPath = ROUTE_ALIASES.get(url.pathname);
    if (!targetPath) {
      if (url.pathname === '/wiki' || url.pathname === '/wiki/') targetPath = '/wiki/index.html';
      else if (url.pathname === '/app/' ) targetPath = '/app/index.html';
      else if (url.pathname.startsWith('/wiki/') && !url.pathname.split('/').pop().includes('.')) {
        targetPath = url.pathname.endsWith('/') ? `${url.pathname}index.html` : `${url.pathname}/index.html`;
      }
    }
    let assetRequest = request;
    if (targetPath) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = targetPath;
      assetRequest = new Request(assetUrl.toString(), request);
    }
    const response = await env.ASSETS.fetch(assetRequest);
    if (!needsAuth) {
      const contentType = response.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().includes('text/html')) return response;
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
      headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return withPrivateArchiveShell(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
  }
};

export const __test = {
  cleanArchivePath,
  cleanArchiveTitle,
  cleanInviteCode,
  cleanMapSlug,
  cleanWorkflowKind,
  cleanWorkflowStatus,
  constantTimeEqual,
  createPasswordHash,
  isPrivatePath,
  isTrustedMutation,
  parsePasswordHash,
  sanitizeAdditionsPath,
  sanitizeFolderPath,
  sanitizeMapDocument,
  signJwt,
  verifyPassword,
  verifyJwt,
};
