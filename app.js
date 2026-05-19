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

// ─── Storage (localStorage cache + server sync) ──────────────────────────────
const DEFAULT_NAMES = { p1: 'P1', p2: 'P2', p3: 'P3', p4: 'P4' };
function getNames()    { 
  try { return JSON.parse(localStorage.getItem('bt_names'))   || {...DEFAULT_NAMES}; } 
  // if JSON.parse throws an error for corrupted string like Bryan@@
  catch { return {...DEFAULT_NAMES}; } }
function getRallies()  { 
  try { return JSON.parse(localStorage.getItem('bt_rallies')) || []; } 
  catch { return []; } }

// first localStorage, then pushed to server, in case server goes offlien so user can continue until server is online.
function saveNames(n)  { localStorage.setItem('bt_names',   JSON.stringify(n)); pushToServer(); }
function saveRallies(r){ localStorage.setItem('bt_rallies', JSON.stringify(r)); pushToServer(); }

// Server Status Dot Handler
function setSyncDot(state) {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  // Map in JS is just a dictionary.s
  const map = { synced:'#4caf50', syncing:'#f7954f', offline:'#e05555' };
  dot.style.color = map[state] || map.offline;
  dot.title = state;
}

// Sends POST call to /api/state == server.py with all the rally data
async function pushToServer() {
  setSyncDot('syncing');
  try {
    await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: getNames(), rallies: getRallies() })
    });
    // no error; sets status dot to green.
    setSyncDot('synced');
    // if API call throws an error(server error or server offline, sets status dot to red.)
  } catch { setSyncDot('offline'); }
}

async function pullFromServer() {
  setSyncDot('syncing');
  try {
    const res  = await fetch('/api/state');
    // when calling API data comes in stream of bytes so you must call res.json() and not JSON.parse(res)
    const data = await res.json();
    if (data.names)   localStorage.setItem('bt_names',   JSON.stringify(data.names));
    if (data.rallies) localStorage.setItem('bt_rallies', JSON.stringify(data.rallies));
    setSyncDot('synced');
    return true;
  } catch { setSyncDot('offline'); return false; }
}

// ─── SVG helpers ────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) {
    // append.Child attaches child e to parent
    parent.appendChild(e);
  }
  return e;
}
// text goes in between the tags, so svgText must be separated with svgEl
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
    // hovering and click animation
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

  // clears everything inside court-wrap div. Renders fresh court SVG.
  container.innerHTML = '';
  container.appendChild(svg);
}

// ─── Record page init ────────────────────────────────────────────────────────
if (document.getElementById('court-wrap')) {
  pullFromServer().then(() => initRecordPage());
}

function initRecordPage() {
  const names   = getNames();
  const rallies = getRallies();
  const ctx = { server: null, serveBox: null, receiver: null };

  // Player name inputs
  ['p1','p2','p3','p4'].forEach(p => {
    const el = document.getElementById(`${p}-name`);
    if (el) el.value = names[p];
  });

  document.getElementById('save-names-btn').addEventListener('click', () => {
    ['p1','p2','p3','p4'].forEach(p => {
      const v = document.getElementById(`${p}-name`).value.trim();
      names[p] = v || DEFAULT_NAMES[p];
    });
    saveNames(names);
    refreshLabels();
    refreshCourt();
    showToast('Names saved');
  });

  // refreshes name labels without needing to reload the entire page.
  function refreshLabels() {
    ['p1','p2','p3','p4'].forEach(p => {
      document.querySelectorAll(`[data-player="${p}"]`).forEach(btn => {
        btn.textContent = names[p];
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
        rallies.push({
          id: Date.now(),
          server: ctx.server, serveBox: ctx.serveBox, serve: shotId,
          receiver: ctx.receiver || null,
          receiveBox: ctx.serveBox,   // always same as serveBox
          receive: null
        });
        saveRallies(rallies);
        renderLog();
        showToast(`Serve: ${shotId}`);
      },
      onReceive(shotId) {
        if (!ctx.receiver) { showToast('Select receiver first', true); return; }
        // Link to most recent unresolved rally for this receiver
        let linked = false;
        for (let i = rallies.length - 1; i >= 0; i--) {
          if (rallies[i].receiver === ctx.receiver && rallies[i].receive === null) {
            rallies[i].receive = shotId;
            linked = true; break;
          }
        }
        if (!linked) {
          rallies.push({
            id: Date.now(),
            server: null, serveBox: null, serve: null,
            receiver: ctx.receiver, receiveBox: ctx.serveBox,
            receive: shotId
          });
        }
        saveRallies(rallies);
        renderLog();
        showToast(`Return: ${shotId}`);
      }
    });
  }

  document.getElementById('undo-btn').addEventListener('click', () => {
    if (!rallies.length) return;
    rallies.pop();
    saveRallies(rallies);
    renderLog();
  });

  function renderLog() {
    const tbody = document.getElementById('log-body');
    const count = document.getElementById('rally-count');
    if (!tbody) return;
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

// small popup on the bottom that appears or disappears for new state or error messages.
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
