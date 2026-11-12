// Chapter III's finale: the Warden — VESPER's defence frame — and the shield
// pylons that feed it.

import * as THREE from 'three';
import { G } from '../gfx/geo.js';
import { clamp, damp, rand } from '../core/utils.js';
import { Enemy, TINT, armourMaterial, plainMaterial, bakeGeo } from './enemyBase.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _hit = { t: 0, nx: 0, ny: 0, nz: 0, kind: null, ref: null };

const additive = (color) => new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });

function stretch(mesh, from, to, width) {
  _a.subVectors(to, from);
  const len = _a.length() || 0.001;
  mesh.position.copy(from).addScaledVector(_a, 0.5);
  mesh.quaternion.setFromUnitVectors(_y, _a.divideScalar(len));
  mesh.scale.set(width, len, width);
}

export class Pylon extends Enemy {
  constructor(game, x, z, zone, opts) {
    super(game, {
      type: 'pylon', hp: 190, radius: 0.9, height: 4, color: [0.3, 1.5, 2.6],
      spheres: [{ y: 1.3, r: 0.85 }, { y: 3.4, r: 0.8, crit: true }],
    }, x, z, zone, { ...opts, counts: false });
    this.static = true;
    this.boss = null;
    const body = bakeGeo('pylon-body', (add) => {
      add(G.box, 0, 0.25, 0, 1.5, 0.5, 1.5, 0, 0, 0, TINT.dark);
      add(G.taper, 0, 1.7, 0, 1.15, 2.4, 1.15, 0, 0, 0, TINT.plate);
      add(G.cyl8, 0, 2.95, 0, 1.1, 0.16, 1.1, 0, 0, 0, TINT.steel);
      for (let k = 0; k < 4; k++) add(G.box, Math.cos(k * 1.5708) * 0.62, 1.2, Math.sin(k * 1.5708) * 0.62, 0.12, 1.6, 0.4, 0, -k * 1.5708 + 1.5708, 0, TINT.dark);
    });
    this.mesh(body, armourMaterial());
    this.crystal = this.mesh(G.octa, this.eyeMat);
    this.crystal.scale.set(0.95, 1.5, 0.95);
    this.crystal.position.y = 3.6;
    const ring = this.mesh(G.torus, this.eyeMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(1.25);
    ring.position.y = 3.02;
    // Blocks movement only: shots are resolved against the hit spheres instead.
    this.box = game.level.addBox({ minX: x - 0.75, maxX: x + 0.75, minZ: z - 0.75, maxZ: z + 0.75, minY: 0, maxY: 3, kind: 'dynamic', nav: false, ray: false });
  }

  // The casing is tough; the crystal is not.
  armour(crit) {
    return crit ? 1 : 0.5;
  }

  move() {}

  animate(dt) {
    this.crystal.rotation.y += dt * 1.6;
    this.crystal.position.y = 3.6 + Math.sin(this.t * 2 + this.seed) * 0.12;
  }

  die() {
    if (!this.alive) return;
    const g = this.game;
    g.level.removeBox(this.box);
    g.fx.explosion(this.pos.x, 3, this.pos.z, 3.5, [0.3, 0.9, 1.6]);
    g.audio.play('explosion', { pos: this.pos });
    super.die();
    this.boss?.onPylonDown();
  }

  dispose() {
    if (this.alive) this.game.level.removeBox(this.box);
    super.dispose();
  }
}

export class Warden extends Enemy {
  constructor(game, x, z, zone, opts) {
    super(game, { type: 'warden', hp: 2500, radius: 2.1, height: 4.2, flying: true, color: [2.6, 0.55, 0.14], spheres: [{ y: 0, r: 2.1 }] }, x, z, zone, opts);
    this.static = true;
    this.home = { x, z };
    this.pos.y = 4.6;
    this.phase = 'shield';
    this._pylons = [];
    this.orbitA = Math.random() * 6.283;
    this.open = 0;
    this.openTarget = 0;
    this.burstT = 3;
    this.volley = 0;
    this.volleyT = 0;
    this.ringT = 6;
    this.summonT = 9;
    this.beamT = 7;
    this.beam = { state: null, t: 0, dir: new THREE.Vector3(0, 0, -1), tick: 0, end: new THREE.Vector3() };
    this.dieT = 0;
    this.boomT = 0;
    this.shieldHit = 0;
    this.blockedToast = 0;

    const plain = plainMaterial();
    this.core = this.mesh(G.sphere, this.eyeMat);
    this.core.scale.setScalar(2);
    this.petals = [];
    for (let i = 0; i < 6; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i * Math.PI) / 3;
      const plate = this.mesh(G.box, plain, pivot);
      plate.scale.set(1.2, 2.5, 0.24);
      plate.position.z = -1.45;
      this.group.add(pivot);
      this.petals.push(plate);
    }
    this.rings = [5.0, 5.9].map((s) => {
      const r = this.mesh(G.torusFat, plain);
      r.scale.setScalar(s);
      return r;
    });
    const spike = this.mesh(G.cone8, plain);
    spike.scale.set(1.1, 2.0, 1.1);
    spike.rotation.x = Math.PI;
    spike.position.y = -2.3;
    const crown = this.mesh(G.cone8, plain);
    crown.scale.set(0.8, 1.1, 0.8);
    crown.position.y = 2.0;

    this.shieldMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHit: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0.25, 0.9, 1.8) } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vP = position;
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uHit, uAlpha; uniform vec3 uColor;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
          float band = 0.5 + 0.5 * sin(vP.y * 22.0 + uTime * 3.0);
          float cell = 0.5 + 0.5 * sin(atan(vP.z, vP.x) * 14.0 + uTime);
          vec3 col = uColor * (f * 1.9 + 0.05 + band * cell * 0.16 + uHit * 0.8);
          gl_FragColor = vec4(col * uAlpha, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.shield = new THREE.Mesh(G.sphere, this.shieldMat);
    this.shield.scale.setScalar(6.6);
    this.shield.renderOrder = 8;
    this.group.add(this.shield);

    // World-space helpers (beam and pylon tethers) live outside the rotating body.
    this.fxGroup = new THREE.Group();
    game.engine.scene.add(this.fxGroup);
    this.beamMat = additive(new THREE.Color(3, 0.5, 0.15));
    this.beamMesh = new THREE.Mesh(G.cyl8, this.beamMat);
    this.beamMesh.visible = false;
    this.beamMesh.frustumCulled = false;
    this.fxGroup.add(this.beamMesh);
    this.linkMat = additive(new THREE.Color(0.2, 0.9, 1.8));
    this.links = [];
  }

  set pylons(list) {
    this._pylons = list;
    for (const p of list) {
      p.boss = this;
      const m = new THREE.Mesh(G.cyl8, this.linkMat);
      m.frustumCulled = false;
      this.fxGroup.add(m);
      this.links.push({ mesh: m, pylon: p });
    }
  }

  get pylons() {
    return this._pylons;
  }

  get shielded() {
    return this.phase === 'shield';
  }

  get enraged() {
    return this.phase === 'enrage';
  }

  onPylonDown() {
    const g = this.game;
    const left = this._pylons.filter((p) => p.alive).length;
    g.mission.emit('boss:pylon', left);
    if (left > 0 || this.phase !== 'shield') return;
    this.phase = 'fight';
    this.shieldHit = 1;
    g.fx.ring(this.pos.x, this.pos.y, this.pos.z, [0.3, 1, 2], 9, 0.7);
    g.fx.burst(this.pos.x, this.pos.y, this.pos.z, [0.3, 1, 2], 50, 12, 0.4, 0.9);
    g.audio.play('shieldBreak', { volume: 1.6 });
    g.fx.shake(0.5);
    this.beamT = 5;
    g.mission.emit('boss:shield');
  }

  takeDamage(amount, point, dir, crit) {
    const g = this.game;
    if (!this.alive || this.spawnT > 0 || this.phase === 'dying') return 'blocked';
    if (this.phase === 'shield') {
      this.shieldHit = 1;
      g.fx.sparks(point.x, point.y, point.z, -dir.x, -dir.y, -dir.z, [0.4, 1.2, 2.2], 5, 4);
      if (this.blockedToast <= 0) {
        this.blockedToast = 5;
        g.audio.play('clank', { pos: this.pos, volume: 1.4 });
        g.hud.toast('The Warden is shielded — destroy the pylons', 'warn');
      }
      return 'blocked';
    }
    const dealt = amount * (this.open > 0.5 ? 1.6 : 1);
    this.hp -= dealt;
    this.flashT = 0.1;
    g.stats.damage += dealt;
    g.fx.sparks(point.x, point.y, point.z, -dir.x, -dir.y, -dir.z, this.color, crit || this.open > 0.5 ? 10 : 5, 6);
    if (this.phase === 'fight' && this.hp <= this.maxHp * 0.4) {
      this.phase = 'enrage';
      g.audio.play('roar');
      g.fx.ring(this.pos.x, 0.1, this.pos.z, [2.6, 0.4, 0.1], 20, 0.9);
      g.fx.shake(0.6);
      this.beamT = Math.min(this.beamT, 3);
      g.mission.emit('boss:enrage');
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.phase = 'dying';
      this.dieT = 2.8;
      this._endBeam();
      this.openTarget = 1;
      g.audio.play('roar');
      return 'killed';
    }
    return 'hit';
  }

  think(dt) {
    const g = this.game, p = g.player;
    this.blockedToast -= dt;
    this.shieldHit = Math.max(0, this.shieldHit - dt * 3);

    if (this.phase === 'dying') {
      this.dieT -= dt;
      this.boomT -= dt;
      this.vel.set(0, 0, 0);
      if (this.boomT <= 0) {
        this.boomT = 0.2;
        g.fx.explosion(this.pos.x + rand(-2, 2), this.pos.y + rand(-1.5, 1.5), this.pos.z + rand(-2, 2), 2.6);
        g.audio.play('explosion', { pos: this.pos, volume: 0.6 });
      }
      this.pos.y = Math.max(2.4, this.pos.y - dt * 0.7);
      if (this.dieT <= 0) this._finish();
      return;
    }

    // Drift: hold station while shielded, then prowl the arena.
    let tx = this.home.x, tz = this.home.z;
    if (this.phase !== 'shield') {
      this.orbitA += dt * (this.enraged ? 0.36 : 0.24);
      const r = this.enraged ? 10.5 : 8.5;
      tx += Math.cos(this.orbitA) * r;
      tz += Math.sin(this.orbitA) * r;
    }
    this.vel.x = damp(this.vel.x, clamp((tx - this.pos.x) * 0.9, -5, 5), 2, dt);
    this.vel.z = damp(this.vel.z, clamp((tz - this.pos.z) * 0.9, -5, 5), 2, dt);
    this.pos.y = damp(this.pos.y, 4.6 + Math.sin(this.t * 0.8) * 0.5, 2, dt);
    this.facePlayer(2, dt);

    if (!p.alive) { this._endBeam(); return; }
    if (this.beam.state) { this._updateBeam(dt); return; }

    this.burstT -= dt;
    this.ringT -= dt;
    this.summonT -= dt;
    if (this.phase !== 'shield') this.beamT -= dt;

    if (this.volley > 0) {
      this.volleyT -= dt;
      if (this.volleyT <= 0) {
        this._fan();
        this.volley--;
        this.volleyT = 0.24;
      }
    } else if (this.burstT <= 0 && this.los) {
      this.volley = this.phase === 'shield' ? 1 : this.enraged ? 3 : 2;
      this.volleyT = 0;
      this.burstT = this.phase === 'shield' ? 2.8 : this.enraged ? 1.6 : 2.3;
    }
    if (this.ringT <= 0) {
      this._ring();
      this.ringT = this.enraged ? 5.2 : 7.5;
    }
    if (this.summonT <= 0) {
      this._summon();
      this.summonT = this.enraged ? 13 : 17;
    }
    if (this.phase !== 'shield' && this.beamT <= 0 && this.los) {
      this.beam.state = 'charge';
      this.beam.t = 1.35;
      this.beam.tick = 0;
      this.beam.dir.set(p.pos.x - this.pos.x, p.pos.y + 1.1 - this.pos.y, p.pos.z - this.pos.z).normalize();
      this.openTarget = 1;
      this.beamT = this.enraged ? 9 : 12;
      g.audio.play('charge', { pos: this.pos, volume: 1.6 });
    }
  }

  // Five bolts in a flat spread.
  _fan() {
    const g = this.game, p = g.player;
    const oy = this.pos.y - 0.6;
    const lead = (this.dist / 21) * g.difficulty.lead;
    let dx = p.pos.x + p.vel.x * lead - this.pos.x, dy = p.pos.y + 1.1 - oy, dz = p.pos.z + p.vel.z * lead - this.pos.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    for (let k = -2; k <= 2; k++) {
      const a = k * 0.1, c = Math.cos(a), s = Math.sin(a);
      const fx = dx * c - dz * s, fz = dx * s + dz * c;
      g.projectiles.spawn({ x: this.pos.x + fx * 2, y: oy, z: this.pos.z + fz * 2, dx: fx, dy, dz: fz, speed: 21, damage: 9, color: this.color, radius: 0.17 });
    }
    g.audio.play('bolt', { pos: this.pos, volume: 1.5 });
    this.glowK = 2.5;
  }

  // Slow expanding ring at knee height: slip through a gap or jump it.
  _ring() {
    const g = this.game;
    const n = this.enraged ? 18 : 14;
    const off = Math.random() * 6.283;
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * 6.283;
      g.projectiles.spawn({ x: this.pos.x + Math.cos(a) * 1.5, y: 1.0, z: this.pos.z + Math.sin(a) * 1.5, dx: Math.cos(a), dy: 0, dz: Math.sin(a), speed: 9.5, damage: 12, color: [1.4, 0.4, 2.6], radius: 0.22, life: 6 });
    }
    g.fx.ring(this.pos.x, 0.1, this.pos.z, [1.4, 0.4, 2.6], 6, 0.6);
    g.audio.play('charge', { pos: this.pos });
  }

  _summon() {
    const g = this.game;
    let adds = 0;
    for (const e of g.enemies.list) if (e.alive && e.zone === this.zone && !e.counts && e.type !== 'pylon') adds++;
    const cap = this.enraged ? 3 : 2;
    const type = this.enraged ? 'crawler' : 'drone';
    for (let i = 0; i < 2 && adds < cap; i++) {
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * 6.283, r = rand(8, 16);
        const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
        if (!g.level.navFree(x, z) || g.level.zoneAt(x, z) !== this.zone) continue;
        g.enemies.spawn(type, x, z, this.zone, { counts: false, delay: 0.2 + i * 0.35 });
        adds++;
        break;
      }
    }
  }

  _endBeam() {
    this.beam.state = null;
    this.beamMesh.visible = false;
    this.openTarget = this.phase === 'dying' ? 1 : 0;
  }

  _updateBeam(dt) {
    const g = this.game, p = g.player, b = this.beam;
    b.t -= dt;
    // Swing the emitter towards the target at a limited rate, so it can be outrun.
    _a.set(p.pos.x - this.pos.x, p.pos.y + 1.0 - this.pos.y, p.pos.z - this.pos.z).normalize();
    const rate = b.state === 'charge' ? 3 : this.enraged ? 0.95 : 0.75;
    const ang = Math.acos(clamp(b.dir.dot(_a), -1, 1));
    if (ang > 1e-4) b.dir.lerp(_a, Math.min(1, (rate * dt) / ang)).normalize();

    const hit = g.level.raycast(this.pos.x, this.pos.y, this.pos.z, b.dir.x, b.dir.y, b.dir.z, 70, _hit);
    const len = hit ? _hit.t : 70;
    b.end.copy(this.pos).addScaledVector(b.dir, len);
    this.beamMesh.visible = true;

    if (b.state === 'charge') {
      stretch(this.beamMesh, this.pos, b.end, 0.05);
      this.beamMat.color.setRGB(1.2, 0.15, 0.05);
      this.glowK = 1 + (1 - b.t / 1.35) * 3;
      if (b.t <= 0) {
        b.state = 'fire';
        b.t = 2.6;
        g.audio.play('beam', { pos: this.pos, volume: 1.5 });
      }
      return;
    }

    stretch(this.beamMesh, this.pos, b.end, 0.34 + Math.sin(this.t * 40) * 0.05);
    this.beamMat.color.setRGB(4, 0.9, 0.25);
    this.glowK = 4;
    g.fx.sparks(b.end.x, b.end.y, b.end.z, -b.dir.x, -b.dir.y + 0.5, -b.dir.z, [2, 0.8, 0.3], 3, 7);
    g.fx.shake(0.05);
    b.tick -= dt;
    if (b.tick <= 0) {
      b.tick = 0.1;
      // Distance from the player's chest to the beam segment.
      _b.set(p.pos.x, p.pos.y + 1.0, p.pos.z).sub(this.pos);
      const along = clamp(_b.dot(b.dir), 0, len);
      const d = _b.addScaledVector(b.dir, -along).length();
      if (d < 0.85) p.takeDamage(3.6, this.pos);
      g.fx.flash(b.end.x, b.end.y + 0.3, b.end.z, [1, 0.4, 0.1], 90, 9, 0.15);
    }
    if (b.t <= 0) this._endBeam();
  }

  _finish() {
    const g = this.game;
    for (let k = 0; k < 4; k++) g.fx.explosion(this.pos.x + rand(-2.5, 2.5), this.pos.y + rand(-1, 1.5), this.pos.z + rand(-2.5, 2.5), 5);
    g.fx.ring(this.pos.x, 0.1, this.pos.z, this.color, 26, 1.1);
    g.audio.play('explosion', { volume: 1.6 });
    g.engine.fx.flashColor.setRGB(1, 0.9, 0.8);
    g.engine.fx.flash = 1;
    g.fx.shake(1);
    g.enemies.killAdds(this.zone);
    this.die();
  }

  move(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
  }

  animate(dt) {
    this.open = damp(this.open, this.openTarget, 5, dt);
    if (!this.beam.state && this.phase !== 'dying') this.glowK = damp(this.glowK, this.enraged ? 1.8 : 1, 4, dt);
    for (const plate of this.petals) {
      plate.position.z = -(1.45 + this.open * 0.8);
      plate.rotation.x = this.open * 0.5;
    }
    const spin = this.enraged ? 2 : 1;
    this.rings[0].rotation.x += dt * 0.9 * spin;
    this.rings[0].rotation.y += dt * 0.3 * spin;
    this.rings[1].rotation.z += dt * 0.7 * spin;
    this.rings[1].rotation.x += dt * 0.2 * spin;
    this.core.scale.setScalar(2 + Math.sin(this.t * 5) * 0.06);

    const u = this.shieldMat.uniforms;
    u.uTime.value = this.t;
    u.uHit.value = this.shieldHit;
    u.uAlpha.value = damp(u.uAlpha.value, this.phase === 'shield' ? 1 : 0, 6, dt);
    this.shield.visible = u.uAlpha.value > 0.01;

    for (const l of this.links) {
      const on = l.pylon.alive && this.phase === 'shield' && l.pylon.active;
      l.mesh.visible = on;
      if (!on) continue;
      _b.set(l.pylon.pos.x, 3.6, l.pylon.pos.z);
      stretch(l.mesh, _b, this.pos, 0.07 + Math.sin(this.t * 9 + l.pylon.seed) * 0.02);
    }
  }

  dispose() {
    super.dispose();
    this.fxGroup.removeFromParent();
    this.shieldMat.dispose();
    this.beamMat.dispose();
    this.linkMat.dispose();
  }
}
