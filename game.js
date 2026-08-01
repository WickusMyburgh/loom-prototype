/* Loom — Prototype 01: The Drag Loop
 * Answers one question: does 90 seconds of this gesture feel good?
 * No framework, no build step. Pointer Events only. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- constants

  var COLS = 8;
  var ROWS = 12;

  var BG        = '#0f1016';
  var CELL_EMPTY = '#1c1e28';
  var WOVEN      = '#3b4152';
  var TRAY_SLOT  = '#171923';

  var PALETTE = ['#e0574a', '#e2a13c', '#4fb27a', '#3f8ede', '#9d5fe0', '#d95f96'];

  var WEAVE_MS = 220;          // under 250ms, per brief
  var WEAVE_LOCK = 0.32;       // first third: the row locks and holds, then pulls
  var FINGER_LIFT = 1.5;       // dragged piece sits this many cells above the touch

  // ------------------------------------------------------------------- shapes
  // 6 base shapes. Rotations are generated so the board stays placeable.

  function normalize(cells) {
    var minc = Infinity, minr = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < minc) minc = cells[i][0];
      if (cells[i][1] < minr) minr = cells[i][1];
    }
    var out = cells.map(function (c) { return [c[0] - minc, c[1] - minr]; });
    out.sort(function (a, b) { return (a[1] - b[1]) || (a[0] - b[0]); });
    return out;
  }

  function rotate(cells) {
    return normalize(cells.map(function (c) { return [-c[1], c[0]]; }));
  }

  function keyOf(cells) {
    return cells.map(function (c) { return c[0] + ',' + c[1]; }).join(';');
  }

  function variants(base) {
    var seen = {}, out = [], cur = normalize(base), i;
    for (i = 0; i < 4; i++) {
      var k = keyOf(cur);
      if (!seen[k]) { seen[k] = 1; out.push(cur); }
      cur = rotate(cur);
    }
    return out;
  }

  var I2 = variants([[0, 0], [1, 0]]);
  var I3 = variants([[0, 0], [1, 0], [2, 0]]);
  var L3 = variants([[0, 0], [0, 1], [1, 1]]);
  var O4 = variants([[0, 0], [1, 0], [0, 1], [1, 1]]);
  var I4 = variants([[0, 0], [1, 0], [2, 0], [3, 0]]);
  var T4 = variants([[0, 0], [1, 0], [2, 0], [1, 1]]);

  var FULL_SET  = [I2, I3, L3, O4, I4, T4];
  var SMALL_SET = [I2, I3];                 // the silent no-fail refill

  function makePiece(sets) {
    var group = sets[(Math.random() * sets.length) | 0];
    var cells = group[(Math.random() * group.length) | 0];
    var w = 0, h = 0;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] + 1 > w) w = cells[i][0] + 1;
      if (cells[i][1] + 1 > h) h = cells[i][1] + 1;
    }
    return {
      cells: cells,
      w: w,
      h: h,
      color: PALETTE[(Math.random() * PALETTE.length) | 0]
    };
  }

  // -------------------------------------------------------------------- state

  var board = [];
  for (var r = 0; r < ROWS; r++) {
    board.push(new Array(COLS).fill(null));
  }

  // Provenance grid, parallel to `board`. Each filled cell holds a reference to
  // the placement record that put it there, so a weaving row can name exactly
  // which player actions built it. Holding references rather than ids means
  // records for pieces that never wove are collected on their own.
  var owner = [];
  for (var or = 0; or < ROWS; or++) {
    owner.push(new Array(COLS).fill(null));
  }

  var tray = [makePiece(FULL_SET), makePiece(FULL_SET), makePiece(FULL_SET)];
  var drag = null;      // { slot, piece, x, y, pointerId }
  var weave = null;     // { rows, set, map, t0 }
  // Anchored here, not in the first rAF: a page that starts backgrounded gets
  // no frames, and both timings would silently read zero.
  var startedAt = performance.now();
  var hasPlaced = false;

  // ------------------------------------------------------------------- canvas

  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d', { alpha: false });

  var W = 0, H = 0, cell = 0;
  var boardX = 0, boardY = 0, boardW = 0, boardH = 0;
  var trayCell = 0, trayY = 0, trayBoxH = 0, dropLimitY = 0;

  function safeInset(id) {
    var el = document.getElementById(id);
    return el ? el.getBoundingClientRect().height : 0;
  }

  function layout() {
    var rect = canvas.getBoundingClientRect();
    W = Math.round(rect.width);
    H = Math.round(rect.height);

    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var top = safeInset('safeTop');
    var bottom = safeInset('safeBottom');

    // Cell size derives from the screen: width-limited, with enough room left
    // below the board for the drop zone plus a tray in the thumb arc.
    // 4.6 cells of headroom = 1.5 for the drop zone, ~2.6 for the tray box.
    var byWidth = (W - 28) / COLS;
    var byHeight = (H - top - bottom - 24) / (ROWS + 4.6);
    cell = Math.max(12, Math.floor(Math.min(byWidth, byHeight)));

    boardW = cell * COLS;
    boardH = cell * ROWS;
    boardX = Math.round((W - boardW) / 2);
    boardY = Math.round(top + 16);

    trayCell = Math.round(cell * 0.58);
    trayBoxH = trayCell * 4.4;

    // Sit the tray low for the thumb, but never so high that its box overlaps
    // the drop zone — releasing over the tray has to mean "cancel".
    var boardBottom = boardY + boardH;
    var below = (H - bottom) - boardBottom;
    var minTrayY = boardBottom + cell * 1.5 + trayBoxH / 2;
    var maxTrayY = (H - bottom) - Math.max(12, cell * 0.3) - trayBoxH / 2;
    trayY = Math.round(Math.max(minTrayY, Math.min(maxTrayY, boardBottom + below * 0.55)));

    // Below this, a release is a cancel. Kept clear of the tray box, and never
    // so tight that the bottom board row becomes unreachable.
    dropLimitY = Math.max(boardBottom + cell,
                          Math.min(boardBottom + cell * 1.5, trayY - trayBoxH / 2));
  }

  // -------------------------------------------------------- stats (local only)

  var KEY = 'loom.proto01';
  var stats = {
    sessionCount: 0,
    placements: 0,
    weaves: 0,
    timeToFirstMove: null,
    sessions: []
  };

  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      for (var k in stats) if (parsed[k] !== undefined) stats[k] = parsed[k];
    }
  } catch (e) { /* private mode — run without persistence */ }

  stats.sessionCount++;
  stats.sessions.push({ n: stats.sessionCount, ttfm: null, len: 0 });
  if (stats.sessions.length > 20) stats.sessions.shift();
  var session = stats.sessions[stats.sessions.length - 1];

  function save() {
    stats.sessionLength = session.len;
    try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch (e) {}
  }

  function tickSession() {
    session.len = Math.round(performance.now() - startedAt);
  }

  setInterval(function () { tickSession(); save(); }, 2000);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { tickSession(); save(); }
  });
  window.addEventListener('pagehide', function () { tickSession(); save(); });

  // -------------------------------------------------------------- the cloth
  // An ordered array of TraitVectors, one per woven row, oldest first. Traits
  // are captured once at the weave moment and never recomputed, so this array
  // is only ever appended to. A band's N — what the amplification curve reads
  // — is its array index plus one; see amplify() for why it is 1-based.

  var CLOTH_KEY = 'loom.cloth.v1';

  // TraitVector { density, bias, tempo, setup }
  //   density  0..1   how packed the board was around the row as it wove
  //   bias    -1..+1  negative = the row was built left of centre, positive = right
  //   tempo    0..1   1 = fast and decisive, 0 = slow and deliberate
  //   setup    0..1   0 = a lone row, 1 = four rows weaving together
  var cloth = [];

  try {
    var clothRaw = localStorage.getItem(CLOTH_KEY);
    if (clothRaw) {
      var loaded = JSON.parse(clothRaw);
      if (Object.prototype.toString.call(loaded) === '[object Array]') {
        for (var ci = 0; ci < loaded.length; ci++) {
          var band = loaded[ci];
          if (band && isNum(band.density) && isNum(band.bias) &&
              isNum(band.tempo) && isNum(band.setup)) {
            cloth.push({
              density: band.density, bias: band.bias,
              tempo: band.tempo, setup: band.setup
            });
          } else {
            // Substitute a neutral band rather than dropping it. Dropping would
            // renumber every later band, and N drives amplification — one bad
            // entry would quietly restyle the whole rest of the cloth.
            cloth.push({ density: 0.5, bias: 0, tempo: 0.5, setup: 0 });
          }
        }
      }
    }
  } catch (e) { /* private mode or corrupt entry — start a fresh cloth */ }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function round4(v) { return Math.round(v * 1e4) / 1e4; }

  function saveCloth() {
    try { localStorage.setItem(CLOTH_KEY, JSON.stringify(cloth)); } catch (e) {}
  }

  // ------------------------------------------------------ front-loading
  // Almost nobody plays long enough for character to emerge on its own, so
  // early bands are exaggerated and later ones settle:
  //
  //   amplified = neutral + (raw - neutral) * (1 + k / (N + c))
  //
  // N is 1-based. That is not a guess — with k=6, c=2 it reproduces the
  // brief's stated curve exactly (band 1 = 3.00x, band 10 = 1.50x,
  // band 50 = 1.12x). Treating N as a 0-based array index would make the
  // first band 4.00x and shift the whole curve.
  //
  // These two constants are the most important numbers in the system, so they
  // are tunable live from the debug panel and persist across sessions.

  var TUNE_KEY = 'loom.tune.v1';
  var K_DEFAULT = 6, C_DEFAULT = 2;
  var tuneK = K_DEFAULT, tuneC = C_DEFAULT;

  try {
    var tuneRaw = localStorage.getItem(TUNE_KEY);
    if (tuneRaw) {
      var tune = JSON.parse(tuneRaw);
      if (tune && isNum(tune.k)) tuneK = tune.k;
      if (tune && isNum(tune.c)) tuneC = tune.c;
    }
  } catch (e) { /* fall back to the brief's starting values */ }

  function saveTune() {
    try { localStorage.setItem(TUNE_KEY, JSON.stringify({ k: tuneK, c: tuneC })); } catch (e) {}
  }

  // c only has to stay clear of N + c === 0. N starts at 1, so anything above
  // -1 is safe; clamping at 0 keeps the curve monotonic and easy to reason about.
  function amplifyFactor(n) {
    return 1 + tuneK / (n + Math.max(0, tuneC));
  }

  // Each trait is stretched away from its own neutral point, not from a shared
  // 0.5. Bias runs -1..+1 and is neutral at dead centre of the board, so
  // stretching it about 0.5 would drag every band rightward.
  function amplifyTrait(raw, neutral, lo, hi, n) {
    return clamp(neutral + (raw - neutral) * amplifyFactor(n), lo, hi);
  }

  // Read-time only. Nothing here is ever written back to the cloth — the raw
  // capture stays canonical, so retuning k and c restyles the whole history
  // rather than only the bands woven after the change.
  function amplified(index) {
    var v = cloth[index];
    var n = index + 1;
    return {
      density: amplifyTrait(v.density, 0.5, 0, 1, n),
      bias: amplifyTrait(v.bias, 0, -1, 1, n),
      tempo: amplifyTrait(v.tempo, 0.5, 0, 1, n),
      setup: amplifyTrait(v.setup, 0.5, 0, 1, n)
    };
  }

  // -------------------------------------------------------------------- audio
  // One placement tick, one weave chime. Nothing else.

  var actx = null;

  function audio() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  function blip(freq, dur, vol, type, delay) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime + (delay || 0);
    var osc = a.createOscillator();
    var gain = a.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function soundPlace() { blip(440, 0.05, 0.09, 'triangle', 0); }

  function soundWeave(n) {
    var notes = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < Math.min(n + 1, 4); i++) {
      blip(notes[i], 0.4, 0.07, 'sine', i * 0.055);
    }
  }

  // ---------------------------------------------------------------- game logic

  function fits(piece, col, row) {
    for (var i = 0; i < piece.cells.length; i++) {
      var c = col + piece.cells[i][0];
      var rr2 = row + piece.cells[i][1];
      if (c < 0 || c >= COLS || rr2 < 0 || rr2 >= ROWS) return false;
      if (board[rr2][c]) return false;
    }
    return true;
  }

  function fitsAnywhere(piece) {
    for (var row = 0; row <= ROWS - piece.h; row++) {
      for (var col = 0; col <= COLS - piece.w; col++) {
        if (fits(piece, col, row)) return true;
      }
    }
    return false;
  }

  function place(piece, col, row, record) {
    for (var i = 0; i < piece.cells.length; i++) {
      var r = row + piece.cells[i][1];
      var c = col + piece.cells[i][0];
      board[r][c] = piece.color;
      owner[r][c] = record;
    }
  }

  // ------------------------------------------------------------------ traits
  // Captured at the weave moment, from the placements that built the row.
  // Every number here traces back to something the player did.

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Fraction of the rows immediately above and below that are filled. Rows off
  // the board are not counted at all rather than counted as empty, so a row
  // weaving at the top edge is not scored as artificially sparse.
  function densityAt(row) {
    var filled = 0, total = 0;
    var neighbours = [row - 1, row + 1];
    for (var n = 0; n < neighbours.length; n++) {
      var r = neighbours[n];
      if (r < 0 || r >= ROWS) continue;
      for (var c = 0; c < COLS; c++) {
        total++;
        if (board[r][c]) filled++;
      }
    }
    return total ? filled / total : 0;
  }

  // Distinct placements that contributed at least one cell to this row.
  function contributorsOf(row) {
    var out = [];
    for (var c = 0; c < COLS; c++) {
      var rec = owner[row][c];
      if (rec && out.indexOf(rec) === -1) out.push(rec);
    }
    return out;
  }

  function median(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // One TraitVector per woven row. `rowsInEvent` is shared by every row in the
  // same weave — that is what Setup measures.
  function captureTraits(row, rowsInEvent) {
    var contributors = contributorsOf(row);
    var centres = [], durations = [], i;

    for (i = 0; i < contributors.length; i++) {
      var rec = contributors[i];
      // A piece spans columns; its centre is the honest single x for it.
      centres.push(rec.col + (rec.w - 1) / 2);
      durations.push(rec.dragMs);
    }

    var boardCentre = (COLS - 1) / 2;
    var meanCentre = boardCentre;
    if (centres.length) {
      var sum = 0;
      for (i = 0; i < centres.length; i++) sum += centres[i];
      meanCentre = sum / centres.length;
    }

    // Slow, deliberate drags normalise toward 0; fast, decisive ones toward 1,
    // so the number reads the same direction as the word "tempo".
    var ms = clamp(median(durations), 200, 3000);
    var tempo = 1 - (ms - 200) / 2800;

    return {
      density: round4(clamp(densityAt(row), 0, 1)),
      bias: round4(clamp((meanCentre - boardCentre) / boardCentre, -1, 1)),
      tempo: round4(clamp(tempo, 0, 1)),
      setup: round4((clamp(rowsInEvent, 1, 4) - 1) / 3)
    };
  }

  function checkWeaves() {
    var full = [];
    for (var row = 0; row < ROWS; row++) {
      var complete = true;
      for (var col = 0; col < COLS; col++) {
        if (!board[row][col]) { complete = false; break; }
      }
      if (complete) full.push(row);
    }
    if (!full.length) return false;
    startWeave(full, true);
    return true;
  }

  function startWeave(rows, counted) {
    if (counted) {
      stats.weaves += rows.length;
      save();
      soundWeave(rows.length);

      // Capture before finishWeave() rearranges the board — the traits describe
      // the board as the player left it. `counted` is false only for the
      // no-fail rescue weave, which the player did not complete and is never
      // told about, so it must not put a band in the cloth.
      for (var t = 0; t < rows.length; t++) {
        cloth.push(captureTraits(rows[t], rows.length));
      }
      saveCloth();
    }
    var set = {};
    for (var i = 0; i < rows.length; i++) set[rows[i]] = 1;

    // Rows above a woven row scroll down into the space it leaves.
    var map = new Array(ROWS);
    for (var row = 0; row < ROWS; row++) {
      if (set[row]) continue;
      var below = 0;
      for (var j = 0; j < rows.length; j++) if (rows[j] > row) below++;
      map[row] = row + below;
    }
    weave = { rows: rows, set: set, map: map, t0: performance.now() };
  }

  // Apply any weave whose animation has run its course. Loops because the
  // no-fail fallback can start a fresh weave from inside finishWeave().
  function settleWeave(now) {
    var guard = 0;
    while (weave && now - weave.t0 >= WEAVE_MS && guard++ < ROWS) finishWeave();
  }

  function finishWeave() {
    var next = [], nextOwner = [];
    for (var i = 0; i < ROWS; i++) {
      next.push(new Array(COLS).fill(null));
      nextOwner.push(new Array(COLS).fill(null));
    }
    for (var row = 0; row < ROWS; row++) {
      if (weave.set[row]) continue;
      next[weave.map[row]] = board[row];
      nextOwner[weave.map[row]] = owner[row];   // provenance moves with the cells
    }
    board = next;
    owner = nextOwner;
    weave = null;
    ensurePlayable();
  }

  function refill() {
    tray = [makePiece(FULL_SET), makePiece(FULL_SET), makePiece(FULL_SET)];
  }

  // The player must never be stuck. Silently downgrade the tray; if even that
  // fails (it should not), weave the fullest row and say nothing about it.
  function ensurePlayable() {
    var live = [], i;
    for (i = 0; i < tray.length; i++) if (tray[i]) live.push(i);
    if (!live.length) return;

    for (i = 0; i < live.length; i++) {
      if (fitsAnywhere(tray[live[i]])) return;
    }
    for (i = 0; i < live.length; i++) {
      tray[live[i]] = makePiece(SMALL_SET);
    }
    for (i = 0; i < live.length; i++) {
      if (fitsAnywhere(tray[live[i]])) return;
    }

    var best = -1, bestCount = 0;
    for (var row = 0; row < ROWS; row++) {
      var count = 0;
      for (var col = 0; col < COLS; col++) if (board[row][col]) count++;
      if (count > bestCount) { bestCount = count; best = row; }
    }
    if (best >= 0) startWeave([best], false);
  }

  // ------------------------------------------------------------------- ghost

  // Where would the dragged piece land? Returns null when the drag is over the
  // tray (a clean cancel) rather than the board.
  function ghostTarget() {
    if (!drag) return null;
    // The lift means the finger sits a full cell below the piece, so the drop
    // zone has to extend past the board edge or the bottom row is unreachable.
    if (drag.y > dropLimitY) return null;

    var p = drag.piece;
    var ox = drag.x - (p.w * cell) / 2;
    var oy = drag.y - FINGER_LIFT * cell - (p.h - 0.5) * cell;

    // Rounding is the snap: half a cell of tolerance in every direction,
    // then clamp so edge placements never need pixel accuracy.
    var col = Math.round((ox - boardX) / cell);
    var row = Math.round((oy - boardY) / cell);
    col = Math.max(0, Math.min(COLS - p.w, col));
    row = Math.max(0, Math.min(ROWS - p.h, row));

    return { col: col, row: row, legal: fits(p, col, row) };
  }

  // ------------------------------------------------------------------- input

  function pointAt(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function slotAt(x, y) {
    if (y < boardY + boardH) return -1;            // generous: the whole strip
    var i = Math.floor((x / W) * 3);
    if (i < 0 || i > 2) return -1;
    return i;
  }

  function onDown(e) {
    e.preventDefault();
    audio();
    debugCorner(e);

    // A backgrounded tab stops rAF mid-weave. Never let that strand input.
    settleWeave(performance.now());
    if (drag || weave) return;                     // one finger, one weave
    var p = pointAt(e);
    var slot = slotAt(p.x, p.y);
    if (slot < 0 || !tray[slot]) return;

    drag = {
      slot: slot, piece: tray[slot], x: p.x, y: p.y, pointerId: e.pointerId,
      tPickup: performance.now()                   // start of the Tempo measure
    };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    var p = pointAt(e);
    drag.x = p.x;
    drag.y = p.y;
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();

    var p = pointAt(e);
    drag.x = p.x;
    drag.y = p.y;

    var target = ghostTarget();
    var piece = drag.piece;
    var slot = drag.slot;
    var tPickup = drag.tPickup;
    releasePointer(e.pointerId);
    drag = null;

    if (!target || !target.legal) return;          // back to the tray, silently

    // What this placement was, for any row it later helps weave. Cancelled and
    // illegal drags never get here, so they never colour a band.
    place(piece, target.col, target.row, {
      col: target.col,
      row: target.row,
      w: piece.w,
      h: piece.h,
      dragMs: performance.now() - tPickup
    });
    tray[slot] = null;

    stats.placements++;
    if (!hasPlaced) {
      hasPlaced = true;
      var ttfm = Math.round(performance.now() - startedAt);
      session.ttfm = ttfm;
      if (stats.timeToFirstMove === null) stats.timeToFirstMove = ttfm;
    }
    tickSession();
    save();

    soundPlace();
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (err) {} }

    if (!tray[0] && !tray[1] && !tray[2]) refill();
    if (!checkWeaves()) ensurePlayable();
  }

  // pointercancel must never leave state dangling — this killed Grapple Frog.
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    releasePointer(e.pointerId);
    drag = null;
  }

  function releasePointer(id) {
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(id)) {
        canvas.releasePointerCapture(id);
      }
    } catch (err) {}
  }

  canvas.addEventListener('pointerdown', onDown, { passive: false });
  canvas.addEventListener('pointermove', onMove, { passive: false });
  canvas.addEventListener('pointerup', onUp, { passive: false });
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);

  // Belt and braces against scroll / pull-to-refresh / double-tap zoom — but
  // the debug panel is a scrollable DOM overlay, so touches inside it have to
  // pass through or its controls become unreachable on a phone.
  function inPanel(e) {
    return panel && !panel.hidden && e.target && panel.contains(e.target);
  }
  document.addEventListener('touchstart', function (e) {
    if (!inPanel(e)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', function (e) {
    if (!inPanel(e)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('resize', function () {
    layout();
    if (drag) { releasePointer(drag.pointerId); drag = null; }
  });
  window.addEventListener('orientationchange', layout);

  // -------------------------------------------------------------------- debug
  // Five taps in the top-left corner. Nothing else reveals it.

  var taps = [];
  var panel = document.getElementById('debug');

  function debugCorner(e) {
    var p = pointAt(e);
    if (p.x > 72 || p.y > 72) { taps.length = 0; return; }
    var now = performance.now();
    taps.push(now);
    while (taps.length && now - taps[0] > 2500) taps.shift();
    // Sync only on open. Doing it inside showDebug() would rewrite the input
    // mid-keystroke and fight anyone typing a two-digit k.
    if (taps.length >= 5) { taps.length = 0; syncTuneInputs(); showDebug(); }
  }

  function pad(v, n) {
    var s = '' + v;
    while (s.length < n) s += ' ';
    return s;
  }

  // Signed, fixed width, so the columns line up and a drifting trait is
  // obvious at a glance.
  function sig(v) {
    var s = (v < 0 ? '-' : '+') + Math.abs(v).toFixed(2);
    return pad(s, 6);
  }

  function clothAverage() {
    var sum = { density: 0, bias: 0, tempo: 0, setup: 0 };
    if (!cloth.length) return sum;
    for (var i = 0; i < cloth.length; i++) {
      sum.density += cloth[i].density;
      sum.bias += cloth[i].bias;
      sum.tempo += cloth[i].tempo;
      sum.setup += cloth[i].setup;
    }
    sum.density /= cloth.length;
    sum.bias /= cloth.length;
    sum.tempo /= cloth.length;
    sum.setup /= cloth.length;
    return sum;
  }

  function showDebug() {
    tickSession();
    save();
    var lines = [
      'timeToFirstMove  ' + (stats.timeToFirstMove === null ? '-' : stats.timeToFirstMove + ' ms'),
      'sessionLength    ' + session.len + ' ms',
      'sessionCount     ' + stats.sessionCount,
      'placements       ' + stats.placements,
      'weaves           ' + stats.weaves,
      '',
      'cloth            ' + cloth.length + ' bands'
    ];

    // The curve itself, at the three points the brief calls out. This is the
    // fastest read on whether a k/c change did what you wanted, and it works
    // even on a cloth too short to show interesting bands.
    lines.push('',
      'amplify          k ' + tuneK.toFixed(2) + '   c ' + tuneC.toFixed(2),
      '  N=1 ' + amplifyFactor(1).toFixed(2) + 'x' +
      '   N=10 ' + amplifyFactor(10).toFixed(2) + 'x' +
      '   N=50 ' + amplifyFactor(50).toFixed(2) + 'x');

    // Newest bands first. N is 1-based, matching the amplification curve.
    if (cloth.length) {
      lines.push('', showAmplified ? 'bands (amplified)' : 'bands (raw)',
                 '  N    dens   bias   temp   setup   x');
      for (var b = cloth.length - 1; b >= Math.max(0, cloth.length - 10); b--) {
        var v = showAmplified ? amplified(b) : cloth[b];
        lines.push('  ' + pad(b + 1, 4) + ' ' + sig(v.density) + ' ' + sig(v.bias) +
                   ' ' + sig(v.tempo) + ' ' + sig(v.setup) +
                   ' ' + amplifyFactor(b + 1).toFixed(2));
      }
      var avg = clothAverage();
      lines.push('  avg  ' + sig(avg.density) + ' ' + sig(avg.bias) +
                 ' ' + sig(avg.tempo) + ' ' + sig(avg.setup) + '  (raw)');
    }

    lines.push('', 'per session (ttfm / length)');
    for (var i = stats.sessions.length - 1; i >= 0; i--) {
      var s = stats.sessions[i];
      lines.push('  #' + s.n + '  ' + (s.ttfm === null ? '-' : s.ttfm + ' ms') + '  /  ' + s.len + ' ms');
    }
    document.getElementById('debugText').textContent = lines.join('\n');
    panel.hidden = false;
  }

  // --------------------------------------------------------- tuning controls

  var showAmplified = true;
  var kInput = document.getElementById('tuneK');
  var cInput = document.getElementById('tuneC');
  var toggleBtn = document.getElementById('tuneToggle');

  function syncTuneInputs() {
    kInput.value = tuneK;
    cInput.value = tuneC;
    toggleBtn.textContent = showAmplified ? 'show raw' : 'show amplified';
  }

  function readTuneInput(input, current) {
    var v = parseFloat(input.value);
    // Reject junk rather than letting NaN poison the curve and blank the table.
    if (!isNum(v)) return current;
    return clamp(v, 0, 40);
  }

  kInput.addEventListener('input', function () {
    tuneK = readTuneInput(kInput, tuneK);
    saveTune();
    showDebug();
  });
  cInput.addEventListener('input', function () {
    tuneC = readTuneInput(cInput, tuneC);
    saveTune();
    showDebug();
  });
  // Re-sync on blur so a rejected entry visibly snaps back to what is in use.
  kInput.addEventListener('blur', syncTuneInputs);
  cInput.addEventListener('blur', syncTuneInputs);

  toggleBtn.addEventListener('click', function () {
    showAmplified = !showAmplified;
    syncTuneInputs();
    showDebug();
  });

  document.getElementById('tuneDefaults').addEventListener('click', function () {
    tuneK = K_DEFAULT;
    tuneC = C_DEFAULT;
    saveTune();
    syncTuneInputs();
    showDebug();
  });

  document.getElementById('debugClose').addEventListener('click', function () {
    panel.hidden = true;
  });
  document.getElementById('debugReset').addEventListener('click', function () {
    stats.placements = 0;
    stats.weaves = 0;
    stats.timeToFirstMove = null;
    stats.sessionCount = 1;
    stats.sessions = [{ n: 1, ttfm: null, len: 0 }];
    session = stats.sessions[0];
    startedAt = performance.now();
    hasPlaced = false;
    save();
    showDebug();
  });

  // Deliberately separate from "reset stats", and deliberately two-step: a
  // cloth is the whole point of prototype 02 and there is no undo.
  var clothBtn = document.getElementById('debugResetCloth');
  var armed = false;
  clothBtn.addEventListener('click', function () {
    if (!armed) {
      armed = true;
      clothBtn.classList.add('armed');
      clothBtn.textContent = 'erase cloth — tap again';
      setTimeout(function () {
        armed = false;
        clothBtn.classList.remove('armed');
        clothBtn.textContent = 'erase cloth';
      }, 3000);
      return;
    }
    armed = false;
    clothBtn.classList.remove('armed');
    clothBtn.textContent = 'erase cloth';
    cloth.length = 0;
    saveCloth();
    showDebug();
  });

  // ------------------------------------------------------------------ drawing

  function rr(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function block(x, y, size, color) {
    var pad = Math.max(1, size * 0.045);
    rr(x + pad, y + pad, size - pad * 2, size - pad * 2, size * 0.16);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function drawBoard(now) {
    var row, col;

    // static grid
    for (row = 0; row < ROWS; row++) {
      for (col = 0; col < COLS; col++) {
        block(boardX + col * cell, boardY + row * cell, cell, CELL_EMPTY);
      }
    }

    settleWeave(now);
    var t = weave ? Math.min(1, (now - weave.t0) / WEAVE_MS) : 1;

    ctx.save();
    ctx.beginPath();
    ctx.rect(boardX - 2, boardY, boardW + 4, boardH);
    ctx.clip();

    if (weave) {
      // The row locks and holds for a beat, then the cloth is drawn up and the
      // board settles down into the space it left.
      var pull = t <= WEAVE_LOCK ? 0 : (t - WEAVE_LOCK) / (1 - WEAVE_LOCK);
      var e = easeOut(pull);

      // surviving rows scroll down by one row per weave beneath them
      for (row = 0; row < ROWS; row++) {
        if (weave.set[row]) continue;
        var dy = (weave.map[row] - row) * cell * e;
        for (col = 0; col < COLS; col++) {
          if (board[row][col]) {
            block(boardX + col * cell, boardY + row * cell + dy, cell, board[row][col]);
          }
        }
      }

      // the woven rows lock to a muted tone and exit the top
      ctx.globalAlpha = Math.max(0, 1 - pull / 0.75);
      for (var i = 0; i < weave.rows.length; i++) {
        var wr = weave.rows[i];
        var up = e * (wr + 1.5) * cell;
        for (col = 0; col < COLS; col++) {
          block(boardX + col * cell, boardY + wr * cell - up, cell, WOVEN);
        }
      }
      ctx.globalAlpha = 1;
    } else {
      for (row = 0; row < ROWS; row++) {
        for (col = 0; col < COLS; col++) {
          if (board[row][col]) {
            block(boardX + col * cell, boardY + row * cell, cell, board[row][col]);
          }
        }
      }
    }

    ctx.restore();
  }

  // The ghost sits under the dragged piece, so it needs an outline to read.
  function drawGhost(target) {
    if (!target || !target.legal) return;
    var p = drag.piece;
    var pad = Math.max(1, cell * 0.045);

    for (var i = 0; i < p.cells.length; i++) {
      var x = boardX + (target.col + p.cells[i][0]) * cell;
      var y = boardY + (target.row + p.cells[i][1]) * cell;
      ctx.globalAlpha = 0.3;
      block(x, y, cell, p.color);
      ctx.globalAlpha = 0.9;
      rr(x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
      ctx.lineWidth = Math.max(1.5, cell * 0.055);
      ctx.strokeStyle = p.color;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawPieceAt(piece, cx, cy, size, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var ox = cx - (piece.w * size) / 2;
    var oy = cy - (piece.h * size) / 2;
    for (var i = 0; i < piece.cells.length; i++) {
      block(ox + piece.cells[i][0] * size, oy + piece.cells[i][1] * size, size, piece.color);
    }
    ctx.globalAlpha = 1;
  }

  function drawTray(now) {
    // Until the first placement, the tray breathes. No text, just an invitation.
    var pulse = 1;
    if (!hasPlaced && !drag && startedAt && now - startedAt > 2200) {
      pulse = 1 + 0.05 * Math.sin((now - startedAt) / 260);
    }

    for (var i = 0; i < 3; i++) {
      var cx = W * (i + 0.5) / 3;
      rr(cx - trayBoxH / 2, trayY - trayBoxH / 2, trayBoxH, trayBoxH, trayCell * 0.4);
      ctx.fillStyle = TRAY_SLOT;
      ctx.fill();

      var piece = tray[i];
      if (!piece) continue;
      if (drag && drag.slot === i) continue;       // it's on the finger
      drawPieceAt(piece, cx, trayY, trayCell * pulse, 1);
    }
  }

  function drawDrag(target) {
    if (!drag) return;
    var p = drag.piece;
    // Lifted clear of the finger so the player can see what they are placing.
    var cx = drag.x;
    var cy = drag.y - FINGER_LIFT * cell - (p.h - 0.5) * cell + (p.h * cell) / 2;
    // Dimmed when it would not land — the only "no" signal, and it needs no text.
    drawPieceAt(p, cx, cy, cell, target && target.legal ? 1 : 0.45);
  }

  function frame(now) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    var target = drag ? ghostTarget() : null;
    drawBoard(now);
    drawGhost(target);
    drawTray(now);
    drawDrag(target);

    requestAnimationFrame(frame);
  }

  layout();
  if (window.ResizeObserver) {
    new ResizeObserver(layout).observe(canvas);
  }
  ensurePlayable();
  requestAnimationFrame(frame);
})();
