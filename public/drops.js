// Lore Drops — gap-deck engine. Pure helpers are exported so node --test
// can verify paths, shuffle, and queue shape without a browser.
// Browser glue runs only when `document` exists.

export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'untitled';
}

export function sessionKey(dateStr) {
  return `geor-drops-${dateStr}`;
}

// Mirror of the worker's sanitizeAdditionsPath limits — a drop path that
// fails here would be rejected by /api/additions/save, so never emit one.
export function fitSanitize(p) {
  if (typeof p !== 'string' || !p) return false;
  if (p.startsWith('/')) return false;
  if (p.includes('\\') || p.includes('//')) return false;
  if (!/^[A-Za-z0-9._\-/ ]+$/.test(p)) return false;
  if (p.length > 180) return false;
  const parts = p.split('/').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return false;
  for (const seg of parts) {
    if (seg.length > 80) return false;
    if (seg === '.' || seg === '..' || seg.startsWith('.') || seg.endsWith('.')) return false;
  }
  return true;
}

export function nextSessionN(storedDay, storedN, todayStr) {
  if (storedDay === todayStr && Number.isSafeInteger(storedN) && storedN > 0) return storedN + 1;
  return 1;
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function timeStr(d = new Date()) {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

// drops/2026-09-06/s03/143522-some-ruling.md — null when it cannot fit.
export function buildDropPath(dateS, sessionN, timeS, title) {
  const sess = 's' + pad2(sessionN);
  const p = `drops/${dateS}/${sess}/${timeS}-${slugify(title)}.md`;
  return fitSanitize(p) ? p : null;
}

export function shuffled(cards, rand = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Choice: trade places with the coming card. Returns a new order;
// out-of-range swaps return the order untouched.
export function swappedOrder(order, i) {
  if (!Array.isArray(order) || i < 0 || i + 1 >= order.length) return order.slice();
  const a = order.slice();
  [a[i], a[i + 1]] = [a[i + 1], a[i]];
  return a;
}

export function validateQueue(payload) {
  if (!payload || !Array.isArray(payload.cards)) return 'queue.cards missing';
  if (!payload.cards.length) return 'queue is empty';
  for (const c of payload.cards) {
    for (const k of ['id', 'kind', 'title', 'question']) {
      if (typeof c[k] !== 'string' || !c[k]) return `card missing ${k}`;
    }
  }
  return null;
}

export const KIND_LABEL = {
  nation: 'STUB NATION',
  culture: 'CULTURE GAP',
  orphan: 'LOST THREAD',
  map: 'MAP RULING',
  age: 'THIN AGE',
  count: 'SURVEY',
};

export function kindLabel(kind) {
  return KIND_LABEL[kind] || 'LORE GAP';
}

export function kindArt(kind, ext = 'webp') {
  return `/drops-art/drops-${kind}.${ext}`;
}

export function buildDropBody(card, text, meta) {
  const words = text.trim();
  return [
    '---',
    `card: ${card.id}`,
    `kind: ${card.kind}`,
    `date: ${meta.date}`,
    `session: s${pad2(meta.sessionN)}`,
    '---',
    '',
    `# ${card.title}`,
    '',
    words,
    '',
    '---',
    `_Prompt: ${card.question}_`,
    `_Archive note: ${card.context || '—'}_`,
    '',
  ].join('\n');
}

// --- Sound: synthesized, no assets. No-ops outside a browser. ---
let _ac = null;
function ac() {
  if (typeof AudioContext === 'undefined') return null;
  if (!_ac) _ac = new AudioContext();
  if (_ac.state === 'suspended') void _ac.resume();
  return _ac;
}
function tone(freq, delay, dur, type, vol) {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}
export function playFiled() {
  tone(659.25, 0, 0.22, 'sine', 0.16); // E5
  tone(880.0, 0.12, 0.34, 'sine', 0.16); // A5
}
export function playRejected() {
  tone(138.0, 0, 0.28, 'sawtooth', 0.12); // low buzz
}

// --- Browser glue ---
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const state = {
    deck: [], index: 0, filed: 0, skipped: 0,
    sessionN: 1, today: dayStr(), queueCount: 0,
    verdicts: {}, answers: {},
  };

  function artImg(kind) {
    const img = document.createElement('img');
    img.src = kindArt(kind);
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.onerror = null; img.src = kindArt(kind, 'jpg'); };
    return img;
  }

  function setStatus(msg, ok) {
    const el = $('dropStatus');
    el.textContent = msg;
    el.className = 'text-xs mt-3 text-center h-4 ' + (ok === true ? 'text-emerald-300' : ok === false ? 'text-red-300' : 'text-cream/40');
  }

  function renderStats() {
    $('dropStats').textContent =
      `SESSION s${pad2(state.sessionN)} · CARD ${Math.min(state.index + 1, state.queueCount)} / ${state.queueCount} · FILED ${state.filed} · SKIPPED ${state.skipped}`;
  }

  function cardEl(card, pos) {
    const wrap = document.createElement('article');
    wrap.className = 'drop-card drop-pos-' + pos;
    wrap.dataset.id = card.id;
    const banner = document.createElement('div');
    banner.className = 'drop-banner';
    banner.appendChild(artImg(card.kind));
    const body = document.createElement('div');
    body.className = 'p-4';
    const eyebrow = document.createElement('p');
    eyebrow.className = 'text-gold text-[10px] tracking-[.3em] font-semibold';
    eyebrow.textContent = kindLabel(card.kind);
    const title = document.createElement('h2');
    title.className = 'font-display text-xl font-bold mt-2';
    title.textContent = card.title;
    const q = document.createElement('p');
    q.className = 'font-serif italic text-base text-cream/80 mt-2';
    q.textContent = card.question;
    body.append(eyebrow, title, q);
    if (card.context) {
      const ctx = document.createElement('p');
      ctx.className = 'text-xs text-cream/40 mt-3';
      ctx.textContent = card.context;
      body.appendChild(ctx);
    }
    if (pos === 0) {
      const known = card.existing || card.context;
      if (known) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mt-3 text-[11px] tracking-[.2em] text-gold border border-gold/25 rounded-full px-4 py-1.5';
        btn.textContent = 'CONTEXT — WHAT IS WRITTEN';
        const pre = document.createElement('pre');
        pre.className = 'hidden mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-cream/70 bg-ink/60 border border-gold/15 rounded-xl p-3 font-sans';
        pre.textContent = known;
        btn.addEventListener('click', () => {
          const hidden = pre.classList.toggle('hidden');
          btn.textContent = hidden ? 'CONTEXT — WHAT IS WRITTEN' : 'HIDE THE ARCHIVE';
        });
        body.append(btn, pre);
      }
      const ta = document.createElement('textarea');
      ta.id = 'dropAnswer';
      ta.rows = 3;
      ta.placeholder = card.placeholder || 'Rule it here…';
      ta.className = 'mt-4 w-full rounded-xl bg-ink/60 border border-gold/20 focus:border-gold/60 outline-none p-3 text-sm text-cream placeholder:text-cream/30';
      ta.setAttribute('aria-label', 'Your ruling for ' + card.title);
      body.appendChild(ta);
    }
    wrap.append(banner, body);
    return wrap;
  }

  function render() {
    const stack = $('dropStack');
    stack.innerHTML = '';
    for (let k = 2; k >= 0; k--) {
      const card = state.deck[state.index + k];
      if (card) stack.appendChild(cardEl(card, k));
    }
    const current = stack.querySelector('.drop-pos-0');
    if (current) attachDrag(current);
    renderStats();
    renderSides();
    const ta = $('dropAnswer');
    if (ta) ta.focus({ preventScroll: true });
  }

  function outboxPush(item) {
    try {
      const box = JSON.parse(localStorage.getItem('geor-drops-outbox') || '[]');
      box.push(item);
      localStorage.setItem('geor-drops-outbox', JSON.stringify(box));
    } catch { /* storage full or blocked — ruling stays on screen */ }
  }

  async function flushOutbox() {
    let box = [];
    try { box = JSON.parse(localStorage.getItem('geor-drops-outbox') || '[]'); } catch { return 0; }
    if (!box.length) return 0;
    const rest = [];
    let sent = 0;
    for (const item of box) {
      try {
        const r = await fetch('/api/additions/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: item.path, content: item.content, message: item.message }),
        });
        if (r.ok) sent++;
        else rest.push(item);
      } catch { rest.push(item); }
    }
    try { localStorage.setItem('geor-drops-outbox', JSON.stringify(rest)); } catch { /* ignore */ }
    return sent;
  }

  async function resolveCurrent(filed) {
    const card = state.deck[state.index];
    if (!card) return;
    const el = document.querySelector('.drop-pos-0');
    const ta = $('dropAnswer');
    const text = ta ? ta.value : '';
    if (filed && !text.trim()) {
      setStatus('Empty card — write the ruling first, or skip it down.', false);
      playRejected();
      if (el) { el.classList.add('drop-shake'); setTimeout(() => el.classList.remove('drop-shake'), 400); }
      return;
    }
    if (el) el.classList.add(filed ? 'drop-filed' : 'drop-rejected');
    if (filed) {
      playFiled();
      const path = buildDropPath(state.today, state.sessionN, timeStr(), card.title);
      const content = buildDropBody(card, text, { date: state.today, sessionN: state.sessionN });
      if (!path) {
        setStatus('That title cannot become a file path — shorten it.', false);
        if (el) el.classList.remove('drop-filed');
        return;
      }
      try {
        const r = await fetch('/api/additions/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content, message: `lore drop: ${card.title} (session s${pad2(state.sessionN)})` }),
        });
        if (r.ok) {
          state.filed++;
          setStatus(`Filed to ${path}`, true);
        } else {
          outboxPush({ path, content, message: `lore drop: ${card.title}` });
          state.filed++;
          setStatus('Archive busy — kept on this device, will retry.', true);
        }
      } catch {
        outboxPush({ path, content, message: `lore drop: ${card.title}` });
        state.filed++;
        setStatus('Offline — kept on this device, will retry.', true);
      }
    } else {
      playRejected();
      state.skipped++;
      setStatus(`Skipped — the gap waits for another night.`, null);
    }
    if (filed) { state.verdicts[card.id] = 'filed'; state.answers[card.id] = text.trim(); }
    else { state.verdicts[card.id] = 'skipped'; }
    state.index++;
    setTimeout(() => {
      if (state.index >= state.deck.length) {
        $('dropStack').innerHTML = '<p class="text-center font-serif italic text-xl text-cream/60 py-16">The deck is empty. The archive thanks its keeper.</p>';
        renderStats();
        renderSides();
        return;
      }
      render();
    }, 420);
  }

  function attachDrag(el) {
    let startY = 0, dy = 0, dragging = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('textarea,button,a')) return;
      dragging = true;
      startY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      el.style.transform = `translateY(${dy}px) rotate(${dy / 40}deg)`;
      el.style.opacity = String(1 - Math.min(dy / 500, 0.5));
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      if (dy > 110) {
        const ta = $('dropAnswer');
        resolveCurrent(!!(ta && ta.value.trim()));
      } else {
        el.style.transform = '';
        el.style.opacity = '';
      }
      dy = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  function verdictBadge(v) {
    if (v === 'filed') return ['✓ FILED', 'text-emerald-300 border-emerald-300/40'];
    if (v === 'skipped') return ['✗ SKIPPED', 'text-red-300 border-red-300/40'];
    return ['• UNRULED', 'text-cream/40 border-cream/20'];
  }

  function miniCard(card) {
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'drop-side w-full text-left';
    const thumb = artImg(card.kind);
    thumb.className = 'drop-side-thumb';
    const k = document.createElement('p');
    k.className = 'text-gold text-[9px] tracking-[.25em] font-semibold mt-2';
    k.textContent = kindLabel(card.kind);
    const t = document.createElement('p');
    t.className = 'font-display text-sm font-bold mt-1 text-cream';
    t.textContent = card.title;
    box.append(thumb, k, t);
    return box;
  }

  function doSwap() {
    const coming = state.deck[state.index + 1];
    if (!coming) { setStatus('Nothing waits behind this card.', null); return; }
    const waiting = state.deck[state.index];
    state.deck = swappedOrder(state.deck, state.index);
    render();
    setStatus(`Traded — “${waiting ? waiting.title : 'this one'}” waits one turn.`, null);
  }

  function renderSides() {
    const prev = $('prevPanel');
    const next = $('nextPanel');
    if (!prev || !next) return;
    prev.innerHTML = '';
    next.innerHTML = '';
    const head = (txt) => {
      const p = document.createElement('p');
      p.className = 'text-[10px] tracking-[.3em] text-cream/40 font-semibold mb-2';
      p.textContent = txt;
      return p;
    };
    // --- left: where you have been ---
    prev.appendChild(head('BEHIND YOU'));
    const last = state.deck[state.index - 1];
    if (!last) {
      const p = document.createElement('p');
      p.className = 'font-serif italic text-cream/40';
      p.textContent = 'The deck begins here.';
      prev.appendChild(p);
    } else {
      const box = miniCard(last);
      const [txt, cls] = verdictBadge(state.verdicts[last.id]);
      const badge = document.createElement('span');
      badge.className = 'drop-verdict border ' + cls;
      badge.textContent = txt;
      box.appendChild(badge);
      const detail = document.createElement('div');
      detail.className = 'hidden mt-2';
      const q = document.createElement('p');
      q.className = 'text-xs text-cream/60 italic';
      q.textContent = last.question;
      detail.appendChild(q);
      const ans = state.answers[last.id];
      const a = document.createElement('p');
      a.className = 'drop-answer';
      a.textContent = ans ? '“' + ans + '”' : 'Skipped without a ruling.';
      detail.appendChild(a);
      box.appendChild(detail);
      box.addEventListener('click', () => detail.classList.toggle('hidden'));
      prev.appendChild(box);
    }
    // --- right: what is coming ---
    next.appendChild(head('AHEAD OF YOU'));
    const coming = state.deck[state.index + 1];
    if (!coming) {
      const p = document.createElement('p');
      p.className = 'font-serif italic text-cream/40';
      p.textContent = 'This is the last card.';
      next.appendChild(p);
    } else {
      const box = miniCard(coming);
      const seal = document.createElement('p');
      seal.className = 'text-[11px] text-cream/40 mt-2';
      seal.textContent = 'Question sealed until dealt — tap to trade places.';
      box.appendChild(seal);
      box.addEventListener('click', doSwap);
      next.appendChild(box);
    }
    const sp = $('stripPrev');
    const sn = $('stripNext');
    if (sp && sn) {
      sp.textContent = last ? `← ${last.title}` : '← start';
      sn.textContent = coming ? `${coming.title} →` : 'end →';
      sp.onclick = () => { const b = prev.querySelector('.drop-side'); if (b) b.click(); };
      sn.onclick = doSwap;
    }
  }

  async function init() {
    try {
      const storedDay = localStorage.getItem(sessionKey('day'));
      const storedN = parseInt(localStorage.getItem(sessionKey('n')) || '0', 10);
      state.sessionN = nextSessionN(storedDay, storedN, state.today);
      localStorage.setItem(sessionKey('day'), state.today);
      localStorage.setItem(sessionKey('n'), String(state.sessionN));
    } catch { /* private mode — session s01 */ }
    setStatus('Dealing the gaps…', null);
    try {
      const r = await fetch('/drops-queue.json', { cache: 'no-store' });
      const payload = await r.json();
      const err = validateQueue(payload);
      if (err) throw new Error(err);
      state.queueCount = payload.cards.length;
      state.deck = shuffled(payload.cards);
      const sent = await flushOutbox();
      render();
      setStatus(sent ? `Session s${pad2(state.sessionN)} — ${sent} kept ruling(s) sent.` : `Session s${pad2(state.sessionN)} — swipe down to rule, down empty to skip.`, null);
    } catch (e) {
      setStatus('The deck could not be dealt: ' + e.message, false);
    }
    $('btnFile').addEventListener('click', () => resolveCurrent(true));
    $('btnSkip').addEventListener('click', () => resolveCurrent(false));
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') resolveCurrent(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
