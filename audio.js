// 効果音とBGM（Web Audio。外部の音声ファイルは使わない）
let actx = null, master = null, muted = false;
try { muted = localStorage.getItem('muted') === '1'; } catch (e) { /* 無視 */ }

function initAudio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 1;
  try { localStorage.setItem('muted', m ? '1' : '0'); } catch (e) { /* 無視 */ }
  const b = document.getElementById('mute');
  if (b) b.textContent = m ? '🔇' : '🔊';
}

// ---- 効果音 ----
function beep(f1, f2, dur, type = 'square', vol = 0.06) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.linearRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}
const sJump   = () => beep(300, 700, 0.18);
const sCoin   = () => { beep(988, 988, 0.07); setTimeout(() => beep(1319, 1319, 0.2), 70); };
const sStomp  = () => beep(400, 120, 0.12);
const sBump   = () => beep(120, 90, 0.08, 'triangle', 0.1);
const sBreak  = () => beep(200, 60, 0.15, 'sawtooth', 0.05);
const sDie    = () => beep(500, 80, 0.7, 'square', 0.07);
const sAppear = () => beep(250, 600, 0.3, 'triangle', 0.1);
const sPower  = () => { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => beep(f, f, 0.09), i * 60)); };
const sShrink = () => beep(700, 150, 0.35, 'square', 0.06);

// ---- BGM ----
const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(n) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(n);
  if (!m) throw new Error('bad note: ' + n);
  return 12 * (parseInt(m[3], 10) + 1) + NOTE_BASE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
// 1トークン = 8分音符1つ。"-" は前の音を伸ばす、"." は休符
function parseTrack(str) {
  const toks = str.trim().split(/\s+/);
  const by = new Array(toks.length).fill(null);
  let last = null;
  toks.forEach((t, i) => {
    if (t === '-') { if (last && last.step + last.len === i) last.len++; }
    else if (t === '.') { last = null; }
    else { last = { step: i, midi: noteToMidi(t), len: 1 }; by[i] = last; }
  });
  return { by, n: toks.length };
}
function makeSong(o) {
  const lead = parseTrack(o.lead);
  const bass = o.bass ? parseTrack(o.bass) : null;
  return { tempo: o.tempo, loop: !!o.loop, drums: !!o.drums, leadType: o.leadType || 'square',
           leadVol: o.leadVol || 0.04, lead, bass, steps: lead.n };
}

const MAIN_LEAD = [
  'E5 G5 C6 - G5 E5 G5 -',   'A5 C6 E6 - C6 A5 C6 -',
  'F5 A5 C6 - A5 F5 A5 C6',  'D5 G5 B5 - G5 B5 D6 -',
  'E5 G5 C6 - E6 D6 C6 G5',  'G5 B5 E6 - D6 B5 G5 -',
  'A5 C6 F6 E6 D6 C6 A5 F5', 'G5 B5 D6 B5 C6 - - .',
  'C6 - E6 C6 G5 - C6 -',    'A5 - C6 A5 E5 - A5 -',
  'F5 A5 C6 F6 C6 A5 F5 -',  'G5 - B5 D6 G6 D6 B5 G5',
  'E6 - E6 D6 C6 - G5 -',    'E6 - G6 E6 B5 - G5 -',
  'F6 E6 D6 C6 B5 A5 G5 B5', 'G5 B5 D6 B5 G5 B5 D6 -'
].join(' ');
const CHORDS = { C: ['C3', 'G3'], Am: ['A2', 'E3'], F: ['F2', 'C3'], G: ['G2', 'D3'], Em: ['E2', 'B2'] };
const bassBar = ch => { const [r, f] = CHORDS[ch]; return [r, r, f, r, r, r, f, r].join(' '); };
const MAIN_PROG = ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G', 'C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G'];

const SONGS = {
  main: makeSong({ tempo: 150, loop: true, drums: true, lead: MAIN_LEAD, bass: MAIN_PROG.map(bassBar).join(' ') }),
  star: makeSong({
    tempo: 200, loop: true, drums: true, leadVol: 0.045,
    lead: ['C6 E6 G6 E6 C6 E6 G6 E6', 'F6 A6 C7 A6 F6 A6 C7 A6', 'G6 B6 D7 B6 G6 B6 D7 B6', 'C7 G6 E6 G6 C7 - . .'].join(' '),
    bass: ['C',  'F', 'G', 'C'].map(ch => { const r = CHORDS[ch][0]; return Array(8).fill(r).join(' '); }).join(' ')
  }),
  clear: makeSong({
    tempo: 170, loop: false,
    lead: 'C5 E5 G5 C6 E6 - C6 E6 G6 - - - - - . .',
    bass: 'C3 . C3 . G2 . G2 . C3 - - - - - . .'
  }),
  over: makeSong({ tempo: 90, loop: false, leadType: 'triangle', leadVol: 0.1, lead: 'G4 - E4 - D4 - C4 - - - . . . . . .' })
};

let noiseBuf = null;
function getNoise() {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.1), actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function tone(freq, t, len, type, vol) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.03, len));
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + Math.max(0.03, len) + 0.02);
}
const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12);

const Music = {
  cur: null, name: null, step: 0, next: 0,
  play(name) {
    if (name === this.name) return;
    this.name = name; this.cur = name ? SONGS[name] : null; this.step = 0; this.next = 0;
  },
  tick() {
    if (!actx || !this.cur) return;
    const now = actx.currentTime;
    if (this.next < now) this.next = now + 0.05;
    const s = this.cur, dur = 60 / s.tempo / 2;
    while (this.cur && this.next < now + 0.2) {
      this.sched(s, this.step, this.next, dur);
      this.next += dur;
      this.step++;
      if (this.step >= s.steps) {
        if (s.loop) this.step = 0;
        else { this.cur = null; this.name = null; }
      }
    }
  },
  sched(s, step, t, dur) {
    const l = s.lead.by[step];
    if (l) tone(midiFreq(l.midi), t, l.len * dur * 0.95, s.leadType, s.leadVol);
    if (s.bass) {
      const b = s.bass.by[step];
      if (b) tone(midiFreq(b.midi), t, b.len * dur * 0.85, 'triangle', 0.1);
    }
    if (s.drums) {
      if (step % 2 === 1) {
        const src = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter();
        src.buffer = getNoise(); f.type = 'highpass'; f.frequency.value = 6000;
        g.gain.setValueAtTime(0.04, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.04);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t); src.stop(t + 0.05);
      }
      if (step % 4 === 0) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(160, t); o.frequency.linearRampToValueAtTime(45, t + 0.09);
        g.gain.setValueAtTime(0.14, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.11);
      }
    }
  }
};
setInterval(() => Music.tick(), 50);

document.addEventListener('visibilitychange', () => {
  if (!actx) return;
  if (document.hidden) actx.suspend(); else actx.resume();
});

// ミュートボタン
const muteBtn = document.getElementById('mute');
if (muteBtn) {
  muteBtn.addEventListener('click', () => { initAudio(); setMuted(!muted); muteBtn.blur(); });
  muteBtn.addEventListener('pointerdown', e => e.stopPropagation());
}
setMuted(muted);
