// ─── Court geometry (viewBox 305 × 670) ────────────────────────────────────
const VW = 305, VH = 670;
const NET_Y    = 335;
const R_SHORT  = 236;   // receiver short service line
const R_LONG   = 38;    // receiver doubles long service line
const S_SHORT  = 434;   // server short service line
const S_LONG   = 632;   // server doubles long service line
const CX       = 152.5; // center line x
const COL      = CX / 3;           // service box column width ~50.83
const SVC_ROW  = (R_SHORT - R_LONG) / 2; // service box row height = 99

// ─── Zone definitions ───────────────────────────────────────────────────────
// Serve zones: col 0=wide-side, 1=middle, 2=T-side  |  row 0=long, 1=short
const SERVE_ZONES = [
  { id: 'T',        label: 'T',       col: 2, row: 1 },
  { id: 'Middle',   label: 'Middle',  col: 1, row: 1 },
  { id: 'Wide',     label: 'Wide',    col: 0, row: 1 },
  { id: 'TLong',    label: 'T Long',  col: 2, row: 0 },
  { id: 'Drive',    label: 'Drive',   col: 1, row: 0 },
  { id: 'WideLong', label: 'W.Long',  col: 0, row: 0 },
];

// Receive zones: side 0=straight, 1=middle, 2=cross  |  depth 0=net, 1=midcourt, 2=push
// Midcourt zones use absolute=true → side 0=left/straight, 1=center, 2=right/cross (no flip by serveBox)
const RECEIVE_ZONES = [
  { id: 'StraightNet',  label: 'Str\nNet',    side: 0, depth: 0 },
  { id: 'MiddleNet',    label: 'Mid\nNet',    side: 1, depth: 0 },
  { id: 'CrossNet',     label: 'Cross\nNet',  side: 2, depth: 0 },
  { id: 'LeftMid',      label: 'L.\nMid',     side: 0, depth: 1, absolute: true },
  { id: 'CenterMid',    label: 'Ctr\nMid',    side: 1, depth: 1, absolute: true },
  { id: 'RightMid',     label: 'R.\nMid',     side: 2, depth: 1, absolute: true },
  { id: 'StraightPush', label: 'Str\nPush',   side: 0, depth: 2 },
  { id: 'MiddlePush',   label: 'Mid\nPush',   side: 1, depth: 2 },
  { id: 'CrossPush',    label: 'Cross\nPush', side: 2, depth: 2 },
];

// Serve zone rect — if serveBox 'right' → receiver in top-LEFT (bird's eye)(since serve is diagonal)
// T-side (col 2) is always closest to center line CX
function getServeRect(zone, serveBox) {
  const y = R_LONG + zone.row * SVC_ROW;
  const x = serveBox === 'right'
    ? zone.col * COL
    : CX + (2 - zone.col) * COL; // Flips zones.
  return { x, y, w: COL, h: SVC_ROW };
}

// Receive zone rect — placed in court's bottom half, split into 3 equal depth bands
// Midcourt zones are absolute (left/center/right); net & push flip with serveBox
function getReceiveRect(zone, serveBox) {
  const RCOL = VW / 3;
  const BAND = (S_LONG - NET_Y) / 3; // 99 units each band
  let col;
  // if middle row.
  if (zone.absolute) {
    col = zone.side; // 0=left, 1=center, 2=right — fixed
  } else {
  // if front or back row
    col = zone.side === 1 ? 1
      : zone.side === 0 ? (serveBox === 'right' ? 0 : 2)
      : (serveBox === 'right' ? 2 : 0);
  }
  return { x: col * RCOL, y: NET_Y + zone.depth * BAND, w: RCOL, h: BAND };
}

// ─── Storage layer (localStorage cache + per-op server sync) ────────────────
//
// localStorage shape:
//   bt_sessions          → { [id]: { id, name, createdAt, names, rallies } }
//   bt_current_session_id → string | null
//   bt_pending_ops       → array of { type, sessionId, ... }   (offline retry queue)
//
// Rally-level ops (append/patch_rally/undo) are idempotent on the server, so
// retrying them is safe. Session-level ops (create/delete/switch) require the
// server to be online — we don't queue those.

const DEFAULT_NAMES = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
function lsSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function getSessions()          { return lsGet('bt_sessions', {}); }
function saveSessions(sessions) { lsSet('bt_sessions', sessions); }
function getCurrentSessionId()  { return lsGet('bt_current_session_id', null); }
function setCurrentSessionIdLocal(id) { lsSet('bt_current_session_id', id); }
function getPendingOps()        { return lsGet('bt_pending_ops', []); }
function setPendingOps(ops)     { lsSet('bt_pending_ops', ops); }

function getActiveSession() {
  const id = getCurrentSessionId();
  if (!id) return null;
  return getSessions()[id] || null;
}

// Back-compat shims used by data.js and the record-page renderLog.
function getNames()   { const s = getActiveSession(); return s ? { ...DEFAULT_NAMES, ...s.names } : { ...DEFAULT_NAMES }; }
function getRallies() { const s = getActiveSession(); return s ? s.rallies.slice() : []; }

// ─── Sync dot ───────────────────────────────────────────────────────────────
function setSyncDot(state) {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  const map = { synced:'#4caf50', syncing:'#f7954f', offline:'#e05555' };
  dot.style.color = map[state] || map.offline;
  dot.title = state;
}

// ─── Low-level fetch helper ─────────────────────────────────────────────────
async function apiFetch(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

// ─── API wrappers ───────────────────────────────────────────────────────────
const api = {
  listSessions:   ()                          => apiFetch('GET',    '/api/sessions'),
  getSession:     (id)                        => apiFetch('GET',    `/api/sessions/${id}`),
  createSession:  (body)                      => apiFetch('POST',   '/api/sessions', body),
  patchSession:   (id, body)                  => apiFetch('PATCH',  `/api/sessions/${id}`, body),
  deleteSession:  (id)                        => apiFetch('DELETE', `/api/sessions/${id}`),
  setCurrent:     (id)                        => apiFetch('PUT',    '/api/current-session', { id }),
  appendRally:    (id, rally)                 => apiFetch('POST',   `/api/sessions/${id}/rallies`, rally),
  patchRally:     (sid, rid, partial)         => apiFetch('PATCH',  `/api/sessions/${sid}/rallies/${rid}`, partial),
  deleteRally:    (sid, rid)                  => apiFetch('DELETE', `/api/sessions/${sid}/rallies/${rid}`),
};

// ─── Op queue (offline retry for rally-level ops) ───────────────────────────
async function applyOp(op) {
  switch (op.type) {
    case 'append_rally':  return api.appendRally(op.sessionId, op.rally);
    case 'patch_rally':   return api.patchRally(op.sessionId, op.rallyId, op.partial);
    case 'delete_rally':  return api.deleteRally(op.sessionId, op.rallyId);
    case 'patch_session': return api.patchSession(op.sessionId, op.partial);
    default: throw new Error(`unknown op ${op.type}`);
  }
}

async function flushOps() {
  let queue = getPendingOps();
  while (queue.length) {
    try { await applyOp(queue[0]); }
    catch { return false; }
    queue = queue.slice(1);
    setPendingOps(queue);
  }
  return true;
}

async function syncOp(op) {
  setSyncDot('syncing');
  const flushed = await flushOps();
  if (!flushed) {
    setPendingOps([...getPendingOps(), op]);
    setSyncDot('offline');
    return;
  }
  try {
    await applyOp(op);
    setSyncDot('synced');
  } catch {
    setPendingOps([...getPendingOps(), op]);
    setSyncDot('offline');
  }
}

// ─── Local + remote mutators ────────────────────────────────────────────────
function mutateActiveSession(fn) {
  const id = getCurrentSessionId();
  if (!id) return null;
  const sessions = getSessions();
  if (!sessions[id]) return null;
  const result = fn(sessions[id]);
  saveSessions(sessions);
  return result;
}

function appendRallyLocal(rally) {
  const sid = getCurrentSessionId();
  mutateActiveSession(s => s.rallies.push(rally));
  syncOp({ type: 'append_rally', sessionId: sid, rally });
}

function patchRallyLocal(rallyId, partial) {
  const sid = getCurrentSessionId();
  mutateActiveSession(s => {
    const t = s.rallies.find(r => r.id === rallyId);
    if (t) Object.assign(t, partial);
  });
  syncOp({ type: 'patch_rally', sessionId: sid, rallyId, partial });
}

function undoLastLocal() {
  const sid = getCurrentSessionId();
  let removed = null;
  mutateActiveSession(s => { removed = s.rallies.pop() || null; });
  if (removed) syncOp({ type: 'delete_rally', sessionId: sid, rallyId: removed.id });
  return removed;
}

function saveNames(names) {
  const sid = getCurrentSessionId();
  mutateActiveSession(s => { s.names = { ...s.names, ...names }; });
  syncOp({ type: 'patch_session', sessionId: sid, partial: { names } });
}

// ─── Bootstrap: pull from server, seed if empty ─────────────────────────────
async function bootstrapState() {
  setSyncDot('syncing');
  try {
    const flushed = await flushOps();
    const list = await api.listSessions();
    let currentId = list.currentSessionId;

    // No sessions at all → create a default one and adopt it.
    if (!currentId && list.sessions.length === 0) {
      const seed = await api.createSession({ name: 'Session 1', names: DEFAULT_NAMES });
      currentId = seed.id;
      list.sessions = [{ id: seed.id, name: seed.name, createdAt: seed.createdAt }];
    } else if (!currentId) {
      // Server has sessions but none marked current — pick the newest.
      currentId = list.sessions[0].id;
      await api.setCurrent(currentId);
    }

    // Pull the current session in full and cache it.
    const full = await api.getSession(currentId);
    const sessions = {};
    for (const meta of list.sessions) {
      sessions[meta.id] = meta.id === currentId
        ? full
        : { ...meta, names: { ...DEFAULT_NAMES }, rallies: [] }; // lazy: rallies fetched on switch
    }
    saveSessions(sessions);
    setCurrentSessionIdLocal(currentId);
    setSyncDot(flushed ? 'synced' : 'offline');
    return true;
  } catch {
    setSyncDot('offline');
    return false;
  }
}

// data.js still calls this; preserve the name.
async function pullFromServer() { return bootstrapState(); }

// ─── Session lifecycle (online-only) ────────────────────────────────────────
async function uiCreateSession() {
  const name = prompt('Session name?');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    setSyncDot('syncing');
    const session = await api.createSession({ name: trimmed, names: DEFAULT_NAMES });
    await api.setCurrent(session.id);
    const sessions = getSessions();
    sessions[session.id] = session;
    saveSessions(sessions);
    setCurrentSessionIdLocal(session.id);
    location.reload();
  } catch {
    setSyncDot('offline');
    showToast('Offline — cannot create session', true);
  }
}

async function uiRenameSession() {
  const id = getCurrentSessionId();
  const cur = getActiveSession();
  if (!cur) return;
  const name = prompt('Rename session:', cur.name);
  if (!name || name.trim() === cur.name) return;
  try {
    setSyncDot('syncing');
    await api.patchSession(id, { name: name.trim() });
    mutateActiveSession(s => { s.name = name.trim(); });
    setSyncDot('synced');
    renderSessionSwitcher();
  } catch {
    setSyncDot('offline');
    showToast('Offline — cannot rename', true);
  }
}

async function uiDeleteSession() {
  const id = getCurrentSessionId();
  const cur = getActiveSession();
  if (!cur) return;
  const sessions = getSessions();
  if (Object.keys(sessions).length <= 1) {
    showToast('Cannot delete the only session', true);
    return;
  }
  if (!confirm(`Delete session "${cur.name}"? This removes all its rallies.`)) return;
  try {
    setSyncDot('syncing');
    const res = await api.deleteSession(id);
    delete sessions[id];
    saveSessions(sessions);
    setCurrentSessionIdLocal(res.currentSessionId);
    location.reload();
  } catch {
    setSyncDot('offline');
    showToast('Offline — cannot delete', true);
  }
}

async function uiSwitchSession(targetId) {
  if (targetId === getCurrentSessionId()) return;
  try {
    setSyncDot('syncing');
    await api.setCurrent(targetId);
    const full = await api.getSession(targetId);
    const sessions = getSessions();
    sessions[targetId] = full;
    saveSessions(sessions);
    setCurrentSessionIdLocal(targetId);
    location.reload();
  } catch {
    setSyncDot('offline');
    showToast('Offline — cannot switch sessions', true);
  }
}

// ─── Session switcher UI (navbar dropdown) ──────────────────────────────────
function renderSessionSwitcher() {
  const root = document.getElementById('session-switcher');
  if (!root) return;
  const cur = getActiveSession();
  const sessions = Object.values(getSessions()).sort((a, b) => b.createdAt - a.createdAt);

  const nameBtn = document.getElementById('session-current-name');
  if (nameBtn) nameBtn.textContent = cur ? cur.name : '—';

  const list = document.getElementById('session-list');
  if (list) {
    list.innerHTML = sessions.map(s => {
      const d = new Date(s.createdAt);
      const label = `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const active = s.id === (cur && cur.id) ? ' active' : '';
      return `<li class="session-item${active}" data-id="${s.id}">
                <span class="session-name">${escapeHtml(s.name)}</span>
                <span class="session-date">${label}</span>
              </li>`;
    }).join('');
    list.querySelectorAll('.session-item').forEach(li => {
      li.addEventListener('click', () => uiSwitchSession(li.dataset.id));
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function initSessionSwitcher() {
  const root = document.getElementById('session-switcher');
  if (!root) return;
  const currentBtn = document.getElementById('session-current-btn');
  const menu = document.getElementById('session-menu');
  currentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) menu.hidden = true;
  });
  document.getElementById('session-new-btn').addEventListener('click', uiCreateSession);
  document.getElementById('session-rename-btn').addEventListener('click', uiRenameSession);
  document.getElementById('session-delete-btn').addEventListener('click', uiDeleteSession);
  renderSessionSwitcher();
}

// ─── SVG helpers ────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
function svgText(txt, attrs, parent) {
  const e = svgEl('text', attrs, parent);
  e.textContent = txt;
  return e;
}

// ─── Build court SVG ────────────────────────────────────────────────────────
function buildCourt(container, { serveBox, serverName, receiverName, onServe, onReceive, pendingServe }) {
  const svg = svgEl('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'court-svg' });

  // Background
  svgEl('rect', { x:0, y:0, width:VW, height:VH, fill:'#1a3a1e', rx:3 }, svg);

  // Service box highlights
  if (serveBox) {
    const recvX = serveBox === 'right' ? 0 : CX;
    const servX = serveBox === 'right' ? CX : 0;
    svgEl('rect', { x:recvX, y:R_LONG, width:CX, height:R_SHORT-R_LONG, fill:'rgba(79,142,247,0.08)' }, svg);
    svgEl('rect', { x:servX, y:S_SHORT, width:CX, height:S_LONG-S_SHORT, fill:'rgba(255,220,80,0.07)' }, svg);
  }

  // Court lines
  const L = { stroke:'#ffffff', 'stroke-width':'1.5', 'stroke-linecap':'round' };
  svgEl('rect', { x:1, y:1, width:VW-2, height:VH-2, fill:'none', stroke:'#fff', 'stroke-width':'2' }, svg);
  svgEl('line', { x1:0, y1:NET_Y, x2:VW, y2:NET_Y, stroke:'#fff', 'stroke-width':'3.5' }, svg);
  svgEl('line', { x1:0, y1:R_SHORT, x2:VW, y2:R_SHORT, ...L }, svg);
  svgEl('line', { x1:0, y1:R_LONG,  x2:VW, y2:R_LONG,  ...L }, svg);
  svgEl('line', { x1:0, y1:S_SHORT, x2:VW, y2:S_SHORT, ...L }, svg);
  svgEl('line', { x1:0, y1:S_LONG,  x2:VW, y2:S_LONG,  ...L }, svg);
  svgEl('line', { x1:CX, y1:R_LONG,  x2:CX, y2:R_SHORT, ...L }, svg);
  svgEl('line', { x1:CX, y1:S_SHORT, x2:CX, y2:S_LONG,  ...L }, svg);

  // NET label
  svgText('NET', { x:VW/2, y:NET_Y-7, fill:'rgba(255,255,255,0.5)', 'font-size':'9', 'font-family':'sans-serif', 'text-anchor':'middle', 'font-weight':'bold', 'letter-spacing':'2' }, svg);

  if (!serveBox) {
    svgEl('rect', { x:0, y:0, width:VW, height:VH, fill:'rgba(0,0,0,0.55)' }, svg);
    svgText('Select server & serve box', { x:VW/2, y:VH/2-8, fill:'rgba(255,255,255,0.8)', 'font-size':'13', 'font-family':'sans-serif', 'text-anchor':'middle' }, svg);
    svgText('to activate court', { x:VW/2, y:VH/2+10, fill:'rgba(255,255,255,0.5)', 'font-size':'10', 'font-family':'sans-serif', 'text-anchor':'middle' }, svg);
    container.innerHTML = '';
    container.appendChild(svg);
    return;
  }

  // Player labels on court
  if (serverName) {
    const sx = serveBox === 'right' ? CX + CX/2 : CX/2;
    svgText(serverName, { x:sx, y:S_LONG+18, fill:'rgba(255,220,80,0.9)', 'font-size':'10', 'font-family':'sans-serif', 'font-weight':'bold', 'text-anchor':'middle' }, svg);
    svgText('SERVER', { x:sx, y:S_LONG+28, fill:'rgba(255,220,80,0.5)', 'font-size':'7', 'font-family':'sans-serif', 'text-anchor':'middle', 'letter-spacing':'1' }, svg);
  }
  if (receiverName) {
    const rx = serveBox === 'right' ? CX/2 : CX + CX/2;
    svgText(receiverName, { x:rx, y:R_LONG-18, fill:'rgba(79,142,247,0.9)', 'font-size':'10', 'font-family':'sans-serif', 'font-weight':'bold', 'text-anchor':'middle' }, svg);
    svgText('RECEIVER', { x:rx, y:R_LONG-8, fill:'rgba(79,142,247,0.5)', 'font-size':'7', 'font-family':'sans-serif', 'text-anchor':'middle', 'letter-spacing':'1' }, svg);
  }

  // ── Serve zones ──
  svgText('↓ SERVE TARGET ↓', {
    x: serveBox === 'right' ? CX/2 : CX + CX/2,
    y: R_SHORT + 11,
    fill: 'rgba(247,149,79,0.6)', 'font-size':'7.5', 'font-family':'sans-serif', 'text-anchor':'middle', 'letter-spacing':'1'
  }, svg);

  SERVE_ZONES.forEach(zone => {
    const r = getServeRect(zone, serveBox);
    const g = svgEl('g', { class:'zone serve-zone', style:'cursor:pointer' }, svg);
    const rect = svgEl('rect', {
      x: r.x+1, y: r.y+1, width: r.w-2, height: r.h-2,
      fill: pendingServe ? 'rgba(247,149,79,0.07)' : 'rgba(247,149,79,0.15)',
      stroke: 'rgba(247,149,79,0.5)', 'stroke-width':'1', rx:'2'
    }, g);
    svgText(zone.label, {
      x: r.x + r.w/2, y: r.y + r.h/2 + 4,
      fill: 'rgba(255,200,140,0.95)', 'font-size':'9', 'font-family':'sans-serif',
      'font-weight':'bold', 'text-anchor':'middle', 'pointer-events':'none'
    }, g);
    g.addEventListener('mouseenter', () => { rect.setAttribute('fill','rgba(247,149,79,0.45)'); });
    g.addEventListener('mouseleave', () => { rect.setAttribute('fill', pendingServe ? 'rgba(247,149,79,0.07)' : 'rgba(247,149,79,0.15)'); });
    g.addEventListener('click', () => onServe && onServe(zone.id));
  });

  // ── Receive zones ──
  const rLabel = serveBox === 'right' ? CX / 2 : CX + CX / 2;
  svgText('↑ RETURN TARGET ↑', {
    x: rLabel, y: NET_Y + 11,
    fill: 'rgba(79,142,247,0.6)', 'font-size':'7.5', 'font-family':'sans-serif', 'text-anchor':'middle', 'letter-spacing':'1'
  }, svg);

  RECEIVE_ZONES.forEach(zone => {
    const r = getReceiveRect(zone, serveBox);
    const g = svgEl('g', { class:'zone receive-zone', style:'cursor:pointer' }, svg);
    const rect = svgEl('rect', {
      x: r.x+1, y: r.y+1, width: r.w-2, height: r.h-2,
      fill: 'rgba(79,142,247,0.12)',
      stroke: 'rgba(79,142,247,0.4)', 'stroke-width':'1', rx:'2'
    }, g);

    const lines = zone.label.split('\n');
    const cy = r.y + r.h / 2;
    lines.forEach((line, i) => {
      svgText(line, {
        x: r.x + r.w/2, y: cy + (i - (lines.length-1)/2) * 11,
        fill: 'rgba(140,190,255,0.95)', 'font-size':'8.5', 'font-family':'sans-serif',
        'font-weight':'bold', 'text-anchor':'middle', 'pointer-events':'none'
      }, g);
    });

    g.addEventListener('mouseenter', () => { rect.setAttribute('fill','rgba(79,142,247,0.4)'); });
    g.addEventListener('mouseleave', () => { rect.setAttribute('fill','rgba(79,142,247,0.12)'); });
    g.addEventListener('click', () => onReceive && onReceive(zone.id));
  });

  container.innerHTML = '';
  container.appendChild(svg);
}

// ─── Page bootstrapping ─────────────────────────────────────────────────────
bootstrapState().then(() => {
  initSessionSwitcher();
  if (document.getElementById('court-wrap')) initRecordPage();
});

// ─── Record page ────────────────────────────────────────────────────────────
function initRecordPage() {
  const names = getNames();
  const ctx = { server: null, serveBox: null, receiver: null };

  // Player name inputs
  ['p1','p2','p3','p4'].forEach(p => {
    const el = document.getElementById(`${p}-name`);
    if (el) el.value = names[p];
  });

  document.getElementById('save-names-btn').addEventListener('click', () => {
    const next = {};
    ['p1','p2','p3','p4'].forEach(p => {
      const v = document.getElementById(`${p}-name`).value.trim();
      next[p] = v || DEFAULT_NAMES[p];
    });
    saveNames(next);
    Object.assign(names, next);
    refreshLabels();
    refreshCourt();
    showToast('Names saved');
  });

  function refreshLabels() {
    const fresh = getNames();
    Object.assign(names, fresh);
    ['p1','p2','p3','p4'].forEach(p => {
      document.querySelectorAll(`[data-player="${p}"]`).forEach(btn => {
        btn.textContent = fresh[p];
      });
    });
  }

  function bindGroup(groupId, key) {
    const grp = document.getElementById(groupId);
    grp.querySelectorAll('.ctx-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        grp.querySelectorAll('.ctx-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ctx[key] = btn.dataset.value;
        refreshCourt();
      });
    });
  }

  bindGroup('server-select', 'server');
  bindGroup('serve-box-select', 'serveBox');
  bindGroup('receiver-select', 'receiver');

  refreshLabels();
  refreshCourt();
  renderLog();

  function refreshCourt() {
    buildCourt(document.getElementById('court-wrap'), {
      serveBox: ctx.serveBox,
      serverName: ctx.server ? names[ctx.server] : null,
      receiverName: ctx.receiver ? names[ctx.receiver] : null,
      pendingServe: false,
      onServe(shotId) {
        if (!ctx.server || !ctx.serveBox) return;
        appendRallyLocal({
          id: Date.now(),
          server: ctx.server, serveBox: ctx.serveBox, serve: shotId,
          receiver: ctx.receiver || null,
          receiveBox: ctx.serveBox,
          receive: null
        });
        renderLog();
        showToast(`Serve: ${shotId}`);
      },
      onReceive(shotId) {
        if (!ctx.receiver) { showToast('Select receiver first', true); return; }
        // Link to most recent unresolved rally for this receiver
        const rallies = getRallies();
        let linkedId = null;
        for (let i = rallies.length - 1; i >= 0; i--) {
          if (rallies[i].receiver === ctx.receiver && rallies[i].receive === null) {
            linkedId = rallies[i].id; break;
          }
        }
        if (linkedId !== null) {
          patchRallyLocal(linkedId, { receive: shotId });
        } else {
          appendRallyLocal({
            id: Date.now(),
            server: null, serveBox: null, serve: null,
            receiver: ctx.receiver, receiveBox: ctx.serveBox,
            receive: shotId
          });
        }
        renderLog();
        showToast(`Return: ${shotId}`);
      }
    });
  }

  document.getElementById('undo-btn').addEventListener('click', () => {
    const removed = undoLastLocal();
    if (removed) renderLog();
  });

  function renderLog() {
    const tbody = document.getElementById('log-body');
    const count = document.getElementById('rally-count');
    if (!tbody) return;
    const rallies = getRallies();
    count.textContent = `(${rallies.length})`;
    tbody.innerHTML = rallies.slice().reverse().map((r, i) => `
      <tr>
        <td>${rallies.length - i}</td>
        <td>${r.server ? names[r.server] : '—'}</td>
        <td>${r.serveBox || '—'}</td>
        <td class="serve-cell">${r.serve || '—'}</td>
        <td>${r.receiver ? names[r.receiver] : '—'}</td>
        <td>${r.receiveBox || '—'}</td>
        <td class="receive-cell">${r.receive || '—'}</td>
      </tr>`).join('');
  }
}

// ─── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, warn = false) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast ' + (warn ? 'toast-warn' : 'toast-ok');
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}
