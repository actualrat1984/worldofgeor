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
  reveal: { attempts: 30, windowSeconds: 10 * 60 },
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
  '/arcs.js',
  '/quests.js',
  '/timeline.js',
  '/gazetteer.js',
  '/trees.js',
  '/notebook.js',
  '/manuscripts.js',
  '/boards.js',
  '/webs.js',
  '/gallery.js',
  '/oracle.js',
  '/chronicles.js',
  '/primer.js',
  '/desk.js',
  '/atlas-chain.js',
  '/marginalia.js',
  '/archive-compass.css',
  '/archive-compass.js',
  '/article-layouts.css',
]);
const ROUTE_ALIASES = new Map([
  ['/updates', '/updates.html'],
  ['/updates/', '/updates.html'],
  ['/timeline', '/timeline.html'],
  ['/timeline/', '/timeline.html'],
  ['/gazetteer', '/gazetteer.html'],
  ['/gazetteer/', '/gazetteer.html'],
  ['/arcs', '/arcs.html'],
  ['/arcs/', '/arcs.html'],
  ['/quests', '/quests.html'],
  ['/quests/', '/quests.html'],
  ['/trees', '/trees.html'],
  ['/trees/', '/trees.html'],
  ['/notebook', '/notebook.html'],
  ['/notebook/', '/notebook.html'],
  ['/manuscripts', '/manuscripts.html'],
  ['/manuscripts/', '/manuscripts.html'],
  ['/boards', '/boards.html'],
  ['/boards/', '/boards.html'],
  ['/webs', '/webs.html'],
  ['/webs/', '/webs.html'],
  ['/gallery', '/gallery.html'],
  ['/gallery/', '/gallery.html'],
  ['/oracle', '/oracle.html'],
  ['/oracle/', '/oracle.html'],
  ['/chronicles', '/chronicles.html'],
  ['/chronicles/', '/chronicles.html'],
  ['/primer', '/primer.html'],
  ['/primer/', '/primer.html'],
  ['/desk', '/desk.html'],
  ['/desk/', '/desk.html'],
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
    ['/atlas', '/map-editor', '/species', '/search', '/timeline', '/gazetteer', '/trees', '/arcs', '/quests', '/notebook', '/manuscripts', '/boards', '/webs', '/gallery', '/oracle', '/chronicles', '/primer', '/desk', '/dashboard', '/admin']
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

// --- Wave B: path-driven article layouts ------------------------------------
// Pure string prefix matching on real wiki sections (no D1 on the hot path).
// Characters live under History/Characters (no top-level People section);
// section indexes themselves are excluded (articles only, strictly beneath).
const ARTICLE_LAYOUTS = [
  { prefix: '/wiki/World/History/Characters/', bodyClass: 'geor-layout-character', eyebrow: 'Character' },
  { prefix: '/wiki/World/Nations/', bodyClass: 'geor-layout-nation', eyebrow: 'Nation' },
  { prefix: '/wiki/World/History/Events/', bodyClass: 'geor-layout-event', eyebrow: 'Event' },
];

// --- Wave B3: related-articles sidebar ("see also") ---------------------------
// Actual tags-index.json shape (see scripts/generate_tags.py — NOT
// {tags:{tag:[urls]}}):
//   { source, files_scanned, files_with_tags,
//     items: [{ tag, count, pages: [{ title, path }] }] }
// where path is a vault-relative markdown path, e.g. "World/Nations/Foo.md"
// or "World/Nations/Foo/index.md" for folder indexes.
// Wiki URL mapping (MkDocs renders each page to <path-minus-.md>/index.html):
//   md path "World/Nations/Foo.md" <-> URL "/wiki/World/Nations/Foo/"
//   md path "World/Nations/Foo/index.md" <-> URL "/wiki/World/Nations/Foo/"
// Fetched once per isolate through env.ASSETS (module-level cache, TTL 10 min);
// oversize index (>2MB) is skipped. No D1. Only layout-classified article
// pages trigger a lookup, and only the target page's own tags are scanned
// (no full relatedness matrix). Missing/empty index or zero relations:
// omit the sidebar silently — never render an empty box.
const RELATED_TTL_MS = 10 * 60 * 1000;
const RELATED_MAX_BYTES = 2 * 1024 * 1024;
const RELATED_MAX_LINKS = 5;
let relatedCache = { at: 0, lookup: null };

function classifyArticleLayout(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch {}
  for (const layout of ARTICLE_LAYOUTS) {
    if (decoded.length > layout.prefix.length && decoded.startsWith(layout.prefix)) {
      return { bodyClass: layout.bodyClass, eyebrow: layout.eyebrow };
    }
  }
  return null;
}

function buildRelatedLookup(items) {
  const pageTags = new Map(); // mdPath -> Set(tag)
  const tagPages = new Map(); // tag -> [{ path, title }]
  const pageTitle = new Map(); // mdPath -> title
  for (const item of items || []) {
    if (!item || typeof item.tag !== 'string' || !Array.isArray(item.pages)) continue;
    for (const page of item.pages) {
      if (!page || typeof page.path !== 'string') continue;
      if (!pageTags.has(page.path)) {
        pageTags.set(page.path, new Set());
        pageTitle.set(page.path, typeof page.title === 'string' && page.title ? page.title : page.path.replace(/\.md$/, '').split('/').pop());
      }
      pageTags.get(page.path).add(item.tag);
      if (!tagPages.has(item.tag)) tagPages.set(item.tag, []);
      tagPages.get(item.tag).push({ path: page.path, title: pageTitle.get(page.path) });
    }
  }
  return { pageTags, tagPages, pageTitle };
}

async function loadRelatedLookup(env, origin) {
  const now = Date.now();
  if (relatedCache.lookup && now - relatedCache.at < RELATED_TTL_MS) return relatedCache.lookup;
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== 'function') return relatedCache.lookup;
  try {
    const response = await env.ASSETS.fetch(new Request(new URL('/wiki/tags-index.json', origin), { headers: { Accept: 'application/json' } }));
    if (!response.ok) return relatedCache.lookup;
    const text = await response.text();
    if (text.length > RELATED_MAX_BYTES) return null;
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.items)) return relatedCache.lookup;
    const lookup = buildRelatedLookup(data.items);
    relatedCache = { at: now, lookup };
    return lookup;
  } catch {
    return relatedCache.lookup;
  }
}

// Candidate vault md paths for a wiki URL (direct page, then folder index).
function wikiMdCandidates(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { return []; }
  if (!decoded.startsWith('/wiki/')) return [];
  let rel = decoded.slice('/wiki/'.length).replace(/\/+$/, '');
  if (!rel) return [];
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  if (!rel) return [];
  return [`${rel}.md`, `${rel}/index.md`];
}

function relatedUrlForPagePath(mdPath) {
  let rel = mdPath.replace(/\.md$/, '');
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  return `/wiki/${rel.split('/').map(encodeURIComponent).join('/')}/`;
}

function escapeRelatedHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Top-N related pages by shared-tag count (self excluded). Tie-break: fewer
// total tags first (more specific), then title A-Z. Only the target page's
// own tags are scanned — trivial per-request cost.
function computeRelated(mdPath, lookup, limit = RELATED_MAX_LINKS) {
  const tags = lookup && lookup.pageTags ? lookup.pageTags.get(mdPath) : null;
  if (!tags || tags.size === 0) return [];
  const shared = new Map();
  for (const tag of tags) {
    const pages = lookup.tagPages.get(tag) || [];
    for (const page of pages) {
      if (page.path === mdPath) continue;
      shared.set(page.path, (shared.get(page.path) || 0) + 1);
    }
  }
  return [...shared.entries()]
    .map(([path, count]) => ({
      path,
      title: lookup.pageTitle.get(path) || path,
      shared: count,
      total: lookup.pageTags.get(path) ? lookup.pageTags.get(path).size : Infinity,
    }))
    .sort((a, b) => b.shared - a.shared || a.total - b.total || String(a.title).localeCompare(String(b.title)))
    .slice(0, limit)
    .map(({ path, title, shared: count }) => ({ path, title, url: relatedUrlForPagePath(path), shared: count }));
}

function relatedAsideHtml(related) {
  const items = related
    .map(entry => `<li><a href="${escapeRelatedHtml(entry.url)}">${escapeRelatedHtml(entry.title)}</a></li>`)
    .join('');
  return `<aside class="geor-related"><h2 class="geor-related-title">See also</h2><ul class="geor-related-list">${items}</ul></aside>`;
}

function resetRelatedCache() {
  relatedCache = { at: 0, lookup: null };
}

// --- Wave B4: sticky table-of-contents ---------------------------------------
// MkDocs emits id attributes on h2/h3 (verified against dist/wiki output —
// headerlink ids like <h2 id="connections">), so TOC anchors reuse them.
// Headings without an id fall back to a slug of their text, assigned back to
// the element so the anchor resolves. The article h1 is the hero, never TOC.
function slugifyHeadingText(value) {
  const ascii = String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug || 'section';
}

function collectTocEntries(html) {
  const source = String(html || '');
  const article = source.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const scope = article ? article[1] : source;
  const entries = [];
  const seen = new Set();
  for (const match of scope.matchAll(/<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const level = match[1].toLowerCase() === 'h3' ? 3 : 2;
    const idMatch = match[2].match(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const text = match[3].replace(/<[^>]+>/g, ' ').replace(/¶|&para;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const raw = idMatch ? (idMatch[1] ?? idMatch[2] ?? idMatch[3]) : '';
    const base = raw || slugifyHeadingText(text);
    let id = base;
    let n = 1;
    while (seen.has(id)) id = `${base}-${++n}`;
    seen.add(id);
    entries.push({ level, id, text, needsId: !raw });
  }
  return entries;
}

function tocNavHtml(entries) {
  const items = entries
    .map(entry => `<li class="geor-toc-h${entry.level}"><a href="#${escapeRelatedHtml(entry.id)}">${escapeRelatedHtml(entry.text)}</a></li>`)
    .join('');
  return `<nav class="geor-toc" aria-label="On this page"><details class="geor-toc-box" open><summary class="geor-toc-title">On this page</summary><ul class="geor-toc-list">${items}</ul></details></nav>`;
}

// Stamp the final (deduped) entry ids back onto their h2/h3 elements and
// prepend the TOC nav. Mirrors collectTocEntries' scope + skip rules exactly
// (first <article> scope, empty-text headings skipped) so each consumed entry
// lines up with its heading in document order. Headings already carrying the
// final id keep their bytes apart from quote normalization.
function renderTocHtml(html, entries) {
  const source = String(html || '');
  const queue = Array.isArray(entries) ? entries.slice() : [];
  if (!queue.length) return source;
  const nav = tocNavHtml(queue);
  const articleOpen = source.match(/<article\b[^>]*>/i);
  const scopeEnd = articleOpen ? source.indexOf('</article>', articleOpen.index + articleOpen[0].length) : -1;
  const scoped = Boolean(articleOpen) && scopeEnd > articleOpen.index;
  const head = scoped ? source.slice(0, articleOpen.index + articleOpen[0].length) : '';
  const scope = scoped ? source.slice(articleOpen.index + articleOpen[0].length, scopeEnd) : source;
  const tail = scoped ? source.slice(scopeEnd) : '';
  let take = 0;
  const stamped = scope.replace(/<(h[23])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (whole, tag, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/¶|&para;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || take >= queue.length) return whole;
    const id = escapeRelatedHtml(queue[take++].id);
    const hasId = /\bid\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i.test(attrs);
    const nextAttrs = hasId
      ? attrs.replace(/\bid\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `id="${id}"`)
      : `${attrs} id="${id}"`;
    return `<${tag}${nextAttrs}>${inner}</${tag}>`;
  });
  if (scoped) return `${head}${nav}${stamped}${tail}`;
  // No <article> (never MkDocs output — fallback only): nav after <body>.
  const bodyOpen = stamped.match(/<body\b[^>]*>/i);
  if (!bodyOpen) return `${nav}${stamped}`;
  const at = bodyOpen.index + bodyOpen[0].length;
  return `${stamped.slice(0, at)}${nav}${stamped.slice(at)}`;
}

// Per-article section highlighting (aria-current via IntersectionObserver).
// Reading progress itself is NOT duplicated: archive-compass.js already renders
// the site-wide reading progress bar on /wiki/ pages (see that file for the
// element's class). This module only highlights the visible TOC section and
// collapses the TOC on mobile.
const TOC_HIGHLIGHT_SCRIPT = `<script type="module" data-geor-toc>(function(){var nav=document.querySelector('nav.geor-toc');if(!nav)return;var box=nav.querySelector('details');if(box&&window.matchMedia&&matchMedia('(max-width: 640px)').matches)box.removeAttribute('open');var links=Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));if(!links.length||!('IntersectionObserver' in window))return;var byId={};links.forEach(function(a){byId[a.hash.slice(1)]=a});var current=null;var observer=new IntersectionObserver(function(rows){rows.forEach(function(row){if(!row.isIntersecting)return;var link=byId[row.target.id];if(!link||link===current)return;if(current)current.removeAttribute('aria-current');current=link;link.setAttribute('aria-current','true')})},{rootMargin:'-15% 0px -70% 0px'});Object.keys(byId).forEach(function(id){var h=document.getElementById(id);if(h)observer.observe(h)})})();</script>`;

// --- Wave B2: spoiler-block secrets ------------------------------------------
// Author syntax (raw HTML passes MkDocs untouched — document here, do NOT
// touch the vault):
//   <div class="geor-secret" data-secret="slug-id">hidden html</div>
// Optional GM-only part (NEVER sent to non-owners — stripped server-side):
//   <div class="geor-secret-gm">notes</div>
// GM blocks must be siblings of secrets, never nested inside them: a revealed
// secret is unwrapped verbatim, so nested GM notes would ride along.
const SECRET_ID_PATTERN = /^[a-z0-9-]{1,64}$/;
function cleanSecretId(value) {
  return typeof value === 'string' && SECRET_ID_PATTERN.test(value) ? value : null;
}
// --- Wave E2: per-member notebook validation --------------------------------
// Titles are short labels, bodies carry the note (non-empty, 20k cap), and
// checklists normalize server-side to [{text, done}] so stored JSON is always
// the same shape no matter what the client sent (strings or {text, done}).
const NOTEBOOK_TITLE_MAX = 200;
const NOTEBOOK_BODY_MAX = 20_000;
const NOTEBOOK_CHECKLIST_MAX = 100;
const NOTEBOOK_CHECKLIST_ITEM_MAX = 200;
function cleanNotebookTitle(value) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length <= NOTEBOOK_TITLE_MAX ? title : null;
}
function cleanNotebookBody(value) {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  return body && body.length <= NOTEBOOK_BODY_MAX ? body : null;
}
function cleanNotebookChecklist(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > NOTEBOOK_CHECKLIST_MAX) return null;
  const items = [];
  for (const entry of value) {
    const text = typeof entry === 'string' ? entry.trim()
      : entry && typeof entry.text === 'string' ? entry.text.trim() : null;
    if (!text || text.length > NOTEBOOK_CHECKLIST_ITEM_MAX) return null;
    items.push({ text, done: Boolean(entry && typeof entry === 'object' && entry.done) });
  }
  return items;
}
function notebookNoteJson(row) {
  let checklist = [];
  try {
    const parsed = JSON.parse(row?.checklist_json ?? '[]');
    if (Array.isArray(parsed)) checklist = parsed;
  } catch { checklist = []; }
  return { id: row.id, title: row.title ?? '', body: row.body ?? '', checklist, created_at: row.created_at, updated_at: row.updated_at };
}
// --- Wave E1: manuscripts validation ----------------------------------------
// Chapters/scenes live under Books/<book>/<chapter>.md in the shared
// additions repo — segments keep the additions charset (no separators, no
// dotfiles), bodies cap at 100k chars, and every composed path passes
// through sanitizeAdditionsPath so the API can never escape Books/.
const MANUSCRIPT_ROOT = 'Books';
const MANUSCRIPT_SEGMENT_MAX = 80;
const MANUSCRIPT_TITLE_MAX = 200;
const MANUSCRIPT_BODY_MAX = 100_000;
const MANUSCRIPT_SEGMENT_PATTERN = /^[A-Za-z0-9._\- ]+$/;
function cleanManuscriptSegment(value) {
  if (typeof value !== 'string') return null;
  const segment = value.trim();
  if (!segment || segment.length > MANUSCRIPT_SEGMENT_MAX) return null;
  if (!MANUSCRIPT_SEGMENT_PATTERN.test(segment)) return null;
  if (segment === '.' || segment === '..' || segment.startsWith('.') || segment.endsWith('.')) return null;
  return segment;
}
function manuscriptPath(book, chapter) {
  const cleanBook = cleanManuscriptSegment(book);
  const cleanChapter = cleanManuscriptSegment(chapter);
  if (!cleanBook || !cleanChapter) return null;
  // Chapters naming their own extension keep it (and face the allow-list);
  // bare names become markdown.
  const file = cleanChapter.includes('.') ? cleanChapter : `${cleanChapter}.md`;
  const path = sanitizeAdditionsPath(`${MANUSCRIPT_ROOT}/${cleanBook}/${file}`);
  return path && path.startsWith(`${MANUSCRIPT_ROOT}/`) ? path : null;
}
function cleanManuscriptTitle(value) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title.length <= MANUSCRIPT_TITLE_MAX ? title : null;
}
function cleanManuscriptBody(value) {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  return body && body.length <= MANUSCRIPT_BODY_MAX ? body : null;
}
function buildManuscriptContent(title, body) {
  return title ? `# ${title}\n\n${body}` : body;
}
// --- Wave E3: whiteboard validation -----------------------------------------
// Cards + arrows persist inside the 0006 `boards.doc_json` document as
// {cards:[{id,x,y,title,body,wiki}], arrows:[{id,from,to}]} — the table
// already carries every column this wave needs, so no migration. Caps keep
// docs small (200 cards / 400 arrows); wiki links must stay on-archive
// (^/wiki/) and are rejected before store.
const BOARD_TITLE_MAX = 200;
const BOARD_CARDS_MAX = 200;
const BOARD_ARROWS_MAX = 400;
const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOARD_CARD_TITLE_MAX = 200;
const BOARD_CARD_BODY_MAX = 2000;
const BOARD_CARD_WIKI_MAX = 500;
const BOARD_COORD_MAX = 100_000;
function cleanBoardId(value) {
  return typeof value === 'string' && BOARD_ID_PATTERN.test(value) ? value : null;
}
function cleanBoardTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title && title.length <= BOARD_TITLE_MAX ? title : null;
}
// Optional wiki link: empty stays empty, otherwise a same-archive /wiki/ path.
function cleanBoardWiki(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const wiki = value.trim();
  if (!wiki.startsWith('/wiki/') || wiki.length > BOARD_CARD_WIKI_MAX) return null;
  if (/[\s\\]/.test(wiki) || wiki.includes('..')) return null;
  return wiki;
}
function cleanBoardCoord(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > BOARD_COORD_MAX) return null;
  return Math.round(value * 100) / 100;
}
function cleanBoardCards(value) {
  if (!Array.isArray(value) || value.length > BOARD_CARDS_MAX) return null;
  const seen = new Set();
  const cards = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!cleanBoardId(entry.id) || seen.has(entry.id)) return null;
    seen.add(entry.id);
    const x = cleanBoardCoord(entry.x);
    const y = cleanBoardCoord(entry.y);
    if (x === null || y === null) return null;
    let title = '';
    if (entry.title != null && entry.title !== '') {
      if (typeof entry.title !== 'string') return null;
      title = entry.title.trim();
      if (title.length > BOARD_CARD_TITLE_MAX) return null;
    }
    let body = '';
    if (entry.body != null && entry.body !== '') {
      if (typeof entry.body !== 'string') return null;
      body = entry.body.trim();
      if (body.length > BOARD_CARD_BODY_MAX) return null;
    }
    const wiki = cleanBoardWiki(entry.wiki);
    if (wiki === null) return null;
    cards.push({ id: entry.id, x, y, title, body, wiki });
  }
  return cards;
}
// Arrows reference cards from the same payload: unknown endpoints 400.
function cleanBoardArrows(value, cardIds) {
  if (!Array.isArray(value) || value.length > BOARD_ARROWS_MAX) return null;
  const ids = cardIds instanceof Set ? cardIds : new Set();
  const seen = new Set();
  const arrows = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (typeof entry.from !== 'string' || !ids.has(entry.from)) return null;
    if (typeof entry.to !== 'string' || !ids.has(entry.to)) return null;
    const id = entry.id == null || entry.id === '' ? `arrow-${index}` : entry.id;
    if (!cleanBoardId(id) || seen.has(id)) return null;
    seen.add(id);
    arrows.push({ id, from: entry.from, to: entry.to });
  }
  return arrows;
}
function boardDocJson(row) {
  let doc = null;
  try { doc = JSON.parse(row?.doc_json ?? ''); } catch { doc = null; }
  return {
    cards: Array.isArray(doc?.cards) ? doc.cards : [],
    arrows: Array.isArray(doc?.arrows) ? doc.arrows : [],
  };
}
function boardJson(row) {
  const { cards, arrows } = boardDocJson(row);
  return { id: row.id, title: row.title ?? '', cards, arrows, updated_at: row.updated_at };
}
function boardSummaryJson(row) {
  const { cards, arrows } = boardDocJson(row);
  return { id: row.id, title: row.title ?? '', cardCount: cards.length, arrowCount: arrows.length, updated_at: row.updated_at };
}
// --- Wave E4: marginalia validation -----------------------------------------
// Page-anchored notes persist in the 0006 `notes` table
// (member_email, page, anchor, body, shared) — the table already carries
// every column this wave needs, so no migration. Pages are same-archive
// wiki paths only; anchors are optional section labels; bodies are short
// margin notes (5k cap).
const MARGINALIA_PAGE_MAX = 500;
const MARGINALIA_ANCHOR_MAX = 200;
const MARGINALIA_BODY_MAX = 5000;
function cleanMarginaliaPage(value) {
  if (typeof value !== 'string') return null;
  const page = value.trim();
  if (!page.startsWith('/wiki/') || page.length > MARGINALIA_PAGE_MAX) return null;
  if (/[\s\\?#]/.test(page) || page.includes('..')) return null;
  return page;
}
function cleanMarginaliaAnchor(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const anchor = value.trim();
  if (!anchor) return '';
  return anchor.length <= MARGINALIA_ANCHOR_MAX ? anchor : null;
}
function cleanMarginaliaBody(value) {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  return body && body.length <= MARGINALIA_BODY_MAX ? body : null;
}
// mine marks the viewer's own notes; author names the sharer on notes from
// other members (null on own notes — the client already knows the viewer).
function marginaliaNoteJson(row, viewerEmail) {
  const shared = Number(row?.shared) === 1;
  const mine = row?.member_email === viewerEmail;
  return {
    id: row.id,
    page: row.page ?? '',
    anchor: row.anchor ?? '',
    body: row.body ?? '',
    shared,
    mine,
    author: !mine && shared ? (row.member_email ?? null) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
// --- Wave F1: story arcs + plot trees validation ----------------------------
// Reuses the 0006 `arcs` / `plots` / `threads` tables — every column this
// wave needs already exists, so no migration. Member scoping runs through
// arcs.created_by (plots + threads scope through their arc, never by a
// member column they do not have). Thread states are a strict
// seed/active/resolved enum; plot trees cap at 32 ancestors.
const ARC_TITLE_MAX = 200;
const ARC_SUMMARY_MAX = 2000;
const ARC_STATUSES = new Set(['active', 'complete', 'archived']);
const ARC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PLOT_TITLE_MAX = 200;
const PLOT_SUMMARY_MAX = 2000;
const PLOT_DEPTH_MAX = 32;
const PLOT_SORT_MAX = 1_000_000;
const THREAD_TITLE_MAX = 200;
const THREAD_STATES = new Set(['seed', 'active', 'resolved']);
function cleanArcId(value) {
  return typeof value === 'string' && ARC_ID_PATTERN.test(value) ? value : null;
}
function cleanArcTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title && title.length <= ARC_TITLE_MAX ? title : null;
}
function cleanArcSummary(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const summary = value.trim();
  return summary.length <= ARC_SUMMARY_MAX ? summary : null;
}
function cleanArcStatus(value) {
  if (value == null || value === '') return 'active';
  return typeof value === 'string' && ARC_STATUSES.has(value) ? value : null;
}
function cleanPlotId(value) {
  return typeof value === 'string' && ARC_ID_PATTERN.test(value) ? value : null;
}
function cleanPlotTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title && title.length <= PLOT_TITLE_MAX ? title : null;
}
function cleanPlotSummary(value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string') return null;
  const summary = value.trim();
  return summary.length <= PLOT_SUMMARY_MAX ? summary : null;
}
function arcJson(row) {
  return { id: row.id, title: row.title ?? '', summary: row.summary ?? '', status: row.status ?? 'active', created_at: row.created_at, updated_at: row.updated_at };
}
function plotJson(row) {
  return { id: row.id, arc_id: row.arc_id, parent_id: row.parent_id ?? null, title: row.title ?? '', summary: row.summary ?? '', is_master: Number(row.is_master) === 1, sort: Number(row.sort) || 0 };
}
function cleanThreadTitle(value) {
  if (typeof value !== 'string') return null;
  const title = value.trim();
  return title && title.length <= THREAD_TITLE_MAX ? title : null;
}
function cleanThreadState(value) {
  if (value == null || value === '') return 'seed';
  return typeof value === 'string' && THREAD_STATES.has(value) ? value : null;
}
function threadJson(row) {
  return { id: row.id, arc_id: row.arc_id, title: row.title ?? '', state: row.state ?? 'seed', created_at: row.created_at, updated_at: row.updated_at };
}
// Walk the ancestor chain above startParentId inside one arc. forbiddenId is
// the plot being moved (null on create — the id is fresh, so only a corrupt
// pre-existing cycle can trip the walk). Any hit on forbiddenId, any repeat,
// a parent outside the arc, or a chain deeper than PLOT_DEPTH_MAX rejects
// the link before store.
async function plotParentError(env, arcId, startParentId, forbiddenId) {
  const seen = new Set();
  let current = startParentId;
  let depth = 0;
  while (current) {
    if (forbiddenId && current === forbiddenId) return 'Plot links must not form a loop';
    if (seen.has(current)) return 'Plot links must not form a loop';
    seen.add(current);
    depth++;
    if (depth > PLOT_DEPTH_MAX) return 'Plot tree is too deep';
    const row = await env.DB.prepare('SELECT id, arc_id, parent_id FROM plots WHERE id = ?').bind(current).first();
    if (!row || row.arc_id !== arcId) return 'Unknown parent plot';
    current = row.parent_id || null;
  }
  return null;
}
// Locked cards carry a title + reveal button only — the id charset above is
// HTML/JS-string safe, so no further escaping is needed when interpolating.
function lockedSecretInner(id) {
  const title = id
    ? `<p class="geor-secret-locked-title">🔒 Hidden passage <span class="geor-secret-id">${id}</span></p>`
    : `<p class="geor-secret-locked-title">🔒 Hidden passage</p>`;
  if (!id) return title;
  return `${title}<p class="geor-secret-locked-action"><button type="button" class="geor-secret-reveal" data-geor-reveal="${id}" onclick="fetch('/api/secrets/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${id}'})}).then(function(r){if(r.ok){location.reload()}})">Reveal</button></p>`;
}
// revealed: secret ids the viewer may read (own reveals + global '*' reveals).
// Fail-closed: any DB trouble returns a locked, non-owner context.
async function getSecretsContext(request, env) {
  const locked = { loggedIn: false, email: null, isOwner: false, revealed: new Set() };
  let session = null;
  try { session = await requireUser(request, env); } catch { return locked; }
  if (!session?.email) return locked;
  const ctx = { loggedIn: true, email: session.email, isOwner: session.email === ADMIN_EMAIL, revealed: new Set() };
  if (!env.DB) return ctx;
  try {
    const row = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(session.email).first();
    if (row?.role === 'owner') ctx.isOwner = true;
  } catch { /* keep JWT-derived ownership only */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT secret_id FROM reveals WHERE state = 'revealed' AND (member_email = ? OR member_email = '*')`
    ).bind(session.email).all();
    for (const row of results || []) {
      if (cleanSecretId(row?.secret_id)) ctx.revealed.add(row.secret_id);
    }
  } catch { ctx.revealed.clear(); }
  return ctx;
}
async function isOwnerSession(session, env) {
  if (!session?.email) return false;
  if (session.email === ADMIN_EMAIL) return true;
  try {
    if (!env.DB) return false;
    const row = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(session.email).first();
    return row?.role === 'owner';
  } catch { return false; }
}

async function withPrivateArchiveShell(response, pathname = '', secrets = null, relatedCtx = null) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/html') || response.status < 200 || response.status >= 300 || typeof HTMLRewriter === 'undefined') return response;
  const layout = classifyArticleLayout(pathname);
  // Wave B4b TOC: buffer layout-classified articles once, collect h2/h3
  // entries, and rewrite the body (final ids + prepended nav) before the
  // streaming shell runs. Non-layout pages and empty TOCs pass through
  // untouched — never an empty box.
  let tocEntries = [];
  if (layout) {
    try {
      tocEntries = collectTocEntries(await response.clone().text());
    } catch { tocEntries = []; }
  }
  if (tocEntries.length > 0) {
    try {
      const rendered = renderTocHtml(await response.text(), tocEntries);
      // Rebuilt body has a new byte length: drop length/encoding validators
      // from the asset response or pages truncate on stale content-length.
      const rebuiltHeaders = new Headers(response.headers);
      rebuiltHeaders.delete('content-length');
      rebuiltHeaders.delete('content-encoding');
      rebuiltHeaders.delete('etag');
      response = new Response(rendered, { status: response.status, statusText: response.statusText, headers: rebuiltHeaders });
    } catch { tocEntries = []; }
  }
  const hasToc = tocEntries.length > 0;
  let heroApplied = false;
  let rewriter = new HTMLRewriter()
    .on('head', { element(element) {
      element.append('<link rel="stylesheet" href="/archive-compass.css"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0f0e0d">', { html: true });
      if (layout) element.append('<link rel="stylesheet" href="/article-layouts.css">', { html: true });
    } })
    .on('body', { element(element) {
      if (layout) {
        const existing = element.getAttribute('class') || '';
        element.setAttribute('class', `${existing} ${layout.bodyClass}`.trim());
      }
      element.append(`<script type="module" src="/archive-compass.js"></script>${layout ? '<script type="module" src="/marginalia.js"></script>' : ''}${hasToc ? TOC_HIGHLIGHT_SCRIPT : ''}`, { html: true });
    } });
  if (layout) {
    // Slim hero: reuse the article's own <h1> in place (no extra fetch, no
    // text capture) — eyebrow label before it, hero class on it, CSS does
    // the rest. Selector matches MkDocs output (<article><h1>…).
    rewriter = rewriter.on('article h1', { element(element) {
      if (heroApplied) return;
      heroApplied = true;
      const existing = element.getAttribute('class') || '';
      element.setAttribute('class', `${existing} geor-hero-title`.trim());
      element.before(`<p class="geor-hero-eyebrow">${layout.eyebrow}</p>`, { html: true });
    } });
  }
  // Wave B3 related sidebar: layout-classified articles only, resolved from
  // the cached tags index. Any miss (no index, unknown page, zero relations)
  // falls through to no sidebar — never an empty box.
  let related = [];
  if (layout && relatedCtx && relatedCtx.env && relatedCtx.origin) {
    try {
      const lookup = await loadRelatedLookup(relatedCtx.env, relatedCtx.origin);
      if (lookup) {
        const candidates = wikiMdCandidates(pathname);
        const mdPath = candidates.find(candidate => lookup.pageTags.has(candidate));
        if (mdPath) related = computeRelated(mdPath, lookup);
      }
    } catch { related = []; }
  }
  if (related.length > 0) {
    let asideApplied = false;
    rewriter = rewriter.on('article', { element(element) {
      if (asideApplied) return;
      asideApplied = true;
      element.append(relatedAsideHtml(related), { html: true });
    } });
  }
  // Wave B2 secrets: same guard pattern as layouts. Logged-out/gated requests
  // never reach here (302/401 above); secretsCtx null also locks everything.
  const secretsCtx = secrets || { loggedIn: false, email: null, isOwner: false, revealed: new Set() };
  const revealed = secretsCtx.revealed instanceof Set ? secretsCtx.revealed : new Set();
  rewriter = rewriter
    .on('div.geor-secret-gm', { element(element) {
      if (!secretsCtx.isOwner) element.remove();
    } })
    .on('div.geor-secret', { element(element) {
      const id = cleanSecretId(element.getAttribute('data-secret'));
      if (secretsCtx.isOwner || (id && revealed.has(id))) {
        element.removeAndKeepContent();
        return;
      }
      // Locked: swap children for a title + reveal button — zero secret bytes
      // reach the client (asserted by the zero-bytes test in worker.test.mjs).
      element.setAttribute('class', 'geor-secret-locked');
      if (id) element.setAttribute('data-secret', id);
      else if (typeof element.removeAttribute === 'function') element.removeAttribute('data-secret');
      element.setInnerContent(lockedSecretInner(id), { html: true });
    } });
  return rewriter.transform(response);
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
      // auto-migrate tables if missing (so /api/register 500 never happens).
      // Mirrors migrations/0006_foundation.sql: CREATE TABLE / INDEX statements
      // are IF NOT EXISTS no-ops on migrated DBs; users.role is ALTER-probed
      // below because SQLite has no ADD COLUMN IF NOT EXISTS. No data backfill
      // here — the owner role seed lives in the SQL file.
      async function ensureTables() {
        if (!env.DB) throw new Error('Database unavailable');
        await env.DB.batch([
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, invite_code TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, used_by TEXT, used_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, path TEXT, summary TEXT NOT NULL, actor_email TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS map_documents (slug TEXT PRIMARY KEY, title TEXT NOT NULL, document_json TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, reset_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS reveals (member_email TEXT NOT NULL, secret_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'locked', updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (member_email, secret_id))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, member_email TEXT NOT NULL, page TEXT NOT NULL, anchor TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS notebook_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, member_email TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, checklist_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS arcs (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS plots (id TEXT PRIMARY KEY, arc_id TEXT NOT NULL REFERENCES arcs(id), parent_id TEXT REFERENCES plots(id), title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', is_master INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, arc_id TEXT NOT NULL REFERENCES arcs(id), title TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'seed', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, title TEXT NOT NULL, doc_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS member_library (user_email TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'folio', progress INTEGER NOT NULL DEFAULT 0, saved INTEGER NOT NULL DEFAULT 0, last_visited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (user_email, path))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_items (id TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', content_json TEXT NOT NULL, created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), UNIQUE(kind, path))`),
          env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_history (id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, actor_email TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_reveals_member ON reveals(member_email)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notes_member_page ON notes(member_email, page)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notebook_notes_member_updated ON notebook_notes(member_email, updated_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_plots_arc_parent ON plots(arc_id, parent_id)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_threads_arc_state ON threads(arc_id, state)`),
           env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_boards_owner ON boards(owner_email)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits(reset_at)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_member_library_recent ON member_library(user_email, last_visited_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_member_library_saved ON member_library(user_email, saved, updated_at DESC) WHERE saved = 1`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_workflow_status_updated ON workflow_items(status, updated_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_workflow_history_item ON workflow_history(workflow_id, created_at DESC)`),
        ]);
        // Wave B2: roles column for pre-0006 databases (best effort — migrated
        // DBs already have it, so a duplicate-column error is the happy path).
        try { await env.DB.prepare(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'`).run(); } catch {}
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

      // --- Wave B2: spoiler-block secrets — reveal state per member in D1. ---
      // POST /api/secrets/reveal {id} — any member reveals a secret for self.
      if (url.pathname === '/api/secrets/reveal' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const id = cleanSecretId(body.id);
        if (!id) return json({ error: 'Unknown secret id' }, 400);
        try {
          await ensureTables();
          await env.DB.prepare(`INSERT INTO reveals (member_email, secret_id, state)
            VALUES (?, ?, 'revealed')
            ON CONFLICT(member_email, secret_id) DO UPDATE SET state = 'revealed', updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
            .bind(user.email, id).run();
          return json({ ok: true, id, state: 'revealed' });
        } catch {
          return json({ error: 'Secret could not be revealed' }, 500);
        }
      }

      // POST /api/secrets/set {id, state} — owner reveals/locks globally ('*'
      // rows, which every viewer reads as revealed while state = 'revealed').
      if (url.pathname === '/api/secrets/set' && request.method === 'POST') {
        const session = await requireUser(request, env);
        if (!session) return json({ error: 'Authentication required' }, 401);
        if (!(await isOwnerSession(session, env))) return json({ error: 'Owner access required' }, 403);
        let body;
        try { body = await readJson(request); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const id = cleanSecretId(body.id);
        const state = body.state === 'revealed' || body.state === 'locked' ? body.state : null;
        if (!id || !state) return json({ error: 'Valid secret id and state required' }, 400);
        try {
          await ensureTables();
          await env.DB.prepare(`INSERT INTO reveals (member_email, secret_id, state)
            VALUES ('*', ?, ?)
            ON CONFLICT(member_email, secret_id) DO UPDATE SET state = excluded.state, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`)
            .bind(id, state).run();
          return json({ ok: true, id, state });
        } catch {
          return json({ error: 'Secret state could not be changed' }, 500);
        }
      }

      // --- Wave F2: reader's primer — spoiler-gated read lens over reveals. ---
      // GET /api/primer — the caller's own revealed secret ids only (own rows
      // plus global '*' rows, mirroring getSecretsContext). No secret content
      // here: article HTML behind the geor-secret transform stays the only
      // place hidden bytes are ever served.
      if (url.pathname === '/api/primer' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        try {
          await ensureTables();
          const { results } = await env.DB.prepare(
            `SELECT secret_id FROM reveals WHERE state = 'revealed' AND (member_email = ? OR member_email = '*')`
          ).bind(user.email).all();
          const seen = new Set();
          for (const row of results || []) {
            const id = cleanSecretId(row?.secret_id);
            if (id) seen.add(id);
          }
          const revealed = [...seen].sort();
          return json({ revealed, count: revealed.length });
        } catch {
          return json({ error: 'Primer is temporarily unavailable' }, 503);
        }
      }

      // --- Wave E2: per-member notebook (quick notes + checklists) ------------
      // Own notes only: every statement binds member_email = session email.
      // Search is a length-capped LIKE over title/body with wildcards escaped.
      if (url.pathname === '/api/notes' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const query = (url.searchParams.get('q') || '').slice(0, 100).trim();
        try {
          await ensureTables();
          let statement = env.DB.prepare(`SELECT id, title, body, checklist_json, created_at, updated_at FROM notebook_notes
            WHERE member_email = ? ORDER BY updated_at DESC LIMIT 100`).bind(user.email);
          if (query) {
            const like = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
            statement = env.DB.prepare(`SELECT id, title, body, checklist_json, created_at, updated_at FROM notebook_notes
              WHERE member_email = ? AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
              ORDER BY updated_at DESC LIMIT 100`).bind(user.email, like, like);
          }
          const { results } = await statement.all();
          return json({ notes: (results || []).map(notebookNoteJson) });
        } catch {
          return json({ error: 'Notebook is temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/notes' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const title = cleanNotebookTitle(body.title ?? '');
        const noteBody = cleanNotebookBody(body.body);
        const checklist = cleanNotebookChecklist(body.checklist);
        if (title === null || noteBody === null || checklist === null) return json({ error: 'Valid notebook note required' }, 400);
        try {
          await ensureTables();
          const inserted = await env.DB.prepare(`INSERT INTO notebook_notes (member_email, title, body, checklist_json)
            VALUES (?, ?, ?, ?)`).bind(user.email, title, noteBody, JSON.stringify(checklist)).run();
          const row = await env.DB.prepare(`SELECT id, title, body, checklist_json, created_at, updated_at FROM notebook_notes
            WHERE id = ? AND member_email = ?`).bind(inserted.meta.last_row_id, user.email).first();
          if (!row) return json({ error: 'Notebook note could not be saved' }, 500);
          return json({ note: notebookNoteJson(row) }, 201);
        } catch {
          return json({ error: 'Notebook note could not be saved' }, 500);
        }
      }

      // PATCH / DELETE /api/notes/:id — own notes only (id + member_email bind,
      // zero changes means missing or another member's note: generic 404).
      const notebookIdMatch = url.pathname.match(/^\/api\/notes\/([^/]+)$/);
      if (notebookIdMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        const noteId = validPositiveId(Number(notebookIdMatch[1]));
        if (!noteId) return json({ error: 'Notebook note not found' }, 404);
        try {
          await ensureTables();
          if (request.method === 'DELETE') {
            const deleted = await env.DB.prepare('DELETE FROM notebook_notes WHERE id = ? AND member_email = ?')
              .bind(noteId, user.email).run();
            if (!deleted.meta.changes) return json({ error: 'Notebook note not found' }, 404);
            return json({ ok: true, id: noteId });
          }
          let body;
          try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const updates = [];
          const values = [];
          if (body.title !== undefined) {
            const title = cleanNotebookTitle(body.title);
            if (title === null) return json({ error: 'Valid notebook note required' }, 400);
            updates.push('title = ?'); values.push(title);
          }
          if (body.body !== undefined) {
            const noteBody = cleanNotebookBody(body.body);
            if (noteBody === null) return json({ error: 'Valid notebook note required' }, 400);
            updates.push('body = ?'); values.push(noteBody);
          }
          if (body.checklist !== undefined) {
            const checklist = cleanNotebookChecklist(body.checklist);
            if (checklist === null) return json({ error: 'Valid notebook note required' }, 400);
            updates.push('checklist_json = ?'); values.push(JSON.stringify(checklist));
          }
          if (!updates.length) return json({ error: 'Valid notebook note required' }, 400);
          updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
          const changed = await env.DB.prepare(`UPDATE notebook_notes SET ${updates.join(', ')} WHERE id = ? AND member_email = ?`)
            .bind(...values, noteId, user.email).run();
          if (!changed.meta.changes) return json({ error: 'Notebook note not found' }, 404);
          const row = await env.DB.prepare(`SELECT id, title, body, checklist_json, created_at, updated_at FROM notebook_notes
            WHERE id = ? AND member_email = ?`).bind(noteId, user.email).first();
          if (!row) return json({ error: 'Notebook note not found' }, 404);
          return json({ note: notebookNoteJson(row) });
        } catch {
          return json({ error: 'Notebook note could not be saved' }, 500);
        }
      }

      // --- Wave E3: whiteboards (pan/zoom canvas, wiki-linked cards) --------
      // Own boards only: every statement binds owner_email = session email.
      // Cards/arrows persist as doc_json {cards, arrows}; caps + wiki-link
      // checks run server-side before store, so oversized or off-archive
      // payloads 400 instead of landing in D1. Rate limits reuse 'reveal'.
      if (url.pathname === '/api/boards' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        try {
          await ensureTables();
          const { results } = await env.DB.prepare(`SELECT id, title, doc_json, updated_at FROM boards
            WHERE owner_email = ? ORDER BY updated_at DESC LIMIT 100`).bind(user.email).all();
          return json({ boards: (results || []).map(boardSummaryJson) });
        } catch {
          return json({ error: 'Whiteboards are temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/boards' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const title = cleanBoardTitle(body.title);
        if (title === null) return json({ error: 'Valid whiteboard required' }, 400);
        try {
          await ensureTables();
          const id = crypto.randomUUID();
          await env.DB.prepare(`INSERT INTO boards (id, owner_email, title, doc_json)
            VALUES (?, ?, ?, ?)`).bind(id, user.email, title, '{"cards":[],"arrows":[]}').run();
          const row = await env.DB.prepare(`SELECT id, title, doc_json, updated_at FROM boards
            WHERE id = ? AND owner_email = ?`).bind(id, user.email).first();
          if (!row) return json({ error: 'Whiteboard could not be saved' }, 500);
          return json({ board: boardJson(row) }, 201);
        } catch {
          return json({ error: 'Whiteboard could not be saved' }, 500);
        }
      }

      // GET / PUT / DELETE /api/boards/:id — own boards only (id +
      // owner_email bind, zero changes means missing or another member's
      // board: generic 404).
      const boardIdMatch = url.pathname.match(/^\/api\/boards\/([^/]+)$/);
      if (boardIdMatch && (request.method === 'GET' || request.method === 'PUT' || request.method === 'DELETE')) {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const boardId = cleanBoardId(boardIdMatch[1]);
        if (!boardId) return json({ error: 'Whiteboard not found' }, 404);
        if (request.method !== 'GET') {
          const throttle = await consumeRateLimit(request, env, 'reveal');
          if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        }
        try {
          await ensureTables();
          if (request.method === 'DELETE') {
            const deleted = await env.DB.prepare('DELETE FROM boards WHERE id = ? AND owner_email = ?')
              .bind(boardId, user.email).run();
            if (!deleted.meta.changes) return json({ error: 'Whiteboard not found' }, 404);
            return json({ ok: true, id: boardId });
          }
          if (request.method === 'GET') {
            const row = await env.DB.prepare(`SELECT id, title, doc_json, updated_at FROM boards
              WHERE id = ? AND owner_email = ?`).bind(boardId, user.email).first();
            if (!row) return json({ error: 'Whiteboard not found' }, 404);
            return json({ board: boardJson(row) });
          }
          let body;
          try { body = await readJson(request, MAX_SAVE_JSON_BYTES); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
          if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
          const cards = cleanBoardCards(body.cards);
          const arrows = cards === null ? null : cleanBoardArrows(body.arrows, new Set(cards.map(card => card.id)));
          if (cards === null || arrows === null) return json({ error: 'Valid whiteboard required' }, 400);
          const updates = ['doc_json = ?'];
          const values = [JSON.stringify({ cards, arrows })];
          if (body.title !== undefined) {
            const title = cleanBoardTitle(body.title);
            if (title === null) return json({ error: 'Valid whiteboard required' }, 400);
            updates.push('title = ?'); values.push(title);
          }
          updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
          const changed = await env.DB.prepare(`UPDATE boards SET ${updates.join(', ')} WHERE id = ? AND owner_email = ?`)
            .bind(...values, boardId, user.email).run();
          if (!changed.meta.changes) return json({ error: 'Whiteboard not found' }, 404);
          const row = await env.DB.prepare(`SELECT id, title, doc_json, updated_at FROM boards
            WHERE id = ? AND owner_email = ?`).bind(boardId, user.email).first();
          if (!row) return json({ error: 'Whiteboard not found' }, 404);
          return json({ board: boardJson(row) });
        } catch {
          return json({ error: 'Whiteboard could not be saved' }, 500);
        }
      }

      // --- Wave E4: marginalia (page-anchored notes in the reader) --------
      // Own notes for the page plus notes other members marked shared;
      // private notes stay invisible — enforced in SQL, never filtered
      // client-side. POST creates own notes only. Rate limits reuse
      // 'reveal'. Reads cap at 100, oldest first (margin order).
      if (url.pathname === '/api/marginalia' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const page = cleanMarginaliaPage(url.searchParams.get('page'));
        if (!page) return json({ error: 'Valid wiki page required' }, 400);
        const anchorParam = url.searchParams.get('anchor');
        let anchorFilter = null;
        if (anchorParam != null && anchorParam !== '') {
          const cleaned = cleanMarginaliaAnchor(anchorParam);
          if (cleaned === null) return json({ error: 'Valid wiki page required' }, 400);
          if (cleaned) anchorFilter = cleaned;
        }
        try {
          await ensureTables();
          const base = `SELECT id, member_email, page, anchor, body, shared, created_at, updated_at FROM notes
            WHERE page = ? AND (member_email = ? OR shared = 1)`;
          const statement = anchorFilter
            ? env.DB.prepare(`${base} AND anchor = ? ORDER BY created_at ASC LIMIT 100`).bind(page, user.email, anchorFilter)
            : env.DB.prepare(`${base} ORDER BY created_at ASC LIMIT 100`).bind(page, user.email);
          const { results } = await statement.all();
          return json({ notes: (results || []).map(row => marginaliaNoteJson(row, user.email)) });
        } catch {
          return json({ error: 'Marginalia is temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/marginalia' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const page = cleanMarginaliaPage(body.page);
        const anchor = cleanMarginaliaAnchor(body.anchor);
        const noteBody = cleanMarginaliaBody(body.body);
        if (!page || anchor === null || !noteBody) return json({ error: 'Valid marginalia note required' }, 400);
        const shared = body.shared === true || body.shared === 1 ? 1 : 0;
        try {
          await ensureTables();
          const inserted = await env.DB.prepare(`INSERT INTO notes (member_email, page, anchor, body, shared)
            VALUES (?, ?, ?, ?, ?)`).bind(user.email, page, anchor, noteBody, shared).run();
          const row = await env.DB.prepare(`SELECT id, member_email, page, anchor, body, shared, created_at, updated_at FROM notes
            WHERE id = ? AND member_email = ?`).bind(inserted.meta.last_row_id, user.email).first();
          if (!row) return json({ error: 'Marginalia note could not be saved' }, 500);
          return json({ note: marginaliaNoteJson(row, user.email) }, 201);
        } catch {
          return json({ error: 'Marginalia note could not be saved' }, 500);
        }
      }

      // --- Wave F1: story arcs + plot trees ---------------------------------
      // Own arcs only: every statement scopes arcs.created_by = session
      // email; plots + threads scope through their arc (a foreign arc id
      // reads as a generic 404 — never confirm or deny another member's
      // titles). Parent links validate server-side: same arc, ancestor
      // walk with a 32-deep cap, loops rejected before store. Thread
      // states are a strict seed/active/resolved enum. Rate limits reuse
      // 'reveal', mirroring the notebook/whiteboard pattern.
      if (url.pathname === '/api/arcs' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        try {
          await ensureTables();
          const { results } = await env.DB.prepare(`SELECT id, title, summary, status, created_by, created_at, updated_at FROM arcs
            WHERE created_by = ? ORDER BY updated_at DESC LIMIT 100`).bind(user.email).all();
          return json({ arcs: (results || []).map(arcJson) });
        } catch {
          return json({ error: 'Story arcs are temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/arcs' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const title = cleanArcTitle(body.title);
        const summary = cleanArcSummary(body.summary);
        const status = cleanArcStatus(body.status);
        if (title === null || summary === null || status === null) return json({ error: 'Valid story arc required' }, 400);
        try {
          await ensureTables();
          const id = crypto.randomUUID();
          await env.DB.prepare(`INSERT INTO arcs (id, title, summary, status, created_by)
            VALUES (?, ?, ?, ?, ?)`).bind(id, title, summary, status, user.email).run();
          const row = await env.DB.prepare(`SELECT id, title, summary, status, created_by, created_at, updated_at FROM arcs
            WHERE id = ? AND created_by = ?`).bind(id, user.email).first();
          if (!row) return json({ error: 'Story arc could not be saved' }, 500);
          return json({ arc: arcJson(row) }, 201);
        } catch {
          return json({ error: 'Story arc could not be saved' }, 500);
        }
      }

      // GET /api/arcs/:id — the arc with its plot tree + threads (the tree
      // renders from D1 through this endpoint; foreign arcs 404).
      const arcIdMatch = url.pathname.match(/^\/api\/arcs\/([^/]+)$/);
      if (arcIdMatch && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const arcId = cleanArcId(arcIdMatch[1]);
        if (!arcId) return json({ error: 'Story arc not found' }, 404);
        try {
          await ensureTables();
          const arc = await env.DB.prepare(`SELECT id, title, summary, status, created_by, created_at, updated_at FROM arcs
            WHERE id = ? AND created_by = ?`).bind(arcId, user.email).first();
          if (!arc) return json({ error: 'Story arc not found' }, 404);
          const { results: plotRows } = await env.DB.prepare(`SELECT id, arc_id, parent_id, title, summary, is_master, sort FROM plots
            WHERE arc_id = ? ORDER BY sort ASC LIMIT 200`).bind(arcId).all();
          const { results: threadRows } = await env.DB.prepare(`SELECT id, arc_id, title, state, created_at, updated_at FROM threads
            WHERE arc_id = ? ORDER BY created_at ASC LIMIT 200`).bind(arcId).all();
          return json({ arc: arcJson(arc), plots: (plotRows || []).map(plotJson), threads: (threadRows || []).map(threadJson) });
        } catch {
          return json({ error: 'Story arcs are temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/plots' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const arcId = cleanArcId(body.arc_id);
        const title = cleanPlotTitle(body.title);
        const summary = cleanPlotSummary(body.summary);
        if (!arcId || title === null || summary === null) return json({ error: 'Valid plot required' }, 400);
        let parentId = null;
        if (body.parent_id != null && body.parent_id !== '') {
          parentId = cleanPlotId(body.parent_id);
          if (!parentId) return json({ error: 'Valid plot required' }, 400);
        }
        const isMaster = body.is_master === true || body.is_master === 1 ? 1 : 0;
        let sort = 0;
        if (body.sort !== undefined) {
          if (!Number.isSafeInteger(body.sort) || Math.abs(body.sort) > PLOT_SORT_MAX) return json({ error: 'Valid plot required' }, 400);
          sort = body.sort;
        }
        try {
          await ensureTables();
          const arc = await env.DB.prepare('SELECT id FROM arcs WHERE id = ? AND created_by = ?').bind(arcId, user.email).first();
          if (!arc) return json({ error: 'Story arc not found' }, 404);
          const id = crypto.randomUUID();
          if (parentId) {
            const loopError = await plotParentError(env, arcId, parentId, id);
            if (loopError) return json({ error: loopError }, 400);
          }
          await env.DB.prepare(`INSERT INTO plots (id, arc_id, parent_id, title, summary, is_master, sort)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, arcId, parentId, title, summary, isMaster, sort).run();
          const row = await env.DB.prepare(`SELECT id, arc_id, parent_id, title, summary, is_master, sort FROM plots
            WHERE id = ?`).bind(id).first();
          if (!row || row.arc_id !== arcId) return json({ error: 'Plot could not be saved' }, 500);
          return json({ plot: plotJson(row) }, 201);
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Plot could not be saved' }, 500);
        }
      }

      // PATCH /api/plots/:id — own plots only (ownership resolves through
      // the plot's arc; foreign plots 404). parent_id: null detaches to a
      // root; any new link walks ancestors first — self-parents, cycles,
      // and over-deep trees 400 before store.
      const plotIdMatch = url.pathname.match(/^\/api\/plots\/([^/]+)$/);
      if (plotIdMatch && request.method === 'PATCH') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        const plotId = cleanPlotId(plotIdMatch[1]);
        if (!plotId) return json({ error: 'Plot not found' }, 404);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        try {
          await ensureTables();
          const plot = await env.DB.prepare(`SELECT id, arc_id, parent_id, title, summary, is_master, sort FROM plots
            WHERE id = ?`).bind(plotId).first();
          if (!plot) return json({ error: 'Plot not found' }, 404);
          const arc = await env.DB.prepare('SELECT id FROM arcs WHERE id = ? AND created_by = ?').bind(plot.arc_id, user.email).first();
          if (!arc) return json({ error: 'Plot not found' }, 404);
          const updates = [];
          const values = [];
          if (body.title !== undefined) {
            const title = cleanPlotTitle(body.title);
            if (title === null) return json({ error: 'Valid plot required' }, 400);
            updates.push('title = ?'); values.push(title);
          }
          if (body.summary !== undefined) {
            const summary = cleanPlotSummary(body.summary);
            if (summary === null) return json({ error: 'Valid plot required' }, 400);
            updates.push('summary = ?'); values.push(summary);
          }
          if (body.is_master !== undefined) {
            updates.push('is_master = ?'); values.push(body.is_master === true || body.is_master === 1 ? 1 : 0);
          }
          if (body.sort !== undefined) {
            if (!Number.isSafeInteger(body.sort) || Math.abs(body.sort) > PLOT_SORT_MAX) return json({ error: 'Valid plot required' }, 400);
            updates.push('sort = ?'); values.push(body.sort);
          }
          if (body.parent_id !== undefined) {
            let parentId = null;
            if (body.parent_id != null && body.parent_id !== '') {
              parentId = cleanPlotId(body.parent_id);
              if (!parentId) return json({ error: 'Valid plot required' }, 400);
              const loopError = await plotParentError(env, plot.arc_id, parentId, plotId);
              if (loopError) return json({ error: loopError }, 400);
            }
            updates.push('parent_id = ?'); values.push(parentId);
          }
          if (!updates.length) return json({ error: 'Valid plot required' }, 400);
          await env.DB.prepare(`UPDATE plots SET ${updates.join(', ')} WHERE id = ?`).bind(...values, plotId).run();
          const row = await env.DB.prepare(`SELECT id, arc_id, parent_id, title, summary, is_master, sort FROM plots
            WHERE id = ?`).bind(plotId).first();
          if (!row) return json({ error: 'Plot not found' }, 404);
          return json({ plot: plotJson(row) });
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Plot could not be saved' }, 500);
        }
      }

      if (url.pathname === '/api/threads' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const arcId = cleanArcId(url.searchParams.get('arc'));
        if (!arcId) return json({ error: 'Valid story arc required' }, 400);
        try {
          await ensureTables();
          const arc = await env.DB.prepare('SELECT id FROM arcs WHERE id = ? AND created_by = ?').bind(arcId, user.email).first();
          if (!arc) return json({ error: 'Story arc not found' }, 404);
          const { results } = await env.DB.prepare(`SELECT id, arc_id, title, state, created_at, updated_at FROM threads
            WHERE arc_id = ? ORDER BY created_at ASC LIMIT 200`).bind(arcId).all();
          return json({ threads: (results || []).map(threadJson) });
        } catch {
          return json({ error: 'Threads are temporarily unavailable' }, 503);
        }
      }

      if (url.pathname === '/api/threads' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const arcId = cleanArcId(body.arc_id);
        const title = cleanThreadTitle(body.title);
        const state = cleanThreadState(body.state);
        if (!arcId || title === null || state === null) return json({ error: 'Valid thread required' }, 400);
        try {
          await ensureTables();
          const arc = await env.DB.prepare('SELECT id FROM arcs WHERE id = ? AND created_by = ?').bind(arcId, user.email).first();
          if (!arc) return json({ error: 'Story arc not found' }, 404);
          const id = crypto.randomUUID();
          await env.DB.prepare(`INSERT INTO threads (id, arc_id, title, state)
            VALUES (?, ?, ?, ?)`).bind(id, arcId, title, state).run();
          const row = await env.DB.prepare(`SELECT id, arc_id, title, state, created_at, updated_at FROM threads
            WHERE id = ?`).bind(id).first();
          if (!row || row.arc_id !== arcId) return json({ error: 'Thread could not be saved' }, 500);
          return json({ thread: threadJson(row) }, 201);
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Thread could not be saved' }, 500);
        }
      }

      // PATCH /api/threads/:id — own threads only (ownership resolves
      // through the thread's arc); state transitions keep the strict enum.
      const threadIdMatch = url.pathname.match(/^\/api\/threads\/([^/]+)$/);
      if (threadIdMatch && request.method === 'PATCH') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        const threadId = cleanPlotId(threadIdMatch[1]);
        if (!threadId) return json({ error: 'Thread not found' }, 404);
        let body;
        try { body = await readJson(request, 32_768); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        try {
          await ensureTables();
          const thread = await env.DB.prepare(`SELECT id, arc_id, title, state, created_at, updated_at FROM threads
            WHERE id = ?`).bind(threadId).first();
          if (!thread) return json({ error: 'Thread not found' }, 404);
          const arc = await env.DB.prepare('SELECT id FROM arcs WHERE id = ? AND created_by = ?').bind(thread.arc_id, user.email).first();
          if (!arc) return json({ error: 'Thread not found' }, 404);
          const updates = [];
          const values = [];
          if (body.title !== undefined) {
            const title = cleanThreadTitle(body.title);
            if (title === null) return json({ error: 'Valid thread required' }, 400);
            updates.push('title = ?'); values.push(title);
          }
          if (body.state !== undefined) {
            if (typeof body.state !== 'string' || !THREAD_STATES.has(body.state)) return json({ error: 'Valid thread required' }, 400);
            updates.push('state = ?'); values.push(body.state);
          }
          if (!updates.length) return json({ error: 'Valid thread required' }, 400);
          updates.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
          await env.DB.prepare(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).bind(...values, threadId).run();
          const row = await env.DB.prepare(`SELECT id, arc_id, title, state, created_at, updated_at FROM threads
            WHERE id = ?`).bind(threadId).first();
          if (!row) return json({ error: 'Thread not found' }, 404);
          return json({ thread: threadJson(row) });
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Thread could not be saved' }, 500);
        }
      }

      // --- Wave E1: manuscripts (chapters/scenes writing studio) --------------
      // Chapters live under Books/<book>/<chapter>.md in the SAME additions
      // repo and commit flow as /api/additions — no new store, no new D1
      // tables. Draft versioning is client localStorage autosave; server
      // versions surface through /api/additions/history?path=Books/....
      // GET /api/manuscripts -> {files} (Books/ tree only)
      // GET /api/manuscripts?book=B -> {files} filtered to Books/B/
      // GET /api/manuscripts?book=B&chapter=C -> {path, content, sha, ...}
      if (url.pathname === '/api/manuscripts' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        const book = url.searchParams.get('book');
        const chapter = url.searchParams.get('chapter');
        if (chapter != null && book == null) return json({ error: 'book required with chapter' }, 400);
        if (book != null && chapter != null) {
          const path = manuscriptPath(book, chapter);
          if (!path) return json({ error: 'Invalid book or chapter' }, 400);
          try {
            const r = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
            if (r.status === 404) return json({ error: 'Manuscript not found' }, 404);
            if (!r.ok) return json({ error: 'Additions repository is unavailable' }, 502);
            const j = await r.json();
            if (j.type !== 'file' || !j.content) return json({ error: 'Not a file' }, 400);
            return json({ path: j.path, sha: j.sha, size: j.size, html_url: j.html_url, content: b64DecodeUtf8(j.content) });
          } catch {
            return json({ error: 'Manuscript could not be loaded' }, 500);
          }
        }
        // List: same git-tree listing as additions, scoped to the Books/ tree.
        let prefix = `${MANUSCRIPT_ROOT}/`;
        if (book != null) {
          const cleanBook = cleanManuscriptSegment(book);
          if (!cleanBook) return json({ error: 'Invalid book' }, 400);
          prefix = `${MANUSCRIPT_ROOT}/${cleanBook}/`;
        }
        try {
          const treeRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/git/trees/${ADDITIONS_BRANCH}?recursive=1`, { method: 'GET' }, env);
          if (!treeRes.ok) return json({ error: 'Additions repository is unavailable' }, 502);
          const j = await treeRes.json();
          const files = (j.tree || [])
            .filter(n => n.type === 'blob')
            .map(n => {
              const path = safeAdditionListPath(n.path);
              return path && path.startsWith(prefix) ? { path, sha: n.sha, size: n.size || 0 } : null;
            })
            .filter(Boolean)
            .sort((a,b) => a.path.localeCompare(b.path));
          return json({ files, root: prefix });
        } catch {
          return json({ error: 'Manuscripts are temporarily unavailable' }, 500);
        }
      }

      // POST /api/manuscripts {book, chapter, title?, body} -> commit to Books/.
      if (url.pathname === '/api/manuscripts' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Authentication required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'Archive publishing is unavailable' }, 503);
        const throttle = await consumeRateLimit(request, env, 'reveal');
        if (!throttle.allowed) return rateLimited(throttle.retryAfter);
        let body;
        try { body = await readJson(request, 512_000); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
        if (!isJsonObject(body)) return json({ error: 'JSON object required' }, 400);
        const path = manuscriptPath(body.book, body.chapter);
        if (!path) return json({ error: 'Valid book and chapter required (A-Z 0-9 . _ - space)' }, 400);
        const title = cleanManuscriptTitle(body.title);
        const chapterBody = cleanManuscriptBody(body.body);
        if (title === null || chapterBody === null) return json({ error: 'Title within 200 chars and a body within 100k chars required' }, 400);
        const content = buildManuscriptContent(title, chapterBody);
        try {
          let existingSha = null;
          const check = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (check.ok) {
            const jc = await check.json();
            if (jc.sha) existingSha = jc.sha;
          } else if (check.status !== 404) {
            return json({ error: 'Additions repository is unavailable' }, 502);
          }
          const putBody = {
            message: `manuscript ${path} via /manuscripts — by ${user.email}`,
            content: b64EncodeUtf8(content),
            branch: ADDITIONS_BRANCH,
          };
          if (existingSha) putBody.sha = existingSha;
          const putRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
          }, env);
          if (!putRes.ok) return json({ error: 'Manuscript could not be saved', status: putRes.status }, 502);
          const pj = await putRes.json();
          if (env.DB) ctx.waitUntil(env.DB.prepare('INSERT INTO activity (action, path, summary, actor_email) VALUES (?, ?, ?, ?)')
            .bind(existingSha ? 'edit' : 'create', path, existingSha ? 'Revised a manuscript chapter' : 'Created a manuscript chapter', user.email).run().catch(() => {}));
          return json({ ok: true, path, sha: pj.content?.sha || pj.commit?.sha, html_url: pj.content?.html_url });
        } catch {
          return json({ error: 'Manuscript could not be saved' }, 500);
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
    const gatedResponse = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    // Wave B2: resolve secret visibility before rewriting (HTMLRewriter element
    // handlers are synchronous, so reveal state loads up front; any DB failure
    // falls back to fully locked). Skipped for non-HTML gated assets.
    const gatedType = response.headers.get('Content-Type') || '';
    let secretsCtx = null;
    if (gatedType.toLowerCase().includes('text/html') && response.status >= 200 && response.status < 300 && typeof HTMLRewriter !== 'undefined') {
      try { secretsCtx = await getSecretsContext(request, env); } catch { secretsCtx = null; }
    }
    return withPrivateArchiveShell(gatedResponse, url.pathname, secretsCtx, { env, origin: url.origin });
  }
};

export const __test = {
  classifyArticleLayout,
  collectTocEntries,
  slugifyHeadingText,
  tocNavHtml,
  renderTocHtml,
  computeRelated,
  buildRelatedLookup,
  resetRelatedCache,
  relatedUrlForPagePath,
  cleanArchivePath,
  cleanArcId,
  cleanArcStatus,
  cleanArcSummary,
  cleanArcTitle,
  cleanPlotId,
  cleanPlotSummary,
  cleanPlotTitle,
  cleanThreadState,
  cleanThreadTitle,
  cleanSecretId,
  cleanArchiveTitle,
  cleanInviteCode,
  cleanBoardArrows,
  cleanBoardCards,
  cleanBoardCoord,
  cleanBoardId,
  cleanBoardTitle,
  cleanBoardWiki,
  cleanNotebookBody,
  cleanNotebookChecklist,
  cleanNotebookTitle,
  cleanMapSlug,
  cleanMarginaliaAnchor,
  cleanMarginaliaBody,
  cleanMarginaliaPage,
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
  marginaliaNoteJson,
  signJwt,
  verifyPassword,
  verifyJwt,
  buildManuscriptContent,
  cleanManuscriptBody,
  cleanManuscriptSegment,
  cleanManuscriptTitle,
  manuscriptPath,
};
