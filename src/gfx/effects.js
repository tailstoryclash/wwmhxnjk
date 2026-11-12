// Transient visual effects: particles, tracers, beams, scorch decals, flash
// lights, shockwave rings, debris and camera trauma. Everything is pooled.

import * as THREE from 'three';
import { G } from './geo.js';
import { getTextures } from './textures.js';
import { clamp, rand } from '../core/utils.js';

const _v = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _z = new THREE.Vector3(0, 0, 1);

class Particles {
  constructor(max) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.baseSize = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aCol);
    geo.setAttribute('psize', this.aSize);
    this.uniforms = { uScale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 pcolor;
        attribute float psize;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = psize * uScale / max(0.2, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  emit(x, y, z, vx, vy, vz, life, size, r, g, b, grav = 0, drag = 0, grow = 0) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.base[i3] = r; this.base[i3 + 1] = g; this.base[i3 + 2] = b;
    this.life[i] = this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  update(dt) {
    const { pos, vel, col, base, size, baseSize, life, maxLife, grav, drag, grow, max } = this;
    for (let i = 0; i < max; i++) {
      let l = life[i];
      if (l <= 0) continue;
      l -= dt;
      if (l <= 0) { life[i] = 0; size[i] = 0; continue; }
      life[i] = l;
      const i3 = i * 3;
      const k = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= k; vel[i3 + 2] *= k;
      vel[i3 + 1] = vel[i3 + 1] * k - grav[i] * dt;
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      if (grav[i] > 0 && pos[i3 + 1] < 0.03 && vel[i3 + 1] < 0) { pos[i3 + 1] = 0.03; vel[i3 + 1] *= -0.35; }
      const t = l / maxLife[i];
      col[i3] = base[i3] * t; col[i3 + 1] = base[i3 + 1] * t; col[i3 + 2] = base[i3 + 2] * t;
      size[i] = baseSize[i] * (1 + grow[i] * (1 - t));
    }
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.size.fill(0);
  }
}

// Slow motes drifting in a box that wraps around the camera.
class Dust {
  constructor(count) {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 28; pos[i * 3 + 1] = Math.random() * 7; pos[i * 3 + 2] = Math.random() * 28;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: 600 }, uColor: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float seed;
        uniform float uTime; uniform vec3 uCam; uniform float uScale;
        varying float vA;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.11 + seed * 40.0) * 1.4, uTime * (0.05 + seed * 0.07), cos(uTime * 0.09 + seed * 31.0) * 1.4);
          vec3 box = vec3(28.0, 7.0, 28.0);
          p = mod(p - uCam + box * 0.5, box) - box * 0.5 + uCam;
          p.y = mod(p.y, 7.0) + 0.1;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          vA = smoothstep(0.6, 3.0, dist) * (1.0 - smoothstep(9.0, 14.0, dist)) * (0.675 + 0.325 * sin(uTime * 0.7 + seed * 90.0));
          gl_PointSize = (0.025 + seed * 0.035) * uScale / max(0.2, dist);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(uColor * a * vA, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 19;
  }
}

export class Effects {
  constructor(engine, quality) {
    this.engine = engine;
    const scene = engine.scene;
    const tex = getTextures();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.particles = new Particles(Math.round(3600 * quality.particles));
    this.group.add(this.particles.points);
    this.dust = new Dust(Math.round(420 * quality.particles));
    this.group.add(this.dust.points);
    this.density = quality.particles;

    const additive = (extra) => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, ...extra });

    this.tracers = [];
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(G.box, additive());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, active: false, start: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, head: 0, len: 0, speed: 0, width: 0.03 });
    }

    this.beams = [];
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(G.cyl8, additive());
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.beams.push({ mesh, t: 0, dur: 0, width: 0, color: new THREE.Color() });
    }

    this.decalMat = new THREE.MeshBasicMaterial({
      map: tex.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.85,
    });
    this.decals = [];
    this.decalCursor = 0;
    for (let i = 0; i < 70; i++) {
      const mesh = new THREE.Mesh(G.plane, this.decalMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.decals.push(mesh);
    }

    this.flashes = [];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 20, 2);
      scene.add(light);
      this.flashes.push({ light, t: 0, dur: 1, peak: 0 });
    }

    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(G.plane, additive({ map: tex.ring, side: THREE.DoubleSide }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 0, radius: 1, color: new THREE.Color() });
    }

    this.debrisMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.8 });
    this.chunks = [];
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(G.box, this.debrisMat);
      mesh.visible = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.chunks.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, size: 0.2 });
    }
    this.chunkCursor = 0;

    this.trauma = 0;
    this.shakeEnabled = true;
  }

  setTheme(theme) {
    this.dust.uniforms.uColor.value.setRGB(
      0.25 + theme.light[0] * 0.25 + theme.accent[0] * 0.12,
      0.25 + theme.light[1] * 0.25 + theme.accent[1] * 0.12,
      0.25 + theme.light[2] * 0.25 + theme.accent[2] * 0.12,
    );
  }

  clear() {
    this.particles.clear();
    for (const t of this.tracers) { t.active = false; t.mesh.visible = false; }
    for (const b of this.beams) { b.t = 0; b.mesh.visible = false; }
    for (const d of this.decals) d.visible = false;
    for (const f of this.flashes) { f.t = 0; f.light.intensity = 0; }
    for (const r of this.rings) { r.t = 0; r.mesh.visible = false; }
    for (const c of this.chunks) { c.life = 0; c.mesh.visible = false; }
    this.trauma = 0;
  }

  update(dt, camera) {
    const scale = this.engine.pointScale(camera);
    this.particles.uniforms.uScale.value = scale;
    this.particles.update(dt);
    this.dust.uniforms.uScale.value = scale;
    this.dust.uniforms.uTime.value += dt;
    this.dust.uniforms.uCam.value.copy(camera.position);

    for (const t of this.tracers) {
      if (!t.active) continue;
      t.head += t.speed * dt;
      const a = Math.max(0, t.head - t.len);
      if (a >= t.dist) { t.active = false; t.mesh.visible = false; continue; }
      const b = Math.min(t.head, t.dist);
      t.mesh.position.copy(t.start).addScaledVector(t.dir, (a + b) / 2);
      t.mesh.scale.set(t.width, t.width, Math.max(0.01, b - a));
    }

    for (const b of this.beams) {
      if (b.t <= 0) continue;
      b.t -= dt;
      if (b.t <= 0) { b.mesh.visible = false; continue; }
      const k = b.t / b.dur;
      b.mesh.material.color.copy(b.color).multiplyScalar(k * k);
      b.mesh.scale.x = b.mesh.scale.z = b.width * (0.35 + 0.65 * k);
    }

    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      const k = Math.max(0, f.t / f.dur);
      f.light.intensity = f.peak * k * k;
    }

    for (const r of this.rings) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.t / r.dur;
      const s = r.radius * 2 * (0.15 + 0.85 * (1 - (1 - k) * (1 - k)));
      r.mesh.scale.set(s, s, 1);
      r.mesh.material.color.copy(r.color).multiplyScalar((1 - k) * (1 - k));
    }

    for (const c of this.chunks) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.vel.y -= 20 * dt;
      const p = c.mesh.position;
      p.addScaledVector(c.vel, dt);
      if (p.y < c.size * 0.5) {
        p.y = c.size * 0.5;
        c.vel.y *= -0.38;
        c.vel.x *= 0.7; c.vel.z *= 0.7;
        c.spin.multiplyScalar(0.6);
      }
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      const s = c.size * Math.min(1, c.life / 0.4);
      c.mesh.scale.setScalar(s);
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.5);
  }

  // ------------------------------------------------------------ emitters

  sparks(x, y, z, nx, ny, nz, color, count = 8, speed = 6) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const s = speed * (0.3 + Math.random() * 0.9);
      this.particles.emit(
        x, y, z,
        (nx + rand(-0.8, 0.8)) * s, (ny + rand(-0.8, 0.8)) * s + 1, (nz + rand(-0.8, 0.8)) * s,
        rand(0.18, 0.5), rand(0.05, 0.11), color[0], color[1], color[2], 16, 1.2,
      );
    }
  }

  burst(x, y, z, color, count = 12, speed = 4, size = 0.3, life = 0.6, grav = 0, drag = 2.5) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(speed * (0.25 + Math.random()));
      this.particles.emit(x, y, z, _v.x, _v.y, _v.z, life * rand(0.5, 1.2), size * rand(0.6, 1.3), color[0], color[1], color[2], grav, drag, 0.6);
    }
  }

  puff(x, y, z, color, count = 3, size = 0.6) {
    for (let i = 0; i < count; i++) {
      this.particles.emit(x + rand(-0.1, 0.1), y + rand(-0.1, 0.1), z + rand(-0.1, 0.1), rand(-0.4, 0.4), rand(0.2, 0.9), rand(-0.4, 0.4), rand(0.5, 1.1), size * rand(0.7, 1.3), color[0], color[1], color[2], -0.3, 1.5, 1.6);
    }
  }

  // Column of rising motes used when a hostile materialises.
  warp(x, y, z, color, height = 2) {
    const n = Math.round(34 * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, r = rand(0.2, 0.9);
      this.particles.emit(x + Math.cos(a) * r, y + rand(0, height), z + Math.sin(a) * r, -Math.cos(a) * r * 1.5, rand(1.5, 4), -Math.sin(a) * r * 1.5, rand(0.35, 0.8), rand(0.08, 0.2), color[0], color[1], color[2], 0, 1);
    }
    this.flash(x, y + height * 0.5, z, color, 60, 9, 0.35);
    this.ring(x, y + 0.06, z, color, 2.2, 0.45);
  }

  tracer(from, to, color, width = 0.03, speed = 260) {
    let t = this.tracers.find((q) => !q.active);
    if (!t) t = this.tracers[0];
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 0.6) return;
    t.dir.divideScalar(t.dist);
    t.start.copy(from);
    t.head = 0.5;
    t.len = Math.min(t.dist, 8);
    t.speed = speed;
    t.width = width;
    t.active = true;
    t.mesh.visible = true;
    t.mesh.material.color.setRGB(color[0], color[1], color[2]);
    t.mesh.quaternion.setFromUnitVectors(_z, t.dir);
    t.mesh.position.copy(from);
    t.mesh.scale.set(width, width, 0.01);
  }

  beam(from, to, color, width = 0.12, dur = 0.42) {
    let b = this.beams.find((q) => q.t <= 0);
    if (!b) b = this.beams[0];
    _v.subVectors(to, from);
    const len = _v.length();
    if (len < 0.01) return;
    _v.divideScalar(len);
    b.mesh.position.copy(from).addScaledVector(_v, len * 0.5);
    b.mesh.quaternion.setFromUnitVectors(_y, _v); // cylinder axis is +Y
    b.mesh.scale.set(width, len, width);
    b.color.setRGB(color[0], color[1], color[2]);
    b.width = width;
    b.t = b.dur = dur;
    b.mesh.visible = true;
  }

  decal(x, y, z, nx, ny, nz, size = 0.4) {
    const mesh = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    mesh.position.set(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02);
    mesh.quaternion.setFromUnitVectors(_z, _v.set(nx, ny, nz));
    mesh.rotateZ(Math.random() * 6.283);
    mesh.scale.setScalar(size * rand(0.8, 1.25));
    mesh.visible = true;
  }

  flash(x, y, z, color, intensity = 80, range = 12, dur = 0.12) {
    let f = this.flashes[0];
    for (const q of this.flashes) if (q.t < f.t) f = q;
    f.light.position.set(x, y, z);
    f.light.color.setRGB(color[0], color[1], color[2]);
    f.light.distance = range;
    f.peak = intensity;
    f.t = f.dur = dur;
    f.light.intensity = intensity;
  }

  ring(x, y, z, color, radius = 4, dur = 0.5) {
    let r = this.rings.find((q) => q.t <= 0);
    if (!r) r = this.rings[0];
    r.mesh.position.set(x, y, z);
    r.radius = radius;
    r.color.setRGB(color[0], color[1], color[2]);
    r.t = r.dur = dur;
    r.mesh.scale.set(0.1, 0.1, 1);
    r.mesh.visible = true;
  }

  debris(x, y, z, count = 6, force = 6) {
    for (let i = 0; i < count; i++) {
      const c = this.chunks[this.chunkCursor];
      this.chunkCursor = (this.chunkCursor + 1) % this.chunks.length;
      c.size = rand(0.1, 0.28);
      c.mesh.position.set(x + rand(-0.3, 0.3), y + rand(-0.2, 0.3), z + rand(-0.3, 0.3));
      c.vel.set(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).multiplyScalar(force * rand(0.5, 1));
      c.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      c.life = rand(1.4, 2.6);
      c.mesh.scale.setScalar(c.size);
      c.mesh.visible = true;
    }
  }

  explosion(x, y, z, radius = 4, color = [1, 0.5, 0.15]) {
    const p = this.particles;
    const n = Math.round(46 * this.density);
    for (let i = 0; i < n; i++) {
      _v.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(radius * rand(0.6, 2.6));
      const hot = Math.random();
      p.emit(x, y, z, _v.x, _v.y, _v.z, rand(0.35, 0.9), radius * rand(0.16, 0.36), color[0] * (1 + hot), color[1] * (0.6 + hot), color[2] * (0.5 + hot * 1.5), -1.5, 3.2, 1.4);
    }
    for (let i = 0; i < Math.round(26 * this.density); i++) {
      _v.set(rand(-1, 1), rand(0, 1.2), rand(-1, 1)).normalize().multiplyScalar(radius * rand(2, 5));
      p.emit(x, y, z, _v.x, _v.y, _v.z, rand(0.5, 1.2), rand(0.06, 0.12), 1.6, 1.0, 0.5, 14, 0.6);
    }
    for (let i = 0; i < 8; i++) {
      p.emit(x + rand(-1, 1), y + rand(0, 1), z + rand(-1, 1), rand(-0.6, 0.6), rand(0.6, 1.6), rand(-0.6, 0.6), rand(1.2, 2.2), radius * rand(0.5, 0.8), 0.07, 0.07, 0.08, -0.2, 0.8, 1.8);
    }
    this.flash(x, y + 0.5, z, color, 420, radius * 5, 0.4);
    this.ring(x, Math.max(0.08, y - 0.3), z, color, radius * 1.5, 0.5);
    if (y < 2.5) this.decal(x, 0, z, 0, 1, 0, radius * 1.3);
    this.debris(x, y, z, 5, radius * 1.6);
    const d = _v.set(x, y, z).distanceTo(this.engine.camera.position);
    this.shake(clamp(1 - d / (radius * 6), 0, 1) * 0.85);
  }

  // Bullet strike on level geometry.
  impact(x, y, z, nx, ny, nz, kind) {
    if (kind === 'glass') {
      this.sparks(x, y, z, nx, ny, nz, [0.5, 0.8, 1.2], 5, 3);
      return;
    }
    this.sparks(x, y, z, nx, ny, nz, [1.6, 1.0, 0.45], 7, 6);
    this.puff(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, [0.05, 0.05, 0.055], 1, 0.35);
    if (kind !== 'door' && kind !== 'dynamic') this.decal(x, y, z, nx, ny, nz, 0.3);
  }

  shake(amount) {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }
}
