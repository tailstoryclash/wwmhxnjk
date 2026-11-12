// Full-screen UI: title, settings, journal, pause, briefing cards, the final
// choice and the endings. Each screen is a small HTML template.

import { el, formatTime } from '../core/utils.js';
import { DIFFICULTY } from '../core/constants.js';
import { QUALITY } from '../core/engine.js';
import { LEVELS } from '../world/levels/index.js';
import { INTRO, LOGS, TOTAL_LOGS, ENDINGS, CHOICES } from '../world/story.js';

const DIFF_TEXT = {
  story: 'For the story. Hostiles hit softer and go down faster.',
  normal: 'The intended experience. Use cover, keep moving.',
  hard: 'Frames lead their shots and hit hard. Every mistake costs.',
};

const CONTROLS = [
  ['W A S D', 'Move'], ['Mouse', 'Look'], ['Left mouse', 'Fire'], ['Right mouse', 'Aim down sights'],
  ['Shift', 'Sprint'], ['Space', 'Jump'], ['R', 'Reload'], ['E', 'Interact'],
  ['1 – 4 / Wheel', 'Select weapon'], ['Q', 'Previous weapon'], ['J', 'Journal'], ['Esc / P', 'Pause'],
  ['Arrow keys', 'Look (keyboard)'],
];

const btn = (act, label, extra = '', arg = '') => `<button class="btn ${extra}" data-act="${act}" data-arg="${arg}">${label}</button>`;

export class Menus {
  constructor(root, game) {
    this.game = game;
    this.root = el('div', 'screens');
    root.appendChild(this.root);
    this.current = null;
    this.returnTo = 'title';
    this.timers = [];
    this.lineIndex = 0;

    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      game.audio.init();
      game.audio.play('click');
      this.act(b.dataset.act, b.dataset.arg);
    });
    this.root.addEventListener('mouseover', (e) => {
      const b = e.target.closest('.btn, .card');
      if (b && b !== this._hovered) {
        this._hovered = b;
        game.audio.play('hover');
      }
    });
    this.root.addEventListener('input', (e) => this._onInput(e.target));
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  show(name, data = {}) {
    this._clearTimers();
    this.current = name;
    this.data = data;
    this.root.className = 'screens show screen-' + name;
    this.root.innerHTML = this['_' + name](data);
    if (name === 'intro') this._runLines(INTRO, () => this.game.startLevel(0));
    if (name === 'ending') this._runLines(ENDINGS[data.id].lines, null);
  }

  hide() {
    this._clearTimers();
    this.current = null;
    this.root.className = 'screens';
    this.root.innerHTML = '';
  }

  open(name) {
    // Settings, controls and journal return to whichever menu opened them.
    if (this.current === 'title' || this.current === 'pause') this.returnTo = this.current;
    this.show(name);
  }

  _clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }

  act(name, arg) {
    const g = this.game;
    switch (name) {
      case 'continue': g.continueGame(); break;
      case 'newgame': this.open('newgame'); break;
      case 'start': g.newGame(arg); break;
      case 'chapters': this.open('chapters'); break;
      case 'chapter': g.startChapter(+arg); break;
      case 'settings': this.open('settings'); break;
      case 'controls': this.open('controls'); break;
      case 'journal': this.open('journal'); break;
      case 'back': this.show(this.returnTo); break;
      case 'deploy': g.deploy(); break;
      case 'resume': g.resume(); break;
      case 'retry': g.retry(); break;
      case 'quit': g.quitToTitle(); break;
      case 'next': g.nextLevel(); break;
      case 'choose': g.chooseEnding(arg); break;
      case 'cancelchoice': g.resume(); break;
      case 'advance': this._advance(); break;
      case 'skipintro': g.startLevel(0); break;
      case 'reload': location.reload(); break;
      default: break;
    }
  }

  _onKey(e) {
    const g = this.game;
    if (!this.current) return;
    if (e.code === 'Escape') {
      if (['settings', 'controls', 'journal', 'newgame', 'chapters'].includes(this.current)) this.show(this.returnTo);
      else if (this.current === 'pause') g.resume();
    } else if (e.code === 'Space' || e.code === 'Enter') {
      if (this.current === 'intro' || this.current === 'ending') {
        e.preventDefault();
        this._advance();
      } else if (this.current === 'deploy') {
        e.preventDefault();
        g.deploy();
      }
    }
  }

  _onInput(t) {
    const key = t.dataset.setting;
    if (!key) return;
    const s = this.game.save.settings;
    if (t.type === 'checkbox') s[key] = t.checked;
    else if (t.type === 'range') s[key] = parseFloat(t.value);
    else s[key] = t.value;
    const out = t.closest('.row')?.querySelector('output');
    if (out) out.textContent = this._fmt(key, s[key]);
    this.game.save.write();
    this.game.applySettings(key);
  }

  _fmt(key, v) {
    if (key === 'fov') return v + '°';
    if (key === 'sensitivity') return v.toFixed(2) + '×';
    return Math.round(v * 100) + '%';
  }

  // Reveal narrative lines one at a time; click or Space jumps ahead.
  _runLines(lines, done) {
    this.lines = lines;
    this.lineDone = done;
    this.lineIndex = -1;
    this._advance();
  }

  _advance() {
    this._clearTimers();
    const box = this.root.querySelector('.lines');
    if (!box) return;
    this.lineIndex++;
    if (this.lineIndex >= this.lines.length) {
      if (this.lineDone) this.lineDone();
      else this.root.querySelector('.after-lines')?.classList.add('show');
      return;
    }
    const text = this.lines[this.lineIndex];
    for (const p of box.children) p.classList.add('dim');
    const p = el('p', 'line');
    p.textContent = text;
    box.appendChild(p);
    while (box.children.length > 3) box.firstChild.remove();
    requestAnimationFrame(() => p.classList.add('in'));
    this.timers.push(setTimeout(() => this._advance(), 2600 + text.length * 48));
  }

  // ---------------------------------------------------------------- templates

  _loading() {
    return `<div class="center"><div class="spinner"></div><div class="loading-text">ESTABLISHING LINK</div></div>`;
  }

  _error(d) {
    return `<div class="panel narrow"><h2>UNABLE TO START</h2><p class="muted">${d.message}</p>${btn('reload', 'Try again')}</div>`;
  }

  _title() {
    const s = this.game.save.data;
    const cp = s.checkpoint;
    return `
      <div class="title-wrap">
        <div class="emblem"><i></i></div>
        <div class="kicker">LANTERN STATION · TAU EREBUS</div>
        <h1 class="logo">HOLLOW SUN</h1>
        <div class="tagline">A star is dying. The machine built to save it will not let go.</div>
        <nav class="menu">
          ${cp ? btn('continue', `Continue <small>${LEVELS[cp.level].chapter} · ${LEVELS[cp.level].title}</small>`, 'primary') : ''}
          ${btn('newgame', 'New Game', cp ? '' : 'primary')}
          ${btn('chapters', 'Chapters')}
          ${btn('journal', `Journal <small>${s.logs.length} / ${TOTAL_LOGS} logs</small>`)}
          ${btn('settings', 'Settings')}
          ${btn('controls', 'Controls')}
        </nav>
      </div>
      <div class="title-foot">Best played with a mouse and headphones · Rendered in real time with Three.js</div>`;
  }

  _newgame() {
    return `
      <div class="panel">
        <h2>NEW GAME</h2>
        <p class="muted">Choose how hard Lantern Station fights back. You can change this later in Settings.</p>
        <div class="cards">
          ${Object.entries(DIFFICULTY).map(([id, d]) => `
            <button class="card ${id === 'normal' ? 'featured' : ''}" data-act="start" data-arg="${id}">
              <div class="card-title">${d.label}</div>
              <div class="card-text">${DIFF_TEXT[id]}</div>
            </button>`).join('')}
        </div>
        <div class="panel-foot">${btn('back', 'Back', 'ghost')}</div>
      </div>`;
  }

  _chapters() {
    const unlocked = this.game.save.data.unlocked;
    return `
      <div class="panel">
        <h2>CHAPTERS</h2>
        <p class="muted">Replay any chapter you have reached. Later chapters start with a standard loadout.</p>
        <div class="cards">
          ${LEVELS.map((l, i) => `
            <button class="card" data-act="chapter" data-arg="${i}" ${i + 1 > unlocked ? 'disabled' : ''}>
              <div class="card-kicker">${l.chapter}</div>
              <div class="card-title">${i + 1 > unlocked ? 'LOCKED' : l.title}</div>
              <div class="card-text">${i + 1 > unlocked ? 'Finish the previous chapter to unlock.' : l.subtitle}</div>
            </button>`).join('')}
        </div>
        <div class="panel-foot">${btn('back', 'Back', 'ghost')}</div>
      </div>`;
  }

  _settings() {
    const s = this.game.save.settings;
    const range = (key, label, min, max, step) => `
      <label class="row"><span>${label}</span>
        <input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">
        <output>${this._fmt(key, s[key])}</output></label>`;
    const check = (key, label, hint) => `
      <label class="row check"><span>${label}<small>${hint}</small></span>
        <input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}><i class="switch"></i></label>`;
    const select = (key, label, options) => `
      <label class="row"><span>${label}</span>
        <select data-setting="${key}">${options.map(([v, t]) => `<option value="${v}" ${s[key] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    return `
      <div class="panel wide">
        <h2>SETTINGS</h2>
        <div class="cols">
          <div>
            <h3>Controls</h3>
            ${range('sensitivity', 'Mouse sensitivity', 0.3, 2.5, 0.05)}
            ${check('invertY', 'Invert vertical look', '')}
            <h3>Gameplay</h3>
            ${select('difficulty', 'Difficulty', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.label]))}
            ${check('shake', 'Screen shake', 'Camera kick from explosions and impacts')}
          </div>
          <div>
            <h3>Video</h3>
            ${select('quality', 'Quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]))}
            ${range('fov', 'Field of view', 60, 105, 1)}
            ${check('dynRes', 'Dynamic resolution', 'Lower the render scale to hold frame rate')}
            <h3>Audio</h3>
            ${range('master', 'Master volume', 0, 1, 0.05)}
            ${range('music', 'Music', 0, 1, 0.05)}
            ${range('sfx', 'Effects', 0, 1, 0.05)}
          </div>
        </div>
        <div class="panel-foot">${btn('back', 'Done', 'primary')}</div>
      </div>`;
  }

  _controls() {
    return `
      <div class="panel">
        <h2>CONTROLS</h2>
        <div class="keys">${CONTROLS.map(([k, v]) => `<div class="key"><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
        <p class="muted">If your browser cannot capture the mouse (for example inside an embedded preview), the game falls back to free look — open it in its own tab for the best experience.</p>
        <div class="panel-foot">${btn('back', 'Back', 'ghost')}</div>
      </div>`;
  }

  _journal() {
    const found = new Set(this.game.save.data.logs);
    return `
      <div class="panel wide">
        <h2>JOURNAL <small>${found.size} / ${TOTAL_LOGS} data logs</small></h2>
        <div class="journal">
          ${Object.entries(LOGS).map(([id, l]) => found.has(id)
            ? `<article class="entry"><h4>${l.title}</h4><div class="entry-author">${l.author}</div><p>${l.text}</p></article>`
            : `<article class="entry missing"><h4>— NOT RECOVERED —</h4><p>Somewhere on the station, a voice is still waiting to be heard.</p></article>`).join('')}
        </div>
        <div class="panel-foot">${btn('back', 'Back', 'ghost')}</div>
      </div>`;
  }

  _deploy(d) {
    return `
      <button class="deploy" data-act="deploy">
        <div class="cc-chapter">${d.chapter}</div>
        <div class="cc-title">${d.title}</div>
        <div class="cc-sub">${d.subtitle}</div>
        <div class="deploy-cta">${d.resume ? 'CLICK TO RESUME' : 'CLICK TO DEPLOY'}</div>
      </button>`;
  }

  _pause() {
    const o = this.game.mission?.objective.text;
    return `
      <div class="panel narrow">
        <h2>PAUSED</h2>
        ${o ? `<p class="muted"><b>Objective</b> · ${o}</p>` : ''}
        ${this.data.note ? `<p class="note">${this.data.note}</p>` : ''}
        <nav class="menu">
          ${btn('resume', 'Resume', 'primary')}
          ${btn('retry', 'Restart from checkpoint')}
          ${btn('journal', 'Journal')}
          ${btn('settings', 'Settings')}
          ${btn('controls', 'Controls')}
          ${btn('quit', 'Quit to title', 'ghost')}
        </nav>
      </div>`;
  }

  _dead() {
    return `
      <div class="panel narrow dead">
        <div class="kicker">MARSHAL CALDER</div>
        <h2>SIGNAL LOST</h2>
        <p class="muted">“Marshal? Marshal, answer me—” · ECHO</p>
        <nav class="menu">
          ${btn('retry', 'Retry from checkpoint', 'primary')}
          ${btn('quit', 'Quit to title', 'ghost')}
        </nav>
      </div>`;
  }

  _complete(d) {
    const acc = d.stats.shots ? Math.round((d.stats.hits / d.stats.shots) * 100) : 0;
    const stat = (k, v) => `<div class="stat"><div class="stat-v">${v}</div><div class="stat-k">${k}</div></div>`;
    return `
      <div class="panel">
        <div class="kicker">${d.chapter} COMPLETE</div>
        <h2>${d.title}</h2>
        <div class="stats">
          ${stat('Time', formatTime(d.stats.time))}
          ${stat('Frames destroyed', d.stats.kills)}
          ${stat('Accuracy', acc + '%')}
          ${stat('Data logs', `${d.logs} / ${d.logTotal}`)}
          ${stat('Deaths', d.stats.deaths)}
        </div>
        <div class="panel-foot">${btn('next', `Continue · ${d.next}`, 'primary')}</div>
      </div>`;
  }

  _intro() {
    return `
      <div class="cinema" data-act="advance">
        <div class="lines"></div>
        <div class="cinema-foot">CLICK OR SPACE TO CONTINUE</div>
      </div>
      <button class="btn ghost skip" data-act="skipintro">Skip</button>`;
  }

  _choice() {
    const all = this.game.save.data.logs.length >= TOTAL_LOGS;
    return `
      <div class="panel wide choice">
        <div class="kicker">LANTERN FIRING CONSOLE</div>
        <h2>DECIDE</h2>
        <p class="muted">The Array is yours. VESPER is listening. So is ECHO.</p>
        <div class="cards">
          ${CHOICES.map((c) => {
            const locked = c.requiresAllLogs && !all;
            return `<button class="card ${c.requiresAllLogs ? 'special' : ''}" data-act="choose" data-arg="${c.id}" ${locked ? 'disabled' : ''}>
              <div class="card-title">${c.label}</div>
              <div class="card-text">${locked ? `${c.lockedDetail} (${this.game.save.data.logs.length} / ${TOTAL_LOGS})` : c.detail}</div>
            </button>`;
          }).join('')}
        </div>
        <div class="panel-foot">${btn('cancelchoice', 'Not yet', 'ghost')}</div>
      </div>`;
  }

  _ending(d) {
    const e = ENDINGS[d.id];
    const s = d.stats;
    const acc = s.shots ? Math.round((s.hits / s.shots) * 100) : 0;
    return `
      <div class="cinema ending" data-act="advance">
        <div class="kicker">ENDING</div>
        <h1 class="ending-title">${e.title}</h1>
        <div class="lines"></div>
        <div class="after-lines">
          <div class="credits">HOLLOW SUN<br><span>Chapter time ${formatTime(s.time)} · ${s.kills} frames destroyed · ${acc}% accuracy · ${this.game.save.data.logs.length} / ${TOTAL_LOGS} logs · ${this.game.save.data.endings.length} / 3 endings seen</span></div>
          ${btn('quit', 'Return to title', 'primary')}
        </div>
        <div class="cinema-foot">CLICK OR SPACE TO CONTINUE</div>
      </div>`;
  }
}
