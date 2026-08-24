// worldofgeor — Worker + Assets + D1 invite-only auth
// Serves /dist via ASSETS, handles /api/register + /api/login + /api/me + /api/additions
// Invite codes stored in D1.invites — you own the DB.
// Additions: commits to https://github.com/actualrat1984/Website-additions via GITHUB_TOKEN secret

const JWT_EXP_SEC = 60 * 60 * 24 * 30; // 30 days
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
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
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

// --- Additions helpers ---
async function requireUser(request, env) {
  const secret = env.JWT_SECRET || 'dev-secret-change-me-in-dashboard';
  const cookies = parseCookies(request);
  const token = cookies.geor_token || request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return await verifyJwt(token, secret);
}
function sanitizeAdditionsPath(p) {
  if (p == null) return null;
  p = String(p).trim().replace(/^\/+/, '');
  if (!p) return null;
  if (p.includes('..') || p.includes('\\')) return null;
  // allow A-Z a-z 0-9 . _ - / and space (space will be kept but trimmed)
  if (!/^[A-Za-z0-9._\-\/ ]+$/.test(p)) return null;
  if (p.length > 180) return null;
  if (p.startsWith('.') || p.startsWith('/')) return null;
  // disallow leading slash, disallow double slash
  if (p.includes('//')) return null;
  // if no extension, add .md
  if (!p.includes('.')) p += '.md';
  // normalize: trim each segment
  const parts = p.split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  // each segment length check
  for (const seg of parts) {
    if (seg.length > 80) return null;
    if (seg === '.' || seg === '..') return null;
  }
  return parts.join('/');
}
function sanitizeFolderPath(p) {
  if (p == null) return null;
  p = String(p).trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!p) return null;
  if (p.includes('..') || p.includes('\\')) return null;
  if (!/^[A-Za-z0-9._\-\/ ]+$/.test(p)) return null;
  if (p.length > 180) return null;
  if (p.startsWith('.') || p.startsWith('/')) return null;
  if (p.includes('//')) return null;
  const parts = p.split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const seg of parts) {
    if (seg.length > 80) return null;
    if (seg === '.' || seg === '..') return null;
    if (seg.startsWith('.')) return null;
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
  if (!token) throw new Error('GITHUB_TOKEN not configured on worker — set via wrangler secret put GITHUB_TOKEN');
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
      const secret = env.JWT_SECRET || 'dev-secret-change-me-in-dashboard';
      // auto-migrate tables if missing (so /api/register 500 never happens)
      async function ensureTables() {
        if (!env.DB) throw new Error('D1 binding DB missing — add D1 database worldofgeor-db with variable name DB in Worker Settings → Bindings');
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, invite_code TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`).run();
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, used_by TEXT, used_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`).run();
        await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`).run();
        // seed defaults (ignore if exists)
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')))`).run();
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

      // POST /api/request-access  {email, message} — public, creates pending request + emails admin
      if (url.pathname === '/api/request-access' && request.method === 'POST') {
        try {
          await ensureTables();
          const { email, message } = await request.json();
          if (!email || !email.includes('@')) return json({ error: 'Valid email required' }, 400);
          const norm = email.trim().toLowerCase();
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
        } catch (e) { return json({ error: 'Request failed', detail: String(e) }, 500); }
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
        if (url.pathname === '/api/admin/requests' && request.method === 'GET') {
          await ensureTables();
          const { results } = await env.DB.prepare('SELECT id, email, message, status, created_at FROM requests ORDER BY created_at DESC').all();
          return json({ requests: results });
        }
        if (url.pathname === '/api/admin/requests/approve' && request.method === 'POST') {
          const { id, code } = await request.json();
          if (!id) return json({ error: 'id required' }, 400);
          const req = await env.DB.prepare('SELECT email FROM requests WHERE id = ?').bind(id).first();
          if (!req) return json({ error: 'Request not found' }, 404);
          const inviteCode = (code || ('INVITE_' + Math.random().toString(36).slice(2,8).toUpperCase()));
          const clean = inviteCode.trim().toUpperCase().replace(/\s+/g, '_');
          await env.DB.prepare('INSERT OR IGNORE INTO invites (code) VALUES (?)').bind(clean).run();
          await env.DB.prepare('UPDATE requests SET status = ? WHERE id = ?').bind('approved:'+clean, id).run();
          return json({ ok: true, code: clean, email: req.email });
        }
        if (url.pathname === '/api/admin/requests/reject' && request.method === 'POST') {
          const { id } = await request.json();
          await env.DB.prepare('UPDATE requests SET status = "rejected" WHERE id = ?').bind(id).run();
          return json({ ok: true });
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
          return json({ error: 'GitHub list failed', detail: txt.slice(0,500) }, 502);
        } catch (e) {
          return json({ error: 'Additions list failed', detail: String(e).slice(0,600) }, 500);
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
            return json({ error: 'GitHub fetch failed', detail: t.slice(0,600) }, 502);
          }
          const j = await r.json();
          if (j.type !== 'file' || !j.content) return json({ error: 'Not a file' }, 400);
          const content = b64DecodeUtf8(j.content);
          return json({ path: j.path, sha: j.sha, size: j.size, html_url: j.html_url, content });
        } catch (e) {
          return json({ error: 'Additions file fetch failed', detail: String(e).slice(0,600) }, 500);
        }
      }

      // POST /api/additions/save {path, content, oldPath?, message?} -> commit to GitHub
      if (url.pathname === '/api/additions/save' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        let body;
        try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
        const rawPath = (body.path || '').trim();
        const rawOld = (body.oldPath || '').trim();
        const content = body.content;
        const message = (body.message || '').trim().slice(0,200) || `edit ${rawPath} via /app`;
        if (typeof content !== 'string') return json({ error: 'content required (string)' }, 400);
        if (content.length > 900000) return json({ error: 'File too large (900k char limit)' }, 413);
        const path = sanitizeAdditionsPath(rawPath);
        if (!path) return json({ error: 'Invalid path — use A-Z 0-9 . _ - / — e.g. my-idea.md' }, 400);
        const oldPath = rawOld && rawOld !== path ? sanitizeAdditionsPath(rawOld) : null;
        try {
          // check existing sha for path (if file exists, we need sha to update)
          let existingSha = null;
          const check = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (check.ok) {
            const jc = await check.json();
            if (jc.sha) existingSha = jc.sha;
          } else if (check.status !== 404) {
            const t = await check.text();
            // if 403 etc propagate
            if (check.status !== 404) return json({ error: 'GitHub pre-check failed', detail: t.slice(0,600) }, 502);
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
            return json({ error: 'GitHub commit failed', detail: t.slice(0,800), status: putRes.status }, 502);
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
          return json({ ok: true, path, sha: pj.content?.sha || pj.commit?.sha, html_url: pj.content?.html_url, commit: pj.commit?.html_url });
        } catch (e) {
          return json({ error: 'Save failed', detail: String(e).slice(0,800) }, 500);
        }
      }

      // POST /api/additions/delete {path}
      if (url.pathname === '/api/additions/delete' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
        const p = sanitizeAdditionsPath(body.path || '');
        if (!p) return json({ error: 'Invalid path' }, 400);
        try {
          const check = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(p).replace(/%2F/g,'/') }?ref=${ADDITIONS_BRANCH}`, { method: 'GET' }, env);
          if (check.status === 404) return json({ error: 'File not found' }, 404);
          if (!check.ok) { const t = await check.text(); return json({ error: 'GitHub fetch failed', detail: t.slice(0,600) }, 502); }
          const jc = await check.json();
          const del = await ghApi(`/repos/${ADDITIONS_OWNER}/${ADDITIONS_REPO}/contents/${encodeURIComponent(p).replace(/%2F/g,'/')}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `delete ${p} — by ${user.email}`, sha: jc.sha, branch: ADDITIONS_BRANCH })
          }, env);
          if (!del.ok) { const t = await del.text(); return json({ error: 'GitHub delete failed', detail: t.slice(0,800) }, 502); }
          return json({ ok: true, path: p });
        } catch (e) {
          return json({ error: 'Delete failed', detail: String(e).slice(0,800) }, 500);
        }
      }

      // POST /api/additions/mkdir {path} -> create folder via .gitkeep
      if (url.pathname === '/api/additions/mkdir' && request.method === 'POST') {
        const user = await requireUser(request, env);
        if (!user) return json({ error: 'Auth required' }, 401);
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN not configured' }, 503);
        let body; try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
        const raw = (body.path || '').trim();
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
          if (!put.ok) { const t = await put.text(); return json({ error: 'GitHub mkdir failed', detail: t.slice(0,700) }, 502); }
          const pj = await put.json();
          return json({ ok: true, path: folder, sha: pj.content?.sha });
        } catch (e) {
          return json({ error: 'Mkdir failed', detail: String(e).slice(0,700) }, 500);
        }
      }

      if (url.pathname === '/api/debug' && request.method === 'GET') {
        return json({ hasDB: !!env.DB, binding: env.DB ? 'ok' : 'missing — add D1 binding DB → worldofgeor-db', hasGithub: !!env.GITHUB_TOKEN, additionsRepo: `${ADDITIONS_OWNER}/${ADDITIONS_REPO}@${ADDITIONS_BRANCH}`, ts: new Date().toISOString() });
      }

      return json({ error: 'Not found' }, 404);
    }

    // --- Gated archive: /wiki/*, /atlas.html, /dashboard.html, /admin.html share same geor_token
    const needsAuth = url.pathname === '/atlas.html' || url.pathname === '/dashboard.html' || url.pathname === '/admin.html' || url.pathname.startsWith('/wiki') || url.pathname.startsWith('/app');
    if (needsAuth) {
      const secret = env.JWT_SECRET || 'dev-secret-change-me-in-dashboard';
      const cookies = parseCookies(request);
      const token = cookies.geor_token;
      const payload = token ? await verifyJwt(token, secret) : null;
      if (!payload) {
        const accept = request.headers.get('Accept') || '';
        // API-style requests get JSON 401, navigations get redirect to login
        if (accept.includes('application/json') || url.pathname.startsWith('/api/')) {
          return json({ error: 'Auth required — login at /' }, 401);
        }
        const next = encodeURIComponent(url.pathname + url.search);
        return Response.redirect(`${url.origin}/?next=${next}`, 302);
      }
      // admin.html additionally requires ichieisenheart@gmail.com
      if (url.pathname === '/admin.html' || url.pathname.startsWith('/admin')) {
        if (payload.email !== 'ichieisenheart@gmail.com') return Response.redirect(`${url.origin}/dashboard.html`, 302);
      }
    }

    // --- Static assets fallback ---
    // Let Cloudflare serve /dist (including /atlas.html etc. — now gated above)
    return env.ASSETS.fetch(request);
  }
};
