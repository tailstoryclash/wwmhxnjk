// Radio transmissions: queued lines typed out in the HUD's comms panel.

import { SPEAKERS } from '../world/story.js';

export class Dialogue {
  constructor(game, hud) {
    this.game = game;
    const root = hud.root;
    this.panel = root.querySelector('.transmission');
    this.nameEl = root.querySelector('.tx-name');
    this.tagEl = root.querySelector('.tx-tag');
    this.textEl = root.querySelector('.tx-text');
    this.queue = [];
    this.current = null;
    this.chars = 0;
    this.shown = 0;
    this.hold = 0;
    this.gap = 0;
  }

  say(who, text) {
    this.queue.push({ who, text });
  }

  clear() {
    this.queue.length = 0;
    this.current = null;
    this.panel.classList.remove('show');
  }

  get busy() {
    return !!this.current || this.queue.length > 0;
  }

  update(dt) {
    if (!this.current) {
      if (!this.queue.length) return;
      this.gap -= dt;
      if (this.gap > 0) return;
      const line = (this.current = this.queue.shift());
      const sp = SPEAKERS[line.who] || { name: line.who, color: '#ffffff', tag: '' };
      this.nameEl.textContent = sp.name;
      this.tagEl.textContent = sp.tag;
      this.panel.style.setProperty('--speaker', sp.color);
      this.textEl.textContent = '';
      this.panel.classList.add('show');
      this.chars = 0;
      this.shown = 0;
      this.hold = 1.5 + line.text.length * 0.04;
      return;
    }
    const text = this.current.text;
    if (this.chars < text.length) {
      this.chars = Math.min(text.length, this.chars + dt * 52);
      const n = Math.floor(this.chars);
      if (n !== this.shown) {
        if (n - (n % 3) !== this.shown - (this.shown % 3)) this.game.audio.play('blip');
        this.shown = n;
        this.textEl.textContent = text.slice(0, n);
      }
    } else {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.current = null;
        this.gap = 0.4;
        if (!this.queue.length) this.panel.classList.remove('show');
      }
    }
  }
}
