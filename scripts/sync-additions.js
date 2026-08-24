#!/usr/bin/env node
// sync-additions.js — pull Website-additions commits to review at home
// Usage:
//   node sync-additions.js                 # list files
//   node sync-additions.js --pull          # clone/pull repo to ./Website-additions
//   node sync-additions.js --show path     # cat file from GitHub
//
// Ichi workflow: when Mikhail says "do the changes", run:
//   node scripts/sync-additions.js --pull && ls Website-additions/*.md
// then copy approved files into vault or site as requested.

const OWNER = 'actualrat1984';
const REPO = 'Website-additions';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

async function gh(path) {
  let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    try {
      const { execSync } = await import('child_process');
      token = execSync('gh auth token', { encoding: 'utf8' }).trim();
    } catch {}
  }
  const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'sync-additions' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text().then(t=>t.slice(0,400))}`);
  return r.json();
}

async function list() {
  const tree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const files = (tree.tree||[]).filter(n=>n.type==='blob').map(n=>n.path).sort();
  console.log(`\n${OWNER}/${REPO}@${BRANCH} — ${files.length} files:\n`);
  for (const f of files) console.log('  '+f);
  console.log(`\nView: https://github.com/${OWNER}/${REPO}`);
  console.log(`Clone: gh repo clone ${OWNER}/${REPO} or git clone https://github.com/${OWNER}/${REPO}.git`);
}

async function show(target) {
  const j = await gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(target).replace(/%2F/g,'/')}?ref=${BRANCH}`);
  const content = Buffer.from(j.content, 'base64').toString('utf8');
  console.log(`\n# ${j.path} (${j.size} bytes) — ${j.html_url}\n`);
  console.log(content.slice(0,12000));
}

async function pullLocal() {
  const { execSync } = await import('child_process');
  const fs = await import('fs');
  const path = './Website-additions';
  if (fs.existsSync(path)) {
    console.log(`Pulling existing ${path} ...`);
    execSync('git -C Website-additions pull --ff-only', { stdio: 'inherit' });
  } else {
    console.log(`Cloning ${OWNER}/${REPO} ...`);
    execSync(`gh repo clone ${OWNER}/${REPO} Website-additions 2>&1 || git clone https://github.com/${OWNER}/${REPO}.git Website-additions`, { stdio: 'inherit' });
  }
  const files = fs.readdirSync(path).filter(f=> !f.startsWith('.'));
  console.log(`\nLocal ${path}/ — ${files.length} entries:`);
  files.forEach(f=> console.log('  '+f));
}

const args = process.argv.slice(2);
if (args.includes('--pull')) pullLocal().catch(e=>{ console.error(e.message); process.exit(1); });
else if (args[0]==='--show' && args[1]) show(args[1]).catch(e=>{ console.error(e.message); process.exit(1); });
else list().catch(e=>{ console.error(e.message); process.exit(1); });
