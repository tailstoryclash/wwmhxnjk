const KEY = 'hollow-sun:v1';

const defaults = () => ({
  settings: {
    sensitivity: 1,
    fov: 80,
    quality: 'high',
    dynRes: true,
    master: 0.8,
    music: 0.6,
    sfx: 0.9,
    invertY: false,
    shake: true,
    difficulty: 'normal',
  },
  unlocked: 1, // highest chapter available from the title screen
  logs: [], // data-log ids found across all runs
  endings: [],
  checkpoint: null,
});

export class Save {
  constructor() {
    this.data = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed, settings: { ...this.data.settings, ...(parsed.settings || {}) } };
      }
    } catch {
      // Storage can be unavailable (private mode, sandboxed frame); play without it.
    }
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  get settings() {
    return this.data.settings;
  }

  addLog(id) {
    if (!this.data.logs.includes(id)) {
      this.data.logs.push(id);
      this.write();
    }
  }

  unlock(chapter) {
    if (chapter > this.data.unlocked) {
      this.data.unlocked = chapter;
      this.write();
    }
  }

  setCheckpoint(snapshot) {
    this.data.checkpoint = snapshot;
    this.write();
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.write();
  }
}
