// Per-level material set. Standard materials share the baked light grid through
// their lightMap; emissive ones use HDR colours so the bloom pass picks them up.

import * as THREE from 'three';

export const windTime = { value: 0 };

const hdr = (rgb, k) => new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k);

export function createMaterials(theme, tex) {
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const glow = (color, extra) => {
    const m = new THREE.MeshBasicMaterial({ color, vertexColors: true, ...extra });
    m.userData.noShadow = true;
    return m;
  };
  const panel = { map: tex.panel.map, normalMap: tex.panel.normal, roughnessMap: tex.panel.orm, metalnessMap: tex.panel.orm };
  const deck = { map: tex.floor.map, normalMap: tex.floor.normal, roughnessMap: tex.floor.orm, metalnessMap: tex.floor.orm };

  const m = {
    wall: std({ ...panel, color: theme.wall }),
    wallDark: std({ ...panel, color: theme.wallDark }),
    ceiling: std({ ...panel, color: theme.ceiling }),
    hull: std({ map: tex.panel.map, normalMap: tex.panel.normal, color: theme.hull, roughness: 0.62, metalness: 0.7 }),
    floor: std({ ...deck, color: theme.floor }),
    floorOpen:
      theme.openFloor === 'grass'
        ? std({ map: tex.grass.map, normalMap: tex.grass.normal, color: theme.openFloorColor, roughness: 0.96, metalness: 0 })
        : std({ ...deck, color: theme.openFloorColor }),
    poolBed: std({ color: 0x1c2b30, roughness: 0.35, metalness: 0.3 }),
    trim: std({ color: theme.trim, roughness: 0.42, metalness: 0.85 }),
    metal: std({ color: 0xffffff, roughness: 0.36, metalness: 0.88 }),
    paint: std({ color: 0xffffff, roughness: 0.52, metalness: 0.3 }),
    crate: std({ map: tex.crate.map, normalMap: tex.crate.normal, roughness: 0.6, metalness: 0.4 }),
    container: std({ map: tex.container.map, normalMap: tex.container.normal, roughness: 0.58, metalness: 0.45 }),
    hazard: std({ map: tex.hazard, roughness: 0.6, metalness: 0.3 }),
    bark: std({ color: 0x5a4130, roughness: 0.95, metalness: 0 }),
    leaf: std({ color: 0xffffff, roughness: 0.82, metalness: 0, flatShading: true, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xa9d8ff, roughness: 0.05, metalness: 0.95, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide,
    }),
    accent: glow(hdr(theme.accent, 2.3)),
    accent2: glow(hdr(theme.accent2, 2.3)),
    lightPanel: glow(hdr(theme.light, 3.2)),
    white: glow(hdr([1, 1, 1], 1.6)),
    pod: glow(new THREE.Color(0.3, 0.9, 1.7)),
    screen: glow(hdr(theme.accent, 1.5), { map: tex.screen.texture }),
    padDecal: new THREE.MeshBasicMaterial({
      map: tex.pad, color: hdr(theme.accent2, 0.55), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
  };
  m.glass.userData.noShadow = true;
  m.padDecal.userData.noShadow = true;
  m.wall.shadowSide = m.wallDark.shadowSide = m.ceiling.shadowSide = THREE.DoubleSide;

  // Foliage sways gently; positions are already in world space after batching.
  m.leaf.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float sway = smoothstep(1.0, 6.0, transformed.y);
        transformed.x += sin(uWind * 1.1 + transformed.x * 0.6 + transformed.z * 0.4) * 0.08 * sway;
        transformed.z += cos(uWind * 0.9 + transformed.x * 0.5 - transformed.z * 0.7) * 0.07 * sway;`,
      );
  };

  // Materials that receive the baked light grid.
  m.lit = [m.wall, m.wallDark, m.ceiling, m.floor, m.floorOpen, m.poolBed, m.trim, m.metal, m.paint, m.crate, m.container, m.hazard, m.bark, m.leaf];
  m.base = { accent: m.accent.color.clone(), lightPanel: m.lightPanel.color.clone() };
  return m;
}

export function disposeMaterials(m) {
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (v && v.isMaterial) v.dispose();
  }
}

// Reflection probe stand-in: a tiny emissive "studio" in the level's colours,
// prefiltered once so metals pick up believable coloured highlights.
export function createEnvironment(renderer, theme) {
  const scene = new THREE.Scene();
  const add = (color, k, x, y, z, sx, sy, sz) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color: hdr(color, k) }));
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(30, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.fog).multiplyScalar(2.2), side: THREE.BackSide }),
  );
  scene.add(shell);
  add(theme.light, 9, 0, 9, 0, 9, 0.3, 3); // overhead panels
  add(theme.light, 6, 0, 9, 8, 6, 0.3, 2);
  add(theme.light, 6, 0, 9, -8, 6, 0.3, 2);
  add(theme.accent, 5, 12, 1.5, 0, 0.3, 0.5, 20); // wall strips
  add(theme.accent, 5, -12, 1.5, 0, 0.3, 0.5, 20);
  add(theme.accent2, 4, 0, 2, 13, 14, 2.5, 0.3);
  add([1, 0.55, 0.25], 9, -14, 6, -9, 0.3, 5, 5); // the star through a window
  add([0.2, 0.25, 0.35], 1.2, 0, -8, 0, 40, 0.5, 40); // dim floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.035);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return rt;
}
