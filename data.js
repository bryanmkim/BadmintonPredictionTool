// ─── Data page ───────────────────────────────────────────────────────────────

(function () {
  const names   = getNames();
  const rallies = getRallies();

  // Label player buttons with names
  ['p1','p2','p3','p4'].forEach(p => {
    document.querySelectorAll(`[data-player="${p}"]`).forEach(btn => {
      btn.textContent = names[p];
    });
  });

  let selectedPlayer = null;
  let recvServeType  = 'all';
  let recvBoxSide    = 'all';

  // Pull once on load, then poll every 5 s
  pullFromServer().then(() => { if (selectedPlayer) refreshAll(); });
  setInterval(async () => {
    await pullFromServer();
    if (selectedPlayer) refreshAll();
  }, 5000);

  // Player select
  document.getElementById('data-player-select').querySelectorAll('.ctx-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#data-player-select .ctx-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPlayer = btn.dataset.value;
      document.getElementById('data-placeholder').style.display = 'none';
      document.getElementById('data-content').style.display = 'block';
      refreshAll();
    });
  });

  // Receive filters
  document.getElementById('recv-serve-type').querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#recv-serve-type .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      recvServeType = btn.dataset.value;
      refreshReceive();
    });
  });
  document.getElementById('recv-box-side').querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#recv-box-side .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      recvBoxSide = btn.dataset.value;
      refreshReceive();
    });
  });

  function refreshAll() {
    const pName = names[selectedPlayer];
    document.getElementById('serve-player-label').textContent = pName;
    document.getElementById('recv-player-label').textContent  = pName;
    refreshServe();
    refreshReceive();
  }

  // ── Serve heatmap grid ─────────────────────────────────────────────────────
  // 3 cols (Wide → T) × 2 rows (Long / Short)
  const SERVE_GRID = [
    { id:'WideLong', label:'W. Long', col:0, row:0 },
    { id:'Drive',    label:'Drive',   col:1, row:0 },
    { id:'TLong',    label:'T Long',  col:2, row:0 },
    { id:'Wide',     label:'Wide',    col:0, row:1 },
    { id:'Middle',   label:'Middle',  col:1, row:1 },
    { id:'T',        label:'T',       col:2, row:1 },
  ];

  // ── Receive heatmap grid ───────────────────────────────────────────────────
  // 3 cols (Straight → Cross) × 2 rows (Net / Push)
  const RECV_GRID = [
    { id:'StraightNet',  label:'Str. Net',  col:0, row:0 },
    { id:'MiddleNet',    label:'Mid. Net',  col:1, row:0 },
    { id:'CrossNet',     label:'Cross Net', col:2, row:0 },
    { id:'LeftMid',      label:'L. Mid',    col:0, row:1 },
    { id:'CenterMid',    label:'Ctr. Mid',  col:1, row:1 },
    { id:'RightMid',     label:'R. Mid',    col:2, row:1 },
    { id:'StraightPush', label:'Str. Push', col:0, row:2 },
    { id:'MiddlePush',   label:'Mid. Push', col:1, row:2 },
    { id:'CrossPush',    label:'Cross Push',col:2, row:2 },
  ];

  function heatBg(count, max) {
    if (max === 0 || count === 0) return 'rgba(255,255,255,0.04)';
    const t = count / max;
    if (t < 0.25) return `rgba(79,142,247,${0.15 + t})`;
    if (t < 0.5 ) return `rgba(130,190,80,${0.3 + t * 0.6})`;
    if (t < 0.75) return `rgba(247,190,79,${0.45 + t * 0.4})`;
    return `rgba(220,60,60,${0.55 + t * 0.45})`;
  }

  function renderGrid(container, gridDef, counts, total) {
    const max = Math.max(...Object.values(counts), 1);
    container.innerHTML = '';
    gridDef.forEach(zone => {
      const count = counts[zone.id] || 0;
      const pct   = total > 0 ? Math.round(count / total * 100) : 0;
      const cell  = document.createElement('div');
      cell.className = 'hm-cell';
      cell.style.gridColumn  = zone.col + 1;
      cell.style.gridRow     = zone.row + 1;
      cell.style.background  = heatBg(count, max);
      cell.innerHTML =
        `<span class="hm-label">${zone.label}</span>` +
        `<span class="hm-count">${count}</span>` +
        `<span class="hm-pct">${pct > 0 ? pct + '%' : ''}</span>`;
      container.appendChild(cell);
    });
  }

  function refreshServe() {
    ['left','right'].forEach(box => {
      const sub = rallies.filter(r => r.server === selectedPlayer && r.serveBox === box && r.serve);
      const counts = {};
      SERVE_GRID.forEach(z => { counts[z.id] = 0; });
      sub.forEach(r => { if (counts[r.serve] !== undefined) counts[r.serve]++; });
      renderGrid(document.getElementById(`serve-hm-${box}`), SERVE_GRID, counts, sub.length);
      document.getElementById(`serve-total-${box}`).textContent =
        `${sub.length} serve${sub.length !== 1 ? 's' : ''}`;
    });
  }

  function refreshReceive() {
    const sub = rallies.filter(r => {
      if (r.receiver !== selectedPlayer || !r.receive) return false;
      if (recvServeType !== 'all' && r.serve !== recvServeType) return false;
      if (recvBoxSide   !== 'all' && r.receiveBox !== recvBoxSide) return false;
      return true;
    });
    const counts = {};
    RECV_GRID.forEach(z => { counts[z.id] = 0; });
    sub.forEach(r => { if (counts[r.receive] !== undefined) counts[r.receive]++; });
    renderGrid(document.getElementById('recv-hm'), RECV_GRID, counts, sub.length);
    document.getElementById('recv-total').textContent =
      `${sub.length} return${sub.length !== 1 ? 's' : ''}`;
  }

})();
