// In-game overlay: vitals, weapon, crosshair, radar, waypoint, boss bar,
// toasts and the data-log reader. Plain DOM over the canvas.

import * as THREE from 'three';
import { CELL } from '../core/constants.js';
import { T } from '../world/level.js';
import { WEAPON_ORDER } from '../entities/weapons.js';
import { PICKUP_STYLE } from '../entities/pickups.js';
import { el } from '../core/utils.js';

const RADAR_RANGE = 30;
const _v = new THREE.Vector3();

const css = (c) => `rgb(${Math.min(255, c[0] * 120) | 0},${Math.min(255, c[1] * 120) | 0},${Math.min(255, c[2] * 120) | 0})`;

export class HUD {
  constructor(root, game) {
    this.game = game;
    this.root = el('div', 'hud hidden');
    this.root.innerHTML = `
      <div class="lowhealth"></div>
      <div class="obj-panel">
        <div class="obj-chapter"></div>
        <div class="obj-label">OBJECTIVE</div>
        <div class="obj-text"></div>
      </div>
      <div class="radar-wrap"><canvas class="radar" width="176" height="176"></canvas><div class="radar-n">N</div></div>
      <div class="boss">
        <div class="boss-name">THE WARDEN</div>
        <div class="boss-bar"><div class="boss-fill"></div></div>
        <div class="boss-tag"></div>
      </div>
      <div class="crosshair"><i class="ch ch-t"></i><i class="ch ch-b"></i><i class="ch ch-l"></i><i class="ch ch-r"></i><i class="ch-dot"></i></div>
      <div class="hitmarker"><i></i><i></i><i></i><i></i></div>
      <div class="dmg-ring"></div>
      <div class="prompt"></div>
      <div class="marker"><div class="marker-icon"></div><div class="marker-dist"></div></div>
      <div class="vitals">
        <div class="vital shield"><span class="v-icon">◈</span><div class="v-bar"><div class="v-fill"></div></div><span class="v-num">100</span></div>
        <div class="vital health"><span class="v-icon">✚</span><div class="v-bar"><div class="v-fill"></div></div><span class="v-num">100</span></div>
      </div>
      <div class="weapon">
        <div class="w-slots"></div>
        <div class="w-name"></div>
        <div class="w-ammo"><span class="w-mag">12</span><span class="w-sep">/</span><span class="w-res">∞</span></div>
        <div class="w-state"></div>
      </div>
      <div class="toasts"></div>
      <div class="transmission">
        <div class="tx-head"><span class="tx-wave"><i></i><i></i><i></i><i></i></span><span class="tx-name"></span><span class="tx-tag"></span></div>
        <div class="tx-text"></div>
      </div>
      <div class="logpanel">
        <div class="log-kicker">DATA LOG RECOVERED</div>
        <div class="log-title"></div>
        <div class="log-author"></div>
        <div class="log-text"></div>
        <div class="log-foot">Saved to journal</div>
      </div>
      <div class="chapter-card"><div class="cc-chapter"></div><div class="cc-title"></div><div class="cc-sub"></div></div>
    `;
    root.appendChild(this.root);
    const q = (s) => this.root.querySelector(s);
    this.el = {
      objChapter: q('.obj-chapter'), objText: q('.obj-text'), objPanel: q('.obj-panel'),
      radar: q('.radar'), radarN: q('.radar-n'), boss: q('.boss'), bossFill: q('.boss-fill'), bossTag: q('.boss-tag'),
      cross: q('.crosshair'), hit: q('.hitmarker'), ring: q('.dmg-ring'), prompt: q('.prompt'),
      marker: q('.marker'), markerDist: q('.marker-dist'),
      shieldFill: q('.shield .v-fill'), shieldNum: q('.shield .v-num'), shield: q('.vital.shield'),
      healthFill: q('.health .v-fill'), healthNum: q('.health .v-num'), health: q('.vital.health'),
      slots: q('.w-slots'), wName: q('.w-name'), wMag: q('.w-mag'), wRes: q('.w-res'), wState: q('.w-state'), weapon: q('.weapon'),
      toasts: q('.toasts'), low: q('.lowhealth'),
      log: q('.logpanel'), logTitle: q('.log-title'), logAuthor: q('.log-author'), logText: q('.log-text'),
      card: q('.chapter-card'), ccChapter: q('.cc-chapter'), ccTitle: q('.cc-title'), ccSub: q('.cc-sub'),
    };
    this.rctx = this.el.radar.getContext('2d');
    this.cache = {};
    this.frame = 0;
    this.logT = 0;
    this.hitT = 0;
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  reset() {
    this.el.toasts.innerHTML = '';
    this.el.ring.innerHTML = '';
    this.el.log.classList.remove('show');
    this.el.card.classList.remove('show');
    this.el.boss.classList.remove('show');
    this.el.prompt.classList.remove('show');
    this.logT = 0;
    this.cache = {};
  }

  _set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  setObjective(text) {
    this.el.objText.textContent = text;
    this.el.objPanel.classList.remove('flash');
    void this.el.objPanel.offsetWidth; // restart the CSS animation
    this.el.objPanel.classList.add('flash');
  }

  setChapter(text) {
    this.el.objChapter.textContent = text;
  }

  chapterCard(chapter, title, sub) {
    this.el.ccChapter.textContent = chapter;
    this.el.ccTitle.textContent = title;
    this.el.ccSub.textContent = sub;
    this.el.card.classList.remove('show');
    void this.el.card.offsetWidth;
    this.el.card.classList.add('show');
  }

  toast(text, kind = 'info', seconds = 3.4) {
    const t = el('div', 'toast ' + kind);
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), seconds * 1000);
    setTimeout(() => t.remove(), seconds * 1000 + 500);
  }

  hitMarker(crit, kill) {
    const h = this.el.hit;
    h.className = 'hitmarker' + (kill ? ' kill' : crit ? ' crit' : '');
    void h.offsetWidth;
    h.classList.add('show');
  }

  // angle: radians clockwise from straight ahead.
  damageFrom(angle) {
    const a = el('div', 'dmg-arc');
    a.style.transform = `rotate(${angle}rad)`;
    this.el.ring.appendChild(a);
    setTimeout(() => a.remove(), 900);
  }

  showLog(log) {
    this.el.logTitle.textContent = log.title;
    this.el.logAuthor.textContent = log.author;
    this.el.logText.textContent = log.text;
    this.el.log.classList.add('show');
    this.logT = 9 + log.text.length * 0.035;
  }

  update(dt) {
    const g = this.game, p = g.player, w = g.weapons, e = this.el;
    this.frame++;

    const hp = Math.ceil(p.health), sh = Math.ceil(p.shield);
    this._set('hp', hp, (v) => {
      e.healthNum.textContent = v;
      e.healthFill.style.transform = `scaleX(${v / p.maxHealth})`;
      e.health.classList.toggle('critical', v < 30);
    });
    this._set('sh', sh, (v) => {
      e.shieldNum.textContent = v;
      e.shieldFill.style.transform = `scaleX(${v / p.maxShield})`;
      e.shield.classList.toggle('broken', v <= 0);
    });
    this._set('low', p.health < 30 && p.alive, (v) => e.low.classList.toggle('show', v));

    const d = w.def, a = w.ammo[w.current];
    this._set('wname', w.current, () => {
      e.wName.innerHTML = `${d.name}<span>${d.kind}</span>`;
    });
    this._set('mag', a.mag, (v) => {
      e.wMag.textContent = v;
      e.wMag.classList.toggle('empty', v === 0);
      e.wMag.classList.toggle('lowmag', v > 0 && v <= d.mag * 0.25);
    });
    this._set('res', a.reserve, (v) => { e.wRes.textContent = v === Infinity ? '∞' : v; });
    this._set('wstate', w.state === 'reloading' ? 'RELOADING' : a.mag === 0 && a.reserve === 0 ? 'NO AMMO' : '', (v) => {
      e.wState.textContent = v;
    });
    this._set('slots', WEAPON_ORDER.map((id) => (w.owned[id] ? (id === w.current ? 2 : 1) : 0)).join(''), (v) => {
      e.slots.innerHTML = WEAPON_ORDER.map((id, i) => `<span class="slot s${v[i]}">${i + 1}</span>`).join('');
    });

    // Crosshair opens with spread and tucks away while aiming down sights.
    const gap = 5 + w.currentSpread() * 420;
    e.cross.style.setProperty('--gap', gap.toFixed(1) + 'px');
    this._set('ads', w.adsT > 0.6 && w.current !== 'shotgun', (v) => e.cross.classList.toggle('ads', v));

    const pr = g.mission ? g.mission.promptFor(p.interact) : null;
    this._set('prompt', pr ? pr.text + pr.locked : '', () => {
      e.prompt.classList.toggle('show', !!pr);
      if (pr) {
        e.prompt.classList.toggle('locked', pr.locked);
        e.prompt.innerHTML = pr.locked
          ? `<b>LOCKED</b>${pr.text}`
          : `<b>E</b>${pr.text}<span>${pr.label || ''}</span>`;
      }
    });

    const boss = g.enemies.boss;
    const bossOn = !!boss && boss.alive && boss.spawnT <= 0;
    this._set('boss', bossOn, (v) => e.boss.classList.toggle('show', v));
    if (bossOn) {
      this._set('bosshp', Math.round((boss.hp / boss.maxHp) * 500), (v) => { e.bossFill.style.transform = `scaleX(${v / 500})`; });
      this._set('bosstag', boss.shielded ? 'SHIELDED · DESTROY THE PYLONS' : boss.enraged ? 'CORE EXPOSED · ENRAGED' : 'CORE EXPOSED', (v) => {
        e.bossTag.textContent = v;
        e.boss.classList.toggle('shielded', boss.shielded);
      });
    }

    if (this.logT > 0) {
      this.logT -= dt;
      if (this.logT <= 0) e.log.classList.remove('show');
    }

    this._marker();
    if (this.frame % 2 === 0) this._radar();
  }

  _marker() {
    const g = this.game, e = this.el;
    const target = g.mission ? g.mission.targetPos(_v) : null;
    if (!target) {
      this._set('marker', false, () => e.marker.classList.remove('show'));
      return;
    }
    this._set('marker', true, () => e.marker.classList.add('show'));
    const dist = Math.hypot(target.x - g.player.pos.x, target.z - g.player.pos.z);
    const cam = g.engine.camera;
    _v.project(cam);
    const behind = _v.z > 1;
    let x = _v.x, y = _v.y;
    if (behind) { x = -x; y = -y; }
    const m = 0.86;
    const off = behind || Math.abs(x) > m || Math.abs(y) > m;
    if (off) {
      // Pin to the screen edge in the direction of the target.
      const k = m / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      x *= k; y *= k;
      if (behind && Math.abs(y) < m * 0.99) y = -m;
    }
    e.marker.style.transform = `translate(${((x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px, ${((-y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px)`;
    this._set('markerOff', off, (v) => e.marker.classList.toggle('edge', v));
    this._set('markerDist', Math.round(dist), (v) => { e.markerDist.textContent = v + ' m'; });
  }

  _radar() {
    const g = this.game, level = g.level, p = g.player, c = this.rctx;
    if (!level) return;
    const S = 176, half = S / 2, k = half / RADAR_RANGE;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(half, half, half - 2, 0, 6.2832);
    c.clip();
    c.fillStyle = 'rgba(6, 14, 22, 0.55)';
    c.fillRect(0, 0, S, S);
    c.translate(half, half);
    c.rotate(p.yaw);
    c.scale(k, k);
    c.translate(-p.pos.x, -p.pos.z);

    const cx0 = Math.floor((p.pos.x - RADAR_RANGE) / CELL), cx1 = Math.floor((p.pos.x + RADAR_RANGE) / CELL);
    const cz0 = Math.floor((p.pos.z - RADAR_RANGE) / CELL), cz1 = Math.floor((p.pos.z + RADAR_RANGE) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const t = level.typeAt(cx, cz);
        if (t === T.VOID || t === T.WALL) continue;
        if (t === T.WINDOW) c.fillStyle = 'rgba(120, 210, 255, 0.35)';
        else if (t === T.DOOR) c.fillStyle = level.doorByCell.get(cz * level.w + cx).locked ? 'rgba(255, 90, 60, 0.7)' : 'rgba(120, 255, 210, 0.55)';
        else c.fillStyle = 'rgba(140, 190, 215, 0.2)';
        c.fillRect(cx * CELL, cz * CELL, CELL + 0.06, CELL + 0.06);
      }
    }

    const dot = (x, z, r, style) => {
      c.fillStyle = style;
      c.beginPath();
      c.arc(x, z, r / k, 0, 6.2832);
      c.fill();
    };
    for (const pk of g.pickups.list) dot(pk.x, pk.z, 2, css(PICKUP_STYLE[pk.kind].color));
    for (const en of g.enemies.list) {
      if (!en.alive || en.spawnT > 0) continue;
      dot(en.pos.x, en.pos.z, en.type === 'warden' ? 6 : en.type === 'juggernaut' ? 4.5 : 3, en.type === 'pylon' ? '#59d8ff' : '#ff5a3c');
    }
    const target = g.mission ? g.mission.targetPos(_v) : null;
    if (target) {
      // Keep the waypoint on the rim when it is out of range.
      let dx = target.x - p.pos.x, dz = target.z - p.pos.z;
      const d = Math.hypot(dx, dz), max = RADAR_RANGE - 3;
      if (d > max) { dx *= max / d; dz *= max / d; }
      c.fillStyle = '#ffd866';
      c.save();
      c.translate(p.pos.x + dx, p.pos.z + dz);
      c.rotate(Math.PI / 4);
      c.fillRect(-3.5 / k, -3.5 / k, 7 / k, 7 / k);
      c.restore();
    }
    c.restore();

    // Player arrow and bezel.
    c.fillStyle = '#eaf6ff';
    c.beginPath();
    c.moveTo(half, half - 7);
    c.lineTo(half + 5, half + 5);
    c.lineTo(half, half + 2);
    c.lineTo(half - 5, half + 5);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(140, 220, 255, 0.5)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(half, half, half - 2, 0, 6.2832);
    c.stroke();
    c.strokeStyle = 'rgba(140, 220, 255, 0.14)';
    c.beginPath();
    c.arc(half, half, half * 0.5, 0, 6.2832);
    c.stroke();
    const n = this.el.radarN;
    const r = half - 9;
    n.style.transform = `translate(${(Math.sin(p.yaw) * r).toFixed(1)}px, ${(-Math.cos(p.yaw) * r).toFixed(1)}px)`;
  }
}
