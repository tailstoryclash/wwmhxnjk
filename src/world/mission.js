// Runs a level's script: encounters per zone, terminals, objectives, the exit
// and the checkpoint state that lets a run be resumed.

export class Mission {
  constructor(game, level, view, def) {
    this.game = game;
    this.level = level;
    this.view = view;
    this.def = def;
    this.vars = {};
    this.entered = new Set();
    this.cleared = new Set();
    this.active = new Set(); // zones with a live encounter
    this.used = new Set(); // terminals already operated
    this.enabled = new Set(); // terminals that accept input
    this.collected = new Set(); // pickup ids taken
    this.fired = new Set(); // one-shot script events that have run
    this.manual = new Set(def.manualZones || []);
    this.timers = [];
    this.objective = { text: '', target: null };
    this.exitActive = !def.exitLocked;
    this.power = true;
    this.done = false;
    this.wantCheckpoint = false;
    for (const t of level.terminals) {
      if (def.terminals?.[t.id]?.enabled !== false) this.enabled.add(t.id);
    }

    const m = this, g = game;
    // The API handed to level event scripts.
    this.ctx = {
      get vars() { return m.vars; },
      say: (who, text) => g.dialogue.say(who, text),
      objective: (text, target = null) => m.setObjective(text, target),
      hint: (text) => g.hud.toast(text, 'hint', 8),
      toast: (text) => g.hud.toast(text),
      unlock: (id) => m.setDoor(id, false),
      lock: (id) => m.setDoor(id, true),
      spawn: (zone) => m.startEncounter(zone),
      checkpoint: () => { m.wantCheckpoint = true; },
      setPower: (on) => m.setPower(on),
      enableExit: () => { m.exitActive = true; m.view.setExitActive(true); },
      enableTerminal: (id) => { m.enabled.add(id); m.refreshTerminals(); },
      after: (sec, fn) => m.timers.push({ t: sec, fn }),
      choice: () => g.openChoice(),
    };
  }

  // Fresh start of the level.
  begin() {
    this.refreshTerminals();
    this.view.setExitActive(this.exitActive);
    this.view.setPower(true, true);
    this.emit('start');
  }

  emit(name, arg) {
    const fn = this.def.events?.[name];
    if (!fn) return;
    if (name !== 'boss:pylon') {
      if (this.fired.has(name)) return;
      this.fired.add(name);
    }
    fn(this.ctx, arg);
  }

  setObjective(text, target = null, quiet = false) {
    this.objective = { text, target };
    this.game.hud.setObjective(text);
    if (!quiet) this.game.audio.play('objective');
  }

  setDoor(id, locked) {
    const d = this.level.doorById.get(id);
    if (d) this.level.setDoorLocked(d, locked);
  }

  setPower(on) {
    if (on && !this.power) this.game.audio.play('power');
    this.power = on;
    this.view.setPower(on);
  }

  startEncounter(zone) {
    if (this.active.has(zone) || this.cleared.has(zone)) return;
    if (this.game.enemies.spawnZone(zone) > 0) {
      this.active.add(zone);
      this.game.audio.play('alarm', { volume: 0.7 });
    }
  }

  refreshTerminals() {
    for (const t of this.level.terminals) {
      this.view.setTerminal(t.id, this.used.has(t.id) ? 'used' : this.enabled.has(t.id) ? 'ready' : 'locked');
    }
  }

  promptFor(t) {
    if (!t || this.used.has(t.id)) return null;
    const cfg = this.def.terminals?.[t.id] || {};
    if (!this.enabled.has(t.id)) return { text: cfg.lockedText || 'Terminal locked', locked: true, label: cfg.label };
    return { text: cfg.prompt || 'Use terminal', locked: false, label: cfg.label };
  }

  useTerminal(t) {
    const g = this.game;
    const cfg = this.def.terminals?.[t.id] || {};
    if (this.used.has(t.id)) return;
    if (!this.enabled.has(t.id)) {
      g.audio.play('denied');
      g.hud.toast(cfg.lockedText || 'Terminal locked', 'warn');
      return;
    }
    g.audio.play('terminal');
    if (cfg.repeat) {
      this.fired.delete('use:' + t.id);
    } else {
      this.used.add(t.id);
      this.refreshTerminals();
    }
    this.emit('use:' + t.id);
  }

  collect(p) {
    if (p.id) this.collected.add(p.id);
  }

  // World position the HUD waypoint should point at, or null.
  targetPos(out) {
    const t = this.objective.target;
    const L = this.level, p = this.game.player.pos;
    if (!t) return null;
    if (t === 'exit') {
      if (!L.exit) return null;
      return out.set(L.exit.x, 1.5, L.exit.z);
    }
    if (t === 'terminals') {
      let best = null, bd = Infinity;
      for (const term of L.terminals) {
        if (this.used.has(term.id) || !this.enabled.has(term.id)) continue;
        const d = (term.x - p.x) ** 2 + (term.z - p.z) ** 2;
        if (d < bd) { bd = d; best = term; }
      }
      return best ? out.set(best.x, 1.8, best.z) : null;
    }
    if (t.startsWith('zone:')) {
      const z = +t.slice(5);
      if (this.entered.has(z)) return null;
      const c = L.zoneCentre(z);
      return c ? out.set(c.x, 1.5, c.z) : null;
    }
    const term = L.terminals.find((q) => q.id === t);
    return term ? out.set(term.x, 1.8, term.z) : null;
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }

    const z = this.level.zoneAt(p.pos.x, p.pos.z);
    if (z && !this.entered.has(z)) {
      this.entered.add(z);
      if (!this.manual.has(z)) this.startEncounter(z);
      this.emit('enter:' + z);
    }

    for (const zone of this.active) {
      if (g.enemies.remaining(zone) > 0) continue;
      this.active.delete(zone);
      this.cleared.add(zone);
      this.emit('clear:' + zone);
    }

    if (this.exitActive && !this.done && this.level.exit) {
      const e = this.level.exit;
      if (Math.hypot(e.x - p.pos.x, e.z - p.pos.z) < 1.5 && p.alive) {
        this.done = true;
        g.completeLevel();
      }
    }

    if (this.wantCheckpoint && p.alive) {
      this.wantCheckpoint = false;
      g.saveCheckpoint();
    }
  }

  snapshot() {
    const hasEnemies = (z) => this.level.spawns.some((s) => s.zone === z);
    return {
      vars: JSON.parse(JSON.stringify(this.vars)),
      // Unfinished fights restart when the zone is re-entered.
      entered: [...this.entered].filter((z) => this.cleared.has(z) || !hasEnemies(z)),
      cleared: [...this.cleared],
      used: [...this.used],
      enabled: [...this.enabled],
      collected: [...this.collected],
      fired: [...this.fired],
      doors: this.level.doors.filter((d) => d.id).map((d) => [d.id, d.locked]),
      objective: { ...this.objective },
      exitActive: this.exitActive,
      power: this.power,
    };
  }

  restore(s) {
    this.vars = JSON.parse(JSON.stringify(s.vars));
    this.entered = new Set(s.entered);
    this.cleared = new Set(s.cleared);
    this.used = new Set(s.used);
    this.enabled = new Set(s.enabled);
    this.collected = new Set(s.collected);
    // Events tied to fights that will be replayed must be allowed to fire again.
    this.fired = new Set(s.fired.filter((name) => {
      if (name.startsWith('boss:')) return false;
      const m = /^(enter|clear):(\d+)$/.exec(name);
      if (!m) return true;
      return m[1] === 'enter' ? this.entered.has(+m[2]) : this.cleared.has(+m[2]);
    }));
    for (const [id, locked] of s.doors) this.setDoor(id, locked);
    this.exitActive = s.exitActive;
    this.power = s.power;
    this.view.setExitActive(this.exitActive);
    this.view.setPower(this.power, true);
    this.refreshTerminals();
    this.setObjective(s.objective.text, s.objective.target, true);
  }
}
