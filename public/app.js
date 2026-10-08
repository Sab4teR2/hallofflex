const CONFIG = { pollMs: 10000, chips: [5, 20, 50, 100, 500] };
const $ = (s) => document.querySelector(s);
const eur = (c) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);
const el = (tag, cls = '', text = '') => { const n = document.createElement(tag); n.className = cls; n.textContent = text; return n; };
const state = { board: [] };
const RING = { 1: 'border-gold-300 shadow-[0_0_48px_rgba(212,175,55,.22)]', 2: 'border-gold-500/80', 3: 'border-gold-700' };

const initials = (n) => n.trim().split(/\s+/).map((w) => [...w][0]).join('').slice(0, 2).toUpperCase();
const safeUrl = (t) => { try { const u = new URL(t); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
};

// Todo el contenido de usuarios se inserta con textContent (sin riesgo de XSS)
function card(f, pos) {
  const top = pos <= 3;
  const li = el('li', `flex items-center gap-4 rounded-2xl border bg-[#070707] px-4 py-4 sm:px-6 ${RING[pos] || 'border-white/10'}`);
  li.append(el('span', `w-10 shrink-0 text-center font-display text-3xl font-extrabold ${top ? 'gold-text' : 'text-ash'}`, pos));
  li.append(el('span', `grid h-12 w-12 shrink-0 place-items-center rounded-full border font-display text-lg ${top ? 'border-gold-500 text-gold-300' : 'border-white/15 text-ash'}`, initials(f.nickname)));
  const mid = el('div', 'min-w-0 flex-1');
  mid.append(el('p', 'truncate font-semibold', f.nickname));
  if (f.message) {
    const url = safeUrl(f.message);
    if (url) {
      const a = el('a', 'line-clamp-2 break-all text-sm text-gold-300 hover:underline', f.message);
      Object.assign(a, { href: url, target: '_blank', rel: 'noopener nofollow ugc' });
      mid.append(a);
    } else mid.append(el('p', 'line-clamp-2 break-words text-sm text-ash', f.message));
  }
  li.append(mid, el('span', `shrink-0 font-display text-lg font-semibold sm:text-2xl ${top ? 'gold-text' : ''}`, eur(f.total_cents)));
  return li;
}

function renderBoard() {
  const ol = $('#hall');
  ol.replaceChildren();
  if (!state.board.length) {
    ol.append(el('li', 'rounded-2xl border border-gold-700/40 px-6 py-10 text-center text-ash', 'El Salón está vacío. El puesto #1 es tuyo.'));
    return;
  }
  state.board.forEach((f, i) => ol.append(card(f, i + 1)));
}

function renderStats(s) {
  $('#charityName').textContent = s.charity_name;
  $('#charityTotal').textContent = eur(s.charity_cents);
  $('#statsLine').textContent = `${s.flexers} flexers · ${eur(s.total_cents)} flexeados`;
}

function renderTicker(items) {
  const t = $('#ticker');
  t.replaceChildren();
  const rows = items.length ? items.map((a) => `${a.nickname} flexeó ${eur(a.amount_cents)} · ${ago(a.created_at)}`) : ['Sé el primero en flexear'];
  [...rows, ...rows].forEach((txt) => t.append(el('span', '', txt)));
}

async function load() {
  try {
    const [board, stats, act] = await Promise.all(['leaderboard', 'stats', 'activity'].map((p) => fetch(`/api/${p}`).then((r) => r.json())));
    state.board = board; renderBoard(); renderStats(stats); renderTicker(act); updateBreakdown();
  } catch (e) { console.error(e); }
}

// ── Modal de pago
const dlg = $('#flexDialog'), form = $('#flexForm');
const parseCents = () => { const c = Math.round(parseFloat(String($('#amount').value).replace(',', '.')) * 100); return Number.isFinite(c) ? c : 0; };

function updateBreakdown() {
  const c = parseCents(), ok = c >= 100 && c <= 1_000_000, charity = Math.floor(c / 2);
  $('#ego').textContent = ok ? eur(c - charity) : '—';
  $('#don').textContent = ok ? eur(charity) : '—';
  const nick = $('#nick').value.trim().toLowerCase();
  const mine = state.board.find((f) => f.nickname.toLowerCase() === nick);
  const total = (mine?.total_cents || 0) + c;
  const pos = state.board.filter((f) => f !== mine && f.total_cents >= total).length + 1;
  $('#hint').textContent = ok ? `Con este flex ocuparías el puesto #${pos}.` : '';
  document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) * 100 === c)));
}

CONFIG.chips.forEach((v) => {
  const b = el('button', 'chip', `${v} €`);
  Object.assign(b, { type: 'button' }); b.dataset.v = v;
  b.onclick = () => { $('#amount').value = v; updateBreakdown(); };
  $('#chips').append(b);
});

$('#openFlex').onclick = () => { updateBreakdown(); dlg.showModal(); $('#nick').focus(); };
$('#closeFlex').onclick = () => dlg.close();
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
['#amount', '#nick'].forEach((s) => $(s).addEventListener('input', updateBreakdown));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#err'), btn = $('#pay');
  err.textContent = ''; btn.disabled = true;
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: $('#nick').value, message: $('#msg').value, amount_cents: parseCents() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo iniciar el pago.');
    location.href = data.url; // Stripe Checkout
  } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
});

// ── Retorno desde Stripe
const flex = new URLSearchParams(location.search).get('flex');
if (flex) {
  const t = $('#toast');
  t.textContent = flex === 'ok' ? 'Pago recibido. Tu flex aparecerá en unos segundos.' : 'Pago cancelado. No se ha cobrado nada.';
  t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 6000);
  history.replaceState({}, '', '/');
  if (flex === 'ok') [3000, 7000].forEach((ms) => setTimeout(load, ms));
}

load();
setInterval(load, CONFIG.pollMs);
