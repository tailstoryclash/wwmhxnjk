// All sound is synthesised with the Web Audio API: weapon and creature effects,
// UI blips, and a generative score that thickens when a fight breaks out.

import { clamp } from './utils.js';

const SOUNDS = {
  pistol(a, d) {
    a.tone(d, { type: 'square', f0: 900, f1: 180, dur: 0.09, vol: 0.2 });
    a.noise(d, { dur: 0.07, vol: 0.3, type: 'bandpass', f0: 2200, f1: 800, q: 0.8 });
    a.tone(d, { f0: 160, f1: 60, dur: 0.1, vol: 0.3 });
  },
  rifle(a, d) {
    a.noise(d, { dur: 0.06, vol: 0.32, type: 'highpass', f0: 900 });
    a.tone(d, { type: 'sawtooth', f0: 320, f1: 90, dur: 0.08, vol: 0.18 });
    a.tone(d, { f0: 140, f1: 50, dur: 0.07, vol: 0.28 });
  },
  shotgun(a, d) {
    a.noise(d, { dur: 0.3, vol: 0.55, type: 'lowpass', f0: 3200, f1: 250 });
    a.tone(d, { f0: 130, f1: 38, dur: 0.24, vol: 0.5 });
    a.noise(d, { dur: 0.05, vol: 0.3, type: 'highpass', f0: 3000 });
  },
  rail(a, d) {
    a.tone(d, { type: 'sawtooth', f0: 180, f1: 2600, dur: 0.1, vol: 0.2 });
    a.tone(d, { f0: 95, f1: 28, dur: 0.6, vol: 0.5 });
    a.noise(d, { dur: 0.5, vol: 0.25, type: 'bandpass', f0: 5000, f1: 700, q: 2 });
    a.tone(d, { type: 'square', f0: 1400, f1: 300, dur: 0.35, vol: 0.08 });
  },
  dry(a, d) { a.noise(d, { dur: 0.03, vol: 0.2, type: 'bandpass', f0: 3200, q: 3 }); },
  reload(a, d) {
    a.noise(d, { dur: 0.04, vol: 0.2, type: 'bandpass', f0: 2600, q: 4 });
    a.noise(d, { dur: 0.05, vol: 0.24, type: 'bandpass', f0: 1500, q: 3, when: 0.22 });
  },
  reloadEnd(a, d) {
    a.noise(d, { dur: 0.05, vol: 0.28, type: 'bandpass', f0: 2000, q: 3 });
    a.tone(d, { type: 'square', f0: 240, f1: 420, dur: 0.06, vol: 0.08, when: 0.03 });
  },
  swap(a, d) { a.noise(d, { dur: 0.08, vol: 0.14, type: 'bandpass', f0: 900, f1: 2400, q: 2 }); },
  hit(a, d) { a.tone(d, { type: 'square', f0: 1500, dur: 0.035, vol: 0.08 }); },
  crit(a, d) {
    a.tone(d, { type: 'square', f0: 2100, dur: 0.05, vol: 0.1 });
    a.tone(d, { type: 'square', f0: 2800, dur: 0.05, vol: 0.07, when: 0.03 });
  },
  kill(a, d) { a.tone(d, { type: 'triangle', f0: 700, f1: 1500, dur: 0.14, vol: 0.2 }); },
  clank(a, d) { a.tone(d, { type: 'triangle', f0: 1900, f1: 1400, dur: 0.08, vol: 0.12 }); a.noise(d, { dur: 0.04, vol: 0.1, type: 'bandpass', f0: 5200, q: 4 }); },
  bolt(a, d) {
    a.tone(d, { type: 'square', f0: 620, f1: 190, dur: 0.14, vol: 0.2 });
    a.noise(d, { dur: 0.08, vol: 0.1, type: 'highpass', f0: 2500 });
  },
  rocket(a, d) {
    a.noise(d, { dur: 0.5, vol: 0.4, type: 'bandpass', f0: 300, f1: 1400, q: 1 });
    a.tone(d, { type: 'sawtooth', f0: 90, f1: 220, dur: 0.4, vol: 0.2 });
  },
  explosion(a, d) {
    a.noise(d, { dur: 1.0, vol: 0.9, type: 'lowpass', f0: 2400, f1: 70 });
    a.tone(d, { f0: 100, f1: 24, dur: 0.7, vol: 0.8 });
    a.noise(d, { dur: 0.12, vol: 0.5, type: 'highpass', f0: 1800 });
  },
  hurt(a, d) {
    a.tone(d, { f0: 190, f1: 60, dur: 0.16, vol: 0.5 });
    a.noise(d, { dur: 0.1, vol: 0.3, type: 'lowpass', f0: 900 });
  },
  shieldHit(a, d) {
    a.tone(d, { type: 'triangle', f0: 880, f1: 330, dur: 0.14, vol: 0.28 });
    a.noise(d, { dur: 0.08, vol: 0.14, type: 'bandpass', f0: 4200, q: 3 });
  },
  shieldBreak(a, d) {
    a.tone(d, { type: 'sawtooth', f0: 1300, f1: 90, dur: 0.45, vol: 0.28 });
    a.noise(d, { dur: 0.35, vol: 0.3, type: 'bandpass', f0: 3000, f1: 400, q: 1 });
  },
  shieldUp(a, d) { a.tone(d, { f0: 320, f1: 960, dur: 0.5, vol: 0.12 }); },
  pickup(a, d) { [660, 880, 1320].forEach((f, i) => a.tone(d, { type: 'triangle', f0: f, dur: 0.1, vol: 0.18, when: i * 0.055 })); },
  weapon(a, d) { [330, 495, 660, 990].forEach((f, i) => a.tone(d, { type: 'square', f0: f, dur: 0.12, vol: 0.1, when: i * 0.06 })); },
  log(a, d) { [1320, 990, 1485].forEach((f, i) => a.tone(d, { f0: f, dur: 0.22, vol: 0.16, when: i * 0.09 })); },
  door(a, d) {
    a.noise(d, { dur: 0.5, vol: 0.2, type: 'bandpass', f0: 300, f1: 1100, q: 2 });
    a.tone(d, { type: 'sawtooth', f0: 70, f1: 110, dur: 0.45, vol: 0.1 });
  },
  doorClose(a, d) {
    a.noise(d, { dur: 0.45, vol: 0.18, type: 'bandpass', f0: 1000, f1: 280, q: 2 });
    a.tone(d, { f0: 90, f1: 50, dur: 0.12, vol: 0.3, when: 0.4 });
  },
  denied(a, d) {
    a.tone(d, { type: 'square', f0: 180, dur: 0.12, vol: 0.14 });
    a.tone(d, { type: 'square', f0: 140, dur: 0.16, vol: 0.14, when: 0.14 });
  },
  terminal(a, d) {
    [1200, 1600, 2000].forEach((f, i) => a.tone(d, { type: 'square', f0: f, dur: 0.06, vol: 0.09, when: i * 0.07 }));
    a.tone(d, { f0: 200, f1: 800, dur: 0.6, vol: 0.14, when: 0.2 });
  },
  power(a, d) {
    a.tone(d, { type: 'sawtooth', f0: 40, f1: 220, dur: 1.6, vol: 0.3, attack: 0.3 });
    a.noise(d, { dur: 1.5, vol: 0.2, type: 'lowpass', f0: 200, f1: 3000, attack: 0.3 });
  },
  click(a, d) { a.tone(d, { type: 'triangle', f0: 880, f1: 1320, dur: 0.06, vol: 0.14 }); },
  hover(a, d) { a.tone(d, { f0: 1700, dur: 0.025, vol: 0.05 }); },
  warp(a, d) {
    a.tone(d, { f0: 180, f1: 1500, dur: 0.4, vol: 0.2 });
    a.noise(d, { dur: 0.35, vol: 0.14, type: 'highpass', f0: 3000 });
  },
  die(a, d) {
    a.noise(d, { dur: 0.35, vol: 0.4, type: 'bandpass', f0: 900, f1: 200, q: 1 });
    a.tone(d, { type: 'sawtooth', f0: 420, f1: 50, dur: 0.3, vol: 0.2 });
  },
  screech(a, d) {
    a.tone(d, { type: 'sawtooth', f0: 220, f1: 760, dur: 0.18, vol: 0.16 });
    a.noise(d, { dur: 0.15, vol: 0.1, type: 'bandpass', f0: 3000, q: 4 });
  },
  charge(a, d) { a.tone(d, { type: 'sawtooth', f0: 120, f1: 640, dur: 0.8, vol: 0.16, attack: 0.1 }); },
  slam(a, d) {
    a.tone(d, { f0: 80, f1: 26, dur: 0.6, vol: 0.9 });
    a.noise(d, { dur: 0.5, vol: 0.6, type: 'lowpass', f0: 700, f1: 80 });
  },
  step(a, d) {
    a.noise(d, { dur: 0.05, vol: 0.08, type: 'lowpass', f0: 520 });
    a.tone(d, { f0: 95, f1: 60, dur: 0.05, vol: 0.08 });
  },
  splash(a, d) { a.noise(d, { dur: 0.16, vol: 0.1, type: 'bandpass', f0: 1800, f1: 700, q: 0.8 }); },
  jump(a, d) { a.noise(d, { dur: 0.08, vol: 0.07, type: 'bandpass', f0: 500, f1: 1100, q: 1 }); },
  land(a, d) {
    a.tone(d, { f0: 110, f1: 50, dur: 0.1, vol: 0.28 });
    a.noise(d, { dur: 0.07, vol: 0.12, type: 'lowpass', f0: 600 });
  },
  blip(a, d) { a.tone(d, { type: 'square', f0: 520 + Math.random() * 140, dur: 0.02, vol: 0.028 }); },
  objective(a, d) {
    a.tone(d, { f0: 880, dur: 0.3, vol: 0.13 });
    a.tone(d, { f0: 1320, dur: 0.4, vol: 0.11, when: 0.12 });
  },
  checkpoint(a, d) {
    a.tone(d, { f0: 660, dur: 0.25, vol: 0.1 });
    a.tone(d, { f0: 990, dur: 0.35, vol: 0.1, when: 0.14 });
  },
  heartbeat(a, d) {
    a.tone(d, { f0: 62, f1: 44, dur: 0.14, vol: 0.5 });
    a.tone(d, { f0: 58, f1: 40, dur: 0.16, vol: 0.4, when: 0.2 });
  },
  roar(a, d) {
    a.tone(d, { type: 'sawtooth', f0: 70, f1: 38, dur: 1.8, vol: 0.5, attack: 0.1 });
    a.tone(d, { type: 'square', f0: 105, f1: 52, dur: 1.6, vol: 0.2, attack: 0.1 });
    a.noise(d, { dur: 1.6, vol: 0.4, type: 'lowpass', f0: 900, f1: 120, attack: 0.1 });
  },
  beam(a, d) {
    a.tone(d, { type: 'sawtooth', f0: 110, f1: 132, dur: 2.6, vol: 0.28, attack: 0.1 });
    a.tone(d, { type: 'square', f0: 221, f1: 262, dur: 2.6, vol: 0.1, attack: 0.1 });
    a.noise(d, { dur: 2.6, vol: 0.16, type: 'bandpass', f0: 2400, q: 6, attack: 0.1 });
  },
  alarm(a, d) {
    for (let i = 0; i < 2; i++) {
      a.tone(d, { type: 'square', f0: 620, dur: 0.16, vol: 0.08, when: i * 0.4 });
      a.tone(d, { type: 'square', f0: 470, dur: 0.16, vol: 0.08, when: i * 0.4 + 0.18 });
    }
  },
  ending(a, d) { [220, 277, 330, 440, 554].forEach((f, i) => a.tone(d, { f0: f, dur: 4, vol: 0.12, when: i * 0.35, attack: 0.5 })); },
};

const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
const PENTA = [0, 3, 5, 7, 10, 12, 15];

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this.intensity = 0;
    this.targetIntensity = 0;
    this.m = null;
    this.pendingMusic = null;
  }

  // Must be called from a user gesture; browsers keep audio suspended until then.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);

    // A synthetic impulse response gives everything the station's hollow ring.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.6, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet);
    wet.connect(this.master);
    const sfxSend = ctx.createGain();
    sfxSend.gain.value = 0.2;
    this.sfx.connect(sfxSend);
    sfxSend.connect(this.reverb);
    const musicSend = ctx.createGain();
    musicSend.gain.value = 0.7;
    this.music.connect(musicSend);
    musicSend.connect(this.reverb);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.applyVolumes();
    if (this.pendingMusic) {
      const def = this.pendingMusic;
      this.pendingMusic = null;
      this.startMusic(def);
    }
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.sfx.gain.value = s.sfx;
    this.music.gain.value = s.music * 0.55;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setListener(x, z, yaw) {
    this.listener.x = x;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  // ---------------------------------------------------------------- voices

  tone(dest, { type = 'sine', f0, f1 = f0, dur, vol = 0.3, attack = 0.004, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  noise(dest, { dur, vol = 0.3, type = 'lowpass', f0 = 1000, f1 = f0, q = 1, attack = 0.002, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.03);
  }

  // Play a named effect. opts.pos ({x, z}) places it in the world relative to the listener.
  play(name, opts) {
    const ctx = this.ctx;
    const fn = SOUNDS[name];
    if (!ctx || !fn || ctx.state !== 'running') return;
    let vol = opts?.volume ?? 1;
    let pan = 0;
    if (opts?.pos) {
      const L = this.listener;
      const dx = opts.pos.x - L.x, dz = opts.pos.z - L.z;
      const d = Math.hypot(dx, dz);
      if (d > 75) return;
      vol *= 1 / (1 + (d / 11) * (d / 11));
      if (d > 0.5) pan = clamp((dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d, -1, 1) * 0.85;
    }
    const g = ctx.createGain();
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    fn(this, g);
  }

  // ---------------------------------------------------------------- score

  startMusic(def) {
    if (!this.ctx) {
      this.pendingMusic = def;
      return;
    }
    this.stopMusic();
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    out.connect(this.music);
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 700;
    padFilter.Q.value = 0.6;
    padFilter.connect(out);
    const combat = ctx.createGain();
    combat.gain.value = 0;
    combat.connect(out);
    // Sub drone: the station itself.
    const drone = ctx.createOscillator();
    drone.frequency.value = def.root / 2;
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.2;
    drone.connect(droneGain);
    droneGain.connect(out);
    drone.start();
    const now = ctx.currentTime;
    this.m = { def, out, padFilter, combat, drone, chord: 0, nextChord: now + 0.2, step: 0, nextStep: now + 0.3 };
    this.timer = setInterval(() => this._schedule(), 70);
  }

  stopMusic() {
    this.pendingMusic = null;
    if (!this.m) return;
    clearInterval(this.timer);
    const m = this.m;
    this.m = null;
    const t = this.ctx.currentTime;
    m.out.gain.cancelScheduledValues(t);
    m.out.gain.setTargetAtTime(0.0001, t, 0.4);
    setTimeout(() => {
      try { m.drone.stop(); } catch { /* already stopped */ }
      m.out.disconnect();
    }, 2500);
  }

  setIntensity(v) {
    this.targetIntensity = v;
  }

  _schedule() {
    const m = this.m, ctx = this.ctx;
    if (!m || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.intensity += (this.targetIntensity - this.intensity) * 0.1;
    const k = this.intensity;
    m.combat.gain.setTargetAtTime(k * 0.85, now, 0.25);
    m.padFilter.frequency.setTargetAtTime(650 + k * 1100, now, 0.5);

    const beat = 60 / m.def.tempo;
    const chordDur = beat * 16;
    const chords = m.def.chords;
    // After a long pause (tab hidden) jump ahead instead of flooding the scheduler.
    if (m.nextChord < now - 1) m.nextChord = now + 0.1;
    if (m.nextStep < now - 1) m.nextStep = now + 0.1;
    while (m.nextChord < now + 0.4) {
      this._pad(chords[m.chord % chords.length], m.nextChord, chordDur);
      m.chord++;
      m.nextChord += chordDur;
    }
    const sd = beat / 4;
    const chord = chords[(m.chord + chords.length - 1) % chords.length];
    while (m.nextStep < now + 0.25) {
      const s = m.step % 16;
      if (k > 0.04) this._beat(s, m.nextStep, chord, k);
      else if (s === 0 && Math.random() < 0.6) this._sparkle(m.nextStep + Math.random() * 1.5);
      m.step++;
      m.nextStep += sd;
    }
  }

  _pad(semis, t, dur) {
    const ctx = this.ctx, m = this.m;
    for (const s of semis) {
      const f = m.def.root * 2 * Math.pow(2, s / 12);
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + dur * 0.4);
        g.gain.linearRampToValueAtTime(0.035, t + dur);
        g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.45);
        o.connect(g);
        g.connect(m.padFilter);
        o.start(t);
        o.stop(t + dur * 1.5);
      }
    }
  }

  _sparkle(t) {
    const m = this.m;
    const f = m.def.root * 8 * Math.pow(2, PENTA[(Math.random() * PENTA.length) | 0] / 12);
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(m.out);
    this.tone(g, { f0: f, dur: 1.8, vol: 0.035, attack: 0.02, when: Math.max(0, t - this.ctx.currentTime) });
  }

  _beat(s, t, chord, k) {
    const m = this.m, ctx = this.ctx;
    const when = Math.max(0, t - ctx.currentTime);
    const d = m.combat;
    if (s % 4 === 0) this.tone(d, { f0: 125, f1: 42, dur: 0.17, vol: 0.55, when });
    if (s === 4 || s === 12) this.noise(d, { dur: 0.13, vol: 0.2, type: 'bandpass', f0: 1900, q: 0.8, when });
    if (s % 4 === 2 || (k > 0.6 && s % 2 === 1)) this.noise(d, { dur: 0.03, vol: 0.06, type: 'highpass', f0: 7000, when });
    if (BASS[s]) {
      const f = m.def.root * Math.pow(2, chord[0] / 12) * (s === 13 ? 2 : 1);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(140, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(lp);
      lp.connect(g);
      g.connect(d);
      o.start(t);
      o.stop(t + 0.24);
    }
    if (k > 0.55) {
      const f = m.def.root * 4 * Math.pow(2, chord[s % chord.length] / 12);
      this.tone(d, { type: 'square', f0: f, dur: 0.09, vol: 0.03, when });
    }
  }
}
