// Turns a parsed Level into its three.js scene: merged static geometry, baked
// light grid, props, doors, lights and the handful of animated set pieces.

import * as THREE from 'three';
import { CELL, WALL_H, OPEN_H, DOOR_H, DOOR_W } from '../core/constants.js';
import { T } from './level.js';
import { G, xf, QuadBatch, StaticBatcher } from '../gfx/geo.js';
import { createMaterials, disposeMaterials, windTime } from '../gfx/materials.js';
import { getTextures, makeSign } from '../gfx/textures.js';
import { damp, mulberry32 } from '../core/utils.js';

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SILL = 0.9;
const BAND = 3.9;
const RED = new THREE.Color(3.2, 0.25, 0.12);

// Face on the edge of cell (cx, cz) towards neighbour k, seen from inside the cell.
function faceOf(cx, cz, k) {
  const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;
  if (k === 0) return { lx: x1, lz: z0, rx: x1, rz: z1, nx: -1, nz: 0 };
  if (k === 1) return { lx: x0, lz: z1, rx: x0, rz: z0, nx: 1, nz: 0 };
  if (k === 2) return { lx: x1, lz: z1, rx: x0, rz: z1, nx: 0, nz: -1 };
  return { lx: x0, lz: z0, rx: x1, rz: z0, nx: 0, nz: 1 };
}

const lin = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Keeps a fixed number of real point lights parked on the nearest visible
// fixtures, so the shader light count never changes while the player moves.
class LightPool {
  constructor(parent, count, cands, level) {
    this.level = level;
    this.cands = cands;
    this.slots = [];
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 17, 2);
      parent.add(light);
      this.slots.push({ light, cand: null, k: 0 });
    }
    this.wanted = new Set();
    this.timer = 0;
    this.tint = new THREE.Color();
  }

  update(dt, pos, scale, alarm) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      const level = this.level;
      const seen = [];
      for (const c of this.cands) {
        const dx = c.x - pos.x, dz = c.z - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 34 * 34) continue;
        if (!level._lightLOS(pos.x, pos.z, c.x, c.z)) continue;
        c._d = d2;
        seen.push(c);
      }
      seen.sort((a, b) => a._d - b._d);
      this.wanted.clear();
      for (let i = 0; i < Math.min(seen.length, this.slots.length); i++) this.wanted.add(seen[i]);
    }
    for (const s of this.slots) {
      if (s.cand && this.wanted.has(s.cand)) {
        s.k = Math.min(1, s.k + dt * 2.5);
      } else {
        s.k = Math.max(0, s.k - dt * 3);
        if (s.k === 0) {
          let next = null;
          for (const c of this.wanted) {
            if (!this.slots.some((o) => o.cand === c)) { next = c; break; }
          }
          s.cand = next;
          if (next) {
            s.light.position.set(next.x, next.y, next.z);
            s.light.distance = next.range;
          }
        }
      }
      if (s.cand) {
        s.light.intensity = s.cand.power * s.k * scale;
        s.light.color.setRGB(s.cand.r, s.cand.g, s.cand.b).lerp(this.tint.setRGB(1, 0.16, 0.08), alarm * 0.8);
      } else s.light.intensity = 0;
    }
  }
}

const waterShader = {
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uDeep, uSky, uSunDir, uSunColor, uGlow;
    varying vec3 vWorld;
    void main() {
      vec2 p = vWorld.xz;
      float t = uTime;
      vec2 g = vec2(
        cos(p.x * 2.1 + t * 1.3) * 0.6 + cos(p.x * 0.9 - p.y * 1.7 + t * 0.8) * 0.5 + cos(p.x * 5.3 + p.y * 3.1 - t * 2.1) * 0.2,
        cos(p.y * 1.9 - t * 1.1) * 0.6 - cos(p.x * 0.9 - p.y * 1.7 + t * 0.8) * 0.5 + cos(p.y * 4.7 - p.x * 2.3 + t * 1.7) * 0.2);
      vec3 n = normalize(vec3(-g.x * 0.09, 1.0, -g.y * 0.09));
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 r = reflect(-v, n);
      float spec = pow(max(dot(r, uSunDir), 0.0), 220.0);
      float caustic = pow(max(0.0, sin(p.x * 3.0 + g.x * 1.6 + t) * sin(p.y * 3.0 + g.y * 1.6 - t * 0.7)), 6.0);
      vec3 col = mix(uDeep, uSky, fres) + uSunColor * spec * 5.0 + uGlow * caustic * 0.35;
      gl_FragColor = vec4(col, 0.72 + 0.25 * fres);
    }`,
};

export class LevelView {
  constructor(level, theme, engine) {
    this.level = level;
    this.theme = theme;
    this.engine = engine;
    this.group = new THREE.Group();
    this.tex = getTextures();
    this.mats = createMaterials(theme, this.tex);
    this.rng = mulberry32(hashString(level.def.id));
    this.own = []; // materials / textures created here that need disposing
    this.doors = [];
    this.barrels = [];
    this.terminals = new Map();
    this.exit = null;
    this.lights = []; // baked contributions
    this.fixtures = []; // candidates for the real light pool
    this.shaft = { p: [], c: [] };
    this.power = 1;
    this.powerTarget = 1;
    this.alarm = 0;
    this.alarmTarget = 0;
    this.sunDir = new THREE.Vector3().fromArray(theme.sunDir).normalize();
    this._build();
  }

  ownMat(m) {
    this.own.push(m);
    return m;
  }

  glowMat(rgb, k = 1, extra) {
    return this.ownMat(new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), ...extra }));
  }

  // ---------------------------------------------------------------- build

  _build() {
    const { level, theme, mats } = this;
    const B = {};
    for (const k of ['floor', 'floorOpen', 'poolBed', 'ceiling', 'wall', 'wallDark', 'hull', 'glass', 'accent', 'lightPanel', 'water']) B[k] = new QuadBatch();
    const sb = new StaticBatcher();
    this.B = B;
    this.sb = sb;

    this._cells();
    this._doors();
    this._fixtures();
    this._props();
    this._terminals();
    this._exit();
    if (theme.scatter === 'garden') this._scatterGarden();

    // Bake every static light into the grid shared by all lit materials.
    level.bakeLight(this.lights, theme.openAmbient);
    const n = level.lmW * level.lmH;
    const half = new Uint16Array(n * 4);
    const toHalf = THREE.DataUtils.toHalfFloat;
    const src = level.lightData;
    const one = toHalf(1);
    for (let i = 0; i < n; i++) {
      half[i * 4] = toHalf(Math.min(src[i * 3], 60));
      half[i * 4 + 1] = toHalf(Math.min(src[i * 3 + 1], 60));
      half[i * 4 + 2] = toHalf(Math.min(src[i * 3 + 2], 60));
      half[i * 4 + 3] = one;
    }
    const lm = new THREE.DataTexture(half, level.lmW, level.lmH, THREE.RGBAFormat, THREE.HalfFloatType);
    lm.magFilter = lm.minFilter = THREE.LinearFilter;
    lm.channel = 1;
    lm.needsUpdate = true;
    this.lightMap = lm;
    for (const m of mats.lit) {
      m.lightMap = lm;
      m.lightMapIntensity = 1;
    }

    const mesh = (batch, mat, cast, receive) => {
      const geo = batch.build(level);
      if (!geo) return null;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = receive;
      this.group.add(m);
      return m;
    };
    mesh(B.floor, mats.floor, false, true);
    mesh(B.floorOpen, mats.floorOpen, false, true);
    mesh(B.poolBed, mats.poolBed, false, true);
    mesh(B.ceiling, mats.ceiling, true, false);
    mesh(B.wall, mats.wall, true, true);
    mesh(B.wallDark, mats.wallDark, true, true);
    mesh(B.hull, mats.hull, true, true);
    mesh(B.accent, mats.accent, false, false);
    mesh(B.lightPanel, mats.lightPanel, false, false);
    const glass = mesh(B.glass, mats.glass, false, false);
    if (glass) glass.renderOrder = 5;
    sb.build(level, this.group);

    if (B.water.count) {
      const sunC = new THREE.Color(theme.sunColor);
      this.waterMat = this.ownMat(new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uDeep: { value: new THREE.Color(0.01, 0.05, 0.06) },
          uSky: { value: new THREE.Color(theme.sky.nebulaA[0] + 0.12, theme.sky.nebulaA[1] + 0.16, theme.sky.nebulaA[2] + 0.2) },
          uSunDir: { value: this.sunDir.clone() },
          uSunColor: { value: sunC },
          uGlow: { value: new THREE.Color(theme.accent[0], theme.accent[1], theme.accent[2]) },
        },
        ...waterShader,
        transparent: true,
        depthWrite: false,
      }));
      const w = mesh(B.water, this.waterMat, false, false);
      w.renderOrder = 4;
    }

    if (this.shaft.p.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(this.shaft.p, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(this.shaft.c, 3));
      const mat = this.ownMat(new THREE.MeshBasicMaterial({
        vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      const shafts = new THREE.Mesh(geo, mat);
      shafts.renderOrder = 6;
      this.group.add(shafts);
    }

    // Key light (the star) and soft fill.
    const q = this.engine.quality;
    this.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemi);
    this.sun = new THREE.DirectionalLight(theme.sunColor, theme.sun);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const cam = this.sun.shadow.camera;
    this.shadowExtent = 44;
    cam.left = cam.bottom = -this.shadowExtent;
    cam.right = cam.top = this.shadowExtent;
    cam.near = 1;
    cam.far = 220;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.group.add(this.hemi, this.sun, this.sun.target);

    this.pool = new LightPool(this.group, q.poolLights, this.fixtures, level);
    level.buildNav();
    this.B = this.sb = null;
  }

  _cells() {
    const { level, mats, B, sb, rng } = this;
    const sunC = lin(this.theme.sunColor);
    const lightTravel = this.sunDir.clone().negate();

    for (let cz = 0; cz < level.h; cz++) {
      for (let cx = 0; cx < level.w; cx++) {
        const t = level.typeAt(cx, cz);
        const x0 = cx * CELL, x1 = x0 + CELL, z0 = cz * CELL, z1 = z0 + CELL;

        if (t === T.FLOOR || t === T.OPEN || t === T.DOOR) {
          const open = t === T.OPEN;
          const ceilH = open ? OPEN_H : WALL_H;
          const v = 0.88 + rng() * 0.2;
          const water = level.water[cz * level.w + cx] === 1;
          if (water) {
            B.poolBed.floor(x0, z0, x1, z1, 0, v, v, v);
            B.water.floor(x0, z0, x1, z1, 0.045);
          } else (open ? B.floorOpen : B.floor).floor(x0, z0, x1, z1, 0, v, v, v);

          if (t === T.FLOOR) {
            const c = 0.85 + rng() * 0.25;
            B.ceiling.ceiling(x0, z0, x1, z1, WALL_H, c, c, c);
            sb.add(G.box, mats.trim, null, xf(x0 + CELL / 2, WALL_H - 0.1, z0, CELL, 0.2, 0.3));
          }
          if (open) {
            B.glass.ceiling(x0, z0, x1, z1, OPEN_H);
            if (cz % 2 === 0) sb.add(G.box, mats.trim, null, xf(x0 + CELL / 2, OPEN_H - 0.2, z0, CELL, 0.4, 0.28));
            if (cx % 2 === 0) sb.add(G.box, mats.trim, null, xf(x0, OPEN_H - 0.2, z0 + CELL / 2, 0.28, 0.4, CELL));
          }

          for (let k = 0; k < 4; k++) {
            const nx = cx + NB[k][0], nz = cz + NB[k][1];
            const nt = level.typeAt(nx, nz);
            const f = faceOf(cx, cz, k);
            if (nt === T.WALL || nt === T.VOID) {
              if (t !== T.DOOR) this._wallFace(f, ceilH);
            } else if (nt === T.WINDOW) {
              this._windowFace(f, ceilH, sunC, lightTravel);
            } else {
              const nh = level.ceilAt(nx, nz);
              if (nh < ceilH) {
                const c = 0.85 + rng() * 0.2;
                B.wallDark.wall(f.lx, f.lz, f.rx, f.rz, nh, ceilH, f.nx, f.nz, c, c, c);
              }
              // Low kerb where turf or deck meets a reflecting pool.
              if (water && !level.water[nz * level.w + nx] && nt === T.OPEN) {
                const mx = (f.lx + f.rx) / 2, mz = (f.lz + f.rz) / 2;
                sb.add(G.box, mats.trim, null, xf(mx, 0.06, mz, f.nx ? 0.3 : CELL, 0.12, f.nx ? CELL : 0.3));
              }
            }
          }
        } else if (t === T.WALL || t === T.WINDOW) {
          let tall = false;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (level.typeAt(cx + dx, cz + dz) === T.OPEN) tall = true;
          const top = tall ? OPEN_H + 0.3 : WALL_H + 0.3;
          for (let k = 0; k < 4; k++) {
            const nx = cx + NB[k][0], nz = cz + NB[k][1];
            const nt = level.typeAt(nx, nz);
            if (nt === T.VOID && t === T.WALL) {
              // Outer hull, seen across the void through windows.
              const f = faceOf(nx, nz, k ^ 1);
              B.hull.wall(f.lx, f.lz, f.rx, f.rz, -2, top, f.nx, f.nz, 1, 1, 1, 0.25);
            } else if (t === T.WINDOW && nt === T.WALL) {
              // Reveal at the end of a window bay.
              const f = faceOf(cx, cz, k);
              B.hull.wall(f.lx, f.lz, f.rx, f.rz, SILL, top - 1.2, f.nx, f.nz, 1, 1, 1, 0.25);
            }
          }
          if (t === T.WINDOW) {
            B.hull.floor(x0, z0, x1, z1, SILL, 1, 1, 1, 0.25);
            B.hull.ceiling(x0, z0, x1, z1, top - 1.2, 1, 1, 1, 0.25);
          }
        }
      }
    }
  }

  _wallFace(f, ceilH) {
    const { B, sb, mats, rng } = this;
    const a = 0.86 + rng() * 0.2, b = 0.9 + rng() * 0.16, c = 0.86 + rng() * 0.2;
    B.wallDark.wall(f.lx, f.lz, f.rx, f.rz, 0, SILL, f.nx, f.nz, a, a, a);
    B.wall.wall(f.lx, f.lz, f.rx, f.rz, SILL, Math.min(BAND, ceilH), f.nx, f.nz, b, b, b);
    if (ceilH > BAND) B.wallDark.wall(f.lx, f.lz, f.rx, f.rz, BAND, ceilH, f.nx, f.nz, c, c, c);
    const ox = f.nx * 0.025, oz = f.nz * 0.025;
    B.accent.wall(f.lx + ox, f.lz + oz, f.rx + ox, f.rz + oz, SILL - 0.04, SILL + 0.04, f.nx, f.nz);
    B.accent.wall(f.lx + ox, f.lz + oz, f.rx + ox, f.rz + oz, BAND - 0.03, BAND + 0.01, f.nx, f.nz, 0.3, 0.3, 0.3);
    // Pilaster where two panels meet.
    sb.add(G.box, mats.trim, null, xf(f.lx + f.nx * 0.05, ceilH / 2, f.lz + f.nz * 0.05, f.nx ? 0.14 : 0.3, ceilH, f.nx ? 0.3 : 0.14));
  }

  _windowFace(f, ceilH, sunC, lightTravel) {
    const { B, sb, mats } = this;
    const head = ceilH - 0.9;
    B.wallDark.wall(f.lx, f.lz, f.rx, f.rz, 0, SILL, f.nx, f.nz);
    B.wallDark.wall(f.lx, f.lz, f.rx, f.rz, head, ceilH, f.nx, f.nz);
    const gx = -f.nx * 0.08, gz = -f.nz * 0.08;
    B.glass.wall(f.lx + gx, f.lz + gz, f.rx + gx, f.rz + gz, SILL, head, f.nx, f.nz);
    const ox = f.nx * 0.025, oz = f.nz * 0.025;
    B.accent.wall(f.lx + ox, f.lz + oz, f.rx + ox, f.rz + oz, SILL - 0.04, SILL + 0.04, f.nx, f.nz);
    // Mullion at the left end, plus transoms on tall panes.
    sb.add(G.box, mats.trim, null, xf(f.lx + gx, (SILL + head) / 2, f.lz + gz, 0.16, head - SILL, 0.16));
    const mx = (f.lx + f.rx) / 2, mz = (f.lz + f.rz) / 2;
    for (let y = BAND; y < head - 1; y += 3.1) {
      sb.add(G.box, mats.trim, null, xf(mx + gx, y, mz + gz, f.nx ? 0.12 : CELL, 0.12, f.nx ? CELL : 0.12));
    }

    // Starlight spilling in: a baked glow plus faint additive shafts.
    this.lights.push({ x: mx + f.nx * 1.6, z: mz + f.nz * 1.6, h: 2.6, r: sunC[0], g: sunC[1], b: sunC[2], intensity: 1.5, radius: 9 });
    const facing = f.nx * lightTravel.x + f.nz * lightTravel.z;
    if (facing > 0.15 && lightTravel.y < -0.05) {
      const L = lightTravel;
      const y1 = Math.min(head, 6);
      const cap = 12 / Math.hypot(L.x, L.z);
      const t1 = Math.min(y1 / -L.y, cap), t0 = Math.min(SILL / -L.y, cap);
      const k = 0.05 * facing;
      const near = [sunC[0] * k, sunC[1] * k, sunC[2] * k];
      const push = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
        // a, b sit on the glass (bright); c, d are the far end (faded out).
        this.shaft.p.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
        this.shaft.c.push(...near, ...near, 0, 0, 0, ...near, 0, 0, 0, 0, 0, 0);
      };
      for (const s of [0.18, 0.5, 0.82]) {
        const px = f.lx + (f.rx - f.lx) * s, pz = f.lz + (f.rz - f.lz) * s;
        push(px, y1, pz, px, SILL, pz, px + L.x * t0, SILL + L.y * t0, pz + L.z * t0, px + L.x * t1, y1 + L.y * t1, pz + L.z * t1);
      }
      push(f.lx, y1, f.lz, f.rx, y1, f.rz, f.rx + L.x * t1, y1 + L.y * t1, f.rz + L.z * t1, f.lx + L.x * t1, y1 + L.y * t1, f.lz + L.z * t1);
      push(f.lx, SILL, f.lz, f.rx, SILL, f.rz, f.rx + L.x * t0, SILL + L.y * t0, f.rz + L.z * t0, f.lx + L.x * t0, SILL + L.y * t0, f.lz + L.z * t0);
    }
  }

  _doors() {
    const { level, mats, sb, theme } = this;
    const fw = (CELL - DOOR_W) / 2;
    const leafMat = this.ownMat(new THREE.MeshStandardMaterial({ map: this.tex.panel.map, normalMap: this.tex.panel.normal, color: 0x6a7480, roughness: 0.42, metalness: 0.78 }));
    const signCache = new Map();
    const signMat = (name) => {
      if (!name) return null;
      if (!signCache.has(name)) {
        const tex = makeSign(name);
        this.own.push(tex);
        signCache.set(name, this.glowMat(theme.accent, 1.5, { map: tex, transparent: true }));
      }
      return signCache.get(name);
    };
    const names = level.def.zoneNames || {};

    for (const d of level.doors) {
      const ax = d.axis === 'x';
      const base = new THREE.Matrix4().makeRotationY(ax ? 0 : Math.PI / 2).setPosition(d.x, 0, d.z);
      // Bulkhead: two jambs and a lintel forming a short tunnel.
      for (const s of [-1, 1]) sb.add(G.box, mats.trim, base, xf(s * (DOOR_W / 2 + fw / 2), WALL_H / 2, 0, fw, WALL_H, CELL));
      sb.add(G.box, mats.trim, base, xf(0, (DOOR_H + WALL_H) / 2, 0, DOOR_W, WALL_H - DOOR_H, CELL));
      for (const s of [-1, 1]) {
        const zf = s * (CELL / 2 + 0.02);
        for (const e of [-1, 1]) sb.add(G.box, mats.hazard, base, xf(e * (DOOR_W / 2 + 0.13), DOOR_H / 2, zf, DOOR_H, 0.22, 0.04, 0, 0, Math.PI / 2));
        sb.add(G.box, mats.hazard, base, xf(0, DOOR_H + 0.13, zf, DOOR_W + 0.48, 0.22, 0.04));
        sb.add(G.box, mats.hazard, base, xf(0, 0.012, s * (CELL / 2 - 0.25), DOOR_W, 0.02, 0.4));
      }

      const group = new THREE.Group();
      group.position.set(d.x, 0, d.z);
      group.rotation.y = ax ? 0 : Math.PI / 2;
      const lightMat = this.glowMat([1, 1, 1], 1);
      const leaves = [];
      for (const s of [-1, 1]) {
        const leaf = new THREE.Mesh(G.box, leafMat);
        leaf.scale.set(DOOR_W / 2, DOOR_H, 0.24);
        leaf.position.set((s * DOOR_W) / 4, DOOR_H / 2, 0);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        const seam = new THREE.Mesh(G.box, lightMat);
        // Child of a scaled leaf, so sizes are relative to the leaf.
        seam.scale.set(0.05, 0.42, 1.08);
        seam.position.set(-s * 0.44, 0.02, 0);
        leaf.add(seam);
        group.add(leaf);
        leaves.push(leaf);
      }
      for (const s of [-1, 1]) {
        const bar = new THREE.Mesh(G.box, lightMat);
        bar.scale.set(1.3, 0.09, 0.05);
        bar.position.set(0, DOOR_H + 0.42, s * (CELL / 2 + 0.03));
        group.add(bar);
        const strip = new THREE.Mesh(G.box, lightMat);
        strip.scale.set(0.05, 0.05, CELL - 0.2);
        strip.position.set(s * (DOOR_W / 2 - 0.03), DOOR_H - 0.04, 0);
        group.add(strip);
      }
      // Each face names the room on the far side.
      const zoneAt = (s) => (ax ? level.zone[(d.cz + s) * level.w + d.cx] : level.zone[d.cz * level.w + d.cx + s]);
      for (const s of [-1, 1]) {
        const mat = signMat(names[zoneAt(-s)]);
        if (!mat) continue;
        const sign = new THREE.Mesh(G.plane, mat);
        sign.scale.set(2.3, 0.5, 1);
        sign.position.set(0, DOOR_H + 1.15, s * (CELL / 2 + 0.035));
        if (s < 0) sign.rotation.y = Math.PI;
        group.add(sign);
      }
      this.group.add(group);
      this.doors.push({ door: d, leaves, lightMat, shown: -1 });
    }
  }

  _fixtures() {
    const { level, mats, B, sb, theme } = this;
    const cands = [];
    for (let cz = 0; cz < level.h; cz++) {
      for (let cx = 0; cx < level.w; cx++) {
        if (level.typeAt(cx, cz) !== T.FLOOR) continue;
        let d = 4;
        search: for (let r = 1; r <= 3; r++) {
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              const t = level.typeAt(cx + dx, cz + dz);
              if (t !== T.FLOOR && t !== T.OPEN) { d = r; break search; }
            }
          }
        }
        cands.push({ cx, cz, d, i: cz * level.w + cx });
      }
    }
    // Room centres first, then fill in at a two-cell pitch.
    cands.sort((a, b) => b.d - a.d || a.i - b.i);
    const chosen = [];
    for (const c of cands) {
      const x = (c.cx + 0.5) * CELL, z = (c.cz + 0.5) * CELL;
      const crowded = chosen.some((o) => Math.max(Math.abs(o.cx - c.cx), Math.abs(o.cz - c.cz)) < 2 && level._lightLOS(o.x, o.z, x, z));
      if (!crowded) chosen.push({ cx: c.cx, cz: c.cz, x, z });
    }
    const [r, g, b] = theme.light;
    for (const c of chosen) {
      sb.add(G.box, mats.trim, null, xf(c.x, WALL_H - 0.05, c.z, 2.1, 0.1, 0.75));
      B.lightPanel.ceiling(c.x - 0.92, c.z - 0.27, c.x + 0.92, c.z + 0.27, WALL_H - 0.105);
      this.lights.push({ x: c.x, z: c.z, h: WALL_H - 0.3, r, g, b, intensity: 3.1 * theme.lightPower, radius: 13.5 });
      this.fixtures.push({ x: c.x, y: WALL_H - 0.5, z: c.z, r, g, b, power: 30 * theme.lightPower, range: 17 });
    }
  }

  _props() {
    const { level, mats, sb, theme, rng } = this;
    const palette = [[0.62, 0.66, 0.72], [0.74, 0.62, 0.42], [0.42, 0.56, 0.62], [0.5, 0.52, 0.56]];
    const containers = theme.containers.map(lin);
    const leaves = [[0.05, 0.2, 0.07], [0.09, 0.3, 0.09], [0.13, 0.34, 0.1], [0.04, 0.22, 0.16], [0.16, 0.3, 0.06]];
    const [lr, lg, lb] = theme.light;

    for (const p of level.props) {
      const base = new THREE.Matrix4().makeTranslation(p.x, 0, p.z);
      const open = level.typeAt(p.cx, p.cz) === T.OPEN;

      if (p.kind === 'pillar') {
        const h = open ? 7 : WALL_H;
        sb.add(G.cyl8, mats.metal, base, xf(0, h / 2, 0, 1.1, h, 1.1, 0, Math.PI / 8, 0), [0.32, 0.35, 0.4]);
        sb.add(G.box, mats.trim, base, xf(0, 0.2, 0, 1.5, 0.4, 1.5));
        sb.add(G.box, mats.trim, base, xf(0, h - 0.2, 0, 1.5, 0.4, 1.5));
        sb.add(G.cyl8, mats.accent, base, xf(0, 1.3, 0, 1.2, 0.07, 1.2, 0, Math.PI / 8, 0));
        sb.add(G.cyl8, mats.accent, base, xf(0, h - 1.3, 0, 1.2, 0.07, 1.2, 0, Math.PI / 8, 0), [0.6, 0.6, 0.6]);
        if (open) sb.add(G.octa, mats.accent2, base, xf(0, h + 0.75, 0, 0.7, 1.1, 0.7));
        level.addBox({ minX: p.x - 0.62, maxX: p.x + 0.62, minZ: p.z - 0.62, maxZ: p.z + 0.62, minY: 0, maxY: h, kind: 'prop' });
      } else if (p.kind === 'crates') {
        const spots = [[-0.8, -0.65], [0.75, -0.5], [-0.25, 0.85], [0.95, 0.8]];
        const n = 2 + ((rng() * 3) | 0);
        for (let k = 0; k < n; k++) {
          const s = 1.0 + rng() * 0.3;
          const ox = spots[k][0] + (rng() - 0.5) * 0.3, oz = spots[k][1] + (rng() - 0.5) * 0.3;
          const ry = (rng() - 0.5) * 0.5;
          const tint = palette[(rng() * palette.length) | 0];
          sb.add(G.box, mats.crate, base, xf(ox, s / 2, oz, s, s, s, 0, ry, 0), tint);
          const e = (s / 2) * (Math.abs(Math.cos(ry)) + Math.abs(Math.sin(ry)));
          level.addBox({ minX: p.x + ox - e, maxX: p.x + ox + e, minZ: p.z + oz - e, maxZ: p.z + oz + e, minY: 0, maxY: s, kind: 'prop' });
          if (rng() < 0.4) {
            const s2 = 0.6 + rng() * 0.25;
            sb.add(G.box, mats.crate, base, xf(ox, s + s2 / 2, oz, s2, s2, s2, 0, ry + 0.5, 0), palette[(rng() * palette.length) | 0]);
            level.addBox({ minX: p.x + ox - s2 * 0.6, maxX: p.x + ox + s2 * 0.6, minZ: p.z + oz - s2 * 0.6, maxZ: p.z + oz + s2 * 0.6, minY: s, maxY: s + s2, kind: 'prop' });
          }
        }
      } else if (p.kind === 'container') {
        const alongX = rng() < 0.5;
        const L = 5.6, W = 2.4, H = 2.6;
        base.makeRotationY(alongX ? 0 : Math.PI / 2).setPosition(p.x, 0, p.z);
        const tint = containers[(rng() * containers.length) | 0];
        sb.add(G.box, mats.container, base, xf(0, H / 2 + 0.12, 0, L, H, W), tint);
        sb.add(G.box, mats.trim, base, xf(0, 0.06, 0, L * 0.98, 0.12, W * 0.94));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) sb.add(G.box, mats.trim, base, xf(sx * (L / 2 - 0.05), H / 2 + 0.12, sz * (W / 2 - 0.05), 0.16, H + 0.04, 0.16));
        for (const sz of [-1, 1]) sb.add(G.box, mats.trim, base, xf(0, H + 0.1, sz * (W / 2 - 0.05), L, 0.12, 0.16));
        for (const sz of [-0.5, 0.5]) sb.add(G.cyl8, mats.metal, base, xf(L / 2 + 0.04, H / 2 + 0.12, sz, 0.07, H * 0.86, 0.07), [0.6, 0.62, 0.66]);
        sb.add(G.box, mats.accent2, base, xf(L / 2 + 0.03, 2.2, 0.95, 0.03, 0.12, 0.28));
        const hx = alongX ? L / 2 : W / 2, hz = alongX ? W / 2 : L / 2;
        level.addBox({ minX: p.x - hx, maxX: p.x + hx, minZ: p.z - hz, maxZ: p.z + hz, minY: 0, maxY: H + 0.16, kind: 'prop' });
      } else if (p.kind === 'tree') {
        const th = 3.2 + rng() * 2;
        const lean = (rng() - 0.5) * 0.16;
        sb.add(G.taper, mats.bark, base, xf(0, th / 2, 0, 0.62, th, 0.62, lean, rng() * 6, lean * 0.6));
        sb.add(G.cone8, mats.bark, base, xf(0, 0.28, 0, 1.4, 0.56, 1.4));
        const blobs = 6 + ((rng() * 3) | 0);
        for (let k = 0; k < blobs; k++) {
          const a = rng() * 6.283, r = rng() * 1.7, s = 1.7 + rng() * 1.6;
          const c = leaves[(rng() * leaves.length) | 0], v = 0.7 + rng() * 0.6;
          sb.add(G.ico, mats.leaf, base, xf(Math.cos(a) * r, th + rng() * 1.8 - 0.3, Math.sin(a) * r, s, s * 0.78, s, rng() * 3, rng() * 6, rng() * 3), [c[0] * v, c[1] * v, c[2] * v]);
        }
        for (let k = 0; k < 4; k++) {
          const a = rng() * 6.283, r = 0.8 + rng() * 1.6;
          sb.add(G.sphereLo, mats.accent2, base, xf(Math.cos(a) * r, th - 0.6 - rng() * 0.8, Math.sin(a) * r, 0.17, 0.2, 0.17));
        }
        level.addBox({ minX: p.x - 0.36, maxX: p.x + 0.36, minZ: p.z - 0.36, maxZ: p.z + 0.36, minY: 0, maxY: th, kind: 'prop' });
      } else if (p.kind === 'lamp') {
        sb.add(G.cyl8, mats.trim, base, xf(0, 1.8, 0, 0.14, 3.6, 0.14));
        sb.add(G.cyl8, mats.trim, base, xf(0, 0.1, 0, 0.6, 0.2, 0.6));
        sb.add(G.box, mats.trim, base, xf(0, 3.66, 0, 0.9, 0.12, 0.9));
        sb.add(G.box, mats.lightPanel, base, xf(0, 3.56, 0, 0.72, 0.1, 0.72));
        level.addBox({ minX: p.x - 0.22, maxX: p.x + 0.22, minZ: p.z - 0.22, maxZ: p.z + 0.22, minY: 0, maxY: 3.7, kind: 'prop' });
        this.lights.push({ x: p.x, z: p.z, h: 3.4, r: lr, g: lg, b: lb, intensity: 2.6, radius: 13 });
        this.fixtures.push({ x: p.x, y: 3.3, z: p.z, r: lr, g: lg, b: lb, power: 34, range: 17 });
      } else if (p.kind === 'pod') {
        // Stand the pod against whichever wall it touches, facing the room.
        let ang = 0;
        const dirs = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]];
        for (const [dx, dz, a] of dirs) if (level.solidCell(p.cx + dx, p.cz + dz)) { ang = a; break; }
        base.makeRotationY(ang).setPosition(p.x, 0, p.z);
        const zo = -1.05, tilt = -0.2;
        sb.add(G.box, mats.trim, base, xf(0, 0.16, zo, 1.6, 0.32, 1.5));
        sb.add(G.cyl16, mats.metal, base, xf(0, 1.5, zo - 0.1, 1.24, 2.4, 1.24, tilt, 0, 0), [0.3, 0.33, 0.38]);
        sb.add(G.sphere, mats.metal, base, xf(0, 2.72, zo - 0.34, 1.24, 0.7, 1.24, tilt, 0, 0), [0.3, 0.33, 0.38]);
        sb.add(G.box, mats.pod, base, xf(0, 1.62, zo + 0.5, 0.78, 1.6, 0.06, tilt, 0, 0));
        sb.add(G.box, mats.trim, base, xf(0, 1.42, zo + 0.55, 0.36, 1.0, 0.03, tilt, 0, 0));
        sb.add(G.sphereLo, mats.trim, base, xf(0, 2.12, zo + 0.42, 0.27, 0.3, 0.08, tilt, 0, 0));
        sb.add(G.box, mats.accent, base, xf(0, 0.36, zo + 0.74, 0.5, 0.05, 0.04));
        const fx = Math.sin(ang), fz = Math.cos(ang);
        const bx = p.x + fx * zo, bz = p.z + fz * zo;
        level.addBox({ minX: bx - 0.72, maxX: bx + 0.72, minZ: bz - 0.72, maxZ: bz + 0.72, minY: 0, maxY: 2.9, kind: 'prop' });
        this.lights.push({ x: p.x + fx * 0.3, z: p.z + fz * 0.3, h: 1.6, r: 0.25, g: 0.65, b: 1, intensity: 0.9, radius: 6 });
      } else if (p.kind === 'ship') {
        this._ship(p, base);
      } else if (p.kind === 'barrel') {
        this._barrel(p);
      }
    }
  }

  // The Kestrel: the player's cutter, parked nose-out towards the hangar door.
  _ship(p, base) {
    const { level, mats, sb, theme } = this;
    const hull = [0.62, 0.66, 0.72], dark = [0.1, 0.12, 0.15], stripe = [theme.accent2[0] * 0.7, theme.accent2[1] * 0.7, theme.accent2[2] * 0.7];
    sb.add(G.box, mats.paint, base, xf(0, 2.0, 0, 6.4, 1.5, 2.3), hull);
    sb.add(G.cone4, mats.paint, base, xf(4.7, 2.0, 0, 1.5, 3.0, 2.3, 0, 0, -Math.PI / 2), hull);
    sb.add(G.sphere, mats.metal, base, xf(1.7, 2.72, 0, 2.6, 0.95, 1.5), [0.03, 0.06, 0.1]);
    sb.add(G.box, mats.paint, base, xf(0, 2.36, 0, 6.42, 0.14, 2.32), stripe);
    sb.add(G.box, mats.trim, base, xf(-0.2, 1.14, 0, 4.6, 0.36, 1.6));
    for (const s of [-1, 1]) {
      sb.add(G.box, mats.paint, base, xf(-1.0, 1.95, s * 2.5, 3.0, 0.16, 2.9, 0, s * 0.3, s * -0.05), hull);
      sb.add(G.box, mats.paint, base, xf(-1.75, 2.3, s * 3.9, 1.5, 0.9, 0.12, 0, s * 0.3, 0), stripe);
      sb.add(G.cyl16, mats.metal, base, xf(-3.0, 2.0, s * 0.85, 1.05, 2.5, 1.05, 0, 0, Math.PI / 2), dark);
      sb.add(G.cyl16, mats.accent, base, xf(-4.28, 2.0, s * 0.85, 0.8, 0.06, 0.8, 0, 0, Math.PI / 2));
      sb.add(G.cyl8, mats.metal, base, xf(-1.8, 0.56, s * 1.0, 0.14, 1.0, 0.14), dark);
      sb.add(G.box, mats.trim, base, xf(-1.8, 0.05, s * 1.0, 0.55, 0.1, 0.55));
      sb.add(G.sphereLo, s < 0 ? mats.accent2 : mats.accent, base, xf(-1.9, 2.02, s * 4.05, 0.14, 0.14, 0.14));
    }
    sb.add(G.box, mats.paint, base, xf(-2.7, 3.25, 0, 1.7, 1.3, 0.14, 0, 0, -0.35), hull);
    sb.add(G.cyl8, mats.metal, base, xf(2.3, 0.56, 0, 0.14, 1.0, 0.14), dark);
    sb.add(G.box, mats.trim, base, xf(2.3, 0.05, 0, 0.55, 0.1, 0.55));
    sb.add(G.sphereLo, mats.white, base, xf(-3.3, 3.95, 0, 0.12, 0.12, 0.12));
    level.addBox({ minX: p.x - 4.4, maxX: p.x + 6.1, minZ: p.z - 1.5, maxZ: p.z + 1.5, minY: 0, maxY: 3.4, kind: 'prop' });

    const pad = new THREE.Mesh(G.plane, mats.padDecal);
    pad.rotation.x = -Math.PI / 2;
    pad.scale.set(15, 15, 1);
    pad.position.set(p.x + 0.8, 0.02, p.z);
    pad.renderOrder = 2;
    this.group.add(pad);
    this.lights.push({ x: p.x - 4.6, z: p.z, h: 1.6, r: theme.accent[0], g: theme.accent[1], b: theme.accent[2], intensity: 1.2, radius: 6 });
  }

  _barrel(p) {
    const body = this._barrelMat ||= this.ownMat(new THREE.MeshStandardMaterial({ color: 0x7a2a1c, roughness: 0.45, metalness: 0.7 }));
    const band = this._barrelBand ||= this.glowMat([1, 0.42, 0.08], 2.6);
    const trim = this._barrelTrim ||= this.ownMat(new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.4, metalness: 0.85 }));
    const g = new THREE.Group();
    const add = (geo, mat, y, sx, sy) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.scale.set(sx, sy, sx);
      m.castShadow = mat !== band;
      g.add(m);
    };
    add(G.cyl16, body, 0.6, 0.84, 1.16);
    add(G.cyl16, trim, 0.1, 0.9, 0.12);
    add(G.cyl16, trim, 1.14, 0.9, 0.12);
    add(G.cyl16, band, 0.62, 0.86, 0.14);
    add(G.cyl16, band, 1.215, 0.5, 0.03);
    g.position.set(p.x, 0, p.z);
    this.group.add(g);
    const barrel = { type: 'barrel', x: p.x, z: p.z, group: g, hp: 1, alive: true, box: null };
    barrel.box = { minX: p.x - 0.42, maxX: p.x + 0.42, minZ: p.z - 0.42, maxZ: p.z + 0.42, minY: 0, maxY: 1.22, kind: 'dynamic', ref: barrel, nav: false };
    this.level.addBox(barrel.box);
    this.barrels.push(barrel);
    this.lights.push({ x: p.x, z: p.z, h: 1.2, r: 1, g: 0.42, b: 0.1, intensity: 0.5, radius: 4 });
  }

  _terminals() {
    const { level, mats, sb, theme } = this;
    const dirs = [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]];
    for (const t of level.terminals) {
      let ang = 0, zo = 0;
      for (const [dx, dz, a] of dirs) if (level.solidCell(t.cx + dx, t.cz + dz)) { ang = a; zo = -1.35; break; }
      const base = new THREE.Matrix4().makeRotationY(ang).setPosition(t.x, 0, t.z);
      sb.add(G.box, mats.trim, base, xf(0, 0.48, zo, 1.15, 0.96, 0.62));
      sb.add(G.box, mats.metal, base, xf(0, 1.03, zo + 0.08, 1.34, 0.1, 0.84, 0.32, 0, 0), [0.34, 0.37, 0.42]);
      sb.add(G.box, mats.accent, base, xf(0, 1.1, zo + 0.2, 0.9, 0.02, 0.36, 0.32, 0, 0), [0.35, 0.35, 0.35]);
      sb.add(G.box, mats.trim, base, xf(0, 1.82, zo - 0.22, 1.36, 0.9, 0.08, -0.1, 0, 0));
      sb.add(G.plane, mats.screen, base, xf(0, 1.82, zo - 0.172, 1.2, 0.74, 1, -0.1, 0, 0));
      sb.add(G.box, mats.trim, base, xf(0, 1.25, zo - 0.25, 0.16, 0.5, 0.1));

      const fx = Math.sin(ang), fz = Math.cos(ang);
      const bx = t.x + fx * zo, bz = t.z + fz * zo;
      const hx = Math.abs(fx) > 0.5 ? 0.45 : 0.7, hz = Math.abs(fx) > 0.5 ? 0.7 : 0.45;
      level.addBox({ minX: bx - hx, maxX: bx + hx, minZ: bz - hz, maxZ: bz + hz, minY: 0, maxY: 2.3, kind: 'prop' });

      // Status beacons either side of the screen.
      const lightMat = this.glowMat([1, 1, 1], 1);
      const g = new THREE.Group();
      g.position.set(t.x, 0, t.z);
      g.rotation.y = ang;
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(G.box, lightMat);
        m.scale.set(0.06, 0.82, 0.06);
        m.position.set(s * 0.76, 1.82, zo - 0.2);
        g.add(m);
      }
      this.group.add(g);
      t.ix = t.x + fx * (zo + 1.1);
      t.iz = t.z + fz * (zo + 1.1);
      t.y = 1.5;
      this.terminals.set(t.id, { lightMat, state: '' });
      this.lights.push({ x: t.ix, z: t.iz, h: 1.7, r: theme.accent[0], g: theme.accent[1], b: theme.accent[2], intensity: 1.1, radius: 5.5 });
    }
  }

  _exit() {
    const { level, mats, sb, theme } = this;
    const e = level.exit;
    if (!e) return;
    const base = new THREE.Matrix4().makeTranslation(e.x, 0, e.z);
    sb.add(G.cyl24, mats.trim, base, xf(0, 0.06, 0, 3.1, 0.12, 3.1));
    sb.add(G.cyl24, mats.metal, base, xf(0, 0.1, 0, 2.5, 0.1, 2.5), [0.3, 0.33, 0.38]);
    const mat = this.glowMat([1, 1, 1], 1);
    const beam = this.ownMat(new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const g = new THREE.Group();
    g.position.set(e.x, 0, e.z);
    const ring = new THREE.Mesh(G.torus, mat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(2.7);
    ring.position.y = 0.17;
    g.add(ring);
    const column = new THREE.Mesh(G.tube, beam);
    column.scale.set(2.5, 4.6, 2.5);
    column.position.y = 2.3;
    column.renderOrder = 7;
    g.add(column);
    const hoops = [];
    for (let k = 0; k < 3; k++) {
      const h = new THREE.Mesh(G.torus, mat);
      h.rotation.x = Math.PI / 2;
      h.scale.setScalar(2.2);
      g.add(h);
      hoops.push(h);
    }
    this.group.add(g);
    this.exit = { mat, beam, column, hoops, active: false, k: 0 };
    this.lights.push({ x: e.x, z: e.z, h: 2, r: theme.accent[0], g: theme.accent[1], b: theme.accent[2], intensity: 0.9, radius: 6 });
  }

  _scatterGarden() {
    const { level, mats, sb, rng } = this;
    const greens = [[0.07, 0.26, 0.08], [0.11, 0.34, 0.1], [0.05, 0.22, 0.14], [0.16, 0.33, 0.08]];
    const m = new THREE.Matrix4();
    for (let cz = 0; cz < level.h; cz++) {
      for (let cx = 0; cx < level.w; cx++) {
        const i = cz * level.w + cx;
        if (level.type[i] !== T.OPEN || level.water[i]) continue;
        for (let k = 0; k < 4; k++) {
          const x = (cx + rng()) * CELL, z = (cz + rng()) * CELL;
          m.makeRotationY(rng() * 6.283).setPosition(x, 0, z);
          const c = greens[(rng() * greens.length) | 0], v = 0.7 + rng() * 0.7;
          const tint = [c[0] * v, c[1] * v, c[2] * v];
          const s = 0.5 + rng() * 0.6;
          for (let b = 0; b < 3; b++) sb.add(G.cone4, mats.leaf, m, xf(0, s * 0.42, 0, s * 0.62, s, 0.07, (rng() - 0.5) * 0.9, b * 2.09, (rng() - 0.5) * 0.9), tint);
        }
        if (rng() < 0.38) {
          const x = (cx + 0.15 + rng() * 0.7) * CELL, z = (cz + 0.15 + rng() * 0.7) * CELL;
          m.makeTranslation(x, 0, z);
          const h = 0.35 + rng() * 0.45;
          sb.add(G.cyl6, mats.leaf, m, xf(0, h / 2, 0, 0.05, h, 0.05), [0.1, 0.3, 0.12]);
          sb.add(G.sphereLo, rng() < 0.5 ? mats.accent2 : mats.accent, m, xf(0, h + 0.06, 0, 0.17, 0.17, 0.17));
        }
      }
    }
  }

  // ---------------------------------------------------------------- runtime

  setPower(on, instant) {
    this.powerTarget = on ? 1 : 0;
    if (instant) this.power = this.powerTarget;
  }

  setAlarm(on) {
    this.alarmTarget = on ? 1 : 0;
  }

  setTerminal(id, state) {
    const t = this.terminals.get(id);
    if (!t || t.state === state) return;
    t.state = state;
    const a = this.theme.accent;
    if (state === 'ready') t.lightMat.color.setRGB(0.4, 2.6, 0.9);
    else if (state === 'used') t.lightMat.color.setRGB(a[0] * 0.8, a[1] * 0.8, a[2] * 0.8);
    else t.lightMat.color.setRGB(1.6, 0.14, 0.08);
  }

  setExitActive(active) {
    if (this.exit) this.exit.active = active;
  }

  // Restore destructible scenery after a checkpoint reload.
  resetDynamic() {
    for (const b of this.barrels) {
      if (!b.alive) {
        b.alive = true;
        b.group.visible = true;
        this.level.addBox(b.box);
      }
    }
  }

  removeBarrel(b) {
    b.alive = false;
    b.group.visible = false;
    this.level.removeBox(b.box);
  }

  update(dt, time, focus) {
    const { mats, theme } = this;
    windTime.value = time;
    this.power = damp(this.power, this.powerTarget, 2.2, dt);
    this.alarm = damp(this.alarm, this.alarmTarget, 3, dt);
    const lit = 0.16 + 0.84 * this.power;
    const pulse = 0.75 + 0.25 * Math.sin(time * 6);
    const lmk = lit * (1 - 0.5 * this.alarm);
    for (const m of mats.lit) m.lightMapIntensity = lmk;
    mats.lightPanel.color.copy(mats.base.lightPanel).multiplyScalar(0.05 + 0.95 * this.power).lerp(RED, this.alarm * pulse);
    this.pool.update(dt, focus, (0.1 + 0.9 * this.power) * (1 - 0.35 * this.alarm), this.alarm * pulse);
    if (this.waterMat) this.waterMat.uniforms.uTime.value = time;
    this.tex.screen.update(dt, time);

    const a = theme.accent;
    for (const d of this.doors) {
      const o = d.door.open;
      const reach = DOOR_W / 2 - 0.04;
      d.leaves[0].position.x = -DOOR_W / 4 - o * reach;
      d.leaves[1].position.x = DOOR_W / 4 + o * reach;
      const state = d.door.locked ? 0 : 1;
      if (state !== d.shown) {
        d.shown = state;
        if (state) d.lightMat.color.setRGB(a[0] * 2.2, a[1] * 2.2, a[2] * 2.2);
        else d.lightMat.color.setRGB(3.0, 0.2, 0.1);
      }
    }

    if (this.exit) {
      const e = this.exit;
      e.k = damp(e.k, e.active ? 1 : 0, 3, dt);
      const k = e.k;
      e.mat.color.setRGB(0.5 * (1 - k) + a[0] * 2.4 * k, 0.05 * (1 - k) + a[1] * 2.4 * k, 0.03 * (1 - k) + a[2] * 2.4 * k);
      e.beam.color.setRGB(a[0] * 0.16 * k, a[1] * 0.16 * k, a[2] * 0.16 * k);
      e.column.visible = k > 0.02;
      for (let i = 0; i < e.hoops.length; i++) {
        const h = e.hoops[i];
        h.visible = k > 0.02;
        h.position.y = 0.4 + ((time * 0.55 + i / e.hoops.length) % 1) * 4;
        h.scale.setScalar(2.2 * (0.8 + 0.2 * Math.sin(time * 2 + i)));
      }
    }

    // Keep the shadow frustum centred on the action, snapped to whole texels so edges do not crawl.
    const sun = this.sun;
    const texel = (this.shadowExtent * 2) / sun.shadow.mapSize.x;
    _fwd.copy(this.sunDir).negate();
    _right.crossVectors(_fwd, _up).normalize();
    _upv.crossVectors(_right, _fwd);
    const rx = _right.dot(focus), uy = _upv.dot(focus);
    _t.copy(focus)
      .addScaledVector(_right, Math.round(rx / texel) * texel - rx)
      .addScaledVector(_upv, Math.round(uy / texel) * texel - uy);
    _t.y = 0;
    sun.target.position.copy(_t);
    sun.position.copy(_t).addScaledVector(this.sunDir, 110);
  }

  applyQuality(q) {
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    for (const s of this.pool.slots) this.group.remove(s.light);
    this.pool = new LightPool(this.group, q.poolLights, this.fixtures, this.level);
    this.group.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    this.sun.shadow.map?.dispose();
    this.lightMap.dispose();
    disposeMaterials(this.mats);
    for (const o of this.own) o.dispose();
    this.group.removeFromParent();
  }
}

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _upv = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _t = new THREE.Vector3();
