(() => {
'use strict';

// ===== 定数 =====
const TS = 16, VW = 320, VH = 240, ROWS = 15;
const { EMPTY, GROUND, BRICK, QUESTION, USED, HARD, PIPE } = TILE;
const SMALL_H = 14, BIG_H = 24;
const STAR_FRAMES = 600;

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
  if (e.code === 'KeyM') setMuted(!muted);
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

// ===== ドット絵 =====
// K=体(青) W=おなか O=くちばし・あし D=ひとみ
const HEAD = [
  '......KKKKK.....',
  '.....KKKKKKK....',
  '....KKKKKKKKK...',
  '....KKWWKWWKK...',
  '....KKWDKWDKOO..',
  '....KKKKKKKOOO..'
];
const B6 = '...KKKWWWWKKK...', B7 = '..KKKWWWWWWKK...', B8 = '..KKKWWWWWWKKK..';
const B10 = '...KKWWWWWWKK...', B11 = '....KWWWWWWK....', B12 = '.....KKKKKK.....';
const FEET = {
  stand: ['....OOO..OOO....', '...OOOO..OOOO...'],
  walkA: ['...OOO....OOO...', '..OOOO....OOOO..'],
  walkB: ['....OOO..OOO....', '....OOOO.OOOO...'],
  jump:  ['..OOO......OOO..', '..OO........OO..']
};
function makePenguin(big, feet) {
  const rows = HEAD.slice();
  if (big) {
    rows.push(B6, B7);
    for (let i = 0; i < 11; i++) rows.push(B8);
    rows.push(B10, B11, B12);
  } else {
    rows.push(B6, B7, B8, B8, B10, B11, B12);
  }
  return rows.concat(FEET[feet]);
}
const PENGUIN = {};
for (const big of [false, true]) for (const f of Object.keys(FEET)) PENGUIN[(big ? 'big_' : 'small_') + f] = makePenguin(big, f);

const MUSH = [
  '....CCCCCC....',
  '..CCCCCCCCCC..',
  '.CCWWCCCCWWCC.',
  '.CCWWCCCCWWCC.',
  'CCCCCWWWWCCCCC',
  'CCCCCWWWWCCCCC',
  '.DDDDDDDDDDDD.',
  '..SSSSSSSSSS..',
  '..SSKSSSSKSS..',
  '..SSKSSSSKSS..',
  '..SSSSSSSSSS..',
  '...SSSSSSSS...',
  '...SSSSSSSS...',
  '....SSSSSS....'
];
const STAR = [
  '......YY......',
  '......YY......',
  '.....YYYY.....',
  'YYYYYYYYYYYYYY',
  '.YYYYYYYYYYYY.',
  '..YYYKYYKYYY..',
  '...YYYYYYYY...',
  '...YYYYYYYY...',
  '..YYYYYYYYYY..',
  '..YYYY..YYYY..',
  '.YYYY....YYYY.',
  '.YYY......YYY.',
  'YYY........YYY',
  'YY..........YY'
];

function drawSprite(rows, x, y, pal, flip) {
  const w = rows[0].length;
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < w; i++) {
      const ch = row[i];
      if (ch === '.') continue;
      ctx.fillStyle = pal[ch];
      ctx.fillRect(x + (flip ? w - 1 - i : i), y + j, 1, 1);
    }
  }
}

// ===== ステージ =====
let COLS = 160, FLAG_COL = 148;
let stageIdx = 0, stage = STAGES[0], contents = {};
let grid, enemies, coins, items, particles;

function buildLevel() {
  stage = STAGES[stageIdx];
  COLS = stage.cols; FLAG_COL = stage.flagCol;
  grid = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Uint8Array(COLS));
  const set = (c, r, t) => { if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r][c] = t; };
  const data = stage.build(set);
  contents = data.contents || {};
  enemies = data.enemies.map(c => ({
    x: c * TS, y: 12 * TS - 2, w: 14, h: 14, dir: -1, vx: 0, vy: 0,
    alive: true, squish: 0, active: false, flying: false
  }));
  coins = [];
  for (const [c, r, n] of data.coins) for (let i = 0; i < n; i++) coins.push({ x: (c + i) * TS, y: r * TS, got: false });
  items = [];
  particles = [];
}

// ===== ゲーム状態 =====
let state = 'title';
let player, cam, score, coinCount, lives, timeLeft, frame, deadTimer, clearTimer, flagY, tick;

function newPlayer() {
  return { x: stage.startX, y: 12 * TS - SMALL_H, w: 12, h: SMALL_H, vx: 0, vy: 0,
           onGround: false, dir: 1, anim: 0, big: false, star: 0, inv: 0, freeze: 0 };
}
function newGame() {
  score = 0; coinCount = 0; lives = 3; stageIdx = 0;
  startRun();
}
function startRun() {
  buildLevel();
  player = newPlayer();
  cam = 0; timeLeft = stage.time; frame = 0; tick = 0; flagY = 3 * TS; clearTimer = 0;
  state = 'play';
  Music.play('main');
}
function hasNextStage() { return stageIdx + 1 < STAGES.length; }
function pressStart() {
  if (state === 'title' || state === 'over') newGame();
  else if (state === 'clear' && clearTimer > 200) {
    if (hasNextStage()) { stageIdx++; startRun(); }
    else { stageIdx = 0; buildLevel(); player = newPlayer(); cam = 0; state = 'title'; }
  }
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
    const content = contents[c + ',' + r];
    if (content === 'mushroom' || content === 'star') {
      items.push({ type: content, x: c * TS + 1, y: r * TS + 2, w: 14, h: 14, vx: 0, vy: 0, dir: 1, emerge: 16 });
      sAppear();
    } else {
      coinCount++; score += 200; sCoin();
      particles.push({ kind: 'coin', x: c * TS + 4, y: r * TS - 8, vy: -4, life: 30 });
    }
    particles.push({ kind: 'bounce', c, r, life: 8 });
    killEnemiesOn(c, r);
  } else if (t === BRICK) {
    if (player.big) {
      grid[r][c] = EMPTY;
      score += 50; sBreak();
      for (const [dx, dy] of [[-1.2, -3.5], [1.2, -3.5], [-0.8, -2], [0.8, -2]]) {
        particles.push({ kind: 'brick', x: c * TS + 4, y: r * TS + 4, vx: dx, vy: dy, life: 50 });
      }
    } else {
      sBump();
      particles.push({ kind: 'bounce', c, r, life: 8 });
    }
    killEnemiesOn(c, r);
  } else {
    sBump();
  }
}
function killEnemiesOn(c, r) {
  for (const e of enemies) {
    if (!e.alive || e.squish || e.flying) continue;
    if (e.x + e.w > c * TS && e.x < (c + 1) * TS && Math.abs((e.y + e.h) - r * TS) < 3) {
      e.flying = true; e.vy = -3; e.vx = 0.6; score += 100;
    }
  }
}

// ===== プレイヤー状態 =====
function die() {
  if (state !== 'play') return;
  const p = player;
  if (p.big) { p.big = false; p.h = SMALL_H; p.y += BIG_H - SMALL_H; }
  p.star = 0;
  state = 'dead'; deadTimer = 0;
  p.vy = -5; p.vx = 0;
  Music.play(null);
  sDie();
}
function hurt() {
  const p = player;
  if (p.inv > 0) return;
  if (p.big) {
    p.big = false; p.h = SMALL_H; p.y += BIG_H - SMALL_H;
    p.freeze = 30; p.inv = 120;
    sShrink();
  } else {
    die();
  }
}
function growUp() {
  const p = player;
  p.big = true; p.h = BIG_H; p.y -= BIG_H - SMALL_H;
  p.freeze = 40;
}

// ===== 更新 =====
function updatePlay() {
  const p = player;
  if (p.freeze > 0) { p.freeze--; return; }
  frame++;
  if (frame % 24 === 0) { timeLeft--; if (timeLeft <= 0) { die(); return; } }
  if (p.inv > 0) p.inv--;
  if (p.star > 0) { p.star--; if (p.star === 0) Music.play('main'); }

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

  // アイテム
  for (const it of items) {
    if (it.gone) continue;
    if (it.emerge > 0) { it.emerge--; it.y -= 1; continue; }
    it.vx = it.dir * (it.type === 'star' ? 1.0 : 0.7);
    it.vy = Math.min(it.vy + 0.3, 5);
    moveX(it);
    if (it.hitWall) it.dir = -it.dir;
    moveY(it);
    if (it.type === 'star' && it.onGround) it.vy = -4;
    if (it.y > VH + 30 || it.x < cam - 64) { it.gone = true; continue; }
    if (p.x < it.x + it.w && p.x + p.w > it.x && p.y < it.y + it.h && p.y + p.h > it.y) {
      it.gone = true;
      score += 1000;
      if (it.type === 'mushroom') {
        if (!p.big) growUp();
        sPower();
      } else {
        p.star = STAR_FRAMES;
        Music.play('star');
        sPower();
      }
    }
  }
  items = items.filter(it => !it.gone);
  if (p.freeze > 0) return;

  // 敵
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!e.active) { if (e.x < cam + VW + 16) e.active = true; else continue; }
    if (e.flying) {
      e.vy += 0.35; e.y += e.vy; e.x += e.vx;
      if (e.y > VH + 30) e.alive = false;
      continue;
    }
    if (e.squish) { e.squish--; if (e.squish === 0) e.alive = false; continue; }
    e.vx = e.dir * 0.5;
    e.vy = Math.min(e.vy + 0.35, 6);
    moveX(e);
    if (e.hitWall) e.dir = -e.dir;
    moveY(e);
    if (e.y > VH + 30 || e.x < cam - 64) { e.alive = false; continue; }

    if (p.x < e.x + e.w && p.x + p.w > e.x && p.y < e.y + e.h && p.y + p.h > e.y) {
      if (p.star > 0) {
        e.flying = true; e.vy = -3.5; e.vx = p.dir * 1.2;
        score += 200; sStomp();
        continue;
      }
      const prevBottom = p.y + p.h - p.vy;
      if (p.vy > 0 && prevBottom <= e.y + 6) {
        e.squish = 20; score += 100; sStomp();
        p.vy = jump ? -5.2 : -3.4;
      } else {
        hurt();
        if (state !== 'play') return;
        if (p.freeze > 0) return;
      }
    }
  }

  // カメラ（戻りスクロールなし）
  cam = Math.max(cam, Math.min(p.x - 130, COLS * TS - VW));
  cam = Math.max(0, cam);

  // ゴール
  if (p.x + p.w > FLAG_COL * TS + 6) {
    state = 'clear'; clearTimer = 0;
    p.x = FLAG_COL * TS - 4; p.vx = 0; p.vy = 0; p.star = 0; p.inv = 0;
    score += 1000 + Math.max(0, Math.round((12 * TS - p.y) * 5));
    Music.play('clear');
  }
}

function updateDead() {
  deadTimer++;
  if (deadTimer > 20) { player.vy += 0.3; player.y += player.vy; }
  if (deadTimer > 130) {
    lives--;
    if (lives <= 0) { state = 'over'; Music.play('over'); }
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
  for (let i = 0; i < 14; i++) {
    const cx = i * 190 + 40 - cam * 0.3, cy = 30 + (i * 37) % 50;
    const x = ((cx % (14 * 190)) + 14 * 190) % (14 * 190) - 60;
    rect(x + 8, cy, 32, 12, '#fff');
    rect(x, cy + 6, 48, 10, '#fff');
    rect(x + 14, cy - 6, 18, 8, '#fff');
  }
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
        rect(x, y, TS, TS, '#20a020');
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
  if (x < -90 || x > VW + 40) return;
  rect(x, 2 * TS, 2, 11 * TS, '#e8e8e8');
  rect(x - 2, 2 * TS - 4, 6, 6, '#f8d820');
  const fy = Math.round(flagY);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(x - 1, fy); ctx.lineTo(x - 17, fy + 7); ctx.lineTo(x - 1, fy + 14); ctx.fill();
  rect(x - 8, fy + 5, 3, 3, '#e03030');
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

function drawItems() {
  const starCols = ['#ffe040', '#ff9030', '#ffffa0', '#ffc020'];
  for (const it of items) {
    const x = Math.round(it.x - cam), y = Math.round(it.y);
    if (x < -20 || x > VW + 20) continue;
    if (it.type === 'mushroom') {
      drawSprite(MUSH, x, y, { C: '#4aa8ff', W: '#ffffff', D: '#2a6ac0', S: '#f4e4c0', K: '#000000' }, false);
    } else {
      const col = starCols[Math.floor(tick / 4) % 4];
      drawSprite(STAR, x, y, { Y: col, K: '#000000' }, false);
    }
  }
}

function drawEnemy(e) {
  const x = Math.round(e.x - cam), y = Math.round(e.y);
  if (x < -20 || x > VW + 20) return;
  if (e.flying) { ctx.save(); ctx.translate(0, 2 * y + 14); ctx.scale(1, -1); }
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
  if (e.flying) ctx.restore();
}

function drawPlayer() {
  const p = player;
  if (p.inv > 0 && Math.floor(tick / 3) % 2 === 0) return;   // ダメージ後の点滅
  let big = p.big;
  if (p.freeze > 0 && Math.floor(tick / 4) % 2 === 0) big = !big;   // 変身中の点滅
  let feet = 'stand';
  if (state === 'dead') feet = 'jump';
  else if (!p.onGround) feet = 'jump';
  else if (Math.abs(p.vx) > 0.1) feet = Math.floor(p.anim) % 2 ? 'walkA' : 'walkB';
  const rows = PENGUIN[(big ? 'big_' : 'small_') + feet];
  const sx = Math.round(p.x - cam + p.w / 2 - 8);
  const sy = Math.round(p.y + p.h - rows.length);
  const starCols = ['#ff5a5a', '#ffd23c', '#4ede6a', '#58a8ff'];
  const body = p.star > 0 && (p.star > 120 || Math.floor(tick / 3) % 2 === 0)
    ? starCols[Math.floor(tick / 3) % 4] : '#2a3f7a';
  drawSprite(rows, sx, sy, { K: body, W: '#ffffff', O: '#ff9a1f', D: '#10182e' }, p.dir < 0);
}

function drawParticles() {
  for (const q of particles) {
    if (q.kind === 'coin') rect(q.x - cam, q.y, 8, 12, '#f8c820');
    else if (q.kind === 'brick') rect(q.x - cam, q.y, 6, 6, '#b84c10');
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
  text('ステージ ' + stage.name, 205, 14, 11);
  text('のこり ' + Math.max(0, timeLeft), 280, 14, 11);
  text('♥×' + lives, 8, 28, 11, '#ffb0b0');
  if (player && player.star > 0) text('★ ' + Math.ceil(player.star / 60), 60, 28, 11, '#ffe070');
}

function drawOverlay() {
  if (state === 'title') {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, VW, VH);
    text('ペンギン・ランナー', VW / 2, 90, 26, '#ffd070', 'center');
    text('Space / タップ でスタート', VW / 2, 140, 14, '#fff', 'center');
    text('ゴールの旗をめざせ！　Mキーで音のオン/オフ', VW / 2, 165, 11, '#cfe', 'center');
  } else if (state === 'over') {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    text('ゲームオーバー', VW / 2, 110, 24, '#ff8080', 'center');
    text('スコア ' + score, VW / 2, 138, 14, '#fff', 'center');
    text('Space / タップ でリトライ', VW / 2, 165, 12, '#fff', 'center');
  } else if (state === 'clear' && clearTimer > 60) {
    const last = !hasNextStage();
    text(last ? 'ゲームクリア！' : 'ステージクリア！', VW / 2, 90, 24, '#ffe070', 'center');
    if (last) text('おめでとう！　ステージは今後追加予定', VW / 2, 112, 11, '#cfe', 'center');
    text('スコア ' + score, VW / 2, 135, 14, '#fff', 'center');
    if (clearTimer > 200) text(last ? 'Space / タップ でタイトルへ' : 'Space / タップ でつぎへ', VW / 2, 160, 12, '#fff', 'center');
  }
}

function draw() {
  drawBackground();
  drawItems();
  drawLevel();
  drawFlag();
  drawCoins();
  for (const e of enemies) if (e.alive && e.active) drawEnemy(e);
  drawParticles();
  drawPlayer();
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

// タイトル画面用の初期化
buildLevel();
player = newPlayer();
cam = 0; score = 0; coinCount = 0; lives = 3; timeLeft = stage.time; flagY = 3 * TS; tick = 0; frame = 0;
requestAnimationFrame(loop);
})();
