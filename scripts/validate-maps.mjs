// Sanity checks for the hand-authored ASCII maps. Needs only Node:
//   node scripts/validate-maps.mjs

import { Level, T } from '../src/world/level.js';
import { LEVELS } from '../src/world/levels/index.js';
import { LOGS } from '../src/world/story.js';

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL:', m); };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

for (const def of LEVELS) {
  console.log('== ' + def.id + ': ' + def.map.length + ' rows');
  const widths = new Set(def.map.map((r) => r.length));
  if (widths.size !== 1) fail('ragged rows: ' + def.map.map((r, i) => i + ':' + r.length).join(' '));
  const L = new Level(def);
  if (!L.start) fail('no start');
  if (def.id !== 'core' && !L.exit) fail('no exit');
  const tIds = L.terminals.map((t) => t.id).join(',');
  if (tIds !== Object.keys(def.terminals).join(',')) fail('terminals ' + tIds + ' vs def ' + Object.keys(def.terminals));
  const logs = L.pickupDefs.filter((p) => p.kind === 'log');
  if (logs.length !== def.logs.length || logs.some((p) => !LOGS[p.log])) fail('log mismatch ' + logs.map((p) => p.log));
  const weps = L.pickupDefs.filter((p) => p.kind === 'weapon');
  if (weps.length !== def.weapons.length || weps.some((p) => !p.weapon)) fail('weapon mismatch');
  for (const s of L.spawns) if (!s.zone) fail('spawn ' + s.type + ' at ' + s.cx + ',' + s.cz + ' has no zone');

  for (const d of L.doors) {
    const a = d.axis === 'x' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    const b = d.axis === 'x' ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
    if (!a.every(([dx, dz]) => L.walkable(d.cx + dx, d.cz + dz))) fail('door ' + (d.id || '=') + ' at ' + d.cx + ',' + d.cz + ' passage blocked (axis ' + d.axis + ')');
    if (!b.every(([dx, dz]) => L.solidCell(d.cx + dx, d.cz + dz))) fail('door at ' + d.cx + ',' + d.cz + ' not flanked by walls');
  }

  const seen = new Uint8Array(L.w * L.h);
  const st = [[L.start.cx, L.start.cz]];
  while (st.length) {
    const [x, z] = st.pop();
    if (!L.walkable(x, z) || seen[z * L.w + x]) continue;
    seen[z * L.w + x] = 1;
    for (const [dx, dz] of N4) st.push([x + dx, z + dz]);
  }
  let unreach = 0;
  for (let z = 0; z < L.h; z++) for (let x = 0; x < L.w; x++) if (L.walkable(x, z) && !seen[z * L.w + x]) unreach++;
  if (unreach) fail(unreach + ' unreachable walkable cells');

  for (let z = 0; z < L.h; z++) {
    for (let x = 0; x < L.w; x++) {
      if (L.walkable(x, z)) {
        for (const [dx, dz] of N4) if (L.typeAt(x + dx, z + dz) === T.VOID) fail('floor ' + x + ',' + z + ' touches void');
      }
      if (L.typeAt(x, z) === T.WINDOW && !N4.some(([dx, dz]) => L.typeAt(x + dx, z + dz) === T.VOID)) fail('window ' + x + ',' + z + ' has no outside');
    }
  }

  const zones = {};
  for (const s of L.spawns) {
    zones[s.zone] ||= {};
    zones[s.zone][s.type] = (zones[s.zone][s.type] || 0) + 1;
  }
  const count = (arr, key) => JSON.stringify(arr.reduce((a, p) => ((a[p[key]] = (a[p[key]] || 0) + 1), a), {}));
  console.log('  size', L.w, 'x', L.h, '| doors', L.doors.map((d) => (d.id || '=') + d.axis).join(' '), '| start', L.start.cx, L.start.cz, '| exit', L.exit && [L.exit.cx, L.exit.cz]);
  console.log('  zones', JSON.stringify(zones), '| total hostiles', L.spawns.length);
  console.log('  pickups', count(L.pickupDefs, 'kind'), '| props', count(L.props, 'kind'));

  L.buildNav();
  L.updateFlow(L.start.x, L.start.z);
  let reach = 0, total = 0;
  for (let i = 0; i < L.navDist.length; i++) {
    if (!L.navBlocked[i]) { total++; if (L.navDist[i] !== 65535) reach++; }
  }
  console.log('  nav free cells', total, '| reachable from start with locked doors shut', reach);
  const hit = {};
  const yaw = def.startYaw;
  const ok = L.raycast(L.start.x, 1.6, L.start.z, -Math.sin(yaw), 0, -Math.cos(yaw), 200, hit);
  console.log('  forward ray:', ok, hit.kind, hit.t.toFixed(1));
}

console.log(bad ? '\n' + bad + ' PROBLEM(S)' : '\nall maps OK');
process.exit(bad ? 1 : 0);
