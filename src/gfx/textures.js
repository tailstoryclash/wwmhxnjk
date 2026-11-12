// Every texture in the game is drawn at load time on 2D canvases — there are
// no image assets. Albedo maps are neutral greys so materials can tint them.

import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

const mk = (w, h = w) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Tileable value noise over a `period` × `period` lattice.
function makeNoise(seed, period) {
  const rng = mulberry32(seed);
  const n = period;
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = ((xi % n) + n) % n, y0 = ((yi % n) + n) % n;
    const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[y0 * n + x0], b = g[y0 * n + x1], c = g[y1 * n + x0], d = g[y1 * n + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

// Fractal sum; integer frequency multipliers keep the result tileable.
function fbm(N, P, u, v, octaves, fx = 1, fy = 1) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * N(u * P * fx * f, v * P * fy * f);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

function toTexture(canvas, { srgb = false, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.userData.shared = true;
  return t;
}

// Tangent-space normal map from a greyscale height canvas (wraps at the edges).
function normalFromHeight(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = mk(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      // Canvas rows run downwards while texture V runs up, hence +dy for green.
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const grey = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;

// ---------------------------------------------------------------- wall panels

function buildPanel(seed) {
  const S = 512;
  const rng = mulberry32(seed);
  const hc = mk(S), h = hc.getContext('2d');
  const ac = mk(S), a = ac.getContext('2d');
  const oc = mk(S), o = oc.getContext('2d'); // G = roughness, B = metalness

  h.fillStyle = grey(52); h.fillRect(0, 0, S, S);
  a.fillStyle = grey(58); a.fillRect(0, 0, S, S);
  o.fillStyle = 'rgb(0,200,70)'; o.fillRect(0, 0, S, S);

  const plate = (x, y, w, hh) => {
    const g = 4;
    for (let k = 0; k < 6; k++) {
      h.fillStyle = grey(84 + k * 13);
      h.fillRect(x + g + k, y + g + k, w - 2 * (g + k), hh - 2 * (g + k));
    }
    const shade = 184 + rng() * 26;
    a.fillStyle = grey(shade);
    a.fillRect(x + g, y + g, w - 2 * g, hh - 2 * g);
    a.fillStyle = 'rgba(255,255,255,0.22)';
    a.fillRect(x + g, y + g, w - 2 * g, 2);
    a.fillRect(x + g, y + g, 2, hh - 2 * g);
    a.fillStyle = 'rgba(0,0,0,0.25)';
    a.fillRect(x + g, y + hh - g - 2, w - 2 * g, 2);
    a.fillRect(x + w - g - 2, y + g, 2, hh - 2 * g);
    o.fillStyle = `rgb(0,${(128 + rng() * 34) | 0},92)`;
    o.fillRect(x + g, y + g, w - 2 * g, hh - 2 * g);
  };
  const bolt = (x, y, r = 5) => {
    h.fillStyle = grey(215); h.beginPath(); h.arc(x, y, r, 0, 7); h.fill();
    a.fillStyle = 'rgba(0,0,0,0.35)'; a.beginPath(); a.arc(x, y, r + 1.5, 0, 7); a.fill();
    a.fillStyle = grey(205); a.beginPath(); a.arc(x, y, r - 1, 0, 7); a.fill();
  };

  plate(0, 0, S, 300);
  plate(0, 300, 256, 212);
  plate(256, 300, 256, 212);

  // Recessed service panel.
  h.fillStyle = grey(112); h.fillRect(52, 46, 236, 150);
  h.fillStyle = grey(128); h.fillRect(58, 52, 224, 138);
  a.fillStyle = 'rgba(0,0,0,0.12)'; a.fillRect(52, 46, 236, 150);
  a.strokeStyle = 'rgba(0,0,0,0.45)'; a.lineWidth = 2; a.strokeRect(52, 46, 236, 150);
  a.strokeStyle = 'rgba(255,255,255,0.14)'; a.lineWidth = 1; a.strokeRect(55, 49, 230, 144);

  // Vent slits.
  for (let k = 0; k < 7; k++) {
    const y = 58 + k * 19;
    h.fillStyle = grey(30); h.fillRect(336, y, 124, 9);
    a.fillStyle = grey(34); a.fillRect(336, y, 124, 9);
    a.fillStyle = 'rgba(255,255,255,0.2)'; a.fillRect(336, y + 9, 124, 1);
    o.fillStyle = 'rgb(0,235,40)'; o.fillRect(336, y, 124, 9);
  }

  // Stencilled id and a faded caution label.
  a.font = 'bold 21px monospace';
  a.fillStyle = 'rgba(30,34,40,0.6)';
  a.fillText('LS-' + String(10 + (seed % 89)).padStart(3, '0'), 70, 262);
  a.fillStyle = 'rgba(214,150,60,0.75)'; a.fillRect(356, 226, 96, 30);
  a.fillStyle = 'rgba(30,26,20,0.8)';
  for (let k = 0; k < 6; k++) { a.beginPath(); a.moveTo(360 + k * 16, 256); a.lineTo(368 + k * 16, 256); a.lineTo(378 + k * 16, 226); a.lineTo(370 + k * 16, 226); a.fill(); }

  // Round access port on the lower-left plate.
  h.strokeStyle = grey(40); h.lineWidth = 6; h.beginPath(); h.arc(128, 406, 52, 0, 7); h.stroke();
  a.strokeStyle = 'rgba(0,0,0,0.5)'; a.lineWidth = 5; a.beginPath(); a.arc(128, 406, 52, 0, 7); a.stroke();
  a.strokeStyle = 'rgba(255,255,255,0.16)'; a.lineWidth = 1.5; a.beginPath(); a.arc(128, 406, 56, 0, 7); a.stroke();
  for (let k = 0; k < 8; k++) bolt(128 + Math.cos((k / 8) * 6.283) * 68, 406 + Math.sin((k / 8) * 6.283) * 68, 4);

  // Cable channel on the lower-right plate.
  h.fillStyle = grey(70); h.fillRect(292, 388, 184, 36);
  a.fillStyle = 'rgba(0,0,0,0.3)'; a.fillRect(292, 388, 184, 36);
  for (let k = 0; k < 4; k++) {
    h.fillStyle = grey(150); h.fillRect(292, 392 + k * 8, 184, 4);
    a.fillStyle = grey(96 + k * 12); a.fillRect(292, 392 + k * 8, 184, 4);
  }

  for (const [x, y] of [[18, 18], [494, 18], [18, 282], [494, 282], [18, 318], [238, 318], [18, 494], [238, 494], [274, 318], [494, 318], [274, 494], [494, 494]]) bolt(x, y);

  // Scratches catch the light: brighter and glossier.
  for (let k = 0; k < 46; k++) {
    const x = rng() * S, y = rng() * S, len = 10 + rng() * 60, ang = rng() * Math.PI;
    a.strokeStyle = `rgba(255,255,255,${0.05 + rng() * 0.1})`;
    a.lineWidth = 1;
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); a.stroke();
    o.strokeStyle = 'rgba(0,70,110,0.5)';
    o.lineWidth = 1.5;
    o.beginPath(); o.moveTo(x, y); o.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); o.stroke();
  }

  const P = 8;
  const N = makeNoise(seed + 7, P);
  const aImg = a.getImageData(0, 0, S, S), hImg = h.getImageData(0, 0, S, S), oImg = o.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, u = x / S, v = y / S;
      const big = fbm(N, P, u, v, 4);
      const fine = N(u * P * 32, v * P * 32);
      const streak = fbm(N, P, u, v, 3, 12, 1); // vertical dirt runs
      const k = 1 - 0.2 * smooth(0.48, 0.8, big) - 0.07 * (fine - 0.5) - 0.13 * smooth(0.55, 0.9, streak);
      aImg.data[i] *= k; aImg.data[i + 1] *= k; aImg.data[i + 2] *= k * 1.01;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = hImg.data[i] + (fine - 0.5) * 7;
      oImg.data[i + 1] = Math.min(255, Math.max(40, oImg.data[i + 1] + (big - 0.5) * 70 + (fine - 0.5) * 24));
    }
  }
  a.putImageData(aImg, 0, 0); h.putImageData(hImg, 0, 0); o.putImageData(oImg, 0, 0);

  return { map: toTexture(ac, { srgb: true }), normal: toTexture(normalFromHeight(hc, 2.6)), orm: toTexture(oc) };
}

// ---------------------------------------------------------------- deck plating

function buildFloor(seed) {
  const S = 512;
  const rng = mulberry32(seed);
  const hc = mk(S), h = hc.getContext('2d');
  const ac = mk(S), a = ac.getContext('2d');
  const oc = mk(S), o = oc.getContext('2d');
  h.fillStyle = grey(40); h.fillRect(0, 0, S, S);
  a.fillStyle = grey(48); a.fillRect(0, 0, S, S);
  o.fillStyle = 'rgb(0,190,110)'; o.fillRect(0, 0, S, S);
  for (let py = 0; py < 2; py++) {
    for (let px = 0; px < 2; px++) {
      const x = px * 256, y = py * 256;
      for (let k = 0; k < 5; k++) { h.fillStyle = grey(86 + k * 10); h.fillRect(x + 3 + k, y + 3 + k, 250 - 2 * k, 250 - 2 * k); }
      a.fillStyle = grey(150 + rng() * 22); a.fillRect(x + 3, y + 3, 250, 250);
      a.fillStyle = 'rgba(255,255,255,0.16)'; a.fillRect(x + 3, y + 3, 250, 2); a.fillRect(x + 3, y + 3, 2, 250);
      a.fillStyle = 'rgba(0,0,0,0.3)'; a.fillRect(x + 3, y + 251, 250, 2); a.fillRect(x + 251, y + 3, 2, 250);
      o.fillStyle = `rgb(0,${(96 + rng() * 30) | 0},150)`; o.fillRect(x + 3, y + 3, 250, 250);
      for (const [bx, by] of [[16, 16], [240, 16], [16, 240], [240, 240]]) {
        h.fillStyle = grey(190); h.beginPath(); h.arc(x + bx, y + by, 5, 0, 7); h.fill();
        a.fillStyle = 'rgba(0,0,0,0.4)'; a.beginPath(); a.arc(x + bx, y + by, 6.5, 0, 7); a.fill();
        a.fillStyle = grey(176); a.beginPath(); a.arc(x + bx, y + by, 4, 0, 7); a.fill();
      }
    }
  }
  const P = 8;
  const N = makeNoise(seed + 3, P);
  const aImg = a.getImageData(0, 0, S, S), hImg = h.getImageData(0, 0, S, S), oImg = o.getImageData(0, 0, S, S);
  const w16 = (2 * Math.PI) / 16;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, u = x / S, v = y / S;
      const px = x % 256, py = y % 256;
      const inset = Math.min(px, py, 255 - px, 255 - py);
      let stud = 0;
      if (inset > 26) {
        const sv = Math.sin(x * w16) * Math.sin(y * w16);
        stud = sv > 0 ? sv * sv : 0;
      }
      const wear = fbm(N, P, u, v, 4);
      const fine = N(u * P * 32, v * P * 32);
      const k = 0.9 + 0.2 * smooth(0.4, 0.75, wear) - 0.08 * (fine - 0.5) + stud * 0.1;
      aImg.data[i] *= k; aImg.data[i + 1] *= k; aImg.data[i + 2] *= k;
      hImg.data[i] = hImg.data[i + 1] = hImg.data[i + 2] = hImg.data[i] + stud * 46 + (fine - 0.5) * 6;
      // Worn paths polish up.
      oImg.data[i + 1] = Math.min(255, Math.max(36, oImg.data[i + 1] - smooth(0.45, 0.8, wear) * 46 + (fine - 0.5) * 26));
    }
  }
  a.putImageData(aImg, 0, 0); h.putImageData(hImg, 0, 0); o.putImageData(oImg, 0, 0);
  return { map: toTexture(ac, { srgb: true }), normal: toTexture(normalFromHeight(hc, 2.8)), orm: toTexture(oc) };
}

// ---------------------------------------------------------------- arboretum turf

function buildGrass(seed) {
  const S = 512;
  const rng = mulberry32(seed);
  const ac = mk(S), a = ac.getContext('2d');
  const hc = mk(S), h = hc.getContext('2d');
  const P = 8;
  const N = makeNoise(seed, P);
  const img = a.createImageData(S, S), himg = h.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4, u = x / S, v = y / S;
      const n1 = fbm(N, P, u, v, 4);
      const n2 = fbm(N, P, u + 0.37, v + 0.11, 3, 2, 2);
      const fine = N(u * P * 40, v * P * 40);
      const dry = smooth(0.58, 0.8, n2);
      let r = 30 + n1 * 34, g = 66 + n1 * 52, b = 28 + n1 * 18;
      r += dry * 52; g += dry * 26; b += dry * 6;
      const k = 0.82 + fine * 0.36;
      img.data[i] = r * k; img.data[i + 1] = g * k; img.data[i + 2] = b * k; img.data[i + 3] = 255;
      const hv = 90 + n1 * 60 + fine * 50;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
  }
  a.putImageData(img, 0, 0); h.putImageData(himg, 0, 0);
  for (let k = 0; k < 5200; k++) {
    const x = rng() * S, y = rng() * S, len = 3 + rng() * 7, ang = rng() * 6.283;
    const g = 90 + rng() * 80;
    a.strokeStyle = `rgba(${(g * 0.55) | 0},${g | 0},${(g * 0.4) | 0},0.55)`;
    a.lineWidth = 1;
    a.beginPath(); a.moveTo(x, y); a.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); a.stroke();
    h.strokeStyle = 'rgba(235,235,235,0.5)';
    h.beginPath(); h.moveTo(x, y); h.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); h.stroke();
  }
  return { map: toTexture(ac, { srgb: true }), normal: toTexture(normalFromHeight(hc, 1.6)) };
}

// ---------------------------------------------------------------- props

function buildCrate(seed) {
  const S = 256;
  const rng = mulberry32(seed);
  const ac = mk(S), a = ac.getContext('2d');
  const hc = mk(S), h = hc.getContext('2d');
  a.fillStyle = grey(168); a.fillRect(0, 0, S, S);
  h.fillStyle = grey(96); h.fillRect(0, 0, S, S);
  // Raised frame.
  h.fillStyle = grey(190);
  h.fillRect(0, 0, S, 26); h.fillRect(0, S - 26, S, 26); h.fillRect(0, 0, 26, S); h.fillRect(S - 26, 0, 26, S);
  a.fillStyle = grey(108);
  a.fillRect(0, 0, S, 26); a.fillRect(0, S - 26, S, 26); a.fillRect(0, 0, 26, S); a.fillRect(S - 26, 0, 26, S);
  a.fillStyle = 'rgba(255,255,255,0.2)'; a.fillRect(26, 26, S - 52, 2); a.fillRect(0, 0, S, 2);
  a.fillStyle = 'rgba(0,0,0,0.35)'; a.fillRect(26, S - 28, S - 52, 2);
  // Ribs.
  for (let k = 0; k < 5; k++) {
    const x = 50 + k * 39;
    h.fillStyle = grey(140); h.fillRect(x, 34, 12, S - 68);
    a.fillStyle = 'rgba(0,0,0,0.12)'; a.fillRect(x, 34, 12, S - 68);
    a.fillStyle = 'rgba(255,255,255,0.12)'; a.fillRect(x, 34, 2, S - 68);
  }
  // Label plate and stripe.
  a.fillStyle = grey(226); a.fillRect(52, 150, 96, 44);
  a.fillStyle = grey(60);
  a.font = 'bold 18px monospace'; a.fillText('LS ' + (100 + ((rng() * 800) | 0)), 60, 178);
  a.fillStyle = 'rgba(40,40,40,0.75)'; a.fillRect(160, 150, 44, 10); a.fillRect(160, 166, 30, 10); a.fillRect(160, 182, 38, 10);
  for (const [x, y] of [[13, 13], [S - 13, 13], [13, S - 13], [S - 13, S - 13]]) {
    h.fillStyle = grey(240); h.beginPath(); h.arc(x, y, 5, 0, 7); h.fill();
    a.fillStyle = grey(70); a.beginPath(); a.arc(x, y, 5, 0, 7); a.fill();
  }
  const N = makeNoise(seed + 1, 8);
  const img = a.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const k = 0.86 + fbm(N, 8, x / S, y / S, 3) * 0.24 - (N((x / S) * 8 * 24, (y / S) * 8 * 24) - 0.5) * 0.08;
      img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
    }
  }
  a.putImageData(img, 0, 0);
  return { map: toTexture(ac, { srgb: true }), normal: toTexture(normalFromHeight(hc, 2.2)) };
}

function buildContainer(seed) {
  const S = 256;
  const ac = mk(S), a = ac.getContext('2d');
  const hc = mk(S), h = hc.getContext('2d');
  const N = makeNoise(seed, 8);
  const img = a.createImageData(S, S), himg = h.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const rail = y < 20 || y > S - 20;
      const wave = rail ? 0.9 : 0.5 + 0.5 * Math.sin((x / S) * Math.PI * 2 * 12);
      const grime = fbm(N, 8, x / S, y / S, 4);
      const streak = fbm(N, 8, x / S, y / S, 3, 10, 1);
      let c = (rail ? 120 : 150 + wave * 62) * (0.84 + grime * 0.22) * (1 - 0.16 * smooth(0.55, 0.9, streak));
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
      const hv = rail ? 215 : 70 + wave * 150;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv; himg.data[i + 3] = 255;
    }
  }
  a.putImageData(img, 0, 0); h.putImageData(himg, 0, 0);
  a.fillStyle = 'rgba(240,240,240,0.82)'; a.fillRect(150, 54, 84, 46);
  a.fillStyle = 'rgba(30,30,30,0.85)'; a.font = 'bold 20px monospace'; a.fillText('LANTERN', 152, 74); a.fillText('TE-212', 158, 94);
  return { map: toTexture(ac, { srgb: true }), normal: toTexture(normalFromHeight(hc, 1.8)) };
}

function buildHazard() {
  const c = mk(256, 64), x = c.getContext('2d');
  x.fillStyle = '#d9a520'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#17181b';
  for (let k = -2; k < 10; k++) {
    x.beginPath(); x.moveTo(k * 32, 64); x.lineTo(k * 32 + 16, 64); x.lineTo(k * 32 + 48, 0); x.lineTo(k * 32 + 32, 0); x.fill();
  }
  const N = makeNoise(5, 8);
  const img = x.getImageData(0, 0, 256, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const p = i / 4, k = 0.72 + fbm(N, 8, (p % 256) / 256, ((p / 256) | 0) / 64, 3) * 0.4;
    img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true });
}

// ---------------------------------------------------------------- sprites

function radial(stops, size = 128) {
  const c = mk(size), x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) g.addColorStop(t, col);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function buildScorch() {
  const S = 128;
  const c = radial([[0, 'rgba(8,8,10,0.92)'], [0.35, 'rgba(10,10,12,0.75)'], [0.7, 'rgba(12,12,14,0.3)'], [1, 'rgba(0,0,0,0)']], S);
  const x = c.getContext('2d');
  const N = makeNoise(77, 8);
  const img = x.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const p = i / 4;
    img.data[i + 3] *= 0.45 + fbm(N, 8, (p % S) / S, ((p / S) | 0) / S, 3, 2, 2) * 0.9;
  }
  x.putImageData(img, 0, 0);
  return toTexture(c, { srgb: true, repeat: false });
}

function buildFlare() {
  const S = 128;
  const c = radial([[0, 'rgba(255,255,255,1)'], [0.16, 'rgba(255,255,255,0.75)'], [0.5, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']], S);
  const x = c.getContext('2d');
  x.globalCompositeOperation = 'lighter';
  // Four tapering spikes.
  for (let k = 0; k < 4; k++) {
    x.save();
    x.translate(S / 2, S / 2);
    x.rotate((k * Math.PI) / 2 + 0.35);
    const g = x.createLinearGradient(0, 0, S / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.moveTo(0, -5); x.lineTo(S / 2, 0); x.lineTo(0, 5); x.fill();
    x.restore();
  }
  return toTexture(c, { srgb: true, repeat: false });
}

function buildRing() {
  const S = 256;
  const c = mk(S), x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.9, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: true, repeat: false });
}

function buildPad() {
  const S = 512;
  const c = mk(S), x = c.getContext('2d');
  x.translate(S / 2, S / 2);
  x.strokeStyle = 'rgba(255,255,255,0.9)';
  x.lineWidth = 9; x.beginPath(); x.arc(0, 0, 232, 0, 7); x.stroke();
  x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 208, 0, 7); x.stroke();
  x.setLineDash([26, 20]); x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 150, 0, 7); x.stroke(); x.setLineDash([]);
  for (let k = 0; k < 4; k++) {
    x.save(); x.rotate((k * Math.PI) / 2);
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.fillRect(-4, -250, 8, 60);
    x.restore();
  }
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.font = 'bold 76px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('02', 0, 4);
  return toTexture(c, { srgb: true, repeat: false });
}

// Illuminated door sign. Returned texture is unique per label (not shared).
export function makeSign(text) {
  const c = mk(512, 112), x = c.getContext('2d');
  x.fillStyle = 'rgba(4,8,12,0.78)'; x.fillRect(0, 0, 512, 112);
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 3; x.strokeRect(5, 5, 502, 102);
  x.fillStyle = '#fff';
  x.fillRect(18, 22, 6, 68);
  x.font = '700 50px Orbitron, "Segoe UI", sans-serif';
  x.textBaseline = 'middle';
  let size = 50;
  while (x.measureText(text).width > 440 && size > 20) { size -= 2; x.font = `700 ${size}px Orbitron, "Segoe UI", sans-serif`; }
  x.fillText(text, 40, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Animated terminal display shared by every console.
class ScreenTexture {
  constructor() {
    this.canvas = mk(256, 160);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.userData.shared = true;
    this.rng = mulberry32(99);
    this.lines = Array.from({ length: 9 }, () => this._line());
    this.acc = 0;
    this.scroll = 0;
    this.draw(0);
  }

  _line() {
    const r = this.rng;
    return { indent: (r() * 3) | 0, len: 6 + ((r() * 16) | 0), bright: r() > 0.8 };
  }

  update(dt, time) {
    this.acc += dt;
    if (this.acc < 0.12) return;
    this.acc = 0;
    this.scroll++;
    if (this.scroll % 4 === 0) { this.lines.shift(); this.lines.push(this._line()); }
    this.draw(time);
  }

  draw(time) {
    const x = this.ctx;
    x.fillStyle = '#03090d'; x.fillRect(0, 0, 256, 160);
    x.fillStyle = '#bfefff'; x.fillRect(0, 0, 256, 20);
    x.fillStyle = '#03090d'; x.font = 'bold 13px monospace'; x.fillText('LANTERN//SYS', 8, 14);
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      x.fillStyle = l.bright ? '#ffffff' : '#6fd6f0';
      x.fillRect(10 + l.indent * 12, 30 + i * 11, l.len * 7, 5);
    }
    // Waveform strip.
    x.strokeStyle = '#ffffff'; x.lineWidth = 1.5; x.beginPath();
    for (let k = 0; k <= 60; k++) {
      const y = 144 + Math.sin(k * 0.5 + time * 6) * 6 * Math.sin(k * 0.13 + time * 1.7);
      if (k === 0) x.moveTo(10 + k * 4, y); else x.lineTo(10 + k * 4, y);
    }
    x.stroke();
    this.texture.needsUpdate = true;
  }
}

let cache = null;

export function getTextures() {
  if (cache) return cache;
  cache = {
    panel: buildPanel(101),
    floor: buildFloor(202),
    grass: buildGrass(303),
    crate: buildCrate(404),
    container: buildContainer(505),
    hazard: buildHazard(),
    glow: toTexture(radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]), { srgb: true, repeat: false }),
    scorch: buildScorch(),
    flare: buildFlare(),
    ring: buildRing(),
    pad: buildPad(),
    screen: new ScreenTexture(),
  };
  return cache;
}
