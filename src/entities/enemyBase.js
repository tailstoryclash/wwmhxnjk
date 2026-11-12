// Shared foundation for every hostile: lifecycle, sensing, damage and the
// helpers used to build their procedural models.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { xf } from '../gfx/geo.js';
import { clamp, dampAngle, rand } from '../core/utils.js';

export const TINT = {
  dark: [0.04, 0.045, 0.055],
  plate: [0.19, 0.215, 0.25],
  steel: [0.42, 0.45, 0.5],
  warn: [0.5, 0.2, 0.05],
};

const WHITE = [1, 1, 1];
const geoCache = new Map();
let bodyMat = null;
let plainMat = null;

// Vertex-coloured armour shared by all baked enemy bodies.
export function armourMaterial() {
  return (bodyMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.82 }));
}

// For un-baked primitives (which carry no vertex colours).
export function plainMaterial() {
  return (plainMat ||= new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.4, metalness: 0.85 }));
}

// Merge a set of tinted primitives into one cached geometry.
// fn receives add(geo, x, y, z, sx, sy, sz, rx, ry, rz, tint).
export function bakeGeo(key, fn) {
  if (geoCache.has(key)) return geoCache.get(key);
  const list = [];
  fn((geo, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, tint = WHITE) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    g.applyMatrix4(xf(x, y, z, sx, sy, sz, rx, ry, rz));
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      col[i * 3] = tint[0]; col[i * 3 + 1] = tint[1]; col[i * 3 + 2] = tint[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.userData = {};
    list.push(g);
  });
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  merged.userData.shared = true;
  geoCache.set(key, merged);
  return merged;
}

export class Enemy {
  constructor(game, cfg, x, z, zone, opts = {}) {
    this.game = game;
    this.type = cfg.type;
    this.zone = zone;
    this.counts = opts.counts !== false; // counts towards clearing its zone
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * 6.283;
    this.radius = cfg.radius;
    this.height = cfg.height;
    this.maxHp = this.hp = cfg.hp * game.difficulty.enemyHealth;
    this.spheres = cfg.spheres; // hit shapes: [{ y, r, crit }] relative to pos
    this.color = cfg.color;
    this.flying = !!cfg.flying;
    this.static = false;
    this.alive = true;
    this.active = false; // false until the warp-in finishes
    this.spawnT = opts.delay || 0.01;
    this.warpT = 0.55;
    this.seed = Math.random() * 100;
    this.t = 0;
    this.losT = Math.random() * 0.2;
    this.los = false;
    this.dist = 99;
    this.dirX = 0;
    this.dirZ = -1;
    this.flashT = 0;
    this.glowK = 1; // subclasses raise this while winding up an attack
    this.group = new THREE.Group();
    this.group.visible = false;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.color[0], cfg.color[1], cfg.color[2]) });
    game.engine.scene.add(this.group);
  }

  mesh(geo, mat, parent = this.group) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = mat !== this.eyeMat;
    parent.add(m);
    return m;
  }

  get centerY() {
    return this.flying ? this.pos.y : this.pos.y + this.height * 0.55;
  }

  aimY() {
    return this.flying ? this.pos.y : this.pos.y + this.height * 0.8;
  }

  update(dt) {
    const g = this.game;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      if (this.spawnT > 0) return;
      this.group.visible = true;
      this.group.scale.setScalar(0.01);
      this.group.position.copy(this.pos);
      g.fx.warp(this.pos.x, this.flying ? Math.max(0, this.pos.y - 1) : 0, this.pos.z, this.color, this.height + 0.5);
      g.audio.play('warp', { pos: this.pos });
    }
    this.t += dt;
    if (this.warpT > 0) {
      this.warpT -= dt;
      const k = clamp(1 - this.warpT / 0.55, 0, 1);
      this.group.scale.setScalar(Math.max(0.01, k * k * (3 - 2 * k)));
      if (this.warpT <= 0) this.active = true;
    }
    this.sense(dt);
    if (this.active) this.think(dt);
    this.move(dt);
    this.flashT = Math.max(0, this.flashT - dt);
    const k = this.glowK + (this.flashT > 0 ? 3 : 0);
    this.eyeMat.color.setRGB(this.color[0] * k, this.color[1] * k, this.color[2] * k);
    this.animate(dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }

  sense(dt) {
    const p = this.game.player;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
    this.dist = Math.hypot(dx, dz) || 0.001;
    this.dirX = dx / this.dist;
    this.dirZ = dz / this.dist;
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.16 + Math.random() * 0.1;
      this.los = p.alive && this.game.level.lineOfSight(this.pos.x, this.aimY(), this.pos.z, p.pos.x, p.pos.y + 1.3, p.pos.z);
    }
  }

  // Direction towards the player along a walkable route.
  seek(out) {
    if (this.game.level.flowDir(this.pos.x, this.pos.z, out)) return;
    out.x = this.dirX;
    out.z = this.dirZ;
  }

  face(yaw, rate, dt) {
    this.yaw = dampAngle(this.yaw, yaw, rate, dt);
  }

  facePlayer(rate, dt) {
    this.face(Math.atan2(-this.dirX, -this.dirZ), rate, dt);
  }

  think() {}

  animate() {}

  // Ground movement with wall/prop collision and gravity.
  move(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.game.level.resolveCircle(this.pos, this.radius, this.pos.y + 0.45, this.pos.y + this.height);
    if (this.pos.y > 0 || this.vel.y > 0) {
      this.vel.y -= 22 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vel.y = 0;
      }
    }
  }

  // Launch a bolt at where the player will be, with a little scatter.
  shootAtPlayer(ox, oy, oz, speed, damage, spread, extra) {
    const g = this.game, p = g.player;
    const ty = p.pos.y + 1.15;
    const d = Math.hypot(p.pos.x - ox, ty - oy, p.pos.z - oz);
    const lead = (d / speed) * g.difficulty.lead;
    let dx = p.pos.x + p.vel.x * lead - ox, dy = ty - oy, dz = p.pos.z + p.vel.z * lead - oz;
    let l = Math.hypot(dx, dy, dz) || 1;
    dx = dx / l + rand(-spread, spread);
    dy = dy / l + rand(-spread, spread) * 0.6;
    dz = dz / l + rand(-spread, spread);
    l = Math.hypot(dx, dy, dz);
    g.projectiles.spawn({ x: ox, y: oy, z: oz, dx: dx / l, dy: dy / l, dz: dz / l, speed, damage, color: this.color, ...extra });
  }

  armour() {
    return 1;
  }

  onHurt() {}

  // Returns 'blocked', 'hit' or 'killed'.
  takeDamage(amount, point, dir, crit) {
    if (!this.alive || this.spawnT > 0) return 'blocked';
    const g = this.game;
    const dealt = amount * this.armour(crit);
    this.hp -= dealt;
    this.flashT = 0.1;
    g.fx.sparks(point.x, point.y, point.z, -dir.x, -dir.y, -dir.z, this.color, crit ? 10 : 5, 5);
    g.stats.damage += dealt;
    this.onHurt(dealt, dir);
    if (this.hp <= 0) {
      this.die();
      return 'killed';
    }
    return 'hit';
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    const g = this.game, y = this.centerY;
    g.fx.burst(this.pos.x, y, this.pos.z, this.color, 20, 7, 0.32, 0.6);
    g.fx.burst(this.pos.x, y, this.pos.z, [1.5, 0.8, 0.3], 10, 4, 0.5, 0.45);
    g.fx.debris(this.pos.x, y, this.pos.z, this.radius > 0.8 ? 10 : 5, 5 + this.radius * 3);
    g.fx.flash(this.pos.x, y, this.pos.z, this.color, 140, 12, 0.25);
    g.audio.play('die', { pos: this.pos });
    g.enemies.onKilled(this);
  }

  dispose() {
    this.group.removeFromParent();
    this.eyeMat.dispose();
  }
}
