// Keys whose default browser behaviour would disrupt play (scrolling, focus changes).
const BLOCKED = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyE', 'KeyF', 'KeyQ', 'KeyJ',
]);

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = [false, false, false];
    this.buttonPressed = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.freeLook = false; // fallback when the browser refuses pointer lock
    this.enabled = false; // true only while the player controls the character
    this.onLockChange = null;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (this.enabled && BLOCKED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || !(this.locked || this.freeLook)) return;
      // Chrome occasionally reports a huge bogus delta right after locking.
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.dx += mx;
      this.dy += my;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.button > 2) return;
      this.buttons[e.button] = true;
      this.buttonPressed[e.button] = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.buttons[e.button] = false;
    });
    document.addEventListener('wheel', (e) => {
      if (this.enabled) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.target;
      this.onLockChange?.(this.locked);
    });
  }

  releaseAll() {
    this.keys.clear();
    this.buttons.fill(false);
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.buttonPressed.fill(false);
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }

  // Resolves true once the pointer is captured, false if the browser refused.
  requestLock() {
    return new Promise((resolve) => {
      const el = this.target;
      if (document.pointerLockElement === el) return resolve(true);
      if (!el.requestPointerLock) return resolve(false);
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        resolve(ok);
      };
      const onChange = () => finish(document.pointerLockElement === el);
      const onError = () => finish(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      const timer = setTimeout(() => finish(document.pointerLockElement === el), 1500);
      try {
        // Raw input avoids OS pointer acceleration where the platform supports it.
        const p = el.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) {
          p.catch((err) => {
            if (err && err.name === 'NotSupportedError') {
              const p2 = el.requestPointerLock();
              if (p2 && p2.catch) p2.catch(() => finish(false));
            } else finish(false);
          });
        }
      } catch {
        finish(false);
      }
    });
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
