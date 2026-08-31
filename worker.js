// worldofgeor — Worker + Assets + D1 invite-only auth
// Serves /dist via ASSETS, handles /api/register + /api/login + /api/me + /api/additions
// Invite codes stored in D1.invites — you own the DB.
// Additions: commits to https://github.com/actualrat1984/Website-additions via GITHUB_TOKEN secret

const JWT_EXP_SEC = 60 * 60 * 24 * 30; // 30 days
const JWT_ISSUER = 'worldofgeor';
const COOKIE_NAME = 'geor_token';
const ADMIN_EMAIL = 'ichieisenheart@gmail.com';
const MAX_JSON_BYTES = 1_000_000;
const ALLOWED_ADDITION_EXTENSIONS = new Set(['md', 'txt', 'json', 'yaml', 'yml', 'csv']);
const PRIVATE_ASSET_PATHS = new Set([
  '/wiki-index.json',
  '/world-map.jpg',
  '/world-map.webp',
  '/world-map-thumb.jpg',
  '/world-map-thumb.webp',
  '/grimmel-peninsula.jpg',
  '/grimmel-peninsula.webp',
]);
const ROUTE_ALIASES = new Map([
  ['/updates', '/updates.html'],
  ['/atlas', '/atlas.html'],
  ['/dashboard', '/dashboard.html'],
  ['/admin', '/admin.html'],
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
    if (payload.iss && payload.iss !== JWT_ISSUER) return null;
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
  return pathname === '/wiki' || pathname.startsWith('/wiki/') ||
    pathname === '/app' || pathname.startsWith('/app/') ||
    pathname === '/atlas' || pathname === '/atlas.html' ||
    pathname === '/dashboard' || pathname === '/dashboard.html' ||
    pathname === '/admin' || pathname === '/admin.html' ||
    PRIVATE_ASSET_PATHS.has(pathname);
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
  p = String(p).trim().replace(/^\/+/, '');
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
  p = String(p).trim().replace(/^\/+/, '').replace(/\/+$/, '');
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
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
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_requests_status_created ON requests(status, created_at DESC)`),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC)`),
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
          const { email, password, inviteCode } = await readJson(request, 16_384);
          if (!email || !password || !inviteCode) return json({ error: 'Missing fields' }, 400);
          if (typeof password !== 'string' || password.length < 12 || password.length > 256) return json({ error: 'Password must be 12–256 characters' }, 400);
          const normEmail = normalizeEmail(email);
          if (!isValidEmail(normEmail)) return json({ error: 'Valid email required' }, 400);
          const cleanCode = cleanInviteCode(inviteCode);
          if (!cleanCode) return json({ error: 'Invalid or unavailable invite code' }, 403);
          const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normEmail).first();
          if (exists) return json({ error: 'Email already registered' }, 409);
          const salt = randomSalt();
          const hash = await pbkdf2Hash(password, salt);
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
          const { email, password } = await readJson(request, 16_384);
          if (!email || !password) return json({ error: 'Missing fields' }, 400);
          if (typeof password !== 'string' || password.length > 256) return json({ error: 'Invalid email or password' }, 401);
          const normEmail = normalizeEmail(email);
          if (!isValidEmail(normEmail)) return json({ error: 'Invalid email or password' }, 401);
          const user = await env.DB.prepare('SELECT email, password_hash, salt FROM users WHERE email = ?').bind(normEmail).first();
          if (!user) return json({ error: 'Invalid email or password' }, 401);
          const hash = await pbkdf2Hash(password, user.salt);
          if (!constantTimeEqual(hash, user.password_hash)) return json({ error: 'Invalid email or password' }, 401);
          const secret = getJwtSecret(env);
          const now = Math.floor(Date.now() / 1000);
          const token = await signJwt({ email: normEmail, iss: JWT_ISSUER, iat: now, exp: now + JWT_EXP_SEC }, secret);
          return json({ ok: true, email: normEmail }, 200, { 'Set-Cookie': authCookie(token) });
        } catch (e) {
          if (e instanceof RangeError) return json({ error: e.message }, 413);
          if (e instanceof SyntaxError) return json({ error: e.message }, 400);
          return json({ error: 'Login is temporarily unavailable' }, 500);
        }
      }

      // GET /api/updates — public, privacy-safe archive activity.
      if (url.pathname === '/api/updates' && request.method === 'GET') {
        try {
          await ensureTables();
          const requestedLimit = Number(url.searchParams.get('limit') || 18);
          const limit = Number.isSafeInteger(requestedLimit) ? Math.min(50, Math.max(1, requestedLimit)) : 18;
          const { results } = await env.DB.prepare(`SELECT id, action, path, summary, created_at
            FROM activity ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit).all();
          return json({ updates: results || [], refreshedAt: new Date().toISOString() }, 200, {
            'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
          });
        } catch {
          return json({ updates: [], refreshedAt: new Date().toISOString(), unavailable: true }, 200, {
            'Cache-Control': 'public, max-age=15',
          });
        }
      }

      // POST /api/request-access  {email, message} — public, creates pending request + emails admin
      if (url.pathname === '/api/request-access' && request.method === 'POST') {
        try {
          await ensureTables();
          const { email, message } = await readJson(request, 16_384);
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
          const id = validPositiveId(body.id);
          if (!id) return json({ error: 'Valid request id required' }, 400);
          const req = await env.DB.prepare('SELECT email, status FROM requests WHERE id = ?').bind(id).first();
          if (!req) return json({ error: 'Request not found' }, 404);
          if (req.status !== 'pending') return json({ error: 'Request has already been resolved' }, 409);
          const clean = body.code ? cleanInviteCode(body.code) : randomInviteCode();
          if (!clean) return json({ error: 'Invalid invite code' }, 400);
          const result = await env.DB.prepare('INSERT OR IGNORE INTO invites (code) VALUES (?)').bind(clean).run();
          if (result.meta?.changes !== 1) return json({ error: 'Invite already exists' }, 409);
          await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ? AND status = ?').bind('approved', id, 'pending').run();
          return json({ ok: true, code: clean, email: req.email });
        }
        if (url.pathname === '/api/admin/requests/reject' && request.method === 'POST') {
          let body;
          try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
          const id = validPositiveId(body.id);
          if (!id) return json({ error: 'Valid request id required' }, 400);
          await env.DB.prepare('UPDATE requests SET status = "rejected" WHERE id = ? AND status = "pending"').bind(id).run();
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

      // --- Additions (Website-additions repo) — requires auth ---
      // GET /api/additions/list -> {files:[{path, sha, size, html_url}]}
      if (url.pathname === '/api/additions/list' && request.method === 'GET') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        try {
          // try git trees recursive — most complete
          const treeRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/git/trees/${ADDITIONS_BRANCH}?recursive=1`, { method: 'GET' }, env);
          if (treeRes.ok) {
            const j = await treeRes.json();
            const files = (j.tree || [])
              .filter(n => n.type === 'blob')
              .map(n => ({ path: n.path, sha: n.sha, size: n.size || 0 }))
              // hide .git internals and filter out directories that slipped
              .filter(f => !f.path.startsWith('.'))
              .sort((a,b) => a.path.localeCompare(b.path));
            return json({ files, via: 'tree' });
          }
          // fallback: /contents at root
          const cRes = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (cRes.ok) {
            const arr = await cRes.json();
            const files = (Array.isArray(arr) ? arr : []).filter(x => x.type === 'file').map(x => ({ path: x.path, sha: x.sha, size: x.size }));
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
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
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

      // POST /api/additions/save {path, content, oldPath?, message?} -> commit to GitHub
      if (url.pathname === '/api/additions/save' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        let body;
        try { body = await readJson(request); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
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
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        let body; try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
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
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        let body; try { body = await readJson(request, 4096); } catch (e) { return json({ error: e.message }, e instanceof RangeError ? 413 : 400); }
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
        return Response.redirect(`${url.origin}/?next=${next}`, 302);
      }
      if (url.pathname === '/admin.html' || url.pathname === '/admin') {
        if (payload.email !== ADMIN_EMAIL) return Response.redirect(`${url.origin}/dashboard.html`, 302);
      }
    }

    // --- Static assets fallback ---
    const alias = ROUTE_ALIASES.get(url.pathname);
    let assetRequest = request;
    if (alias) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = alias;
      assetRequest = new Request(assetUrl.toString(), request);
    }
    const response = await env.ASSETS.fetch(assetRequest);
    if (!needsAuth) return response;
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'private, no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};

export const __test = {
  cleanInviteCode,
  constantTimeEqual,
  isPrivatePath,
  isTrustedMutation,
  sanitizeAdditionsPath,
  sanitizeFolderPath,
  signJwt,
  verifyJwt,
};
