// Procedural deep-space backdrop: stars, nebula, the colony world Meridian and
// Tau Erebus itself — a star with a dark, hollow heart.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // pin to the far plane
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  uniform vec3 uNebulaA;
  uniform vec3 uNebulaB;
  uniform vec3 uPlanetDir;
  uniform vec3 uPlanetColor;
  uniform float uPlanetSize;
  uniform float uTime;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * noise3(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }

  vec3 starLayer(vec3 d, float scale, float density) {
    vec3 p = d * scale;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(id);
    if (h < density) return vec3(0.0);
    vec3 off = vec3(hash13(id + 1.7), hash13(id + 5.3), hash13(id + 9.1)) - 0.5;
    float dist = length(f - off * 0.6);
    float tw = 0.75 + 0.25 * sin(uTime * (0.6 + h * 2.5) + h * 60.0);
    float b = smoothstep(0.11, 0.0, dist) * tw * (0.5 + 2.2 * hash13(id + 3.3));
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.82, 0.62), hash13(id + 7.7));
    return tint * b;
  }

  void basis(vec3 n, out vec3 t, out vec3 b) {
    vec3 up = abs(n.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    t = normalize(cross(up, n));
    b = cross(n, t);
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.0);

    // Nebula.
    float n = fbm(d * 2.1 + vec3(0.0, uTime * 0.003, 0.0));
    float n2 = fbm(d * 4.4 + 7.3);
    vec3 neb = mix(uNebulaA, uNebulaB, smoothstep(0.32, 0.72, n2));
    col += neb * pow(smoothstep(0.38, 0.86, n), 1.7) * 0.9;
    col += uNebulaA * 0.045;

    // Stars.
    col += starLayer(d, 70.0, 0.955) * 1.3;
    col += starLayer(d, 170.0, 0.94) * 0.55;

    // Tau Erebus: a burning ring around a dead core.
    float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    float R = uSunSize;
    vec3 st, sb;
    basis(uSunDir, st, sb);
    float theta = atan(dot(d, sb), dot(d, st));
    float rays = 0.55 + 0.9 * fbm(vec3(cos(theta) * 2.4, sin(theta) * 2.4, ang * 9.0 - uTime * 0.05));
    float ring = smoothstep(R * 0.085, 0.0, abs(ang - R));
    float corona = exp(-max(ang - R, 0.0) / (R * 0.55)) * step(R * 0.96, ang);
    float halo = exp(-ang * 3.2);
    float inner = smoothstep(R * 0.55, R, ang) * (1.0 - step(R, ang));
    float hollow = smoothstep(R * 0.9, R * 1.0, ang); // 0 inside the dark heart
    col *= hollow;
    col += uSunColor * (ring * 16.0 + corona * rays * 2.6 + halo * 0.5);
    col += uSunColor * vec3(1.0, 0.35, 0.2) * inner * inner * 0.9 * rays;

    // Meridian, lit by the star.
    float pAng = acos(clamp(dot(d, uPlanetDir), -1.0, 1.0));
    if (pAng < uPlanetSize * 1.12) {
      vec3 pt, pb;
      basis(uPlanetDir, pt, pb);
      vec2 q = vec2(dot(d, pt), dot(d, pb)) / sin(uPlanetSize);
      float r2 = dot(q, q);
      float edge = smoothstep(1.0, 0.985, sqrt(r2));
      if (r2 < 1.0) {
        float zz = sqrt(1.0 - r2);
        vec3 nrm = normalize(q.x * pt + q.y * pb - zz * uPlanetDir);
        float lit = smoothstep(-0.08, 0.5, dot(nrm, uSunDir));
        float land = fbm(nrm * 3.2 + 4.0);
        float cloud = smoothstep(0.52, 0.75, fbm(nrm * 6.0 + vec3(uTime * 0.004, 0.0, 0.0)));
        vec3 surf = mix(uPlanetColor * 0.55, vec3(0.32, 0.36, 0.2), smoothstep(0.5, 0.62, land));
        surf = mix(surf, vec3(0.9), cloud * 0.7);
        vec3 pc = surf * lit * 1.5;
        // City lights on the night side.
        float city = step(0.74, noise3(nrm * 42.0)) * smoothstep(0.5, 0.62, land) * (1.0 - lit);
        pc += vec3(1.0, 0.7, 0.35) * city * 0.5;
        float rim = pow(1.0 - zz, 3.0);
        pc += uPlanetColor * rim * (0.25 + lit * 1.5);
        col = mix(col, pc, edge);
      }
      float atmo = smoothstep(uPlanetSize * 1.12, uPlanetSize, pAng);
      col += uPlanetColor * atmo * 0.08;
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.45, 0.15) },
      uSunSize: { value: 0.1 },
      uNebulaA: { value: new THREE.Color(0.05, 0.1, 0.3) },
      uNebulaB: { value: new THREE.Color(0.3, 0.08, 0.2) },
      uPlanetDir: { value: new THREE.Vector3(0, 0.3, 1).normalize() },
      uPlanetColor: { value: new THREE.Color(0.2, 0.5, 0.8) },
      uPlanetSize: { value: 0.16 },
      uTime: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    material.userData.shared = true;
    const geometry = new THREE.SphereGeometry(50, 32, 16);
    geometry.userData.shared = true;
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  applyTheme(theme) {
    const s = theme.sky;
    this.uniforms.uSunDir.value.fromArray(theme.sunDir).normalize();
    this.uniforms.uSunColor.value.fromArray(s.sunColor);
    this.uniforms.uSunSize.value = s.sunSize;
    this.uniforms.uNebulaA.value.fromArray(s.nebulaA);
    this.uniforms.uNebulaB.value.fromArray(s.nebulaB);
    this.uniforms.uPlanetDir.value.fromArray(s.planetDir).normalize();
    this.uniforms.uPlanetColor.value.fromArray(s.planetColor);
    this.uniforms.uPlanetSize.value = s.planetSize;
  }

  update(dt, camera) {
    this.uniforms.uTime.value += dt;
    this.mesh.position.copy(camera.position);
  }
}
