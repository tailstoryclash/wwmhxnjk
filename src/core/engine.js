// Renderer, post-processing chain and quality presets.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: { label: 'Low', maxPixelRatio: 1, scale: 0.8, msaa: 0, shadows: false, shadowSize: 1024, poolLights: 4, particles: 0.5 },
  medium: { label: 'Medium', maxPixelRatio: 1, scale: 1, msaa: 2, shadows: true, shadowSize: 1024, poolLights: 6, particles: 0.8 },
  high: { label: 'High', maxPixelRatio: 1.5, scale: 1, msaa: 4, shadows: true, shadowSize: 2048, poolLights: 8, particles: 1 },
};

// Final grade applied in linear HDR, before tone mapping.
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uChroma: { value: 0.6 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uDamage: { value: 0 },
    uDamageColor: { value: new THREE.Color(1, 0.05, 0.02) },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uDesat: { value: 0 },
    uFade: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uChroma, uVignette, uGrain, uDamage, uFlash, uDesat, uFade;
    uniform vec3 uDamageColor, uFlashColor, uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uChroma * 0.03;
      vec3 col = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
      col *= uTint;
      float edge = smoothstep(0.22, 0.78, length(c));
      col *= 1.0 - edge * uVignette;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(luma), uDesat);
      col += uDamageColor * edge * uDamage * (0.55 + 0.6 * luma);
      col += uFlashColor * uFlash;
      col += (hash(vUv * 913.0 + fract(uTime) * 61.0) - 0.5) * uGrain * (0.25 + luma);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Engine {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.quality = QUALITY[settings.quality] || QUALITY.high;
    this.dynScale = 1;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.enabled = this.quality.shadows;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.06, 500);
    this.camera.rotation.order = 'YXZ';

    // The weapon is drawn in its own scene over a cleared depth buffer so it never clips into walls.
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(50, 1, 0.01, 12);

    this.fx = { damage: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1), desat: 0, fade: 0 };
    this._frameAcc = 0;
    this._frameN = 0;
    this._build();
    window.addEventListener('resize', () => this.resize());
  }

  pixelRatio() {
    const q = this.quality;
    return Math.max(0.5, Math.min(window.devicePixelRatio || 1, q.maxPixelRatio) * q.scale * this.dynScale);
  }

  _build() {
    if (this.composer) {
      this.composer.renderTarget1.dispose();
      this.composer.renderTarget2.dispose();
      this.bloom.dispose();
      this.final.dispose();
      this.output.dispose();
    }
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const target = new THREE.WebGLRenderTarget(Math.max(1, Math.round(w * pr)), Math.max(1, Math.round(h * pr)), {
      type: THREE.HalfFloatType,
      samples: this.quality.msaa,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setSize(w, h);

    const main = new RenderPass(this.scene, this.camera);
    const view = new RenderPass(this.viewScene, this.viewCamera);
    view.clear = false;
    view.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.65, 0.6, 0.9);
    this.final = new ShaderPass(FinalShader);
    this.output = new OutputPass();
    this.composer.addPass(main);
    this.composer.addPass(view);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
    this.composer.addPass(this.output);
    this.resize();
  }

  setQuality(name) {
    this.quality = QUALITY[name] || QUALITY.high;
    this.dynScale = 1;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this._build();
  }

  applyTheme(theme) {
    this.renderer.toneMappingExposure = theme.exposure;
    this.bloom.strength = theme.bloom;
    this.final.uniforms.uTint.value.fromArray(theme.grade);
    this.bloomBase = theme.bloom;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = this.viewCamera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewCamera.updateProjectionMatrix();
    this.renderHeight = h * pr;
  }

  // World-size → pixel-size factor for point sprites.
  pointScale(camera) {
    return this.renderHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
  }

  // Trade resolution for frame rate on slower GPUs.
  _adapt(dt) {
    if (!this.settings.dynRes) return;
    this._frameAcc += dt;
    this._frameN++;
    if (this._frameAcc < 1.5) return;
    const avg = this._frameAcc / this._frameN;
    this._frameAcc = 0;
    this._frameN = 0;
    let next = this.dynScale;
    if (avg > 1 / 42) next = Math.max(0.55, this.dynScale - 0.1);
    else if (avg < 1 / 57) next = Math.min(1, this.dynScale + 0.05);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.resize();
    }
  }

  render(dt, time) {
    const u = this.final.uniforms;
    u.uTime.value = time;
    u.uDamage.value = this.fx.damage;
    u.uFlash.value = this.fx.flash;
    u.uFlashColor.value.copy(this.fx.flashColor);
    u.uDesat.value = this.fx.desat;
    u.uFade.value = this.fx.fade;
    this.composer.render(dt);
    this._adapt(dt);
  }
}
