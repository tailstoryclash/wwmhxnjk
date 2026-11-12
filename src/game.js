// The Game: owns every system, runs the frame loop and moves between the
// title screen, briefings, play, pause, death, chapter summaries and endings.

import * as THREE from 'three';
import { DIFFICULTY } from './core/constants.js';
import { clamp, damp } from './core/utils.js';
import { Save } from './core/save.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { Engine } from './core/engine.js';
import { Sky } from './gfx/sky.js';
import { Effects } from './gfx/effects.js';
import { getTextures } from './gfx/textures.js';
import { createEnvironment } from './gfx/materials.js';
import { Level } from './world/level.js';
import { LevelView } from './world/builder.js';
import { Mission } from './world/mission.js';
import { THEMES } from './world/themes.js';
import { LEVELS } from './world/levels/index.js';
import { LOGS, TOTAL_LOGS } from './world/story.js';
import { Player } from './entities/player.js';
import { WeaponSystem, WEAPONS } from './entities/weapons.js';
import { EnemyManager } from './entities/enemies.js';
import { Projectiles } from './entities/projectiles.js';
import { Pickups } from './entities/pickups.js';
import { HUD } from './ui/hud.js';
import { Dialogue } from './ui/dialogue.js';
import { Menus } from './ui/menus.js';

const freshStats = () => ({ shots: 0, hits: 0, kills: 0, damage: 0, damageTaken: 0, time: 0, deaths: 0 });

const NO_WEBGL =
  'This game needs WebGL 2, which this browser or device did not provide. Try a current desktop version of Chrome, Edge or Firefox with hardware acceleration enabled.';

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.save = new Save();
    this.state = 'boot';
    this.time = 0; // simulated seconds (stops while paused)
    this.clock = 0; // wall-clock seconds since boot
    this.stats = freshStats();
    this.difficulty = DIFFICULTY[this.save.settings.difficulty] || DIFFICULTY.normal;
    this.levelIndex = -1;
    this.level = null;
    this.view = null;
    this.mission = null;
    this.theme = null;
    this.env = null;
    this.checkpoint = null;
    this.pendingBegin = false;
    this.timers = [];
    this.navT = 0;
    this.lockFails = 0;
    this.deathT = 0;
    this.pausedAt = 0;
    this._actors = [];
    this._light = [1, 1, 1];
    this._errorAt = 0;
    this._look = new THREE.Object3D();

    this.audio = new AudioEngine(this.save.settings);
    this.hud = new HUD(uiRoot, this);
    this.dialogue = new Dialogue(this, this.hud);
    this.menus = new Menus(uiRoot, this);
    this._doorSound = (door, opening) => this.audio.play(opening ? 'door' : 'doorClose', { pos: door, volume: 0.8 });
  }

  async boot() {
    this.menus.show('loading');
    try {
      this.engine = new Engine(this.canvas, this.save.settings);
    } catch (err) {
      console.error(err);
      this.menus.show('error', { message: NO_WEBGL });
      return;
    }
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.input.freeLook) this.pause();
    };
    this.sky = new Sky();
    this.engine.scene.add(this.sky.mesh);
    this.fx = new Effects(this.engine, this.engine.quality);
    this.fx.shakeEnabled = this.save.settings.shake;
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.enemies = new EnemyManager(this);
    this.projectiles = new Projectiles(this);
    this.pickups = new Pickups(this);

    window.addEventListener('keydown', (e) => this._onKey(e));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    // Door signs are drawn on canvases, so the display font must be ready first.
    const fonts = document.fonts
      ? Promise.all([document.fonts.load('700 48px Orbitron'), document.fonts.load('600 20px Rajdhani')]).catch(() => {})
      : Promise.resolve();
    await Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]);
    await new Promise((r) => setTimeout(r, 30)); // let the loading screen paint

    getTextures();
    this.loadLevel(0);
    this.state = 'title';
    this.menus.show('title');
    this.last = performance.now();
    requestAnimationFrame(this._frame);
  }

  // ---------------------------------------------------------------- levels

  // Build the world for a chapter (static geometry, lighting, sky, mood).
  loadLevel(index) {
    const { engine } = this;
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.dialogue.clear();
    if (this.view) this.view.dispose();
    if (this.env) this.env.dispose();

    const def = LEVELS[index];
    this.levelIndex = index;
    this.theme = THEMES[def.theme];
    this.level = new Level(def);
    this.view = new LevelView(this.level, this.theme, engine);
    engine.scene.add(this.view.group);
    engine.scene.fog = new THREE.FogExp2(this.theme.fog, this.theme.fogDensity);
    this.env = createEnvironment(engine.renderer, this.theme);
    engine.scene.environment = this.env.texture;
    engine.scene.environmentIntensity = 0.6;
    engine.viewScene.environment = this.env.texture;
    engine.viewScene.environmentIntensity = 0.9;
    this.sky.applyTheme(this.theme);
    engine.applyTheme(this.theme);
    this.fx.setTheme(this.theme);
    this.mission = null;
    this.level.updateFlow(this.level.start.x, this.level.start.z);
  }

  _resetLevelState() {
    for (const d of this.level.doors) {
      d.open = 0;
      d.want = 0;
      d.slab.solid = true;
      this.level.setDoorLocked(d, !!d.id);
    }
    this.view.resetDynamic();
    this.view.setAlarm(false);
  }

  // Reset everything that changes during play, then start fresh or from a checkpoint.
  prepareRun(cp) {
    const { level, engine } = this;
    const def = level.def;
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.dialogue.clear();
    this.hud.reset();
    this.timers.length = 0;
    this._resetLevelState();
    this.mission = new Mission(this, level, this.view, def);
    engine.fx.damage = engine.fx.flash = engine.fx.desat = engine.fx.fade = 0;
    this.time = 0;

    const deaths = this.stats.deaths;
    if (cp && !cp.fresh) {
      this.mission.restore(cp.mission);
      this.player.reset(cp.player.x, cp.player.z, cp.player.yaw);
      this.player.health = cp.player.health;
      this.player.shield = cp.player.shield;
      this.weapons.restore(cp.weapons);
      this.stats = { ...freshStats(), ...cp.stats, deaths: Math.max(deaths, cp.stats.deaths || 0) };
      this.pickups.spawnLevel(this.mission.collected);
      this.pendingBegin = false;
    } else {
      if (cp) this.weapons.restore(cp.weapons);
      this.player.reset(level.start.x, level.start.z, def.startYaw);
      this.stats = freshStats();
      this.pickups.spawnLevel(new Set());
      this.view.setPower(true, true);
      this.pendingBegin = true;
    }
    this.hud.setChapter(`${def.chapter} · ${def.title}`);
    this.audio.setIntensity(0);
    this.level.updateFlow(this.player.pos.x, this.player.pos.z);
    this.player.syncCamera();
  }

  startLevel(index, cp = null) {
    this.state = 'loading';
    if (this.input) this.input.enabled = false;
    this.hud.show(false);
    this.menus.show('loading');
    this.audio.init();
    // Yield a frame so the loading screen is visible while geometry is built.
    setTimeout(() => {
      if (this.levelIndex !== index) this.loadLevel(index);
      this.prepareRun(cp);
      const def = LEVELS[index];
      this.state = 'ready';
      this.menus.show('deploy', { chapter: def.chapter, title: def.title, subtitle: def.subtitle, resume: !!cp && !cp.fresh });
    }, 80);
  }

  // ---------------------------------------------------------------- flow

  newGame(difficultyId) {
    this.audio.init();
    if (DIFFICULTY[difficultyId]) {
      this.save.settings.difficulty = difficultyId;
      this.difficulty = DIFFICULTY[difficultyId];
    }
    this.weapons.reset();
    this.checkpoint = null;
    this.save.setCheckpoint(null);
    this.stats = freshStats();
    this.state = 'intro';
    this.audio.startMusic(THEMES.dock.music);
    this.menus.show('intro');
  }

  continueGame() {
    const cp = this.save.data.checkpoint;
    if (!cp || !LEVELS[cp.level]) return;
    this.weapons.reset();
    this.checkpoint = cp;
    this.stats = freshStats();
    this.startLevel(cp.level, cp);
  }

  // Chapter select: later chapters begin with the weapons the story would have given.
  startChapter(index) {
    const owned = ['pistol'];
    if (index >= 1) owned.push('rifle');
    if (index >= 2) owned.push('shotgun');
    const ammo = {};
    for (const id of owned) ammo[id] = [WEAPONS[id].mag, WEAPONS[id].reserve === Infinity ? -1 : WEAPONS[id].reserve];
    this.weapons.reset();
    this.weapons.restore({ owned, ammo, current: owned[Math.min(1, owned.length - 1)] });
    this.checkpoint = null;
    this.stats = freshStats();
    this.startLevel(index, null);
  }

  // The click on the briefing card: this is the user gesture that captures the mouse.
  deploy() {
    if (this.state !== 'ready') return;
    this._enterPlay();
  }

  _enterPlay() {
    const def = this.level.def;
    this.audio.init();
    this.audio.resume();
    this.menus.hide();
    this.hud.show(true);
    this.state = 'playing';
    this.input.releaseAll();
    this.input.enabled = true;
    this.audio.startMusic(this.theme.music);
    if (this.pendingBegin) {
      this.pendingBegin = false;
      // A "fresh" checkpoint replays the chapter opening on retry or continue.
      this.checkpoint = { level: this.levelIndex, fresh: true, weapons: this.weapons.serialize(), stats: freshStats() };
      this.save.setCheckpoint(this.checkpoint);
      this.hud.chapterCard(def.chapter, def.title, def.subtitle);
      this.mission.begin();
    }
    this._lock();
  }

  async _lock() {
    if (this.input.freeLook) return;
    const ok = await this.input.requestLock();
    if (ok) {
      this.lockFails = 0;
      return;
    }
    if (this.state !== 'playing') return;
    this.lockFails++;
    if (this.lockFails >= 2) {
      // Embedded frames often forbid pointer lock; fall back rather than block play.
      this.input.freeLook = true;
      this.hud.toast('Mouse capture is unavailable here — free look enabled. Open the game in its own tab for the best experience.', 'warn', 9);
    } else {
      this.pause('Your browser did not capture the mouse. Choose Resume to try again.');
    }
  }

  pause(note) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.audio.suspend();
    this.menus.show('pause', { note });
  }

  resume() {
    if (this.state !== 'paused' && this.state !== 'choice') return;
    this.menus.hide();
    this.state = 'playing';
    this.input.releaseAll();
    this.input.enabled = true;
    this.audio.resume();
    this._lock();
  }

  retry() {
    const cp = this.checkpoint && this.checkpoint.level === this.levelIndex ? this.checkpoint : null;
    this.audio.resume();
    this.prepareRun(cp);
    this._enterPlay();
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.stats.deaths++;
    this.deathT = 0;
    this.input.enabled = false;
    this.input.releaseAll();
    this.dialogue.clear();
    this.audio.setIntensity(0);
  }

  completeLevel() {
    const def = this.level.def, i = this.levelIndex;
    const next = LEVELS[i + 1];
    this.state = 'complete';
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.audio.setIntensity(0);
    this.audio.play('checkpoint');
    this.dialogue.clear();
    this.hud.show(false);
    this.save.unlock(i + 2);
    if (next) {
      this.checkpoint = { level: i + 1, fresh: true, weapons: this.weapons.serialize(), stats: freshStats() };
      this.save.setCheckpoint(this.checkpoint);
    }
    this.menus.show('complete', {
      chapter: def.chapter,
      title: def.title,
      stats: { ...this.stats },
      logs: def.logs.filter((id) => this.save.data.logs.includes(id)).length,
      logTotal: def.logs.length,
      next: next ? next.title : 'Title',
    });
  }

  nextLevel() {
    const i = this.levelIndex + 1;
    if (!LEVELS[i]) return this.quitToTitle();
    this.startLevel(i, this.checkpoint && this.checkpoint.level === i ? this.checkpoint : null);
  }

  openChoice() {
    this.state = 'choice';
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.menus.show('choice');
  }

  chooseEnding(id) {
    const s = this.save.data;
    if (!s.endings.includes(id)) s.endings.push(id);
    this.checkpoint = null;
    this.save.setCheckpoint(null);
    this.state = 'ending';
    this.hud.show(false);
    this.dialogue.clear();
    this.audio.setIntensity(0);
    this.audio.play('ending');
    this.engine.fx.flashColor.setRGB(1, 0.92, 0.8);
    this.engine.fx.flash = id === 'wake' ? 0.4 : 1.4;
    this.menus.show('ending', { id, stats: { ...this.stats } });
  }

  quitToTitle() {
    const efx = this.engine.fx;
    this.audio.resume();
    this.audio.stopMusic();
    this.audio.setIntensity(0);
    this.input.enabled = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.hud.show(false);
    this.dialogue.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    efx.damage = efx.flash = efx.desat = efx.fade = 0;
    this.mission = null;
    this.state = 'title';
    if (this.levelIndex !== 0) {
      // The title always plays over the hangar.
      this.menus.show('loading');
      setTimeout(() => {
        this.loadLevel(0);
        this.menus.show('title');
      }, 60);
    } else {
      this._resetLevelState();
      this.view.setPower(true, true);
      this.menus.show('title');
    }
  }

  saveCheckpoint(silent = false) {
    const p = this.player;
    this.checkpoint = {
      level: this.levelIndex,
      // Never strand a restored run on a sliver of health.
      player: { x: p.pos.x, z: p.pos.z, yaw: p.yaw, health: Math.max(p.health, 40), shield: p.shield },
      weapons: this.weapons.serialize(),
      mission: this.mission.snapshot(),
      stats: { ...this.stats },
    };
    this.save.setCheckpoint(this.checkpoint);
    if (!silent) {
      this.hud.toast('Checkpoint reached', 'info');
      this.audio.play('checkpoint');
    }
  }

  // ---------------------------------------------------------------- combat helpers

  explode(x, y, z, radius, damage, opts = {}) {
    const p = this.player;
    this.fx.explosion(x, y, z, radius, opts.color);
    this.audio.play('explosion', { pos: { x, z } });
    const d = Math.hypot(p.pos.x - x, p.pos.y + 0.9 - y, p.pos.z - z);
    const reach = radius + 0.4;
    if (p.alive && d < reach && this.level.lineOfSight(x, Math.max(0.3, y), z, p.pos.x, p.pos.y + 1, p.pos.z)) {
      p.takeDamage(damage * clamp(1 - d / reach, 0.15, 1) * (opts.playerScale ?? 1), { x, z });
    }
    this.enemies.damageRadius(x, y, z, radius, damage * (opts.enemyScale ?? 1));
    // Fuel cells caught in the blast go up a moment later.
    for (const b of this.view.barrels) {
      if (b.alive && Math.hypot(b.x - x, b.z - z) < radius * 0.9) {
        this.timers.push({ t: 0.12 + Math.random() * 0.1, fn: () => this.damageBarrel(b) });
      }
    }
  }

  damageBarrel(barrel) {
    if (!barrel.alive) return;
    this.view.removeBarrel(barrel);
    this.explode(barrel.x, 0.7, barrel.z, 6, 70, { enemyScale: 1.6, playerScale: 0.6 });
  }

  onEnemyKilled(e) {
    if (e.type === 'pylon') return;
    this.stats.kills++;
    if (e.type === 'warden') return;
    const p = this.player;
    if (e.type === 'juggernaut') {
      this.pickups.drop('healthOrb', e.pos.x + 0.6, e.pos.z);
      this.pickups.drop('ammoOrb', e.pos.x - 0.6, e.pos.z);
      return;
    }
    const r = Math.random();
    if (r < 0.24 && p.health < 70) this.pickups.drop('healthOrb', e.pos.x, e.pos.z);
    else if (r < 0.52 && this.weapons.needsAmmo()) this.pickups.drop('ammoOrb', e.pos.x, e.pos.z);
  }

  collectLog(id) {
    const log = LOGS[id];
    if (!log) return;
    this.save.addLog(id);
    this.audio.play('log');
    this.hud.showLog(log);
    this.hud.toast(`Data log recovered · ${this.save.data.logs.length} / ${TOTAL_LOGS}`, 'good');
  }

  applySettings(key) {
    const s = this.save.settings;
    if (key === 'master' || key === 'music' || key === 'sfx') this.audio.applyVolumes();
    else if (key === 'difficulty') this.difficulty = DIFFICULTY[s.difficulty] || DIFFICULTY.normal;
    else if (key === 'shake') this.fx.shakeEnabled = s.shake;
    else if (key === 'quality') {
      this.engine.setQuality(s.quality);
      this.engine.applyTheme(this.theme);
      this.view.applyQuality(this.engine.quality);
      this.fx.density = this.engine.quality.particles;
    } else if (key === 'dynRes' && !s.dynRes) {
      this.engine.dynScale = 1;
      this.engine.resize();
    }
  }

  _onKey(e) {
    if (this.state !== 'playing') return;
    if (e.code === 'KeyP' || (e.code === 'Escape' && !this.input.locked)) {
      e.preventDefault();
      this.pause();
    } else if (e.code === 'KeyJ') {
      e.preventDefault();
      this.pause();
      this.menus.open('journal');
    }
  }

  // ---------------------------------------------------------------- frame loop

  _frame = (now) => {
    requestAnimationFrame(this._frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      this.update(dt);
    } catch (err) {
      // Keep rendering, but do not flood the console with the same failure.
      if (now - this._errorAt > 2000) {
        this._errorAt = now;
        console.error(err);
      }
    }
    this.engine.render(dt, this.clock);
    this.input.endFrame();
  };

  update(dt) {
    this.clock += dt;
    const efx = this.engine.fx;
    const s = this.state;
    this.weapons.root.visible = s === 'playing' || s === 'paused' || s === 'dead';

    if (s === 'playing') {
      this._simulate(dt, true);
    } else if (s === 'dead') {
      this._simulate(dt, false);
      this.deathT += dt;
      efx.desat = damp(efx.desat, 0.9, 2, dt);
      efx.fade = damp(efx.fade, 0.4, 1.2, dt);
      if (this.deathT > 1.5 && this.menus.current !== 'dead') {
        this.input.exitLock();
        this.hud.show(false);
        this.menus.show('dead');
      }
    } else if (s === 'paused' || s === 'loading') {
      // Hold the frame.
    } else if (s === 'ready' || s === 'choice' || s === 'complete') {
      this._ambient(dt, this.player.pos);
    } else if (s === 'ending') {
      // Tilt up to the star while the ending plays.
      const cam = this.engine.camera;
      this._look.position.copy(cam.position);
      this._look.lookAt(cam.position.x - this.view.sunDir.x, cam.position.y - this.view.sunDir.y, cam.position.z - this.view.sunDir.z);
      cam.quaternion.slerp(this._look.quaternion, 1 - Math.exp(-0.5 * dt));
      efx.flash = damp(efx.flash, 0, 0.8, dt);
      this._ambient(dt, this.player.pos);
    } else {
      this._attract(dt);
    }
  }

  _simulate(dt, control) {
    const { level, player, weapons, enemies, view, engine } = this;
    const efx = engine.fx;
    this.time += dt;
    if (control) this.stats.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }

    this.navT -= dt;
    if (this.navT <= 0) {
      this.navT = 0.25;
      level.updateFlow(player.pos.x, player.pos.z);
    }

    player.update(dt);
    weapons.update(dt, control);

    const actors = this._actors;
    actors.length = 0;
    actors.push(player.pos);
    for (const e of enemies.list) if (e.alive && e.spawnT <= 0 && !e.static) actors.push(e.pos);
    level.updateDoors(dt, actors, this._doorSound);

    enemies.update(dt);
    this.projectiles.update(dt);
    this.pickups.update(dt);
    if (control) this.mission.update(dt);
    // A script may have ended the level or opened a menu during this step.
    if (this.state !== 'playing' && this.state !== 'dead') return;

    this._ambient(dt, player.pos);
    this.audio.setListener(player.pos.x, player.pos.z, player.yaw);

    // Light the weapon by the room the player is standing in.
    const a = level.sampleLight(player.pos.x, player.pos.z, this._light);
    const k = 0.16 + 0.84 * view.power;
    a[0] *= k; a[1] *= k; a[2] *= k;
    weapons.setAmbient(a);

    efx.damage = damp(efx.damage, 0, 2.6, dt);
    efx.flash = damp(efx.flash, 0, 5, dt);

    const engaged = enemies.engaged();
    view.setAlarm(engaged > 0);
    this.audio.setIntensity(engaged > 0 && player.alive ? Math.min(1, 0.5 + engaged * 0.1) : 0);

    this.hud.update(dt);
    this.dialogue.update(dt);
  }

  _ambient(dt, focus) {
    const cam = this.engine.camera;
    this.fx.update(dt, cam);
    this.view.update(dt, this.clock, focus);
    this.sky.update(dt, cam);
  }

  // Slow orbit of the hangar behind the title and intro screens.
  _attract(dt) {
    const cam = this.engine.camera;
    const a = this.clock * 0.05 + 2.3;
    cam.position.set(20 + Math.cos(a) * 12, 3.3 + Math.sin(this.clock * 0.21) * 0.5, 20 + Math.sin(a) * 12);
    cam.lookAt(15, 2.1, 18);
    if (cam.fov !== 60) {
      cam.fov = 60;
      cam.updateProjectionMatrix();
    }
    this._ambient(dt, cam.position);
  }
}
