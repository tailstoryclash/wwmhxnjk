// Level logic: map parsing, collision, ray casting, navigation and the baked
// light grid. Deliberately free of three.js so it can be reasoned about (and
// exercised) on its own; visuals are layered on top by world/builder.js.

import { CELL, WALL_H, OPEN_H, DOOR_H, DOOR_W, NAV_RES, LM_RES } from '../core/constants.js';

export const T = { VOID: 0, FLOOR: 1, OPEN: 2, WALL: 3, WINDOW: 4, DOOR: 5 };

const ENEMY = { d: 'drone', g: 'sentinel', c: 'crawler', j: 'juggernaut', b: 'warden', p: 'pylon' };
const PICKUP = { '+': 'health', '*': 'ammo', $: 'shield', '!': 'weapon', '?': 'log' };
const PROP = { o: 'pillar', x: 'crates', k: 'container', e: 'barrel', '~': 'tree', i: 'lamp', y: 'pod', S: 'ship' };

const UNREACHABLE = 65535;
const _n = { x: 0, y: 0, z: 0 };
const _hit = { t: 0, nx: 0, ny: 0, nz: 0, kind: null, ref: null };

function pushOut(pos, r, x0, x1, z0, z1) {
  const nx = pos.x < x0 ? x0 : pos.x > x1 ? x1 : pos.x;
  const nz = pos.z < z0 ? z0 : pos.z > z1 ? z1 : pos.z;
  const dx = pos.x - nx;
  const dz = pos.z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    pos.x += dx * k;
    pos.z += dz * k;
  } else {
    // Centre is inside the box: leave through the nearest face.
    const l = pos.x - x0, rr = x1 - pos.x, t = pos.z - z0, b = z1 - pos.z;
    const m = Math.min(l, rr, t, b);
    if (m === l) pos.x = x0 - r;
    else if (m === rr) pos.x = x1 + r;
    else if (m === t) pos.z = z0 - r;
    else pos.z = z1 + r;
  }
  return true;
}

// Slab test. Returns entry distance (0 when starting inside) or -1; writes the hit normal to `n`.
function rayBox(ox, oy, oz, dx, dy, dz, b, n) {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 0;
  if (dx !== 0) {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
    if (t2 < tmax) tmax = t2;
  } else if (ox < b.minX || ox > b.maxX) return -1;
  if (dy !== 0) {
    let t1 = (b.minY - oy) / dy, t2 = (b.maxY - oy) / dy, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
    if (t2 < tmax) tmax = t2;
  } else if (oy < b.minY || oy > b.maxY) return -1;
  if (dz !== 0) {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz, s = -1;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
    if (t2 < tmax) tmax = t2;
  } else if (oz < b.minZ || oz > b.maxZ) return -1;
  if (tmax < 0 || tmin > tmax) return -1;
  if (tmin < 0) {
    n.x = -dx; n.y = -dy; n.z = -dz;
    return 0;
  }
  n.x = axis === 0 ? sign : 0;
  n.y = axis === 1 ? sign : 0;
  n.z = axis === 2 ? sign : 0;
  return tmin;
}

export class Level {
  constructor(def) {
    this.def = def;
    const rows = def.map;
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    const n = this.w * this.h;
    this.worldW = this.w * CELL;
    this.worldD = this.h * CELL;
    this.type = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.boundary = new Uint8Array(n);
    this.zone = new Uint8Array(n);
    this.lockedCell = new Uint8Array(n);
    this.buckets = new Array(n).fill(null);
    this.allBoxes = [];
    this.doors = [];
    this.doorByCell = new Map();
    this.doorById = new Map();
    this.spawns = [];
    this.pickupDefs = [];
    this.props = [];
    this.terminals = [];
    this.zoneCells = {};
    this.exit = null;
    this.start = null;
    this._parse(rows);
    this._buildDoorBoxes();
  }

  // ---------------------------------------------------------------- parsing

  _parse(rows) {
    const { w, h } = this;
    const unknown = [];
    const labels = [];
    let weaponN = 0, logN = 0, termN = 0, pickN = 0;

    for (let cz = 0; cz < h; cz++) {
      const row = rows[cz];
      for (let cx = 0; cx < w; cx++) {
        const ch = row[cx] ?? ' ';
        const i = cz * w + cx;
        const x = (cx + 0.5) * CELL;
        const z = (cz + 0.5) * CELL;
        if (ch === ' ') continue;
        if (ch === '#') { this.type[i] = T.WALL; continue; }
        if (ch === 'W') { this.type[i] = T.WINDOW; continue; }
        if (ch === '.') { this.type[i] = T.FLOOR; continue; }
        if (ch === ',') { this.type[i] = T.OPEN; continue; }
        if (ch === 'w') { this.type[i] = T.OPEN; this.water[i] = 1; continue; }
        if (ch === '=' || (ch >= 'A' && ch <= 'F')) {
          this.type[i] = T.DOOR;
          const door = {
            cx, cz, x, z,
            id: ch === '=' ? null : ch,
            locked: ch !== '=',
            open: 0,
            want: 0,
            axis: 'x',
            slab: null,
            index: this.doors.length,
          };
          this.doors.push(door);
          this.doorByCell.set(i, door);
          if (door.id) this.doorById.set(door.id, door);
          if (door.locked) this.lockedCell[i] = 1;
          continue;
        }

        // Everything else stands on floor whose kind is inferred from its neighbours.
        unknown.push(i);
        if (ch === ':') { this.boundary[i] = 1; continue; }
        if (ch >= '1' && ch <= '9') { labels.push({ cx, cz, id: +ch }); continue; }
        if (ch === '@') { this.start = { x, z, cx, cz }; continue; }
        if (ch === '>') { this.exit = { x, z, cx, cz }; continue; }
        if (ch === 'T') {
          termN++;
          this.terminals.push({ id: 'T' + termN, cx, cz, x, z });
          continue;
        }
        if (ENEMY[ch]) { this.spawns.push({ type: ENEMY[ch], cx, cz, x, z, zone: 0 }); continue; }
        if (PICKUP[ch]) {
          const p = { id: 'p' + pickN++, kind: PICKUP[ch], x, z, cx, cz };
          if (p.kind === 'weapon') p.weapon = this.def.weapons?.[weaponN++];
          if (p.kind === 'log') p.log = this.def.logs?.[logN++];
          this.pickupDefs.push(p);
          continue;
        }
        if (PROP[ch]) { this.props.push({ kind: PROP[ch], cx, cz, x, z }); continue; }
        throw new Error(`Unknown map character "${ch}" at ${cx},${cz}`);
      }
    }

    // Marker cells take the floor kind of the majority of their known neighbours.
    let pending = unknown;
    while (pending.length) {
      const next = [];
      const assign = [];
      for (const i of pending) {
        const cx = i % w, cz = (i / w) | 0;
        let open = 0, floor = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const t = this.typeAt(cx + dx, cz + dz);
            if (t === T.OPEN) open++;
            else if (t === T.FLOOR) floor++;
          }
        }
        if (open + floor === 0) next.push(i);
        else assign.push(i, open > floor ? T.OPEN : T.FLOOR);
      }
      for (let k = 0; k < assign.length; k += 2) this.type[assign[k]] = assign[k + 1];
      if (next.length === pending.length) {
        for (const i of next) this.type[i] = T.FLOOR;
        break;
      }
      pending = next;
    }

    // A door's slab spans x when it is flanked by solid cells on the x axis.
    for (const d of this.doors) {
      d.axis = this.solidCell(d.cx - 1, d.cz) && this.solidCell(d.cx + 1, d.cz) ? 'x' : 'z';
    }

    // Zones are the floor regions enclosed by doors and ':' boundaries.
    for (const { cx, cz, id } of labels) {
      const cells = (this.zoneCells[id] ||= []);
      const stack = [cx, cz];
      while (stack.length) {
        const z = stack.pop(), x = stack.pop();
        if (!this.inBounds(x, z)) continue;
        const i = z * w + x;
        const t = this.type[i];
        if ((t !== T.FLOOR && t !== T.OPEN) || this.boundary[i] || this.zone[i]) continue;
        this.zone[i] = id;
        cells.push({ cx: x, cz: z });
        stack.push(x + 1, z, x - 1, z, x, z + 1, x, z - 1);
      }
    }
    for (const s of this.spawns) s.zone = this.zone[s.cz * w + s.cx];
  }

  _buildDoorBoxes() {
    const fw = (CELL - DOOR_W) / 2;
    for (const d of this.doors) {
      const x0 = d.cx * CELL, z0 = d.cz * CELL;
      const x1 = x0 + CELL, z1 = z0 + CELL;
      if (d.axis === 'x') {
        this.addBox({ minX: x0, maxX: x0 + fw, minZ: z0, maxZ: z1, minY: 0, maxY: WALL_H, kind: 'wall' });
        this.addBox({ minX: x1 - fw, maxX: x1, minZ: z0, maxZ: z1, minY: 0, maxY: WALL_H, kind: 'wall' });
        this.addBox({ minX: x0 + fw, maxX: x1 - fw, minZ: z0, maxZ: z1, minY: DOOR_H, maxY: WALL_H, kind: 'wall' });
        d.slab = this.addBox({ minX: x0 + fw, maxX: x1 - fw, minZ: d.z - 0.16, maxZ: d.z + 0.16, minY: 0, maxY: DOOR_H, kind: 'door', ref: d, nav: false });
      } else {
        this.addBox({ minX: x0, maxX: x1, minZ: z0, maxZ: z0 + fw, minY: 0, maxY: WALL_H, kind: 'wall' });
        this.addBox({ minX: x0, maxX: x1, minZ: z1 - fw, maxZ: z1, minY: 0, maxY: WALL_H, kind: 'wall' });
        this.addBox({ minX: x0, maxX: x1, minZ: z0 + fw, maxZ: z1 - fw, minY: DOOR_H, maxY: WALL_H, kind: 'wall' });
        d.slab = this.addBox({ minX: d.x - 0.16, maxX: d.x + 0.16, minZ: z0 + fw, maxZ: z1 - fw, minY: 0, maxY: DOOR_H, kind: 'door', ref: d, nav: false });
      }
    }
  }

  // ---------------------------------------------------------------- queries

  inBounds(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h;
  }

  typeAt(cx, cz) {
    return this.inBounds(cx, cz) ? this.type[cz * this.w + cx] : T.VOID;
  }

  solidCell(cx, cz) {
    const t = this.typeAt(cx, cz);
    return t === T.WALL || t === T.WINDOW || t === T.VOID;
  }

  walkable(cx, cz) {
    const t = this.typeAt(cx, cz);
    return t === T.FLOOR || t === T.OPEN || t === T.DOOR;
  }

  ceilAt(cx, cz) {
    return this.typeAt(cx, cz) === T.OPEN ? OPEN_H : WALL_H;
  }

  zoneAt(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return this.inBounds(cx, cz) ? this.zone[cz * this.w + cx] : 0;
  }

  isWater(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return this.inBounds(cx, cz) && this.water[cz * this.w + cx] === 1;
  }

  zoneCentre(id) {
    const cells = this.zoneCells[id];
    if (!cells || !cells.length) return null;
    let sx = 0, sz = 0;
    for (const c of cells) { sx += c.cx; sz += c.cz; }
    return { x: (sx / cells.length + 0.5) * CELL, z: (sz / cells.length + 0.5) * CELL };
  }

  // ---------------------------------------------------------------- boxes

  addBox(b) {
    if (b.solid === undefined) b.solid = true;
    const cx0 = Math.floor(b.minX / CELL), cx1 = Math.floor((b.maxX - 1e-5) / CELL);
    const cz0 = Math.floor(b.minZ / CELL), cz1 = Math.floor((b.maxZ - 1e-5) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        (this.buckets[cz * this.w + cx] ||= []).push(b);
      }
    }
    this.allBoxes.push(b);
    return b;
  }

  removeBox(b) {
    for (const bucket of this.buckets) {
      if (!bucket) continue;
      const i = bucket.indexOf(b);
      if (i >= 0) bucket.splice(i, 1);
    }
    const i = this.allBoxes.indexOf(b);
    if (i >= 0) this.allBoxes.splice(i, 1);
  }

  // Push a vertical cylinder out of walls and props. Mutates pos.x / pos.z.
  resolveCircle(pos, r, minY, maxY) {
    let collided = false;
    for (let iter = 0; iter < 2; iter++) {
      const cx0 = Math.floor((pos.x - r) / CELL), cx1 = Math.floor((pos.x + r) / CELL);
      const cz0 = Math.floor((pos.z - r) / CELL), cz1 = Math.floor((pos.z + r) / CELL);
      let moved = false;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (this.solidCell(cx, cz)) {
            if (pushOut(pos, r, cx * CELL, (cx + 1) * CELL, cz * CELL, (cz + 1) * CELL)) moved = true;
            continue;
          }
          const bucket = this.buckets[cz * this.w + cx];
          if (!bucket) continue;
          for (let k = 0; k < bucket.length; k++) {
            const b = bucket[k];
            if (!b.solid || b.maxY <= minY || b.minY >= maxY) continue;
            if (pushOut(pos, r, b.minX, b.maxX, b.minZ, b.maxZ)) moved = true;
          }
        }
      }
      if (!moved) break;
      collided = true;
    }
    return collided;
  }

  // Highest surface under a cylinder that it could stand (or step) onto.
  groundHeight(x, z, r, feetY, step) {
    let g = 0;
    const cx0 = Math.floor((x - r) / CELL), cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL), cz1 = Math.floor((z + r) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!this.inBounds(cx, cz)) continue;
        const bucket = this.buckets[cz * this.w + cx];
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const b = bucket[k];
          if (!b.solid || b.minY > 0.01 || b.maxY > feetY + step || b.maxY <= g) continue;
          if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) g = b.maxY;
        }
      }
    }
    return g;
  }

  // Cast a normalised ray through the level. Returns true and fills `hit`
  // ({t, nx, ny, nz, kind, ref}) when something is struck within maxDist.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hit) {
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? ((cx + (dx > 0 ? 1 : 0)) * CELL - ox) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((cz + (dz > 0 ? 1 : 0)) * CELL - oz) / dz : Infinity;
    const tDeltaX = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tDeltaZ = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    let t = 0, axis = -1;
    hit.t = maxDist; hit.kind = null; hit.ref = null;

    for (let guard = 0; guard < 400; guard++) {
      const type = this.typeAt(cx, cz);
      const solid = type === T.WALL || type === T.WINDOW || type === T.VOID;
      const ceil = type === T.OPEN ? OPEN_H : WALL_H;
      if (solid || (axis !== -1 && oy + dy * t > ceil)) {
        // A solid cell, or the wall above a lower neighbouring ceiling.
        hit.t = t;
        hit.kind = type === T.WINDOW ? 'glass' : 'wall';
        hit.ref = null;
        if (axis === -1) { hit.nx = -dx; hit.ny = -dy; hit.nz = -dz; }
        else { hit.nx = axis === 0 ? -stepX : 0; hit.ny = 0; hit.nz = axis === 2 ? -stepZ : 0; }
        return true;
      }

      const tExit = Math.min(tMaxX, tMaxZ);
      let best = Math.min(tExit, maxDist);
      let found = false;
      if (dy < 0) {
        const tf = -oy / dy;
        if (tf >= t && tf <= best) {
          best = tf; found = true;
          hit.kind = 'floor'; hit.ref = null; hit.nx = 0; hit.ny = 1; hit.nz = 0;
        }
      } else if (dy > 0) {
        const tc = (ceil - oy) / dy;
        if (tc >= t && tc <= best) {
          best = tc; found = true;
          hit.kind = type === T.OPEN ? 'glass' : 'ceil'; hit.ref = null; hit.nx = 0; hit.ny = -1; hit.nz = 0;
        }
      }
      const bucket = this.buckets[cz * this.w + cx];
      if (bucket) {
        for (let k = 0; k < bucket.length; k++) {
          const b = bucket[k];
          // ray:false marks volumes that block movement but not shots (they carry their own hit shapes).
          if (!b.solid || b.ray === false) continue;
          const tb = rayBox(ox, oy, oz, dx, dy, dz, b, _n);
          if (tb >= 0 && tb < best) {
            best = tb; found = true;
            hit.kind = b.kind || 'prop'; hit.ref = b.ref || null;
            hit.nx = _n.x; hit.ny = _n.y; hit.nz = _n.z;
          }
        }
      }
      if (found) { hit.t = best; return true; }
      if (tExit >= maxDist) return false;

      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; axis = 0; }
      else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; axis = 2; }
    }
    return false;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, _hit);
  }

  // ---------------------------------------------------------------- doors

  setDoorLocked(door, locked) {
    door.locked = locked;
    this.lockedCell[door.cz * this.w + door.cx] = locked ? 1 : 0;
  }

  // Doors slide open for any actor nearby. `onToggle(door, opening)` fires when one starts to move.
  updateDoors(dt, actors, onToggle) {
    for (const d of this.doors) {
      let want = 0;
      if (!d.locked) {
        for (let k = 0; k < actors.length; k++) {
          const dx = actors[k].x - d.x, dz = actors[k].z - d.z;
          if (dx * dx + dz * dz < 13.5) { want = 1; break; }
        }
      }
      if (want !== d.want) {
        d.want = want;
        onToggle?.(d, want === 1);
      }
      if (d.open < want) d.open = Math.min(want, d.open + dt * 2.6);
      else if (d.open > want) d.open = Math.max(want, d.open - dt * 2.2);
      d.slab.solid = d.open < 0.85;
    }
  }

  // ---------------------------------------------------------------- navigation

  buildNav() {
    const nw = (this.navW = this.w * NAV_RES);
    const nh = (this.navH = this.h * NAV_RES);
    const cs = (this.navCS = CELL / NAV_RES);
    const blocked = (this.navBlocked = new Uint8Array(nw * nh));
    for (let nz = 0; nz < nh; nz++) {
      for (let nx = 0; nx < nw; nx++) {
        if (!this.walkable((nx / NAV_RES) | 0, (nz / NAV_RES) | 0)) blocked[nz * nw + nx] = 1;
      }
    }
    const pad = 0.45; // typical ground-enemy radius
    for (const b of this.allBoxes) {
      if (b.nav === false || b.maxY < 0.45 || b.minY > 1.6) continue;
      const x0 = Math.max(0, Math.ceil((b.minX - pad) / cs - 0.5));
      const x1 = Math.min(nw - 1, Math.floor((b.maxX + pad) / cs - 0.5));
      const z0 = Math.max(0, Math.ceil((b.minZ - pad) / cs - 0.5));
      const z1 = Math.min(nh - 1, Math.floor((b.maxZ + pad) / cs - 0.5));
      for (let nz = z0; nz <= z1; nz++) for (let nx = x0; nx <= x1; nx++) blocked[nz * nw + nx] = 1;
    }
    this.navDist = new Uint16Array(nw * nh).fill(UNREACHABLE);
    this.navQueue = new Int32Array(nw * nh);
  }

  navFree(x, z) {
    const nx = Math.floor(x / this.navCS), nz = Math.floor(z / this.navCS);
    if (nx < 0 || nz < 0 || nx >= this.navW || nz >= this.navH) return false;
    return this.navBlocked[nz * this.navW + nx] === 0;
  }

  // Breadth-first distance field from the target; ground enemies walk downhill on it.
  updateFlow(px, pz) {
    const nw = this.navW, nh = this.navH, dist = this.navDist, blocked = this.navBlocked, q = this.navQueue;
    dist.fill(UNREACHABLE);
    let sx = Math.min(nw - 1, Math.max(0, Math.floor(px / this.navCS)));
    let sz = Math.min(nh - 1, Math.max(0, Math.floor(pz / this.navCS)));
    if (blocked[sz * nw + sx]) {
      // Standing on a prop: seed from the closest free cell instead.
      let bestD = Infinity, bx = -1, bz = -1;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const x = sx + dx, z = sz + dz;
          if (x < 0 || z < 0 || x >= nw || z >= nh || blocked[z * nw + x]) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; bx = x; bz = z; }
        }
      }
      if (bx < 0) return;
      sx = bx; sz = bz;
    }
    let head = 0, tail = 0;
    const start = sz * nw + sx;
    dist[start] = 0;
    q[tail++] = start;
    const w = this.w, locked = this.lockedCell;
    while (head < tail) {
      const i = q[head++];
      const d = dist[i] + 1;
      const x = i % nw, z = (i / nw) | 0;
      for (let k = 0; k < 4; k++) {
        const x2 = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const z2 = z + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (x2 < 0 || z2 < 0 || x2 >= nw || z2 >= nh) continue;
        const j = z2 * nw + x2;
        if (blocked[j] || dist[j] !== UNREACHABLE) continue;
        if (locked[((z2 / NAV_RES) | 0) * w + ((x2 / NAV_RES) | 0)]) continue;
        dist[j] = d;
        q[tail++] = j;
      }
    }
  }

  flowDistance(x, z) {
    const nx = Math.floor(x / this.navCS), nz = Math.floor(z / this.navCS);
    if (nx < 0 || nz < 0 || nx >= this.navW || nz >= this.navH) return UNREACHABLE;
    return this.navDist[nz * this.navW + nx];
  }

  // Unit direction (written to out.x / out.z) that leads towards the flow target. False if no path.
  flowDir(x, z, out) {
    const nw = this.navW, nh = this.navH, dist = this.navDist, blocked = this.navBlocked, cs = this.navCS;
    const sx = Math.floor(x / cs), sz = Math.floor(z / cs);
    if (sx < 0 || sz < 0 || sx >= nw || sz >= nh) return false;
    let cx = sx, cz = sz;
    for (let step = 0; step < 2; step++) {
      let bd = dist[cz * nw + cx], bx = cx, bz = cz;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const x2 = cx + dx, z2 = cz + dz;
          if (x2 < 0 || z2 < 0 || x2 >= nw || z2 >= nh) continue;
          const j = z2 * nw + x2;
          if (blocked[j] || dist[j] >= bd) continue;
          // No cutting corners through blocked cells.
          if (dx && dz && (blocked[cz * nw + x2] || blocked[z2 * nw + cx])) continue;
          bd = dist[j]; bx = x2; bz = z2;
        }
      }
      if (bx === cx && bz === cz) break;
      cx = bx; cz = bz;
    }
    if (cx === sx && cz === sz) return false;
    const dx = (cx + 0.5) * cs - x, dz = (cz + 0.5) * cs - z;
    const len = Math.hypot(dx, dz) || 1;
    out.x = dx / len;
    out.z = dz / len;
    return true;
  }

  // ---------------------------------------------------------------- baked light

  _lightLOS(x0, z0, x1, z1) {
    let cx = Math.floor(x0 / CELL), cz = Math.floor(z0 / CELL);
    const ex = Math.floor(x1 / CELL), ez = Math.floor(z1 / CELL);
    const dx = x1 - x0, dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    let tMaxX = dx !== 0 ? ((cx + (dx > 0 ? 1 : 0)) * CELL - x0) / dx : Infinity;
    let tMaxZ = dz !== 0 ? ((cz + (dz > 0 ? 1 : 0)) * CELL - z0) / dz : Infinity;
    const tDX = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tDZ = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
    let wasDoor = false;
    for (let guard = 0; guard < 64; guard++) {
      if (cx === ex && cz === ez) return true;
      if (tMaxX < tMaxZ) { tMaxX += tDX; cx += stepX; }
      else { tMaxZ += tDZ; cz += stepZ; }
      const t = this.typeAt(cx, cz);
      // Light stops at walls and does not carry through a doorway into the next room.
      if (t === T.WALL || t === T.VOID || t === T.WINDOW || wasDoor) return false;
      wasDoor = t === T.DOOR;
    }
    return true;
  }

  // Accumulate every static light into a top-down irradiance grid (RGB floats).
  bakeLight(lights, openAmbient) {
    const W = (this.lmW = this.w * CELL * LM_RES);
    const H = (this.lmH = this.h * CELL * LM_RES);
    const data = new Float32Array(W * H * 3);
    const s = 1 / LM_RES;

    for (const L of lights) {
      const R = L.radius, R2 = R * R, hgt = L.h;
      const x0 = Math.max(0, Math.floor((L.x - R) * LM_RES)), x1 = Math.min(W - 1, Math.ceil((L.x + R) * LM_RES));
      const z0 = Math.max(0, Math.floor((L.z - R) * LM_RES)), z1 = Math.min(H - 1, Math.ceil((L.z + R) * LM_RES));
      const lcx = Math.floor(L.x / CELL), lcz = Math.floor(L.z / CELL);
      for (let tz = z0; tz <= z1; tz++) {
        const pz = (tz + 0.5) * s;
        const tcz = Math.floor(pz / CELL);
        for (let tx = x0; tx <= x1; tx++) {
          const px = (tx + 0.5) * s;
          const ddx = px - L.x, ddz = pz - L.z;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 > R2) continue;
          const tcx = Math.floor(px / CELL);
          if (this.solidCell(tcx, tcz)) continue;
          if ((tcx !== lcx || tcz !== lcz) && !this._lightLOS(L.x, L.z, px, pz)) continue;
          const k = 1 - d2 / R2;
          const c = hgt / Math.sqrt(d2 + hgt * hgt);
          const f = L.intensity * k * k * c * c * c;
          const o = (tz * W + tx) * 3;
          data[o] += L.r * f; data[o + 1] += L.g * f; data[o + 2] += L.b * f;
        }
      }
    }

    // Sky light under glass roofs, and a mask of texels that hold real data.
    const valid = new Uint8Array(W * H);
    const per = CELL * LM_RES;
    for (let cz = 0; cz < this.h; cz++) {
      for (let cx = 0; cx < this.w; cx++) {
        const t = this.type[cz * this.w + cx];
        if (t !== T.FLOOR && t !== T.OPEN && t !== T.DOOR) continue;
        for (let tz = cz * per; tz < (cz + 1) * per; tz++) {
          for (let tx = cx * per; tx < (cx + 1) * per; tx++) {
            valid[tz * W + tx] = 1;
            if (t === T.OPEN && openAmbient) {
              const o = (tz * W + tx) * 3;
              data[o] += openAmbient[0]; data[o + 1] += openAmbient[1]; data[o + 2] += openAmbient[2];
            }
          }
        }
      }
    }

    // Bleed lit texels into wall cells so filtered lookups at wall faces stay bright.
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      for (let tz = 0; tz < H; tz++) {
        for (let tx = 0; tx < W; tx++) {
          const i = tz * W + tx;
          if (valid[i]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x2 = tx + dx, z2 = tz + dz;
              if (x2 < 0 || z2 < 0 || x2 >= W || z2 >= H) continue;
              const j = z2 * W + x2;
              if (!valid[j]) continue;
              r += data[j * 3]; g += data[j * 3 + 1]; b += data[j * 3 + 2]; n++;
            }
          }
          if (n) add.push(i, r / n, g / n, b / n);
        }
      }
      for (let k = 0; k < add.length; k += 4) {
        const i = add[k];
        data[i * 3] = add[k + 1]; data[i * 3 + 1] = add[k + 2]; data[i * 3 + 2] = add[k + 3];
        valid[i] = 1;
      }
    }

    this.lightData = data;
    return data;
  }

  sampleLight(x, z, out) {
    const d = this.lightData;
    if (!d) { out[0] = out[1] = out[2] = 1; return out; }
    const tx = Math.min(this.lmW - 1, Math.max(0, Math.floor(x * LM_RES)));
    const tz = Math.min(this.lmH - 1, Math.max(0, Math.floor(z * LM_RES)));
    const o = (tz * this.lmW + tx) * 3;
    out[0] = d[o]; out[1] = d[o + 1]; out[2] = d[o + 2];
    return out;
  }
}
