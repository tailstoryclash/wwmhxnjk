// Enemy ordnance: glowing bolts and rockets, pooled and swept against the
// level and the player every frame.

import * as THREE from 'three';
import { G } from '../gfx/geo.js';

const _z = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _hit = { t: 0, nx: 0, ny: 0, nz: 0, kind: null, ref: null };

// Distance along a normalised ray to a sphere, 0 if starting inside, -1 on a miss.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const c2 = lx * lx + ly * ly + lz * lz;
  const r2 = r * r;
  if (c2 <= r2) return 0;
  if (tca < 0) return -1;
  const m2 = c2 - tca * tca;
  if (m2 > r2) return -1;
  return tca - Math.sqrt(r2 - m2);
}

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.pool = [];
    this.active = [];
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
  }

  _get() {
    let p = this.pool.pop();
    if (!p) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const mesh = new THREE.Mesh(G.sphereLo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      p = { mesh, mat, color: [1, 1, 1] };
    }
    return p;
  }

  spawn({ x, y, z, dx, dy, dz, speed, damage, color, radius = 0.14, splash = 0, kind = 'bolt', life = 5 }) {
    if (this.active.length > 140) return;
    const p = this._get();
    p.x = x; p.y = y; p.z = z;
    p.dx = dx; p.dy = dy; p.dz = dz;
    p.speed = speed;
    p.damage = damage;
    p.radius = radius;
    p.splash = splash;
    p.kind = kind;
    p.life = life;
    p.trail = 0;
    p.color = color;
    p.mat.color.setRGB(color[0] * 1.6, color[1] * 1.6, color[2] * 1.6);
    p.mesh.quaternion.setFromUnitVectors(_z, _d.set(dx, dy, dz));
    const w = radius * 2;
    p.mesh.scale.set(w, w, kind === 'rocket' ? w * 3 : w * 4.5);
    p.mesh.position.set(x, y, z);
    p.mesh.visible = true;
    this.active.push(p);
  }

  _release(i) {
    const p = this.active[i];
    p.mesh.visible = false;
    this.active.splice(i, 1);
    this.pool.push(p);
  }

  update(dt) {
    const g = this.game, level = g.level, player = g.player, fx = g.fx;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      const step = p.speed * dt;
      const world = level.raycast(p.x, p.y, p.z, p.dx, p.dy, p.dz, step, _hit);
      let t = world ? _hit.t : step;
      let struck = false;

      if (player.alive) {
        const r = p.radius;
        const a = raySphere(p.x, p.y, p.z, p.dx, p.dy, p.dz, player.pos.x, player.pos.y + 0.95, player.pos.z, 0.55 + r);
        const b = raySphere(p.x, p.y, p.z, p.dx, p.dy, p.dz, player.pos.x, player.pos.y + 1.55, player.pos.z, 0.3 + r);
        const tp = a < 0 ? b : b < 0 ? a : Math.min(a, b);
        if (tp >= 0 && tp <= t) {
          t = tp;
          struck = true;
        }
      }

      p.x += p.dx * t; p.y += p.dy * t; p.z += p.dz * t;

      if (struck || world || p.life <= 0) {
        if (struck && !p.splash) {
          _d.set(p.x - p.dx * 3, p.y, p.z - p.dz * 3);
          player.takeDamage(p.damage, _d);
          fx.burst(p.x, p.y, p.z, p.color, 6, 3, 0.2, 0.3);
        } else if (p.splash) {
          const ox = world && !struck ? _hit.nx * 0.25 : 0, oy = world && !struck ? _hit.ny * 0.25 : 0, oz = world && !struck ? _hit.nz * 0.25 : 0;
          g.explode(p.x + ox, p.y + oy, p.z + oz, p.splash, p.damage, { enemyScale: 0.5 });
        } else if (world) {
          fx.sparks(p.x, p.y, p.z, _hit.nx, _hit.ny, _hit.nz, p.color, 5, 4);
          if (_hit.ref && _hit.ref.type === 'barrel') g.damageBarrel(_hit.ref, p.damage);
        }
        this._release(i);
        continue;
      }

      p.mesh.position.set(p.x, p.y, p.z);
      if (p.kind === 'rocket') {
        p.trail -= dt;
        if (p.trail <= 0) {
          p.trail = 0.02;
          fx.particles.emit(p.x, p.y, p.z, -p.dx * 2 + (Math.random() - 0.5), -p.dy * 2 + (Math.random() - 0.5), -p.dz * 2 + (Math.random() - 0.5), 0.45, 0.3, 1.4, 0.6, 0.15, 0, 2, 0.8);
        }
      }
    }
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this._release(i);
  }
}
