// Supplies, weapons and data logs placed in the level, plus the small drops
// left behind by destroyed frames.

import * as THREE from 'three';
import { G } from '../gfx/geo.js';
import { WEAPONS } from './weapons.js';

const STYLE = {
  health: { color: [0.3, 2.2, 0.7], label: 'Medical gel' },
  shield: { color: [0.3, 1.2, 2.6], label: 'Shield cell' },
  ammo: { color: [2.4, 1.3, 0.25], label: 'Ammunition' },
  weapon: { color: [2.2, 2.2, 2.4], label: 'Weapon' },
  log: { color: [2.3, 0.6, 2.2], label: 'Data log' },
  healthOrb: { color: [0.3, 2.2, 0.7] },
  ammoOrb: { color: [2.4, 1.3, 0.25] },
};

let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    shell: new THREE.MeshStandardMaterial({ color: 0xd9dee4, roughness: 0.35, metalness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.45, metalness: 0.8 }),
  };
  return mats;
}

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
  }

  _model(kind, glow) {
    const M = materials();
    const g = new THREE.Group();
    const add = (geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.set(rx, ry, rz);
      g.add(m);
      return m;
    };
    if (kind === 'health') {
      add(G.box, M.shell, 0, 0, 0, 0.46, 0.34, 0.2);
      add(G.box, glow, 0, 0, 0.105, 0.26, 0.08, 0.01);
      add(G.box, glow, 0, 0, 0.105, 0.08, 0.26, 0.01);
      add(G.box, glow, 0, 0, -0.105, 0.26, 0.08, 0.01);
      add(G.box, glow, 0, 0, -0.105, 0.08, 0.26, 0.01);
      add(G.box, M.dark, 0, 0.2, 0, 0.2, 0.06, 0.08);
    } else if (kind === 'shield') {
      add(G.ico0, glow, 0, 0, 0, 0.3, 0.3, 0.3);
      add(G.torus, M.dark, 0, 0, 0, 0.56, 0.56, 0.56, Math.PI / 2);
      add(G.torus, M.shell, 0, 0, 0, 0.5, 0.5, 0.5);
    } else if (kind === 'ammo') {
      add(G.box, M.dark, 0, 0, 0, 0.46, 0.26, 0.28);
      add(G.box, glow, 0, 0.02, 0.142, 0.34, 0.08, 0.01);
      add(G.box, glow, 0, 0.02, -0.142, 0.34, 0.08, 0.01);
      for (let k = -1; k <= 1; k++) add(G.cyl8, M.shell, k * 0.12, 0.17, 0, 0.07, 0.1, 0.07);
    } else if (kind === 'log') {
      add(G.box, M.dark, 0, 0, 0, 0.34, 0.46, 0.04, 0.2);
      add(G.box, glow, 0, 0.01, 0.024, 0.27, 0.36, 0.005, 0.2);
    } else if (kind === 'weapon') {
      add(G.box, M.dark, 0, 0, 0, 0.9, 0.16, 0.1);
      add(G.box, M.shell, 0.18, -0.12, 0, 0.1, 0.2, 0.08, 0, 0, 0.3);
      add(G.cyl8, M.shell, -0.5, 0.02, 0, 0.05, 0.3, 0.05, 0, 0, Math.PI / 2);
      add(G.box, glow, 0, 0.03, 0.052, 0.6, 0.03, 0.005);
      add(G.box, glow, 0, 0.03, -0.052, 0.6, 0.03, 0.005);
    } else {
      add(G.sphereLo, glow, 0, 0, 0, 0.22, 0.22, 0.22);
    }
    return g;
  }

  _add(kind, x, z, data = {}) {
    const style = STYLE[kind];
    const c = style.color;
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]) });
    const root = new THREE.Group();
    const model = this._model(kind, glow);
    root.add(model);
    const orb = kind === 'healthOrb' || kind === 'ammoOrb';
    let column = null;
    if (!orb) {
      // Soft light pillar so supplies read from across a room.
      const beam = new THREE.MeshBasicMaterial({
        color: new THREE.Color(c[0] * 0.09, c[1] * 0.09, c[2] * 0.09),
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      column = new THREE.Mesh(G.tube, beam);
      column.scale.set(0.7, kind === 'weapon' || kind === 'log' ? 3.4 : 2.2, 0.7);
      column.position.y = column.scale.y / 2 - 0.9;
      column.renderOrder = 7;
      root.add(column);
      const disc = new THREE.Mesh(G.cyl16, glow);
      disc.scale.set(0.7, 0.02, 0.7);
      disc.position.y = -0.88;
      root.add(disc);
    }
    root.position.set(x, orb ? 0.5 : 0.95, z);
    this.group.add(root);
    const p = { kind, x, z, root, model, glow, column, t: Math.random() * 6, life: orb ? 22 : Infinity, vy: 0, ...data };
    this.list.push(p);
    return p;
  }

  // Place everything the map defines, skipping what a restored checkpoint already collected.
  spawnLevel(collected) {
    for (const d of this.game.level.pickupDefs) {
      if (collected.has(d.id)) continue;
      this._add(d.kind, d.x, d.z, { id: d.id, weapon: d.weapon, log: d.log });
    }
  }

  drop(kind, x, z) {
    const p = this._add(kind, x, z);
    p.vy = 4;
    return p;
  }

  update(dt) {
    const g = this.game, player = g.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.life -= dt;
      p.model.rotation.y = p.t * 1.6;
      const orb = p.life !== Infinity;
      if (orb) {
        // Drops hop out of the wreck, settle, then drift towards the player.
        p.vy -= 14 * dt;
        p.root.position.y = Math.max(0.45, p.root.position.y + p.vy * dt);
        const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 4 && d > 0.01 && player.alive) {
          const pull = (4 - d) * 4 * dt;
          p.x += (dx / d) * pull; p.z += (dz / d) * pull;
          p.root.position.x = p.x; p.root.position.z = p.z;
        }
        if (p.life < 3) p.root.visible = Math.sin(p.life * 18) > -0.3;
      } else {
        p.model.position.y = Math.sin(p.t * 2.2) * 0.08;
      }
      if (p.life <= 0) { this._remove(i); continue; }
      if (!player.alive) continue;
      const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
      if (dx * dx + dz * dz < 1.5 * 1.5 && Math.abs(player.pos.y - 0) < 2.2 && this._collect(p)) {
        g.fx.burst(p.x, 1, p.z, STYLE[p.kind].color, 14, 3, 0.2, 0.5);
        this._remove(i);
      }
    }
  }

  _collect(p) {
    const g = this.game, player = g.player, w = g.weapons;
    switch (p.kind) {
      case 'health':
        if (player.health >= player.maxHealth) return false;
        player.heal(40);
        g.hud.toast('+40 Health', 'good');
        break;
      case 'healthOrb':
        if (player.health >= player.maxHealth) return false;
        player.heal(12);
        break;
      case 'shield':
        if (player.shield >= player.maxShield) return false;
        player.addShield(60);
        g.hud.toast('Shield cell absorbed', 'good');
        break;
      case 'ammo':
        if (!w.addAmmo(1)) return false;
        g.hud.toast('Ammunition restocked', 'good');
        break;
      case 'ammoOrb':
        if (!w.addAmmo(0.4)) return false;
        break;
      case 'weapon': {
        const def = WEAPONS[p.weapon];
        const fresh = w.give(p.weapon);
        g.hud.toast(fresh ? `${def.name} acquired` : `${def.name} ammunition`, 'good');
        g.audio.play('weapon');
        g.mission.collect(p);
        if (fresh) g.mission.emit('weapon:' + p.weapon);
        return true;
      }
      case 'log':
        g.mission.collect(p);
        g.collectLog(p.log);
        return true;
      default:
        return false;
    }
    g.audio.play('pickup');
    if (p.id) g.mission.collect(p);
    return true;
  }

  _remove(i) {
    const p = this.list[i];
    p.root.removeFromParent();
    p.glow.dispose();
    p.column?.material.dispose();
    this.list.splice(i, 1);
  }

  clear() {
    for (let i = this.list.length - 1; i >= 0; i--) this._remove(i);
  }
}

export { STYLE as PICKUP_STYLE };
