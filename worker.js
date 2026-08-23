// worldofgeor — Worker + Assets + D1 invite-only auth
// Serves /dist via ASSETS, handles /api/register + /api/login + /api/me
// Invite codes stored in D1.invites — you own the DB.

const JWT_EXP_SEC = 60 * 60 * 24 * 30; // 30 days

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
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
async function pbkdf2Hash(password, saltB64, iterations = 120000) {
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
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const sig = await hmacSha256(secret, data);
  if (b64url(sig) !== parts[2]) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch { return null; }
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}
function parseCookies(req) {
  const h = req.headers.get('Cookie') || '';
  const o = {};
  h.split(';').forEach(p => { const [k, ...v] = p.trim().split('='); if (k) o[k] = decodeURIComponent(v.join('=')); });
  return o;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // --- API routes ---
    if (url.pathname.startsWith('/api/')) {
      const secret = env.JWT_SECRET || 'dev-secret-change-me-in-dashboard';
      // auto-migrate tables if missing (so /api/register 500 never happens)
      async function ensureTables() {
        if (!env.DB) throw new Error('D1 binding DB missing — add D1 database worldofgeor-db with variable name DB in Worker Settings → Bindings');
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, invite_code TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, used_by TEXT, used_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
        // seed defaults (ignore if exists)
        try { await env.DB.prepare(`INSERT OR IGNORE INTO invites (code) VALUES ('WELCOME_TO_GEOR_2026'), ('MIKHAIL_INVITE'), ('ARCADY_INVITE')`).run(); } catch {}
      }
      // CORS for same origin only
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: { 'Access-Control-Allow-Origin': url.origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Credentials': 'true' } });
      }

      // POST /api/register  {email, password, inviteCode}
      if (url.pathname === '/api/register' && request.method === 'POST') {
        try {
          await ensureTables();
          const { email, password, inviteCode } = await request.json();
          if (!email || !password || !inviteCode) return json({ error: 'Missing fields' }, 400);
          if (password.length < 8) return json({ error: 'Password too short (8+)' }, 400);
          const normEmail = email.trim().toLowerCase();
          // check invite valid and not used
          const invite = await env.DB.prepare('SELECT code, used_by FROM invites WHERE code = ?').bind(inviteCode.trim()).first();
          if (!invite) return json({ error: 'Invalid invite code' }, 403);
          if (invite.used_by) return json({ error: 'Invite already used' }, 403);
          // allowlist check via env.INVITE_CODE fallback (if no D1 row)
          // check user not exists
          const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normEmail).first();
          if (exists) return json({ error: 'Email already registered' }, 409);
          const salt = randomSalt();
          const hash = await pbkdf2Hash(password, salt);
          await env.DB.prepare('INSERT INTO users (email, password_hash, salt, invite_code) VALUES (?, ?, ?, ?)').bind(normEmail, hash, salt, inviteCode.trim()).run();
          await env.DB.prepare('UPDATE invites SET used_by = ?, used_at = strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\') WHERE code = ?').bind(normEmail, inviteCode.trim()).run();
          const token = await signJwt({ email: normEmail, exp: Math.floor(Date.now() / 1000) + JWT_EXP_SEC }, secret);
          return json({ ok: true, email: normEmail }, 200, { 'Set-Cookie': `geor_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${JWT_EXP_SEC}` });
        } catch (e) {
          return json({ error: 'Register failed', detail: String(e) }, 500);
        }
      }

      // POST /api/login  {email, password}
      if (url.pathname === '/api/login' && request.method === 'POST') {
        try {
          await ensureTables();
          const { email, password } = await request.json();
          if (!email || !password) return json({ error: 'Missing fields' }, 400);
          const normEmail = email.trim().toLowerCase();
          const user = await env.DB.prepare('SELECT email, password_hash, salt FROM users WHERE email = ?').bind(normEmail).first();
          if (!user) return json({ error: 'Invalid email or password' }, 401);
          const hash = await pbkdf2Hash(password, user.salt);
          if (hash !== user.password_hash) return json({ error: 'Invalid email or password' }, 401);
          const token = await signJwt({ email: normEmail, exp: Math.floor(Date.now() / 1000) + JWT_EXP_SEC }, secret);
          return json({ ok: true, email: normEmail }, 200, { 'Set-Cookie': `geor_token=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${JWT_EXP_SEC}` });
        } catch (e) {
          return json({ error: 'Login failed', detail: String(e) }, 500);
        }
      }

      // GET /api/me  -> {email} if logged in
      if (url.pathname === '/api/me' && request.method === 'GET') {
        const cookies = parseCookies(request);
        const token = cookies.geor_token || request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!token) return json({ user: null }, 200);
        const payload = await verifyJwt(token, secret);
        if (!payload) return json({ user: null }, 200);
        return json({ user: { email: payload.email } }, 200);
      }

      // POST /api/logout
      if (url.pathname === '/api/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, { 'Set-Cookie': `geor_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
      }

      // --- Admin (only ichieisenheart@gmail.com) ---
      const isAdmin = async () => {
        const cookies = parseCookies(request);
        const token = cookies.geor_token || request.headers.get('Authorization')?.replace('Bearer ', '');
        if (!token) return false;
        const p = await verifyJwt(token, secret);
        return p && p.email === 'ichieisenheart@gmail.com';
      };
      if (url.pathname.startsWith('/api/admin/')) {
        if (!(await isAdmin())) return json({ error: 'Admin only — login as ichieisenheart@gmail.com' }, 403);
        if (url.pathname === '/api/admin/invites' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT code, used_by, used_at, created_at FROM invites ORDER BY created_at DESC').all();
          return json({ invites: results });
        }
        if (url.pathname === '/api/admin/invites' && request.method === 'POST') {
          const { code } = await request.json();
          if (!code) return json({ error: 'code required' }, 400);
          const clean = code.trim().toUpperCase().replace(/\s+/g, '_');
          await env.DB.prepare('INSERT OR IGNORE INTO invites (code) VALUES (?)').bind(clean).run();
          return json({ ok: true, code: clean });
        }
        if (url.pathname.startsWith('/api/admin/invites/') && request.method === 'DELETE') {
          const code = decodeURIComponent(url.pathname.split('/').pop());
          await env.DB.prepare('DELETE FROM invites WHERE code = ?').bind(code).run();
          return json({ ok: true });
        }
        if (url.pathname === '/api/admin/users' && request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT id, email, invite_code, created_at FROM users ORDER BY created_at DESC').all();
          return json({ users: results });
        }
        return json({ error: 'Not found' }, 404);
      }

      if (url.pathname === '/api/debug' && request.method === 'GET') {
        return json({ hasDB: !!env.DB, binding: env.DB ? 'ok' : 'missing — add D1 binding DB → worldofgeor-db', ts: new Date().toISOString() });
      }

      return json({ error: 'Not found' }, 404);
    }

    // --- Static assets fallback ---
    // Let Cloudflare serve /dist (including /atlas.html, /world-map.jpg etc.)
    return env.ASSETS.fetch(request);
  }
};
