// Player arsenal: weapon definitions, hitscan firing, and the animated
// first-person view models (drawn in the engine's dedicated view scene).

import * as THREE from 'three';
import { G } from '../gfx/geo.js';
import { getTextures } from '../gfx/textures.js';
import { clamp, damp, lerp } from '../core/utils.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', slot: 1, name: 'VIGIL-9', kind: 'Sidearm', auto: false, rate: 6.5, damage: 24, crit: 1.8, pellets: 1,
    spread: 0.004, moveSpread: 0.011, bloom: 0.012, bloomMax: 0.03, range: 130, mag: 12, reserve: Infinity, reload: 1.05,
    recoil: 0.02, kick: 0.5, adsZoom: 0.78, color: [0.5, 1.5, 2.4], sound: 'pistol', falloff: [30, 75, 0.6], shake: 0.05,
  },
  rifle: {
    id: 'rifle', slot: 2, name: 'LANCER AR', kind: 'Assault Rifle', auto: true, rate: 10.5, damage: 13.5, crit: 1.6, pellets: 1,
    spread: 0.007, moveSpread: 0.014, bloom: 0.006, bloomMax: 0.04, range: 150, mag: 36, reserve: 108, reserveMax: 252, reload: 1.55,
    recoil: 0.01, kick: 0.34, adsZoom: 0.68, color: [2.4, 1.4, 0.4], sound: 'rifle', falloff: [35, 90, 0.6], shake: 0.04, pack: 36,
  },
  shotgun: {
    id: 'shotgun', slot: 3, name: 'BREAKER', kind: 'Shotgun', auto: false, rate: 1.35, damage: 10.5, crit: 1.25, pellets: 9,
    spread: 0.072, moveSpread: 0.008, bloom: 0, bloomMax: 0, range: 46, mag: 6, reserve: 18, reserveMax: 42, reload: 1.9,
    recoil: 0.055, kick: 1, adsZoom: 0.86, color: [2.6, 1.1, 0.3], sound: 'shotgun', falloff: [9, 28, 0.25], shake: 0.2, pack: 6,
  },
  rail: {
    id: 'rail', slot: 4, name: 'HELIX LANCE', kind: 'Rail Lance', auto: false, rate: 0.85, damage: 160, crit: 1.5, pellets: 1,
    spread: 0, moveSpread: 0.003, bloom: 0, bloomMax: 0, range: 220, mag: 4, reserve: 8, reserveMax: 20, reload: 2.2,
    recoil: 0.075, kick: 1.25, adsZoom: 0.45, color: [1.5, 0.6, 2.8], sound: 'rail', pierce: true, shake: 0.3, pack: 3,
  },
};

export const WEAPON_ORDER = ['pistol', 'rifle', 'shotgun', 'rail'];

const LOWER = 0.16, RAISE = 0.22;
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _hit = { t: 0, nx: 0, ny: 0, nz: 0, kind: null, ref: null };

// ---------------------------------------------------------------- view models

function viewMaterials() {
  const std = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    gun: std(0x2a2f37, 0.34, 0.9),
    steel: std(0x858e99, 0.28, 0.95),
    dark: std(0x14161a, 0.55, 0.6),
    poly: std(0x1b1d22, 0.72, 0.1),
  };
}

function modelBuilder(M, glow) {
  const group = new THREE.Group();
  const part = (geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
  // Cylinder lying along the barrel (z) axis.
  const tube = (mat, x, y, z, r, len, geo = G.cyl16) => part(geo, mat, x, y, z, r * 2, len, r * 2, Math.PI / 2, 0, 0);
  return { group, part, tube, M, glow };
}

function buildPistol(M) {
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.6) });
  const { group, part, tube } = modelBuilder(M, glow);
  part(G.box, M.gun, 0, 0.02, -0.02, 0.036, 0.044, 0.21);
  part(G.box, M.steel, 0, -0.012, -0.035, 0.03, 0.026, 0.16);
  tube(M.dark, 0, 0.022, -0.125, 0.009, 0.03);
  part(G.box, M.poly, 0, -0.07, 0.062, 0.032, 0.115, 0.05, 0.24);
  part(G.box, M.poly, 0, -0.045, 0.0, 0.012, 0.012, 0.07);
  part(G.box, M.poly, 0, -0.03, -0.03, 0.012, 0.03, 0.012);
  for (const s of [-1, 1]) part(G.box, M.dark, s * 0.011, 0.047, 0.07, 0.007, 0.01, 0.012);
  part(G.box, M.dark, 0, 0.047, -0.112, 0.006, 0.01, 0.01);
  for (const s of [-1, 1]) part(G.box, glow, s * 0.0185, 0.014, -0.04, 0.002, 0.007, 0.09);
  part(G.box, glow, 0, 0.0425, 0.02, 0.012, 0.002, 0.03);
  return { group, glow, muzzle: new THREE.Vector3(0, 0.022, -0.15), hip: new THREE.Vector3(0.19, -0.185, -0.44), ads: new THREE.Vector3(0, -0.058, -0.33) };
}

function buildRifle(M) {
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.3) });
  const { group, part, tube } = modelBuilder(M, glow);
  part(G.box, M.gun, 0, 0, 0.02, 0.05, 0.076, 0.3);
  part(G.box, M.dark, 0, 0.004, -0.25, 0.046, 0.056, 0.25);
  for (let k = 0; k < 5; k++) for (const s of [-1, 1]) part(G.box, M.poly, s * 0.0235, 0.008, -0.16 - k * 0.042, 0.002, 0.022, 0.024);
  tube(M.steel, 0, 0.012, -0.45, 0.011, 0.2);
  tube(M.dark, 0, 0.012, -0.555, 0.018, 0.055);
  part(G.box, M.poly, 0, -0.014, 0.26, 0.04, 0.064, 0.2);
  part(G.box, M.poly, 0, -0.095, -0.02, 0.03, 0.125, 0.06, -0.14);
  part(G.box, M.poly, 0, -0.078, 0.11, 0.032, 0.09, 0.04, 0.3);
  part(G.box, M.dark, 0, 0.046, -0.02, 0.02, 0.014, 0.32);
  // Open reflex sight.
  for (const s of [-1, 1]) part(G.box, M.dark, s * 0.021, 0.073, 0.0, 0.004, 0.044, 0.034);
  part(G.box, M.dark, 0, 0.096, 0.0, 0.046, 0.004, 0.034);
  part(G.box, glow, 0, 0.072, 0.0, 0.005, 0.005, 0.002);
  for (const s of [-1, 1]) part(G.box, glow, s * 0.0255, -0.012, -0.24, 0.002, 0.008, 0.2);
  return { group, glow, muzzle: new THREE.Vector3(0, 0.012, -0.6), hip: new THREE.Vector3(0.185, -0.2, -0.42), ads: new THREE.Vector3(0, -0.072, -0.3) };
}

function buildShotgun(M) {
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 0.8, 0.2) });
  const { group, part, tube } = modelBuilder(M, glow);
  tube(M.steel, 0, 0.022, -0.26, 0.021, 0.5);
  tube(M.dark, 0, -0.016, -0.22, 0.017, 0.4);
  const pump = part(G.box, M.poly, 0, -0.016, -0.26, 0.052, 0.046, 0.14);
  part(G.box, M.gun, 0, 0.002, 0.06, 0.052, 0.082, 0.22);
  part(G.box, M.poly, 0, -0.022, 0.28, 0.042, 0.066, 0.21, -0.07);
  part(G.box, M.poly, 0, -0.074, 0.13, 0.032, 0.088, 0.04, 0.3);
  part(G.box, M.dark, 0, 0.046, -0.49, 0.006, 0.01, 0.008);
  part(G.box, M.dark, 0, 0.046, 0.04, 0.014, 0.008, 0.16);
  for (const s of [-1, 1]) part(G.box, glow, s * 0.0265, 0.006, 0.06, 0.002, 0.01, 0.14);
  return { group, glow, pump, muzzle: new THREE.Vector3(0, 0.022, -0.53), hip: new THREE.Vector3(0.195, -0.2, -0.4), ads: new THREE.Vector3(0, -0.056, -0.31) };
}

function buildRail(M) {
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 3.0) });
  const { group, part, tube } = modelBuilder(M, glow);
  part(G.box, M.gun, 0, 0, 0.08, 0.07, 0.092, 0.3);
  for (const s of [-1, 1]) part(G.box, M.steel, s * 0.024, 0.012, -0.3, 0.014, 0.032, 0.5);
  tube(glow, 0, 0.012, -0.3, 0.006, 0.5, G.cyl8);
  for (let k = 0; k < 5; k++) part(G.box, M.dark, 0, 0.012, -0.12 - k * 0.095, 0.064, 0.05, 0.018);
  for (let k = 0; k < 3; k++) part(G.box, M.dark, 0, 0.06, 0.02 + k * 0.05, 0.05, 0.03, 0.012);
  tube(M.dark, 0, 0.082, 0.07, 0.021, 0.15);
  tube(glow, 0, 0.082, -0.006, 0.016, 0.004);
  part(G.box, M.poly, 0, -0.08, 0.16, 0.034, 0.09, 0.042, 0.3);
  part(G.box, M.poly, 0, -0.016, 0.3, 0.044, 0.07, 0.16);
  for (const s of [-1, 1]) part(G.box, glow, s * 0.0355, 0.0, 0.08, 0.002, 0.03, 0.18);
  return { group, glow, muzzle: new THREE.Vector3(0, 0.012, -0.58), hip: new THREE.Vector3(0.195, -0.21, -0.4), ads: new THREE.Vector3(0, -0.082, -0.26) };
}

// ---------------------------------------------------------------- system

export class WeaponSystem {
  constructor(game) {
    this.game = game;
    const view = game.engine.viewScene;
    this.root = new THREE.Group();
    view.add(this.root);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x1c1a18, 0.9);
    this.key = new THREE.DirectionalLight(0xffffff, 1.4);
    this.key.position.set(-0.6, 1, 0.7);
    this.muzzleLight = new THREE.PointLight(0xffffff, 0, 3, 2);
    view.add(this.hemi, this.key, this.muzzleLight);

    const M = viewMaterials();
    this.models = { pistol: buildPistol(M), rifle: buildRifle(M), shotgun: buildShotgun(M), rail: buildRail(M) };
    for (const id of WEAPON_ORDER) {
      const m = this.models[id];
      m.base = m.glow.color.clone();
      m.group.visible = false;
      this.root.add(m.group);
    }

    const tex = getTextures();
    this.flashMat = new THREE.MeshBasicMaterial({ map: tex.flare, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    for (let k = 0; k < 2; k++) {
      const p = new THREE.Mesh(G.plane, this.flashMat);
      p.rotation.y = k * Math.PI * 0.5;
      this.flash.add(p);
    }
    const front = new THREE.Mesh(G.plane, this.flashMat);
    this.flash.add(front);
    this.flash.visible = false;
    this.root.add(this.flash);

    this.ambient = [1, 1, 1];
    this.reset();
  }

  reset() {
    this.owned = { pistol: true };
    this.ammo = {};
    for (const id of WEAPON_ORDER) {
      const d = WEAPONS[id];
      this.ammo[id] = { mag: d.mag, reserve: d.reserve === Infinity ? Infinity : 0 };
    }
    this.current = 'pistol';
    this.last = 'pistol';
    this._resetState();
  }

  _resetState() {
    this.state = 'raising';
    this.timer = RAISE;
    this.pending = null;
    this.cooldown = 0;
    this.bloom = 0;
    this.kick = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.adsT = 0;
    this.sprintT = 0;
    this.flashT = 0;
    this.queued = false;
    this.autoReload = 0;
    this.heat = 0;
    for (const id of WEAPON_ORDER) this.models[id].group.visible = id === this.current;
  }

  get def() {
    return WEAPONS[this.current];
  }

  serialize() {
    const ammo = {};
    for (const id of WEAPON_ORDER) ammo[id] = [this.ammo[id].mag, this.ammo[id].reserve === Infinity ? -1 : this.ammo[id].reserve];
    return { owned: Object.keys(this.owned), ammo, current: this.current };
  }

  restore(s) {
    this.owned = {};
    for (const id of s.owned) this.owned[id] = true;
    for (const id of WEAPON_ORDER) {
      const a = s.ammo[id];
      if (a) this.ammo[id] = { mag: a[0], reserve: a[1] < 0 ? Infinity : a[1] };
    }
    this.current = this.owned[s.current] ? s.current : 'pistol';
    this.last = 'pistol';
    this._resetState();
  }

  give(id) {
    const d = WEAPONS[id];
    if (this.owned[id]) {
      const a = this.ammo[id];
      a.reserve = Math.min(d.reserveMax, a.reserve + d.pack * 2);
      return false;
    }
    this.owned[id] = true;
    this.ammo[id] = { mag: d.mag, reserve: d.reserve };
    this.select(id);
    return true;
  }

  needsAmmo() {
    return WEAPON_ORDER.some((id) => this.owned[id] && WEAPONS[id].reserveMax && this.ammo[id].reserve < WEAPONS[id].reserveMax);
  }

  addAmmo(scale = 1) {
    let any = false;
    for (const id of WEAPON_ORDER) {
      const d = WEAPONS[id], a = this.ammo[id];
      if (!this.owned[id] || !d.reserveMax || a.reserve >= d.reserveMax) continue;
      a.reserve = Math.min(d.reserveMax, a.reserve + Math.max(1, Math.round(d.pack * scale)));
      any = true;
    }
    return any;
  }

  select(id) {
    if (!this.owned[id] || id === this.current || this.state === 'lowering') return;
    this.pending = id;
    this.state = 'lowering';
    this.timer = LOWER;
    this.game.audio.play('swap');
  }

  cycle(dir) {
    const have = WEAPON_ORDER.filter((id) => this.owned[id]);
    if (have.length < 2) return;
    const i = have.indexOf(this.pending || this.current);
    this.select(have[(i + dir + have.length) % have.length]);
  }

  reload() {
    const d = this.def, a = this.ammo[this.current];
    if (this.state !== 'ready' || a.mag >= d.mag || a.reserve <= 0) return;
    this.state = 'reloading';
    this.timer = d.reload;
    this.game.audio.play('reload');
  }

  setAmbient(rgb) {
    this.ambient = rgb;
  }

  update(dt, active) {
    const g = this.game, input = g.input, p = g.player;
    const d = this.def;
    this.cooldown -= dt;

    let trigger = false;
    if (active && p.alive) {
      for (let i = 0; i < 4; i++) if (input.hit('Digit' + (i + 1))) this.select(WEAPON_ORDER[i]);
      if (input.wheel) this.cycle(input.wheel > 0 ? 1 : -1);
      if (input.hit('KeyQ')) this.select(this.last);
      if (input.hit('KeyR')) this.reload();
      if (d.auto) trigger = input.buttons[0];
      else {
        // Semi-auto: every click fires; a click just before the gun is ready is remembered.
        if (input.buttonPressed[0]) this.queued = true;
        if (!input.buttons[0] && this.cooldown < -0.12) this.queued = false;
        trigger = this.queued || (input.buttons[0] && this.cooldown < -0.16);
      }
      p.ads = input.buttons[2] && this.state !== 'lowering' && this.state !== 'raising' && this.state !== 'reloading' && !p.sprinting;
    } else p.ads = false;

    if (this.state === 'reloading') {
      this.timer -= dt;
      if (this.timer <= 0) {
        const a = this.ammo[this.current];
        const take = Math.min(d.mag - a.mag, a.reserve);
        a.mag += take;
        if (a.reserve !== Infinity) a.reserve -= take;
        this.state = 'ready';
        g.audio.play('reloadEnd');
      }
    } else if (this.state === 'lowering') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.models[this.current].group.visible = false;
        this.last = this.current;
        this.current = this.pending;
        this.pending = null;
        this.models[this.current].group.visible = true;
        this.state = 'raising';
        this.timer = RAISE;
        this.queued = false;
        this.bloom = 0;
      }
    } else if (this.state === 'raising') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'ready';
    }

    if (trigger && this.state === 'ready' && this.cooldown <= 0) this.fire();
    if (this.autoReload > 0) {
      this.autoReload -= dt;
      if (this.autoReload <= 0) this.reload();
    }
    this.bloom = Math.max(0, this.bloom - dt * (this.def.bloomMax * 2.6 + 0.01));
    this._animate(dt);
  }

  currentSpread() {
    const d = this.def, p = this.game.player;
    return d.spread * (p.ads ? 0.45 : 1) + this.bloom + (p.speedXZ > 1 ? d.moveSpread * (p.ads ? 0.4 : 1) : 0) + (p.onGround ? 0 : 0.018);
  }

  fire() {
    const g = this.game, p = g.player, d = this.def, a = this.ammo[this.current];
    this.queued = false;
    if (a.mag <= 0) {
      if (a.reserve > 0) this.reload();
      else {
        g.audio.play('dry');
        this.cooldown = 0.3;
        if (this.current !== 'pistol') {
          g.hud.toast('Out of ammunition — switching to sidearm', 'warn');
          this.select('pistol');
        }
      }
      return;
    }
    a.mag--;
    this.cooldown = 1 / d.rate;
    g.stats.shots++;

    const cam = g.engine.camera;
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    const k = 1 - this.adsT;
    _muzzle.copy(p.eye).addScaledVector(p.forward, 0.7).addScaledVector(_right, 0.16 * k).addScaledVector(_up, -0.1 - 0.05 * k);

    const spread = this.currentSpread();
    this._hitSound = 0;
    let landed = false;
    if (d.pierce) landed = this._fireRail(d, p);
    else {
      for (let i = 0; i < d.pellets; i++) {
        const ang = Math.sqrt(Math.random()) * spread, phi = Math.random() * 6.283;
        const t = Math.tan(ang);
        _dir.copy(p.forward).addScaledVector(_right, Math.cos(phi) * t).addScaledVector(_up, Math.sin(phi) * t).normalize();
        if (this._trace(d, p.eye, _dir)) landed = true;
      }
    }
    if (landed) g.stats.hits++;
    if (this._hitSound) g.audio.play(this._hitSound === 3 ? 'kill' : this._hitSound === 2 ? 'crit' : 'hit');

    this.bloom = Math.min(d.bloomMax, this.bloom + d.bloom);
    p.recoil += d.recoil * (p.ads ? 0.7 : 1);
    p.pitch = Math.min(1.5, p.pitch + d.recoil * 0.22);
    this.kick = Math.min(1.6, this.kick + d.kick);
    this.heat = 1;
    this.flashT = 0.055;
    this.flash.rotation.z = Math.random() * 6.283;
    this.flash.scale.setScalar((d.pellets > 1 ? 0.3 : d.pierce ? 0.34 : 0.2) * (0.8 + Math.random() * 0.4));
    g.fx.flash(_muzzle.x, _muzzle.y, _muzzle.z, d.color, 55, 11, 0.07);
    g.audio.play(d.sound);
    g.fx.shake(d.shake);
    if (a.mag === 0 && a.reserve > 0) this.autoReload = 0.3;
  }

  _falloff(d, t) {
    if (!d.falloff) return 1;
    const [a, b, m] = d.falloff;
    return t <= a ? 1 : t >= b ? m : lerp(1, m, (t - a) / (b - a));
  }

  // One hitscan ray. Returns true if it struck a hostile.
  _trace(d, origin, dir) {
    const g = this.game;
    const eh = g.enemies.raycast(origin, dir, d.range);
    const wh = g.level.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, d.range, _hit);
    const wt = wh ? _hit.t : d.range;
    const thin = d.pellets > 1 ? 0.018 : 0.028;
    if (eh && eh.t < wt) {
      _end.copy(origin).addScaledVector(dir, eh.t);
      const dmg = d.damage * this._falloff(d, eh.t) * (eh.crit ? d.crit : 1);
      const result = eh.enemy.takeDamage(dmg, _end, dir, eh.crit);
      g.fx.tracer(_muzzle, _end, d.color, thin);
      if (result === 'blocked') return false;
      const level = result === 'killed' ? 3 : eh.crit ? 2 : 1;
      this._hitSound = Math.max(this._hitSound, level);
      g.hud.hitMarker(eh.crit, result === 'killed');
      return true;
    }
    _end.copy(origin).addScaledVector(dir, Math.min(wt, 90));
    g.fx.tracer(_muzzle, _end, d.color, thin);
    if (wh) {
      if (_hit.ref && _hit.ref.type === 'barrel') g.damageBarrel(_hit.ref, d.damage);
      g.fx.impact(_end.x, _end.y, _end.z, _hit.nx, _hit.ny, _hit.nz, _hit.kind);
    }
    return false;
  }

  _fireRail(d, p) {
    const g = this.game, o = p.eye, dir = p.forward;
    const wh = g.level.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, d.range, _hit);
    const maxT = wh ? _hit.t : d.range;
    const hits = g.enemies.raycastAll(o, dir, maxT);
    let landed = false;
    for (const h of hits) {
      _end.copy(o).addScaledVector(dir, h.t);
      const result = h.enemy.takeDamage(d.damage * (h.crit ? d.crit : 1), _end, dir, h.crit);
      if (result === 'blocked') continue;
      landed = true;
      this._hitSound = Math.max(this._hitSound, result === 'killed' ? 3 : h.crit ? 2 : 1);
      g.hud.hitMarker(h.crit, result === 'killed');
      g.fx.burst(_end.x, _end.y, _end.z, d.color, 10, 5, 0.25, 0.4);
    }
    _end.copy(o).addScaledVector(dir, maxT);
    g.fx.beam(_muzzle, _end, d.color, 0.11, 0.45);
    const n = Math.min(60, Math.floor(maxT / 1.1));
    for (let i = 1; i <= n; i++) {
      const t = i * 1.1, a = i * 0.9;
      g.fx.particles.emit(
        o.x + dir.x * t, o.y + dir.y * t - 0.1, o.z + dir.z * t,
        Math.cos(a) * 0.5, Math.sin(a) * 0.5, Math.sin(a * 1.3) * 0.5,
        0.5 + Math.random() * 0.3, 0.1, d.color[0], d.color[1], d.color[2], 0, 1.5,
      );
    }
    if (wh) {
      if (_hit.ref && _hit.ref.type === 'barrel') g.damageBarrel(_hit.ref, d.damage);
      g.fx.impact(_end.x, _end.y, _end.z, _hit.nx, _hit.ny, _hit.nz, _hit.kind);
      g.fx.burst(_end.x + _hit.nx * 0.2, _end.y + _hit.ny * 0.2, _end.z + _hit.nz * 0.2, d.color, 16, 6, 0.3, 0.5);
      g.fx.flash(_end.x + _hit.nx * 0.4, _end.y + _hit.ny * 0.4, _end.z + _hit.nz * 0.4, d.color, 120, 12, 0.25);
    }
    return landed;
  }

  _animate(dt) {
    const g = this.game, p = g.player, input = g.input;
    const mdl = this.models[this.current];
    const d = this.def;
    this.adsT = damp(this.adsT, p.ads ? 1 : 0, 15, dt);
    this.sprintT = damp(this.sprintT, p.sprinting && this.state === 'ready' ? 1 : 0, 9, dt);
    this.kick = damp(this.kick, 0, 13, dt);
    this.heat = damp(this.heat, 0, 4, dt);
    this.swayX = damp(this.swayX, clamp(-input.dx * 0.0007, -0.03, 0.03), 8, dt);
    this.swayY = damp(this.swayY, clamp(input.dy * 0.0007, -0.03, 0.03), 8, dt);

    const bobK = p.bobAmt * (1 - this.adsT * 0.88);
    const bx = Math.cos(p.bob) * 0.011 * bobK;
    const by = -Math.abs(Math.sin(p.bob)) * 0.013 * bobK;
    const breath = Math.sin(g.time * 1.4) * 0.0025 * (1 - this.adsT * 0.7);

    let lower = 0, tilt = 0;
    if (this.state === 'reloading') {
      const k = Math.sin(clamp(1 - this.timer / d.reload, 0, 1) * Math.PI);
      lower = k * 0.15;
      tilt = k;
    } else if (this.state === 'lowering') lower = (1 - this.timer / LOWER) * 0.32;
    else if (this.state === 'raising') lower = Math.max(0, this.timer / RAISE) * 0.32;
    if (!p.alive) lower = 0.5;

    const gp = mdl.group.position;
    gp.lerpVectors(mdl.hip, mdl.ads, this.adsT);
    gp.x += bx + this.swayX + this.sprintT * -0.05;
    gp.y += by + this.swayY + breath - lower - this.sprintT * 0.04 - (p.onGround ? 0 : 0.012);
    gp.z += this.kick * 0.045;
    mdl.group.rotation.set(
      this.kick * 0.075 + tilt * 0.55 - this.swayY * 1.6 - this.sprintT * 0.25 + lower * 0.9,
      this.swayX * 2.4 + this.sprintT * 0.55 + tilt * 0.35,
      tilt * -0.5 + this.swayX * -1.5,
    );
    if (mdl.pump) mdl.pump.position.z = -0.26 + Math.sin(clamp(this.kick, 0, 1) * Math.PI) * 0.07;
    mdl.glow.color.copy(mdl.base).multiplyScalar(0.7 + this.heat * 1.3 + (this.state === 'reloading' ? -0.5 : 0));

    // Muzzle flash rides the weapon.
    this.flashT -= dt;
    const on = this.flashT > 0;
    this.flash.visible = on;
    if (on) {
      this.flash.position.copy(mdl.muzzle).applyEuler(mdl.group.rotation).add(gp);
      this.flashMat.color.setRGB(d.color[0] * 1.6, d.color[1] * 1.6, d.color[2] * 1.6);
      this.muzzleLight.position.copy(this.flash.position);
      this.muzzleLight.color.setRGB(d.color[0], d.color[1], d.color[2]);
    }
    this.muzzleLight.intensity = on ? 2.2 : 0;

    // Tint the view-model lighting by the baked light where the player stands.
    const a = this.ambient;
    const lum = clamp((a[0] + a[1] + a[2]) / 6, 0.12, 1.2);
    this.hemi.intensity = damp(this.hemi.intensity, 0.35 + lum * 0.75, 5, dt);
    this.key.intensity = damp(this.key.intensity, 0.5 + lum * 1.3, 5, dt);
    const m = Math.max(a[0], a[1], a[2], 0.001);
    this.key.color.setRGB(0.55 + (0.45 * a[0]) / m, 0.55 + (0.45 * a[1]) / m, 0.55 + (0.45 * a[2]) / m);
  }
}
