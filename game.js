(() => {
'use strict';

// ===== 定数 =====
const TS = 16, VW = 320, VH = 240, COLS = 160, ROWS = 15;
const FLAG_COL = 148;
const EMPTY = 0, GROUND = 1, BRICK = 2, QUESTION = 3, USED = 4, HARD = 5, PIPE = 6;

const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ===== 入力 =====
const keys = {};
const touch = {};
let jumpPrev = false;

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  initAudio();
  if (e.code === 'Space' || e.code === 'Enter') pressStart();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.key;
  const on = e => { e.preventDefault(); touch[k] = true; b.classList.add('on'); initAudio(); if (k === 'jump') pressStart(); };
  const off = e => { e.preventDefault(); touch[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on);
  b.addEventListener('pointerup', off);
  b.addEventListener('pointercancel', off);
  b.addEventListener('pointerleave', off);
});
cv.addEventListener('pointerdown', () => { initAudio(); pressStart(); });

const isLeft  = () => keys.ArrowLeft || keys.KeyA || touch.left;
const isRight = () => keys.ArrowRight || keys.KeyD || touch.right;
const isRun   = () => keys.ShiftLeft || keys.ShiftRight || keys.KeyX || touch.run;
const isJump  = () => keys.Space || keys.KeyZ || keys.ArrowUp || keys.KeyW || touch.jump;

// ===== サウンド =====
let actx = null;
function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}
function beep(f1, f2, dur, type = 'square', vol = 0.06) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.linearRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur);
}
const sJump  = () => beep(300, 700, 0.18);
const sCoin  = () => { beep(988, 988, 0.07); setTimeout(() => beep(1319, 1319, 0.2), 70); };
const sStomp = () => beep(400, 120, 0.12);
const sBump  = () => beep(120, 90, 0.08, 'triangle', 0.1);
const sBreak = () => beep(200, 60, 0.15, 'sawtooth', 0.05);
const sDie   = () => beep(500, 80, 0.7, 'square', 0.07);
const sClear = () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, f, 0.18), i * 130)); };

// ===== ステージ =====
let grid, enemies, coins, particles;

function buildLevel() {
  grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Uint8Array(COLS));
  const set = (c, r, t) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r][c] = t; };

  // 地面（穴あり）
  const pits = [[34, 2], [66, 3], [98, 3], [118, 2]];
  for (let c = 0; c < COLS; c++) {
    if (pits.some(([s, w]) => c >= s && c < s + w)) continue;
    set(c, 13, GROUND); set(c, 14, GROUND);
  }
  // 土管
  const pipe = (c, h) => { for (let r = 13 - h; r < 13; r++) { set(c, r, PIPE); set(c + 1, r, PIPE); } };
  pipe(24, 2); pipe(42, 3); pipe(54, 2); pipe(104, 3);
  // ブロック
  const q = (c, r) => set(c, r, QUESTION);
  const b = (c, r) => set(c, r, BRICK);
  q(14, 9); b(17, 9); q(18, 9); b(19, 9); q(20, 9); q(18, 5);
  b(46, 9); b(47, 9); q(48, 9); b(49, 9);
  for (let c = 58; c < 66; c++) b(c, 6);
  q(60, 9); q(61, 9);
  b(76, 9); q(77, 9); b(78, 9);
  b(88, 9); b(89, 9); b(90, 9); q(89, 5);
  b(108, 9); q(109, 9); b(110, 9);
  q(122, 9); b(123, 9); q(124, 9);
  // 階段
  for (let i = 1; i <= 8; i++) for (let h = 0; h < i; h++) set(130 + i, 12 - h, HARD);
  // 敵
  enemies = [20, 30, 38, 50, 62, 70, 72, 84, 92, 94, 112, 114, 126]
    .map(c => ({ x: c * TS, y: 12 * TS - 2, w: 14, h: 14, dir: -1, vx: 0, vy: 0, alive: true, squish: 0, active: false }));
  // 空中コイン
  coins = [];
  const coinRow = (c, r, n) => { for (let i = 0; i < n; i++) coins.push({ x: (c + i) * TS, y: r * TS, got: false }); };
  coinRow(30, 9, 3); coinRow(60, 4, 5); coinRow(96, 8, 5); coinRow(116, 7, 4); coinRow(136, 3, 3);
  particles = [];
}

// ===== ゲーム状態 =====
let state = 'title';
let player, cam, score, coinCount, lives, timeLeft, frame, deadTimer, clearTimer, flagY, tick;

function newGame() {
  score = 0; coinCount = 0; lives = 3;
  startRun();
}
function startRun() {
  buildLevel();
  player = { x: 40, y: 12 * TS - 14, w: 12, h: 14, vx: 0, vy: 0, onGround: false, dir: 1, anim: 0 };
  cam = 0; timeLeft = 300; frame = 0; tick = 0; flagY = 3 * TS; clearTimer = 0;
  state = 'play';
}
function pressStart() {
  if (state === 'title' || state === 'over') newGame();
  else if (state === 'clear' && clearTimer > 200) { state = 'title'; }
}

// ===== 当たり判定 =====
function tileAt(c, r) {
  if (c < 0 || c >= COLS) return HARD;
  if (r < 0 || r >= ROWS) return EMPTY;
  return grid[r][c];
}
const solid = t => t !== EMPTY;

function moveX(e) {
  e.x += e.vx;
  e.hitWall = false;
  const top = Math.floor(e.y / TS), bot = Math.floor((e.y + e.h - 0.01) / TS);
  if (e.vx > 0) {
    const c = Math.floor((e.x + e.w - 0.01) / TS);
    for (let r = top; r <= bot; r++) if (solid(tileAt(c, r))) { e.x = c * TS - e.w; e.vx = 0; e.hitWall = true; break; }
  } else if (e.vx < 0) {
    const c = Math.floor(e.x / TS);
    for (let r = top; r <= bot; r++) if (solid(tileAt(c, r))) { e.x = (c + 1) * TS; e.vx = 0; e.hitWall = true; break; }
  }
}
function moveY(e, onBump) {
  e.y += e.vy;
  e.onGround = false;
  const l = Math.floor(e.x / TS), rr = Math.floor((e.x + e.w - 0.01) / TS);
  if (e.vy > 0) {
    const r = Math.floor((e.y + e.h - 0.01) / TS);
    for (let c = l; c <= rr; c++) if (solid(tileAt(c, r))) { e.y = r * TS - e.h; e.vy = 0; e.onGround = true; break; }
  } else if (e.vy < 0) {
    const r = Math.floor(e.y / TS);
    const cands = [];
    for (let c = l; c <= rr; c++) if (solid(tileAt(c, r))) cands.push(c);
    if (cands.length) {
      const mid = (e.x + e.w / 2) / TS;
      cands.sort((a, b) => Math.abs(a + 0.5 - mid) - Math.abs(b + 0.5 - mid));
      e.y = (r + 1) * TS;
      e.vy = 0;
      if (onBump) onBump(cands[0], r);
    }
  }
}

// ===== ブロック処理 =====
function bump(c, r) {
  const t = tileAt(c, r);
  if (t === QUESTION) {
    grid[r][c] = USED;
    coinCount++; score += 200; sCoin();
    particles.push({ kind: 'coin', x: c * TS + 4, y: r * TS - 8, vy: -4, life: 30 });
    particles.push({ kind: 'bounce', c, r, life: 8 });
    killEnemiesOn(c, r);
  } else if (t === BRICK) {
    grid[r][c] = EMPTY;
    score += 50; sBreak();
    for (const [dx, dy] of [[-1.2, -3.5], [1.2, -3.5], [-0.8, -2], [0.8, -2]]) {
      particles.push({ kind: 'brick', x: c * TS + 4, y: r * TS + 4, vx: dx, vy: dy, life: 50 });
    }
    killEnemiesOn(c, r);
  } else {
    sBump();
  }
}
function killEnemiesOn(c, r) {
  for (const e of enemies) {
    if (!e.alive || e.squish) continue;
    if (e.x + e.w > c * TS && e.x < (c + 1) * TS && Math.abs((e.y + e.h) - r * TS) < 3) {
      e.alive = false; score += 100;
    }
  }
}

// ===== 更新 =====
function die() {
  if (state !== 'play') return;
  state = 'dead'; deadTimer = 0;
  player.vy = -5; player.vx = 0;
  sDie();
}

function updatePlay() {
  const p = player;
  frame++;
  if (frame % 24 === 0) { timeLeft--; if (timeLeft <= 0) { die(); return; } }

  // 入力
  const jump = !!isJump();
  const jumpPressed = jump && !jumpPrev;
  jumpPrev = jump;
  const run = !!isRun();
  const maxV = run ? 2.3 : 1.5;
  const acc = p.onGround ? 0.1 : 0.06;
  const fr = p.onGround ? 0.08 : 0.02;

  if (isRight() && !isLeft()) { p.vx = Math.min(p.vx + acc, maxV); p.dir = 1; }
  else if (isLeft() && !isRight()) { p.vx = Math.max(p.vx - acc, -maxV); p.dir = -1; }
  else {
    if (p.vx > 0) p.vx = Math.max(0, p.vx - fr);
    else if (p.vx < 0) p.vx = Math.min(0, p.vx + fr);
  }
  if (Math.abs(p.vx) > maxV) p.vx += (p.vx > 0 ? -1 : 1) * 0.1;

  if (jumpPressed && p.onGround) {
    p.vy = -4.7 - Math.abs(p.vx) * 0.25;
    p.onGround = false;
    sJump();
  }
  const g = (p.vy < 0 && jump) ? 0.19 : 0.45;
  p.vy = Math.min(p.vy + g, 6);

  moveX(p);
  if (p.x < cam) { p.x = cam; p.vx = Math.max(0, p.vx); }
  moveY(p, bump);

  if (p.onGround && Math.abs(p.vx) > 0.1) p.anim += Math.abs(p.vx) * 0.12;
  else if (p.onGround) p.anim = 0;

  if (p.y > VH + 10) { die(); return; }

  // コイン
  for (const c of coins) {
    if (c.got) continue;
    if (p.x < c.x + 12 && p.x + p.w > c.x + 4 && p.y < c.y + 14 && p.y + p.h > c.y + 2) {
      c.got = true; coinCount++; score += 100; sCoin();
    }
  }

  // 敵
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!e.active) { if (e.x < cam + VW + 16) e.active = true; else continue; }
    if (e.squish) { e.squish--; if (e.squish === 0) e.alive = false; continue; }
    e.vx = e.dir * 0.5;
    e.vy = Math.min(e.vy + 0.35, 6);
    moveX(e);
    if (e.hitWall) e.dir = -e.dir;
    moveY(e);
    if (e.y > VH + 30 || e.x < cam - 64) { e.alive = false; continue; }

    if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
      const prevBottom = p.y + p.h - p.vy;
      if (p.vy > 0 && prevBottom <= e.y + 6) {
        e.squish = 20; score += 100; sStomp();
        p.vy = jump ? -5.2 : -3.4;
      } else {
        die(); return;
      }
    }
  }

  // カメラ（戻りスクロールなし）
  cam = Math.max(cam, Math.min(p.x - 130, COLS * TS - VW));
  cam = Math.max(0, cam);

  // ゴール
  if (p.x + p.w > FLAG_COL * TS + 6) {
    state = 'clear'; clearTimer = 0;
    p.x = FLAG_COL * TS - 4; p.vx = 0; p.vy = 0;
    score += 1000 + Math.max(0, Math.round((12 * TS - p.y) * 5));
    sClear();
  }
}

function updateDead() {
  deadTimer++;
  if (deadTimer > 20) { player.vy += 0.3; player.y += player.vy; }
  if (deadTimer > 130) {
    lives--;
    if (lives <= 0) state = 'over';
    else startRun();
  }
}

function updateClear() {
  clearTimer++;
  const p = player;
  if (flagY < 12 * TS - 12) flagY += 1.5;
  if (p.y < 12 * TS - p.h + 0.5) { p.y = Math.min(p.y + 1.8, 12 * TS - p.h); }
  else if (timeLeft > 0) { timeLeft = Math.max(0, timeLeft - 3); score += 30; }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.life--;
    if (q.kind === 'coin') { q.y += q.vy; q.vy += 0.3; }
    else if (q.kind === 'brick') { q.x += q.vx; q.y += q.vy; q.vy += 0.3; }
    if (q.life <= 0) particles.splice(i, 1);
  }
}

// ===== 描画 =====
function rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

function drawBackground() {
  rect(0, 0, VW, VH, '#5c94fc');
  // 雲（遅く動く）
  for (let i = 0; i < 14; i++) {
    const cx = i * 190 + 40 - cam * 0.3, cy = 30 + (i * 37) % 50;
    const x = ((cx % (14 * 190)) + 14 * 190) % (14 * 190) - 60;
    rect(x + 8, cy, 32, 12, '#fff');
    rect(x, cy + 6, 48, 10, '#fff');
    rect(x + 14, cy - 6, 18, 8, '#fff');
  }
  // 丘
  for (let i = 0; i < 12; i++) {
    const hx = i * 260 + 60 - cam * 0.6;
    const x = ((hx % (12 * 260)) + 12 * 260) % (12 * 260) - 100;
    const base = 13 * TS;
    rect(x, base - 16, 80, 16, '#3fa23a');
    rect(x + 12, base - 30, 56, 14, '#3fa23a');
    rect(x + 26, base - 40, 28, 10, '#3fa23a');
  }
}

function drawTile(t, x, y, c, r) {
  switch (t) {
    case GROUND:
      rect(x, y, TS, TS, '#c8641c');
      if (tileAt(c, r - 1) === EMPTY) rect(x, y, TS, 4, '#4caf34');
      rect(x, y + 7, TS, 1, '#7a3a0c'); rect(x + 8, y + 8, 1, 8, '#7a3a0c'); rect(x + 3, y, 1, 7, '#7a3a0c');
      break;
    case BRICK:
      rect(x, y, TS, TS, '#b84c10');
      rect(x, y + 7, TS, 1, '#400'); rect(x, y + 15, TS, 1, '#400');
      rect(x + 7, y, 1, 7, '#400'); rect(x + 3, y + 8, 1, 7, '#400'); rect(x + 11, y + 8, 1, 7, '#400');
      break;
    case QUESTION: {
      const f = Math.floor(tick / 12) % 4;
      rect(x, y, TS, TS, f === 3 ? '#fcd070' : '#f0a020');
      rect(x, y, TS, 1, '#fff0a0'); rect(x, y, 1, TS, '#fff0a0');
      rect(x, y + 15, TS, 1, '#804000'); rect(x + 15, y, 1, TS, '#804000');
      rect(x + 5, y + 3, 6, 2, '#5a2a00'); rect(x + 9, y + 5, 2, 3, '#5a2a00');
      rect(x + 7, y + 8, 2, 2, '#5a2a00'); rect(x + 7, y + 11, 2, 2, '#5a2a00');
      break;
    }
    case USED:
      rect(x, y, TS, TS, '#8a6a4a');
      rect(x, y, TS, 1, '#b09070'); rect(x, y + 15, TS, 1, '#4a3a2a'); rect(x + 15, y, 1, TS, '#4a3a2a');
      rect(x + 2, y + 2, 2, 2, '#4a3a2a'); rect(x + 12, y + 2, 2, 2, '#4a3a2a');
      rect(x + 2, y + 12, 2, 2, '#4a3a2a'); rect(x + 12, y + 12, 2, 2, '#4a3a2a');
      break;
    case HARD:
      rect(x, y, TS, TS, '#a0a0a0');
      rect(x, y, TS, 1, '#e0e0e0'); rect(x, y, 1, TS, '#e0e0e0');
      rect(x, y + 15, TS, 1, '#505050'); rect(x + 15, y, 1, TS, '#505050');
      rect(x + 3, y + 3, TS - 6, TS - 6, '#8a8a8a');
      break;
    case PIPE: {
      const left = tileAt(c - 1, r) !== PIPE;
      const top = tileAt(c, r - 1) !== PIPE;
      if (top) {
        rect(x - (left ? 0 : 0), y, TS, TS, '#20a020');
        rect(x, y, TS, 2, '#80e080'); rect(x, y + 14, TS, 2, '#106010');
        rect(x + (left ? 0 : 14), y, 2, TS, '#106010');
      } else {
        rect(x, y, TS, TS, '#20a020');
        rect(x + (left ? 2 : 12), y, 2, TS, left ? '#80e080' : '#106010');
      }
      break;
    }
  }
}

function drawLevel() {
  const c0 = Math.floor(cam / TS), c1 = Math.min(COLS - 1, c0 + Math.ceil(VW / TS) + 1);
  for (let r = 0; r < ROWS; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = grid[r][c];
      if (!t) continue;
      let y = r * TS;
      for (const q of particles) if (q.kind === 'bounce' && q.c === c && q.r === r) y -= (q.life > 4 ? 8 - q.life : q.life);
      drawTile(t, Math.round(c * TS - cam), y, c, r);
    }
  }
}

function drawFlag() {
  const x = Math.round(FLAG_COL * TS + 7 - cam);
  if (x < -40 || x > VW + 40) return;
  rect(x, 2 * TS, 2, 11 * TS, '#e8e8e8');
  rect(x - 2, 2 * TS - 4, 6, 6, '#f8d820');
  const fy = Math.round(flagY);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(x - 1, fy); ctx.lineTo(x - 17, fy + 7); ctx.lineTo(x - 1, fy + 14); ctx.fill();
  rect(x - 8, fy + 5, 3, 3, '#e03030');
  // 台座とお城
  rect(x - 7, 12 * TS, 16, TS, '#a0a0a0');
  const cx = Math.round((FLAG_COL + 6) * TS - cam);
  rect(cx, 9 * TS, 64, 4 * TS, '#b86a3a');
  for (let i = 0; i < 4; i++) rect(cx + i * 16, 8 * TS + 8, 8, 8, '#b86a3a');
  rect(cx + 24, 11 * TS, 16, 2 * TS, '#202020');
  rect(cx + 22, 11 * TS - 2, 20, 4, '#202020');
}

function drawCoins() {
  const f = Math.floor(tick / 8) % 4;
  const w = [8, 5, 2, 5][f];
  for (const c of coins) {
    if (c.got) continue;
    const x = Math.round(c.x - cam);
    if (x < -16 || x > VW) continue;
    rect(x + 8 - w / 2, c.y + 2, w, 12, '#f8c820');
    if (w > 4) rect(x + 8 - w / 2 + 1, c.y + 3, 1, 10, '#fff0a0');
  }
}

function drawEnemy(e) {
  const x = Math.round(e.x - cam), y = Math.round(e.y);
  if (x < -20 || x > VW + 20) return;
  if (e.squish) {
    rect(x, y + 10, 14, 4, '#7a3fa0');
    rect(x + 2, y + 11, 3, 1, '#fff'); rect(x + 9, y + 11, 3, 1, '#fff');
    return;
  }
  const step = Math.floor(tick / 8) % 2;
  rect(x + 1, y, 12, 4, '#7a3fa0');
  rect(x, y + 3, 14, 7, '#7a3fa0');
  rect(x + 2, y + 4, 4, 4, '#fff'); rect(x + 8, y + 4, 4, 4, '#fff');
  rect(x + 4, y + 5, 2, 3, '#000'); rect(x + 8, y + 5, 2, 3, '#000');
  rect(x + 2, y + 3, 4, 1, '#300'); rect(x + 8, y + 3, 4, 1, '#300');
  rect(x + (step ? 0 : 2), y + 10, 5, 4, '#e0c090');
  rect(x + (step ? 9 : 7), y + 10, 5, 4, '#e0c090');
}

function drawPlayer() {
  const p = player;
  const x = Math.round(p.x - cam), y = Math.round(p.y);
  const body = '#f08c2a', dark = '#b05a10';
  // 耳
  rect(x, y, 3, 3, body); rect(x + 9, y, 3, 3, body);
  rect(x + 1, y + 1, 1, 1, '#f8b0b0'); rect(x + 10, y + 1, 1, 1, '#f8b0b0');
  // 頭・体
  rect(x, y + 2, 12, 9, body);
  rect(x, y + 9, 12, 2, dark);
  // 目
  const ex = p.dir > 0 ? 5 : 1;
  rect(x + ex, y + 4, 3, 3, '#fff');
  rect(x + ex + (p.dir > 0 ? 1 : 0), y + 5, 2, 2, '#000');
  // しっぽ
  rect(p.dir > 0 ? x - 2 : x + 12, y + 6, 2, 2, dark);
  // 足
  if (!p.onGround) {
    rect(x - 1, y + 11, 4, 3, dark); rect(x + 9, y + 11, 4, 3, dark);
  } else {
    const s = Math.floor(p.anim) % 2;
    rect(x + (s ? 0 : 2), y + 11, 4, 3, dark);
    rect(x + (s ? 8 : 6), y + 11, 4, 3, dark);
  }
}

function drawParticles() {
  for (const q of particles) {
    if (q.kind === 'coin') {
      rect(q.x - cam, q.y, 8, 12, '#f8c820');
    } else if (q.kind === 'brick') {
      rect(q.x - cam, q.y, 6, 6, '#b84c10');
    }
  }
}

function text(str, x, y, size = 12, color = '#fff', align = 'left') {
  ctx.font = `bold ${size}px "Hiragino Sans","Meiryo",sans-serif`;
  ctx.textAlign = align;
  ctx.fillStyle = '#000';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function drawHUD() {
  text('スコア ' + String(score).padStart(6, '0'), 8, 14, 11);
  text('コイン ×' + String(coinCount).padStart(2, '0'), 120, 14, 11);
  text('ステージ 1-1', 205, 14, 11);
  text('のこり ' + Math.max(0, timeLeft), 280, 14, 11);
  text('♥×' + lives, 8, 28, 11, '#ffb0b0');
}

function drawOverlay() {
  if (state === 'title') {
    rect(0, 0, VW, VH, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, VW, VH);
    text('ネコ・ランナー', VW / 2, 90, 28, '#ffd070', 'center');
    text('Space / タップ でスタート', VW / 2, 140, 14, '#fff', 'center');
    text('ゴールの旗をめざせ！', VW / 2, 165, 12, '#cfe', 'center');
  } else if (state === 'over') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    text('ゲームオーバー', VW / 2, 110, 24, '#ff8080', 'center');
    text('スコア ' + score, VW / 2, 138, 14, '#fff', 'center');
    text('Space / タップ でリトライ', VW / 2, 165, 12, '#fff', 'center');
  } else if (state === 'clear' && clearTimer > 60) {
    text('ステージクリア！', VW / 2, 90, 24, '#ffe070', 'center');
    text('スコア ' + score, VW / 2, 118, 14, '#fff', 'center');
    if (clearTimer > 200) text('Space / タップ でタイトルへ', VW / 2, 145, 12, '#fff', 'center');
  }
}

function draw() {
  drawBackground();
  drawLevel();
  drawFlag();
  drawCoins();
  for (const e of enemies) if (e.alive && e.active) drawEnemy(e);
  drawParticles();
  if (state !== 'title') drawPlayer();
  drawHUD();
  drawOverlay();
}

// ===== メインループ（60fps固定） =====
function update() {
  tick++;
  if (state === 'play') updatePlay();
  else if (state === 'dead') updateDead();
  else if (state === 'clear') updateClear();
  if (state !== 'title') updateParticles();
}

let last = performance.now(), acc = 0;
function loop(now) {
  acc += Math.min(100, now - last);
  last = now;
  while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
  draw();
  requestAnimationFrame(loop);
}

// タイトル画面用にステージを用意
buildLevel();
player = { x: 40, y: 12 * TS - 14, w: 12, h: 14, vx: 0, vy: 0, onGround: true, dir: 1, anim: 0 };
cam = 0; score = 0; coinCount = 0; lives = 3; timeLeft = 300; flagY = 3 * TS; tick = 0; frame = 0;
requestAnimationFrame(loop);
})();
