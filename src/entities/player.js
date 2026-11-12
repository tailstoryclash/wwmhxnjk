// First-person controller: movement, collision, camera feel, shields and health.

import * as THREE from 'three';
import { PLAYER, GRAVITY } from '../core/constants.js';
import { clamp, damp } from '../core/utils.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.maxHealth = 100;
    this.maxShield = 100;
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.shield = this.maxShield;
    this.alive = true;
    this.onGround = true;
    this.sprinting = false;
    this.ads = false;
    this.speedXZ = 0;
    this.bob = 0;
    this.bobAmt = 0;
    this.eyeH = PLAYER.eye;
    this.recoil = 0;
    this.roll = 0;
    this.landDip = 0;
    this.sinceDamage = 99;
    this.regen = false;
    this.stepAcc = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.heartT = 0;
    this.interact = null;
    this.invulnerable = false;
  }

  update(dt) {
    const g = this.game, input = g.input, level = g.level, s = g.save.settings;
    if (!this.alive) {
      this.eyeH = damp(this.eyeH, 0.3, 4, dt);
      this.roll = damp(this.roll, 0.55, 3, dt);
      this.pitch = damp(this.pitch, -0.25, 3, dt);
      this.vel.x = damp(this.vel.x, 0, 5, dt);
      this.vel.z = damp(this.vel.z, 0, 5, dt);
      this._camera(dt, s);
      return;
    }

    // Look.
    const sens = 0.0022 * s.sensitivity * (this.ads ? 0.62 : 1);
    this.yaw -= input.dx * sens;
    this.pitch -= input.dy * sens * (s.invertY ? -1 : 1);
    const turn = 2.3 * dt;
    if (input.down('ArrowLeft')) this.yaw += turn;
    if (input.down('ArrowRight')) this.yaw -= turn;
    if (input.down('ArrowUp')) this.pitch += turn * 0.7;
    if (input.down('ArrowDown')) this.pitch -= turn * 0.7;
    this.pitch = clamp(this.pitch, -1.5, 1.5);

    // Move.
    let mx = 0, mz = 0;
    if (input.down('KeyW')) mz -= 1;
    if (input.down('KeyS')) mz += 1;
    if (input.down('KeyA')) mx -= 1;
    if (input.down('KeyD')) mx += 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = cos * mx + sin * mz;
    const wz = -sin * mx + cos * mz;
    this.sprinting = (input.down('ShiftLeft') || input.down('ShiftRight')) && mz < 0 && !this.ads;
    const speed = this.sprinting ? 9.4 : this.ads ? 3.8 : 6.3;
    const accel = this.onGround ? 13 : 2.6;
    this.vel.x = damp(this.vel.x, wx * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wz * speed, accel, dt);

    if (input.hit('Space')) this.jumpBuffer = 0.12;
    this.jumpBuffer -= dt;
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vel.y = 7.4;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      g.audio.play('jump');
    }
    this.vel.y -= GRAVITY * dt;

    // Sub-step the horizontal move so fast motion cannot tunnel through thin props.
    const px = this.pos.x, pz = this.pos.z;
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let i = 0; i < steps; i++) {
      this.pos.x += dx / steps;
      this.pos.z += dz / steps;
      level.resolveCircle(this.pos, PLAYER.radius, this.pos.y + PLAYER.step, this.pos.y + PLAYER.height);
    }
    this.speedXZ = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(dt, 1e-4);

    this.pos.y += this.vel.y * dt;
    const ground = level.groundHeight(this.pos.x, this.pos.z, PLAYER.radius * 0.7, this.pos.y, PLAYER.step);
    if (this.pos.y <= ground) {
      if (!this.onGround && this.vel.y < -7) {
        this.landDip = Math.min(0.22, -this.vel.y * 0.014);
        g.audio.play('land');
      }
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.02) {
      this.onGround = false;
    }

    // Footsteps and view bob.
    if (this.onGround && this.speedXZ > 1) {
      this.bob += this.speedXZ * dt * 1.15;
      this.stepAcc += this.speedXZ * dt;
      if (this.stepAcc > 2.3) {
        this.stepAcc = 0;
        if (level.isWater(this.pos.x, this.pos.z)) {
          g.audio.play('splash');
          g.fx.burst(this.pos.x, 0.08, this.pos.z, [0.3, 0.5, 0.55], 5, 1.6, 0.12, 0.4, 5, 1);
        } else g.audio.play('step');
      }
    }
    this.bobAmt = damp(this.bobAmt, this.onGround ? Math.min(1, this.speedXZ / 6) : 0, 8, dt);

    // Shields recharge after a few seconds out of the line of fire.
    this.sinceDamage += dt;
    if (this.sinceDamage > 3.5 && this.shield < this.maxShield) {
      if (!this.regen) {
        this.regen = true;
        g.audio.play('shieldUp');
      }
      this.shield = Math.min(this.maxShield, this.shield + 30 * dt);
    }
    if (this.health < 30) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 1.1;
        g.audio.play('heartbeat', { volume: 0.6 });
      }
    }

    this._camera(dt, s);
    this._interaction();
  }

  _camera(dt, s) {
    const g = this.game, cam = g.engine.camera;
    this.recoil = damp(this.recoil, 0, 9, dt);
    this.landDip = damp(this.landDip, 0, 8, dt);
    this.eyeH = this.alive ? damp(this.eyeH, PLAYER.eye, 12, dt) : this.eyeH;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    if (this.alive) {
      const side = this.vel.x * cos - this.vel.z * sin;
      this.roll = damp(this.roll, -side * 0.0042, 8, dt);
    }
    const bobY = Math.sin(this.bob * 2) * 0.042 * this.bobAmt;
    const bobX = Math.cos(this.bob) * 0.028 * this.bobAmt;
    const tr = g.fx.trauma * g.fx.trauma;
    const t = g.time;
    cam.position.set(this.pos.x + cos * bobX, this.pos.y + this.eyeH + bobY - this.landDip, this.pos.z - sin * bobX);
    cam.rotation.set(
      this.pitch + this.recoil + tr * 0.06 * Math.sin(t * 61.7),
      this.yaw + tr * 0.06 * Math.sin(t * 53.1 + 1.7),
      this.roll + tr * 0.05 * Math.sin(t * 71.3 + 4.1),
    );
    const zoom = this.ads ? g.weapons.def.adsZoom : 1;
    const fov = s.fov * zoom + (this.sprinting ? 5 : 0);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = damp(cam.fov, fov, 12, dt);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.eye.copy(cam.position);
    cam.getWorldDirection(this.forward);
  }

  _interaction() {
    const g = this.game;
    let best = null, bd = 2.8;
    for (const t of g.level.terminals) {
      const d = Math.hypot(t.ix - this.pos.x, t.iz - this.pos.z);
      if (d >= bd) continue;
      const tx = t.x - this.pos.x, tz = t.z - this.pos.z;
      const tl = Math.hypot(tx, tz) || 1;
      if ((tx * this.forward.x + tz * this.forward.z) / tl < 0.2) continue;
      best = t;
      bd = d;
    }
    this.interact = best;
    if (best && g.input.hit('KeyE')) g.mission.useTerminal(best);
  }

  takeDamage(amount, from) {
    const g = this.game;
    if (!this.alive || this.invulnerable) return;
    amount *= g.difficulty.enemyDamage;
    this.sinceDamage = 0;
    this.regen = false;
    let rem = amount;
    if (this.shield > 0) {
      const a = Math.min(this.shield, rem);
      this.shield -= a;
      rem -= a;
      if (this.shield <= 0) {
        g.audio.play('shieldBreak');
        g.engine.fx.flashColor.setRGB(0.3, 0.7, 1);
        g.engine.fx.flash = Math.max(g.engine.fx.flash, 0.25);
      } else g.audio.play('shieldHit', { volume: 0.7 });
    }
    if (rem > 0) {
      this.health -= rem;
      g.audio.play('hurt');
      g.engine.fx.damage = Math.min(1, g.engine.fx.damage + 0.3 + rem * 0.025);
    }
    g.fx.shake(Math.min(0.45, 0.1 + amount * 0.012));
    if (from) {
      const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      g.hud.damageFrom(Math.atan2(dx * cos - dz * sin, -dx * sin - dz * cos));
    }
    g.stats.damageTaken += amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.ads = false;
      g.onPlayerDeath();
    }
  }

  heal(n) {
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  addShield(n) {
    this.shield = Math.min(this.maxShield, this.shield + n);
  }
}
