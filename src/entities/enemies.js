// The station's defence frames and the manager that spawns, updates and
// ray-tests them.

import * as THREE from 'three';
import { G } from '../gfx/geo.js';
import { damp, rand, randSign } from '../core/utils.js';
import { Enemy, TINT, armourMaterial, plainMaterial, bakeGeo } from './enemyBase.js';
import { Warden, Pylon } from './boss.js';

const _d = { x: 0, z: 0 };
const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------- seeker drone

class Drone extends Enemy {
  constructor(game, x, z, zone, opts) {
    super(game, { type: 'drone', hp: 36, radius: 0.55, height: 1.1, flying: true, color: [2.4, 0.7, 0.15], spheres: [{ y: 0, r: 0.62 }] }, x, z, zone, opts);
    this.hover = rand(1.6, 2.9);
    this.pos.y = this.hover;
    this.speed = 6.4;
    this.range = rand(7, 10.5);
    this.orbit = Math.random() * 6.283;
    this.orbitDir = randSign();
    this.fireT = rand(0.8, 2);
    this.windup = 0;
    const body = bakeGeo('drone-body', (add) => {
      add(G.sphere, 0, 0, 0, 0.84, 0.6, 0.84, 0, 0, 0, TINT.dark);
      add(G.sphere, 0, 0.13, 0, 0.88, 0.3, 0.88, 0, 0, 0, TINT.plate);
      add(G.box, 0.5, 0, 0.08, 0.46, 0.05, 0.24, 0, 0, 0.25, TINT.plate);
      add(G.box, -0.5, 0, 0.08, 0.46, 0.05, 0.24, 0, 0, -0.25, TINT.plate);
      add(G.cyl8, 0, 0.38, 0.1, 0.04, 0.3, 0.04, 0, 0, 0, TINT.steel);
      add(G.cyl16, 0, -0.03, -0.34, 0.38, 0.1, 0.38, HALF_PI, 0, 0, TINT.steel);
    });
    const glow = bakeGeo('drone-glow', (add) => {
      add(G.sphere, 0, -0.03, -0.37, 0.26, 0.26, 0.12);
      add(G.cyl16, 0, -0.31, 0, 0.3, 0.05, 0.3);
    });
    this.mesh(body, armourMaterial());
    this.mesh(glow, this.eyeMat);
    this.ring = this.mesh(G.torusFat, plainMaterial());
    this.ring.rotation.x = HALF_PI;
    this.ring.scale.setScalar(1.32);
  }

  think(dt) {
    const g = this.game, p = g.player;
    let tx, tz;
    if (this.los && this.dist < 24) {
      // Circle the target at a comfortable stand-off range.
      this.orbit += this.orbitDir * dt * 0.55;
      if (Math.random() < dt * 0.25) this.orbitDir *= -1;
      const r = this.range + Math.sin(this.t * 0.6 + this.seed) * 2;
      tx = p.pos.x + Math.cos(this.orbit) * r - this.pos.x;
      tz = p.pos.z + Math.sin(this.orbit) * r - this.pos.z;
      const l = Math.hypot(tx, tz) || 1;
      const sp = Math.min(this.speed, l * 2);
      tx = (tx / l) * sp;
      tz = (tz / l) * sp;
    } else {
      this.seek(_d);
      tx = _d.x * this.speed;
      tz = _d.z * this.speed;
      this.orbit = Math.atan2(this.pos.z - p.pos.z, this.pos.x - p.pos.x);
    }
    this.vel.x = damp(this.vel.x, tx, 3, dt);
    this.vel.z = damp(this.vel.z, tz, 3, dt);

    this.fireT -= dt;
    if (this.windup > 0) {
      this.windup -= dt;
      this.glowK = 1 + (1 - this.windup / 0.42) * 3;
      if (this.windup <= 0) {
        this.glowK = 1;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        this.shootAtPlayer(this.pos.x + fx * 0.45, this.pos.y, this.pos.z + fz * 0.45, 19, 9, 0.03);
        g.audio.play('bolt', { pos: this.pos });
      }
    } else if (this.fireT <= 0 && this.los && this.dist < 30 && p.alive) {
      this.windup = 0.42;
      this.fireT = rand(1.6, 2.7);
    }
    this.facePlayer(6, dt);
  }

  move(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y = damp(this.pos.y, this.hover + Math.sin(this.t * 2.1 + this.seed) * 0.25, 3, dt);
    this.game.level.resolveCircle(this.pos, this.radius, this.pos.y - 0.45, this.pos.y + 0.45);
  }

  animate(dt) {
    this.ring.rotation.z += dt * 4;
    this.group.rotation.z = -this.vel.x * 0.02;
  }
}

// ---------------------------------------------------------------- sentinel

class Sentinel extends Enemy {
  constructor(game, x, z, zone, opts) {
    super(game, {
      type: 'sentinel', hp: 88, radius: 0.5, height: 1.95, color: [0.3, 1.5, 2.4],
      spheres: [{ y: 0.55, r: 0.45 }, { y: 1.3, r: 0.52 }, { y: 1.86, r: 0.27, crit: true }],
    }, x, z, zone, opts);
    this.speed = 3.7;
    this.strafeT = 0;
    this.strafeDir = randSign();
    this.fireT = rand(0.8, 1.8);
    this.windup = 0;
    this.burst = 0;
    this.burstT = 0;
    this.walk = 0;
    const body = bakeGeo('sent-body', (add) => {
      add(G.box, 0, 1.0, 0, 0.46, 0.2, 0.3, 0, 0, 0, TINT.dark);
      add(G.box, 0, 1.4, 0, 0.6, 0.56, 0.38, 0, 0, 0, TINT.plate);
      add(G.box, 0, 1.42, -0.2, 0.42, 0.32, 0.06, 0, 0, 0, TINT.steel);
      add(G.box, 0.42, 1.6, 0, 0.24, 0.2, 0.32, 0, 0, 0, TINT.plate);
      add(G.box, -0.42, 1.6, 0, 0.24, 0.2, 0.32, 0, 0, 0, TINT.plate);
      add(G.box, 0, 1.85, 0, 0.3, 0.26, 0.32, 0, 0, 0, TINT.dark);
      add(G.box, 0, 1.44, 0.27, 0.42, 0.44, 0.18, 0, 0, 0, TINT.dark);
      add(G.box, -0.44, 1.22, 0, 0.13, 0.52, 0.15, 0, 0, 0, TINT.dark);
    });
    const glow = bakeGeo('sent-glow', (add) => {
      add(G.box, 0, 1.87, -0.165, 0.27, 0.07, 0.03);
      add(G.box, 0, 1.52, -0.235, 0.16, 0.06, 0.03);
      add(G.box, 0, 1.52, 0.365, 0.3, 0.04, 0.02);
    });
    const leg = bakeGeo('sent-leg', (add) => {
      add(G.box, 0, -0.25, 0, 0.17, 0.5, 0.22, 0, 0, 0, TINT.plate);
      add(G.box, 0, -0.68, 0.02, 0.14, 0.46, 0.17, 0, 0, 0, TINT.dark);
      add(G.box, 0, -0.93, -0.05, 0.18, 0.08, 0.32, 0, 0, 0, TINT.steel);
    });
    const arm = bakeGeo('sent-arm', (add) => {
      add(G.box, 0, -0.06, -0.2, 0.14, 0.16, 0.46, 0, 0, 0, TINT.plate);
      add(G.cyl8, 0, -0.06, -0.58, 0.1, 0.36, 0.1, HALF_PI, 0, 0, TINT.steel);
    });
    const am = armourMaterial();
    this.mesh(body, am);
    this.mesh(glow, this.eyeMat);
    this.legs = [-1, 1].map((s) => {
      const l = this.mesh(leg, am);
      l.position.set(s * 0.2, 0.97, 0);
      return l;
    });
    this.arm = this.mesh(arm, am);
    this.arm.position.set(0.44, 1.52, 0);
  }

  think(dt) {
    const g = this.game, p = g.player;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = rand(1, 2.4);
      this.strafeDir = randSign();
    }
    let mx, mz, sp = this.speed;
    if (!this.los || this.dist > 16) {
      this.seek(_d);
      mx = _d.x; mz = _d.z;
    } else if (this.dist < 5.5) {
      mx = -this.dirX - this.dirZ * this.strafeDir * 0.6;
      mz = -this.dirZ + this.dirX * this.strafeDir * 0.6;
      sp *= 0.8;
    } else {
      const adv = this.dist > 11 ? 0.45 : 0;
      mx = -this.dirZ * this.strafeDir + this.dirX * adv;
      mz = this.dirX * this.strafeDir + this.dirZ * adv;
      sp *= 0.62;
    }
    const l = Math.hypot(mx, mz) || 1;
    if (this.burst > 0 || this.windup > 0) sp *= 0.3;
    this.vel.x = damp(this.vel.x, (mx / l) * sp, 8, dt);
    this.vel.z = damp(this.vel.z, (mz / l) * sp, 8, dt);

    this.fireT -= dt;
    if (this.windup > 0) {
      this.windup -= dt;
      this.glowK = 1 + (1 - this.windup / 0.45) * 2.5;
      if (this.windup <= 0) { this.burst = 3; this.burstT = 0; }
    } else if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
        this.shootAtPlayer(this.pos.x + fx * 0.8 + rx * 0.44, this.pos.y + 1.46, this.pos.z + fz * 0.8 + rz * 0.44, 31, 7, 0.035);
        g.audio.play('bolt', { pos: this.pos, volume: 0.8 });
        this.burst--;
        this.burstT = 0.13;
        if (!this.burst) this.glowK = 1;
      }
    } else if (this.fireT <= 0 && this.los && this.dist < 34 && p.alive) {
      this.windup = 0.45;
      this.fireT = rand(2.1, 3.1);
    }

    if (this.los) this.facePlayer(7, dt);
    else if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.5) this.face(Math.atan2(-this.vel.x, -this.vel.z), 7, dt);
  }

  animate(dt) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += sp * dt * 2.6;
    const sw = Math.sin(this.walk) * Math.min(0.7, sp * 0.22);
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    this.arm.rotation.x = this.burst > 0 ? 0.08 * Math.sin(this.t * 60) : 0;
  }
}

// ---------------------------------------------------------------- hull crawler

class Crawler extends Enemy {
  constructor(game, x, z, zone, opts) {
    super(game, { type: 'crawler', hp: 44, radius: 0.52, height: 0.85, color: [2.6, 0.25, 0.2], spheres: [{ y: 0.45, r: 0.6 }] }, x, z, zone, opts);
    this.speed = 8.2;
    this.mode = 'chase';
    this.modeT = 0;
    this.cool = rand(0, 0.5);
    this.hitDone = false;
    this.walk = 0;
    const body = bakeGeo('crawl-body', (add) => {
      add(G.sphere, 0, 0.44, 0, 1.0, 0.44, 1.3, 0, 0, 0, TINT.dark);
      add(G.box, 0, 0.64, 0.06, 0.6, 0.1, 0.8, 0, 0, 0, TINT.plate);
      add(G.box, 0.2, 0.36, -0.74, 0.08, 0.08, 0.42, 0, 0.3, 0, TINT.steel);
      add(G.box, -0.2, 0.36, -0.74, 0.08, 0.08, 0.42, 0, -0.3, 0, TINT.steel);
      add(G.box, 0, 0.5, 0.66, 0.3, 0.14, 0.3, 0, 0, 0, TINT.plate);
    });
    const glow = bakeGeo('crawl-glow', (add) => {
      add(G.sphereLo, 0, 0.5, -0.6, 0.16, 0.14, 0.12);
      add(G.sphereLo, 0.2, 0.45, -0.52, 0.11, 0.1, 0.1);
      add(G.sphereLo, -0.2, 0.45, -0.52, 0.11, 0.1, 0.1);
      add(G.box, 0, 0.7, 0.1, 0.1, 0.02, 0.6);
    });
    const leg = bakeGeo('crawl-leg', (add) => {
      add(G.box, 0.26, 0.06, 0, 0.52, 0.07, 0.08, 0, 0, 0.25, TINT.plate);
      add(G.box, 0.54, -0.14, 0, 0.07, 0.56, 0.07, 0, 0, -0.12, TINT.steel);
    });
    const am = armourMaterial();
    this.body = this.mesh(body, am);
    this.mesh(glow, this.eyeMat);
    this.legs = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const l = this.mesh(leg, am);
        l.position.set(sx * 0.36, 0.4, sz * 0.32);
        l.userData.base = (sx < 0 ? Math.PI : 0) + sx * sz * -0.5;
        l.userData.phase = sx * sz > 0 ? 0 : Math.PI;
        this.legs.push(l);
      }
    }
  }

  think(dt) {
    const g = this.game, p = g.player;
    this.cool -= dt;
    if (this.mode === 'chase') {
      let mx, mz;
      if (this.los && this.dist < 14) {
        // Weave on the approach so it is not a straight-line target.
        const zig = Math.sin(this.t * 5 + this.seed) * 0.7;
        mx = this.dirX - this.dirZ * zig;
        mz = this.dirZ + this.dirX * zig;
      } else {
        this.seek(_d);
        mx = _d.x; mz = _d.z;
      }
      const l = Math.hypot(mx, mz) || 1;
      this.vel.x = damp(this.vel.x, (mx / l) * this.speed, 9, dt);
      this.vel.z = damp(this.vel.z, (mz / l) * this.speed, 9, dt);
      if (this.dist < 3.6 && this.los && this.cool <= 0 && p.alive && this.pos.y < 0.05) {
        this.mode = 'windup';
        this.modeT = 0.27;
        g.audio.play('screech', { pos: this.pos });
      }
      if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.5) this.face(Math.atan2(-this.vel.x, -this.vel.z), 12, dt);
    } else if (this.mode === 'windup') {
      this.vel.x = damp(this.vel.x, 0, 14, dt);
      this.vel.z = damp(this.vel.z, 0, 14, dt);
      this.glowK = 3;
      this.facePlayer(16, dt);
      this.modeT -= dt;
      if (this.modeT <= 0) {
        this.mode = 'lunge';
        this.modeT = 0.55;
        this.hitDone = false;
        this.vel.x = this.dirX * 14;
        this.vel.z = this.dirZ * 14;
        this.vel.y = 4.4;
      }
    } else if (this.mode === 'lunge') {
      this.modeT -= dt;
      if (!this.hitDone && this.dist < this.radius + 0.8 && Math.abs(p.pos.y + 0.9 - (this.pos.y + 0.45)) < 1.35) {
        p.takeDamage(14, this.pos);
        this.hitDone = true;
        this.vel.x *= -0.3;
        this.vel.z *= -0.3;
      }
      if (this.modeT <= 0 || (this.pos.y <= 0 && this.modeT < 0.3)) {
        this.mode = 'recover';
        this.modeT = 0.55;
        this.cool = 0.9;
        this.glowK = 1;
      }
    } else {
      this.vel.x = damp(this.vel.x, 0, 6, dt);
      this.vel.z = damp(this.vel.z, 0, 6, dt);
      this.modeT -= dt;
      if (this.modeT <= 0) this.mode = 'chase';
    }
  }

  animate(dt) {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += (2 + sp * 2.2) * dt;
    for (const l of this.legs) {
      const a = this.walk + l.userData.phase;
      l.rotation.y = l.userData.base + Math.sin(a) * 0.45;
      l.rotation.z = Math.max(0, Math.cos(a)) * 0.35;
    }
    this.body.scale.y = this.mode === 'windup' ? 0.72 : 1;
    this.body.position.y = Math.abs(Math.sin(this.walk * 2)) * 0.03;
  }
}

// ---------------------------------------------------------------- juggernaut

class Juggernaut extends Enemy {
  constructor(game, x, z, zone, opts) {
    super(game, {
      type: 'juggernaut', hp: 520, radius: 0.98, height: 3.1, color: [2.6, 0.9, 0.12],
      spheres: [{ y: 0.75, r: 0.8 }, { y: 1.95, r: 1.0 }, { y: 3.08, r: 0.46, crit: true }],
    }, x, z, zone, opts);
    this.speed = 2.35;
    this.attack = null;
    this.attackT = 0;
    this.fired = 0;
    this.slammed = false;
    this.rocketT = rand(1.5, 3);
    this.slamT = 1;
    this.strafeDir = randSign();
    this.walk = 0;
    this.stepSide = 1;
    const body = bakeGeo('jugg-body', (add) => {
      add(G.box, 0, 1.36, 0, 1.1, 0.5, 0.8, 0, 0, 0, TINT.dark);
      add(G.box, 0, 2.16, 0, 1.7, 1.2, 1.1, 0, 0, 0, TINT.plate);
      add(G.box, 0, 2.22, -0.6, 1.3, 0.8, 0.14, 0, 0, 0, TINT.steel);
      add(G.box, 1.15, 2.58, 0, 0.62, 0.62, 0.92, 0, 0, 0, TINT.dark);
      add(G.box, -1.15, 2.58, 0, 0.62, 0.62, 0.92, 0, 0, 0, TINT.dark);
      add(G.box, 0, 2.86, 0, 0.62, 0.22, 0.62, 0, 0, 0, TINT.dark);
      add(G.box, 0, 2.2, 0.72, 1.2, 1.0, 0.4, 0, 0, 0, TINT.dark);
      add(G.cyl8, 0.4, 2.95, 0.8, 0.16, 0.6, 0.16, 0, 0, 0, TINT.steel);
      add(G.cyl8, -0.4, 2.95, 0.8, 0.16, 0.6, 0.16, 0, 0, 0, TINT.steel);
      add(G.box, 0, 1.75, -0.57, 0.9, 0.12, 0.1, 0, 0, 0, TINT.warn);
    });
    const glow = bakeGeo('jugg-glow', (add) => {
      add(G.sphere, 0, 3.1, 0, 0.72, 0.72, 0.72);
      add(G.box, 0, 2.42, -0.68, 0.7, 0.06, 0.03);
      for (const sx of [-1, 1]) for (const dx of [-0.14, 0.14]) for (const dy of [-0.14, 0.14]) add(G.box, sx * 1.15 + dx, 2.58 + dy, -0.47, 0.16, 0.16, 0.04);
    });
    const leg = bakeGeo('jugg-leg', (add) => {
      add(G.box, 0, -0.35, 0, 0.5, 0.7, 0.6, 0, 0, 0, TINT.plate);
      add(G.box, 0, -0.92, 0.03, 0.42, 0.6, 0.5, 0, 0, 0, TINT.dark);
      add(G.box, 0, -1.19, -0.1, 0.56, 0.16, 0.9, 0, 0, 0, TINT.steel);
    });
    const arm = bakeGeo('jugg-arm', (add) => {
      add(G.box, 0, -0.5, 0, 0.4, 0.9, 0.45, 0, 0, 0, TINT.dark);
      add(G.box, 0, -1.1, -0.05, 0.5, 0.5, 0.55, 0, 0, 0, TINT.steel);
    });
    const am = armourMaterial();
    this.mesh(body, am);
    this.mesh(glow, this.eyeMat);
    this.legs = [-1, 1].map((s) => {
      const l = this.mesh(leg, am);
      l.position.set(s * 0.42, 1.27, 0);
      return l;
    });
    this.arms = [-1, 1].map((s) => {
      const a = this.mesh(arm, am);
      a.position.set(s * 1.15, 2.3, 0);
      return a;
    });
  }

  // Plating shrugs off body shots; the exposed core does not.
  armour(crit) {
    return crit ? 1.25 : 0.55;
  }

  think(dt) {
    const g = this.game, p = g.player;
    if (this.attack) {
      this.attackT -= dt;
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
      this.facePlayer(3, dt);
      if (this.attack === 'rockets') {
        this.glowK = 1 + Math.min(1, (1.3 - this.attackT) / 0.8) * 2.5;
        const due = this.attackT < 0.25 ? 2 : this.attackT < 0.5 ? 1 : 0;
        while (this.fired < due) {
          const s = this.fired === 0 ? 1 : -1;
          const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
          const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
          this.shootAtPlayer(this.pos.x + rx * 1.15 * s + fx * 0.6, this.pos.y + 2.6, this.pos.z + rz * 1.15 * s + fz * 0.6, 15, 30, 0.02, { kind: 'rocket', splash: 4.2, radius: 0.22 });
          g.audio.play('rocket', { pos: this.pos });
          this.fired++;
        }
      } else if (this.attack === 'slam' && !this.slammed && this.attackT <= 0.25) {
        this.slammed = true;
        g.fx.ring(this.pos.x, 0.1, this.pos.z, [2.4, 0.6, 0.15], 7, 0.5);
        g.fx.burst(this.pos.x, 0.3, this.pos.z, [1.2, 0.6, 0.2], 26, 9, 0.4, 0.6, 6, 1);
        g.fx.flash(this.pos.x, 1, this.pos.z, [1, 0.5, 0.15], 200, 14, 0.3);
        g.audio.play('slam', { pos: this.pos });
        g.fx.shake(Math.max(0, 0.9 - this.dist * 0.06));
        if (this.dist < 6.4 && p.pos.y < 0.9) {
          p.takeDamage(28, this.pos);
          p.vel.x += this.dirX * 10;
          p.vel.z += this.dirZ * 10;
          p.vel.y = 5.5;
          p.onGround = false;
        }
      }
      if (this.attackT <= 0) { this.attack = null; this.glowK = 1; }
      return;
    }

    let mx, mz, sp = this.speed;
    if (!this.los || this.dist > 9) {
      this.seek(_d);
      mx = _d.x; mz = _d.z;
    } else {
      mx = -this.dirZ * this.strafeDir + this.dirX * 0.4;
      mz = this.dirX * this.strafeDir + this.dirZ * 0.4;
      sp *= 0.6;
      if (Math.random() < dt * 0.3) this.strafeDir *= -1;
    }
    const l = Math.hypot(mx, mz) || 1;
    this.vel.x = damp(this.vel.x, (mx / l) * sp, 4, dt);
    this.vel.z = damp(this.vel.z, (mz / l) * sp, 4, dt);
    if (this.los) this.facePlayer(2.6, dt);
    else this.face(Math.atan2(-this.vel.x, -this.vel.z), 2.6, dt);

    this.rocketT -= dt;
    this.slamT -= dt;
    if (!p.alive) return;
    if (this.dist < 5.4 && this.slamT <= 0) {
      this.attack = 'slam';
      this.attackT = 0.95;
      this.slammed = false;
      this.slamT = 3.2;
      g.audio.play('charge', { pos: this.pos });
      g.fx.ring(this.pos.x, 0.08, this.pos.z, [2.2, 0.3, 0.1], 6.4, 0.7);
    } else if (this.rocketT <= 0 && this.los && this.dist < 42 && this.dist > 4.5) {
      this.attack = 'rockets';
      this.attackT = 1.3;
      this.fired = 0;
      this.rocketT = rand(3.6, 4.8);
      g.audio.play('charge', { pos: this.pos });
    }
  }

  animate(dt) {
    const g = this.game;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.walk += sp * dt * 1.5;
    const s = Math.sin(this.walk);
    const sw = s * Math.min(0.5, sp * 0.3);
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    // Each footfall lands with a thud you can feel.
    if (sp > 0.6 && Math.sign(s) !== this.stepSide) {
      this.stepSide = Math.sign(s);
      g.audio.play('land', { pos: this.pos, volume: 1.4 });
      g.fx.shake(Math.max(0, 0.16 - this.dist * 0.012));
    }
    let raise = 0;
    if (this.attack === 'slam') raise = this.slammed ? 0.4 : -2.4 * Math.min(1, (0.95 - this.attackT) / 0.6);
    this.arms[0].rotation.x = damp(this.arms[0].rotation.x, raise - sw * 0.5, 12, dt);
    this.arms[1].rotation.x = damp(this.arms[1].rotation.x, raise + sw * 0.5, 12, dt);
  }

  die() {
    const g = this.game;
    g.fx.explosion(this.pos.x, 2, this.pos.z, 4);
    g.audio.play('explosion', { pos: this.pos });
    super.die();
  }
}

const TYPES = { drone: Drone, sentinel: Sentinel, crawler: Crawler, juggernaut: Juggernaut, warden: Warden, pylon: Pylon };

// ---------------------------------------------------------------- manager

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.boss = null;
    this._one = { enemy: null, t: 0, crit: false };
  }

  spawn(type, x, z, zone, opts) {
    const e = new TYPES[type](this.game, x, z, zone, opts);
    this.list.push(e);
    if (type === 'warden') this.boss = e;
    return e;
  }

  // Materialise every hostile placed in a zone, one after another.
  spawnZone(zone) {
    const made = [];
    for (const s of this.game.level.spawns) {
      if (s.zone !== zone) continue;
      made.push(this.spawn(s.type, s.x, s.z, zone, { delay: 0.3 + made.length * 0.24 }));
    }
    const boss = made.find((e) => e.type === 'warden');
    if (boss) boss.pylons = made.filter((e) => e.type === 'pylon');
    return made.length;
  }

  remaining(zone) {
    let n = 0;
    for (const e of this.list) if (e.alive && e.zone === zone && e.counts) n++;
    return n;
  }

  // Hostiles that are up and fighting right now (drives music and alarm lighting).
  engaged() {
    let n = 0;
    for (const e of this.list) if (e.alive && e.type !== 'pylon') n++;
    return n;
  }

  onKilled(e) {
    this.game.onEnemyKilled(e);
  }

  killAdds(zone) {
    for (const e of this.list) if (e.alive && e.zone === zone && !e.counts) e.die();
  }

  update(dt) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) if (list[i].alive) list[i].update(dt);

    // Keep bodies from stacking inside each other.
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive || a.static || a.spawnT > 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive || b.static || b.spawnT > 0 || a.flying !== b.flying) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.5;
        a.pos.x -= dx * push; a.pos.z -= dz * push;
        b.pos.x += dx * push; b.pos.z += dz * push;
      }
    }

    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].alive) {
        if (list[i] === this.boss) this.boss = null;
        list[i].dispose();
        list.splice(i, 1);
      }
    }
  }

  _test(e, o, d, maxDist, out) {
    let best = maxDist, crit = false, found = false;
    for (const s of e.spheres) {
      const cx = e.pos.x - o.x, cy = e.pos.y + s.y - o.y, cz = e.pos.z - o.z;
      const tca = cx * d.x + cy * d.y + cz * d.z;
      const c2 = cx * cx + cy * cy + cz * cz;
      const r2 = s.r * s.r;
      if (tca < 0 && c2 > r2) continue;
      const m2 = c2 - tca * tca;
      if (m2 > r2) continue;
      const t = Math.max(0, tca - Math.sqrt(r2 - m2));
      if (t < best) { best = t; crit = !!s.crit; found = true; }
    }
    if (!found) return false;
    out.t = best;
    out.crit = crit;
    return true;
  }

  // Nearest hostile along a ray, or null.
  raycast(o, d, maxDist) {
    const out = this._one;
    let hit = null, best = maxDist;
    const tmp = { t: 0, crit: false };
    for (const e of this.list) {
      if (!e.alive || e.spawnT > 0) continue;
      if (this._test(e, o, d, best, tmp)) {
        best = tmp.t;
        out.enemy = e; out.t = tmp.t; out.crit = tmp.crit;
        hit = out;
      }
    }
    return hit;
  }

  // Every hostile along a ray, nearest first (for piercing shots).
  raycastAll(o, d, maxDist) {
    const hits = [];
    for (const e of this.list) {
      if (!e.alive || e.spawnT > 0) continue;
      const tmp = { enemy: e, t: 0, crit: false };
      if (this._test(e, o, d, maxDist, tmp)) hits.push(tmp);
    }
    return hits.sort((a, b) => a.t - b.t);
  }

  damageRadius(x, y, z, radius, damage) {
    for (const e of this.list) {
      if (!e.alive || e.spawnT > 0) continue;
      const d = Math.hypot(e.pos.x - x, e.centerY - y, e.pos.z - z) - e.radius;
      if (d > radius) continue;
      _p.set(e.pos.x, e.centerY, e.pos.z);
      _n.set(e.pos.x - x, 0.4, e.pos.z - z).normalize();
      e.takeDamage(damage * (1 - (Math.max(0, d) / radius) * 0.7), _p, _n, false);
    }
  }

  clear() {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
    this.boss = null;
  }
}

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
