// Shared primitive geometry plus helpers for merging static scenery into a
// handful of draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const shared = (g) => {
  g.userData.shared = true;
  return g;
};

export const G = {
  box: shared(new THREE.BoxGeometry(1, 1, 1)),
  cyl6: shared(new THREE.CylinderGeometry(0.5, 0.5, 1, 6)),
  cyl8: shared(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  cyl16: shared(new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
  cyl24: shared(new THREE.CylinderGeometry(0.5, 0.5, 1, 24)),
  tube: shared(new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1, true)),
  taper: shared(new THREE.CylinderGeometry(0.32, 0.5, 1, 8)),
  cone4: shared(new THREE.ConeGeometry(0.5, 1, 4)),
  cone8: shared(new THREE.ConeGeometry(0.5, 1, 8)),
  cone16: shared(new THREE.ConeGeometry(0.5, 1, 16)),
  sphere: shared(new THREE.SphereGeometry(0.5, 20, 14)),
  sphereLo: shared(new THREE.SphereGeometry(0.5, 10, 8)),
  ico: shared(new THREE.IcosahedronGeometry(0.5, 1)),
  ico0: shared(new THREE.IcosahedronGeometry(0.5, 0)),
  octa: shared(new THREE.OctahedronGeometry(0.5, 0)),
  torus: shared(new THREE.TorusGeometry(0.5, 0.05, 8, 28)),
  torusFat: shared(new THREE.TorusGeometry(0.5, 0.11, 10, 28)),
  plane: shared(new THREE.PlaneGeometry(1, 1)),
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// Local transform helper. Returns a scratch matrix: consume it before calling again.
export function xf(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// Second UV set addressing the level-wide baked light grid by world XZ. Vertices
// are nudged along their normal so wall faces sample the room, not the wall.
export function addLightUV(geo, level, inset = 0.3) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv1 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + (nor ? nor.getX(i) * inset : 0);
    const z = pos.getZ(i) + (nor ? nor.getZ(i) * inset : 0);
    uv1[i * 2] = x / level.worldW;
    uv1[i * 2 + 1] = z / level.worldD;
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

// Collects transformed copies of primitives and merges them per material.
export class StaticBatcher {
  constructor() {
    this.groups = new Map();
    this._w = new THREE.Matrix4();
  }

  // `base` positions the prop in the world, `local` the part within the prop.
  add(geometry, material, base, local, tint) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (base && local) this._w.multiplyMatrices(base, local);
    else this._w.copy(base || local);
    g.applyMatrix4(this._w);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const r = tint ? tint[0] : 1, gg = tint ? tint[1] : 1, b = tint ? tint[2] : 1;
    for (let i = 0; i < n; i++) {
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.userData = {};
    let list = this.groups.get(material);
    if (!list) this.groups.set(material, (list = []));
    list.push(g);
  }

  build(level, parent) {
    for (const [material, list] of this.groups) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      addLightUV(merged, level);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = !material.userData.noShadow;
      mesh.receiveShadow = !material.userData.noShadow;
      parent.add(mesh);
    }
    this.groups.clear();
  }
}

// Hand-built quads for floors, walls and ceilings.
export class QuadBatch {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.count = 0;
  }

  // Corners a→b→c→d run counter-clockwise when seen from the side the normal points to.
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, u0, v0, u1, v1, r = 1, g = 1, b = 1) {
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) {
      this.n.push(nx, ny, nz);
      this.c.push(r, g, b);
    }
    this.count += 6;
  }

  // Vertical face from the left end (lx, lz) to the right end (rx, rz) as seen by the viewer it faces.
  wall(lx, lz, rx, rz, y0, y1, nx, nz, r = 1, g = 1, b = 1, uvScale = 0.5) {
    const s0 = (Math.abs(nx) > 0.5 ? lz : lx) * uvScale;
    const s1 = (Math.abs(nx) > 0.5 ? rz : rx) * uvScale;
    this.quad(lx, y0, lz, rx, y0, rz, rx, y1, rz, lx, y1, lz, nx, 0, nz, s0, y0 * uvScale, s1, y1 * uvScale, r, g, b);
  }

  floor(x0, z0, x1, z1, y, r = 1, g = 1, b = 1, uvScale = 0.5) {
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, 0, 1, 0, x0 * uvScale, z1 * uvScale, x1 * uvScale, z0 * uvScale, r, g, b);
  }

  ceiling(x0, z0, x1, z1, y, r = 1, g = 1, b = 1, uvScale = 0.5) {
    this.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, 0, -1, 0, x0 * uvScale, z0 * uvScale, x1 * uvScale, z1 * uvScale, r, g, b);
  }

  build(level) {
    if (!this.count) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (level) addLightUV(geo, level);
    return geo;
  }
}
