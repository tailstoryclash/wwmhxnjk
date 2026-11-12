# HOLLOW SUN — project handoff

_Last updated: 2026-11-12 · branch `hoplite/megara-f6eb688a` · snapshot taken mid-build_

This file is the single source of truth for continuing the project in another
chat or with another developer. It describes what the game is, what has been
written, what is still missing, and the plan to finish it.

---

## 1. Status at a glance

**The game is not runnable yet.** About 85% of the code is written, but the
three files that tie it together do not exist, and nothing has been built or
opened in a browser.

| Area | State |
| --- | --- |
| Project scaffold (Vite, deps, `index.html`) | Written. `npm install` succeeded. Never built. |
| Story, level maps, level scripts | Written. Maps **validated** by script (see §9). |
| Level logic (parse, collision, raycast, nav, light bake) | Written. Parsing/nav/raycast exercised by the map validator; the rest unverified. |
| Graphics (textures, sky, materials, effects, level builder) | Written. **Never rendered.** |
| Engine (renderer, post-processing, quality presets) | Written. Never run. |
| Audio (synth SFX + generative music) | Written. Never run. |
| Player, weapons, enemies, boss, projectiles, pickups | Written. Never run. |
| Mission scripting + checkpoints | Written. Never run. |
| HUD, dialogue, menus (DOM + logic) | Written. Never run. **No CSS exists.** |
| `src/game.js` — the Game class that wires everything | **MISSING** (fully specified in §6) |
| `src/main.js` — entry point | **MISSING** (trivial, §6.9) |
| `src/styles.css` — all UI styling | **MISSING** (class inventory in §7) |
| README, preview config, pull request | **MISSING** |
| First build, browser run, bug-fix pass, visual tuning | **NOT STARTED** |

Expect a real debugging pass once it first runs: ~7,500 lines were written
without executing them.

---

## 2. What the game is

A story-driven first-person shooter that runs in the browser. Everything is
procedural: there are **no image, model or audio files** — textures are drawn
on canvases, models are built from primitives, sound is synthesised with Web
Audio.

### Story

2291. The star Tau Erebus is dying. Lantern Station orbits it, running the
Lantern Array that could stabilise the star and save the colony world Meridian
(four million people). The station went dark 19 days ago. The player is
**Marshal Calder**, the only responder in range.

- **ECHO** (cyan) guides the player by radio and claims to be station crew.
- **VESPER** (orange) is the station's governing mind and the antagonist.
- Truth: firing the Array needs more mind than VESPER has, so it put the 212
  crew into cryo-sleep and wove their minds into the Array. Firing would burn
  them out, so VESPER never fires and simply "keeps" them while the star dies.
  ECHO is not a person — she is an echo assembled from fragments of the crew
  that Dr. Sato hid in the maintenance layer, and she dies if the Array fires.

Chapters (one level each):

1. **Dead Air** — docking ring. Restore power, fight to the transit lift.
2. **The Garden** — arboretum hub. See the cryo hall, realign three relays.
3. **Hollow Sun** — the Core. ECHO's confession, the Warden boss, the choice.

Endings (chosen at the final console, text in `src/world/story.js`):

- **The Long Dawn** — fire the Lantern; Meridian lives, crew and ECHO burn.
- **Two Hundred and Twelve** — wake the crew; Meridian burns.
- **Vespers** — only if all 9 data logs were found: play the crew's recording;
  VESPER takes the crew's place and fires the Array on itself. Everyone lives.

Nine collectible data logs (three per level) carry the back-story and gate the
third ending.

### Player kit

| Weapon | Slot | Notes |
| --- | --- | --- |
| VIGIL-9 sidearm | 1 | Semi-auto hitscan, infinite reserve (prevents soft-locks) |
| LANCER AR | 2 | Automatic, found in level 1 cargo bay |
| BREAKER shotgun | 3 | 9 pellets, found in level 2 cryo hall |
| HELIX LANCE | 4 | Piercing rail shot; optional in level 2 hydro lab, guaranteed in level 3 armoury |

100 health (medkits only) + 100 shield (recharges after 3.5 s without damage).
Controls: WASD, mouse, Shift sprint, Space jump, LMB fire, RMB aim, R reload,
E interact, 1–4/wheel/Q weapons, J journal, Esc/P pause, arrow keys look.

### Hostiles

| Type | Map char | Behaviour |
| --- | --- | --- |
| Seeker drone | `d` | Flies, orbits at range, single telegraphed bolts |
| Sentinel | `g` | Walks, strafes, 3-round bursts; head is a crit spot |
| Hull crawler | `c` | Fast, zig-zags, telegraphed leap melee |
| Juggernaut | `j` | Armoured (body ×0.55), rockets + ground slam; glowing core is the crit spot |
| Shield pylon | `p` | Stationary, feeds the Warden's shield; crystal is the crit spot |
| The Warden | `b` | Boss: shielded until 4 pylons die, then bolt fans, expanding bolt rings, summons, a tracking beam (takes ×1.6 damage while its shell is open), enrages below 40% |

Difficulty presets in `src/core/constants.js` (`story`, `normal`, `hard`).

---

## 3. Tech and key decisions

- **Vite 8 + three.js 0.187 + plain JavaScript ES modules.** Fonts from
  `@fontsource/orbitron` (titles) and `@fontsource/rajdhani` (UI).
- `npm run dev` / `npm run build` / `npm run preview`. `vite.config.js` uses
  `base: './'` so the built `dist/` works from any path. The dev server only
  accepts foreign hostnames when `VITE_ALLOW_ALL_HOSTS=1` (needed by hosted
  previews that proxy the dev server).

three.js r187 facts verified against the installed package (do not "fix" these):

- `PCFSoftShadowMap` was removed → use `PCFShadowMap`.
- `THREE.Clock` is deprecated → the loop should use `performance.now()`.
- `RenderPass` has a `clearDepth` flag; the weapon view model is a second
  `RenderPass` with `clear = false; clearDepth = true` so it never clips walls.
- `EffectComposer(renderer, renderTarget)` accepts a custom half-float target;
  MSAA comes from that target's `samples`.
- `lightMap` reads the UV set named by `texture.channel`; the baked light grid
  uses `channel = 1` and geometry attribute `uv1`.
- A material with `vertexColors: true` renders **black** on geometry that has
  no `color` attribute. Batched scenery always has one; un-batched shared
  primitives must use materials without `vertexColors`.

Rendering approach (all in `src/world/builder.js` + `src/core/engine.js`):

- Level geometry is merged into a handful of meshes per material.
- **Baked light grid:** every fixture is accumulated on the CPU into a
  top-down irradiance grid (3 texels/m, with wall occlusion) used as the
  `lightMap` of all static materials. This lights the whole level for free.
- **Light pool:** a fixed number of real point lights (4/6/8 by quality) is
  parked on the nearest visible fixtures and cross-faded, so the shader light
  count never changes.
- One shadow-casting directional light (the star) follows the player with
  texel snapping; it enters through windows and glass roofs.
- Post chain: scene → view model → `UnrealBloomPass` → custom grade pass
  (chromatic aberration, vignette, damage tint, flash, grain, fade) →
  `OutputPass` (ACES tone mapping).
- Emissive surfaces use `MeshBasicMaterial` with HDR colours (> 1) to bloom.

---

## 4. File map

Status key: ✅ written (unverified unless noted) · ❌ missing

```
index.html                     ✅ #app > canvas#game + div#ui, loads /src/main.js
package.json / package-lock    ✅
vite.config.js                 ✅
.gitignore                     ✅
scripts/validate-maps.mjs      ✅ dev check for the ASCII maps (ran clean)
src/
  main.js                      ❌ entry point
  game.js                      ❌ Game class: state machine, loop, wiring
  styles.css                   ❌ all HUD + menu styling
  core/
    constants.js               ✅ CELL=4 m, heights, PLAYER dims, DIFFICULTY
    utils.js                   ✅ math helpers, mulberry32, formatTime, el()
    save.js                    ✅ localStorage: settings, unlocked, logs, endings, checkpoint
    input.js                   ✅ keys/mouse, pointer lock with free-look fallback
    audio.js                   ✅ AudioEngine: SOUNDS table, positional play(), generative music
    engine.js                  ✅ Engine: renderer, composer, QUALITY presets, dynamic resolution
  gfx/
    textures.js                ✅ procedural canvases: panel, floor, grass, crate, container,
                                  hazard, glow, scorch, flare, ring, pad, animated screen; makeSign()
    sky.js                     ✅ Sky: shader with stars, nebula, planet, the "hollow sun"
    geo.js                     ✅ shared primitives G, xf(), StaticBatcher, QuadBatch, addLightUV()
    materials.js               ✅ createMaterials(theme, tex), createEnvironment(), windTime
    effects.js                 ✅ Effects: particles, dust, tracers, beams, decals, flash lights,
                                  rings, debris, explosion(), impact(), shake()
  world/
    story.js                   ✅ SPEAKERS, INTRO, LOGS (9), ENDINGS (3), CHOICES
    themes.js                  ✅ THEMES: dock / garden / core (colours, sun, sky, music)
    level.js                   ✅ Level: parse, zones, collision, raycast, doors, nav flow field, light bake
    builder.js                 ✅ LevelView: builds the three.js scene for a Level
    mission.js                 ✅ Mission: encounters, terminals, objectives, exit, snapshot/restore
    levels/level1.js           ✅ Dead Air   (40×24 cells, 26 hostiles)
    levels/level2.js           ✅ The Garden (41×27 cells, 34 hostiles)
    levels/level3.js           ✅ Hollow Sun (33×41 cells, boss arena)
    levels/index.js            ✅ LEVELS array
  entities/
    player.js                  ✅ Player: movement, collision, camera, shield/health
    weapons.js                 ✅ WEAPONS, WeaponSystem: firing, reload, view models
    enemyBase.js               ✅ Enemy base class, bakeGeo(), shared materials
    enemies.js                 ✅ Drone, Sentinel, Crawler, Juggernaut, EnemyManager
    boss.js                    ✅ Pylon, Warden
    projectiles.js             ✅ Projectiles: pooled bolts/rockets
    pickups.js                 ✅ Pickups: map pickups + enemy drops
  ui/
    hud.js                     ✅ HUD: builds its own DOM, update(), radar, waypoint
    dialogue.js                ✅ Dialogue: typed radio transmissions
    menus.js                   ✅ Menus: all full-screen templates + navigation
```

### Level format (`src/world/levels/*.js`)

ASCII grid, one character per 4 m cell:

```
#  wall          W  window        .  enclosed floor   ,  glass-roofed floor
=  auto door     A-F locked door  :  zone boundary    w  shallow water
1-9 zone label   @  player start  >  exit lift        T  terminal
d drone  g sentinel  c crawler  j juggernaut  b warden  p shield pylon
+ medkit  * ammo  $ shield cell  ! weapon  ? data log
o pillar  x crates  k container  e fuel cell  ~ tree  i lamp  y cryo pod  S ship
```

- A **zone** is a floor region enclosed by doors/`:`; a digit anywhere in it
  names it. Hostiles drawn in a zone warp in when the player first enters
  (unless the zone is listed in `manualZones`).
- Terminals are numbered `T1…` in reading order; `!` and `?` take their
  weapon / log id from the level's `weapons` / `logs` arrays in reading order.
- `events` maps event names to functions receiving the script API `c`:
  `start`, `enter:<zone>`, `clear:<zone>`, `use:<terminal>`, `weapon:<id>`,
  `boss:pylon`, `boss:shield`, `boss:enrage`.
- Script API (`Mission.ctx`): `say(who, text)`, `objective(text, target)`,
  `hint`, `toast`, `unlock(id)`, `lock(id)`, `spawn(zone)`, `checkpoint()`,
  `setPower(on)`, `enableExit()`, `enableTerminal(id)`, `after(sec, fn)`,
  `choice()`, and `vars` (persisted object). Objective targets: `'T1'`,
  `'exit'`, `'zone:3'`, `'terminals'` (nearest unused enabled terminal).

---

## 5. Contracts other modules already rely on

Everything below is **called by existing code** and must exist on the `Game`
instance (`game`) once `src/game.js` is written.

Fields:

| Field | Type | Used by |
| --- | --- | --- |
| `engine` | `Engine` | everything (`engine.scene`, `.camera`, `.viewScene`, `.fx`, `.quality`, `.pointScale()`) |
| `input` | `Input` | player, weapons |
| `audio` | `AudioEngine` | everything |
| `save` | `Save` | player (settings), menus |
| `hud`, `dialogue`, `menus` | UI | entities, mission |
| `fx` | `Effects` | entities |
| `level` | `Level` | entities, hud |
| `view` | `LevelView` | mission (via constructor), game |
| `mission` | `Mission` | player, pickups, boss, hud, menus |
| `player`, `weapons`, `enemies`, `projectiles`, `pickups` | entities | each other, hud |
| `time` | seconds of simulated time | player, weapons, enemies |
| `difficulty` | entry of `DIFFICULTY` | player, enemies |
| `stats` | `{ shots, hits, kills, damage, damageTaken, time, deaths }` | weapons, enemies, player, menus |

Methods:

| Method | Called from | Expected behaviour |
| --- | --- | --- |
| `onPlayerDeath()` | `Player.takeDamage` | state → `dead`, `stats.deaths++`, after ~1.2 s release the pointer and `menus.show('dead')` |
| `onEnemyKilled(e)` | `EnemyManager.onKilled` | `stats.kills++` (not pylons); roll drops via `pickups.drop('healthOrb' \| 'ammoOrb', x, z)` |
| `saveCheckpoint()` | `Mission.update` | build the snapshot (§6.4), keep it in memory and in `save.setCheckpoint()`, toast |
| `completeLevel()` | `Mission.update` (exit pad) | state → `complete`, `save.unlock(index + 2)`, `menus.show('complete', {...})` |
| `openChoice()` | level 3 `use:T1` | state → `choice`, release pointer, `menus.show('choice')` |
| `explode(x, y, z, radius, damage, { enemyScale })` | projectiles (rockets), barrels | `fx.explosion`, sound, damage player (falloff + line of sight) and `enemies.damageRadius`, chain to nearby barrels |
| `damageBarrel(barrel, dmg)` | weapons, projectiles | if alive: `view.removeBarrel(barrel)` then `explode(...)` |
| `collectLog(id)` | pickups | `save.addLog(id)`, `hud.showLog(LOGS[id])`, sound `log`, toast with count |
| `newGame(difficultyId)` | menus | set difficulty, reset weapons, clear checkpoint, play intro then level 0 |
| `continueGame()` | menus | start from `save.data.checkpoint` |
| `startChapter(i)` | menus | start level `i` with a standard loadout |
| `startLevel(i, checkpoint?)` | menus (intro end / skip) | loading screen → build level → `deploy` card |
| `deploy()` | menus (`deploy` screen) | capture pointer, state → `playing`, start mission/music |
| `resume()` | menus (pause, "Not yet" on the choice screen) | recapture pointer, state → `playing` |
| `retry()` | menus | reload the last checkpoint without rebuilding static geometry |
| `nextLevel()` | menus (`complete`) | `startLevel(index + 1)` |
| `chooseEnding(id)` | menus | record ending, state → `ending`, `menus.show('ending', { id, stats })` |
| `quitToTitle()` | menus | back to the title screen (attract mode) |
| `applySettings(key)` | menus | react to a changed setting (volumes, quality, fov, difficulty, shake…) |

Data passed to menu screens: `deploy` → `{ chapter, title, subtitle, resume }`;
`complete` → `{ chapter, title, stats, logs, logTotal, next }`;
`ending` → `{ id, stats }`; `pause` → `{ note? }`; `error` → `{ message }`.

Return values worth knowing: `Enemy.takeDamage()` returns `'blocked' | 'hit' |
'killed'`; `EnemyManager.raycast()` returns `{ enemy, t, crit }` or `null`;
`Level.raycast()` fills `{ t, nx, ny, nz, kind, ref }` and returns a boolean.

---

## 6. Specification for the missing `src/game.js`

### 6.1 Construction

Create in this order: `Save` → `Engine(canvas, save.settings)` → `Input(canvas)`
→ `AudioEngine(save.settings)` → `HUD(uiRoot, game)` → `Dialogue(game, hud)` →
`Menus(uiRoot, game)` → `Sky` (add `sky.mesh` to `engine.scene`) →
`Effects(engine, engine.quality)` → `Player` → `WeaponSystem` → `EnemyManager`
→ `Projectiles` → `Pickups`. Wrap renderer creation in try/catch and show
`menus.show('error', { message })` if WebGL2 is unavailable.

`input.onLockChange = (locked) => { if (!locked && state === 'playing' && !input.freeLook) pause(); }`

### 6.2 States

`boot → title → intro → ready → playing ⇄ paused`, plus `dead`, `complete`,
`choice`, `ending`. `input.enabled` must be true only in `playing`.
`weapons.root.visible` only in `playing`/`dead`. HUD shown only in
`playing`/`paused`/`dead`.

### 6.3 Loading a level — `loadLevel(index)`

1. Dispose the previous `view` (`view.dispose()`), `enemies.clear()`,
   `projectiles.clear()`, `pickups.clear()`, `fx.clear()`, dispose the previous
   environment render target.
2. `level = new Level(LEVELS[index])`; `theme = THEMES[def.theme]`;
   `view = new LevelView(level, theme, engine)`; `engine.scene.add(view.group)`.
3. `scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity)`;
   `env = createEnvironment(renderer, theme)`; set `scene.environment` and
   `viewScene.environment` to `env.texture` (suggested intensities 0.6 / 0.9).
4. `sky.applyTheme(theme)`, `engine.applyTheme(theme)`, `fx.setTheme(theme)`.
5. Optionally pre-compile shaders: `renderer.compile(scene, camera)`.

Wait for the web fonts before the first level build (door signs are drawn on a
canvas with Orbitron): `document.fonts.load('700 48px Orbitron')` with a
timeout.

### 6.4 Starting / restoring a run — `prepareRun(checkpoint)`

- Clear enemies, projectiles, pickups, effects, dialogue, HUD;
  `view.resetDynamic()`; reset every door (`open = 0`, lock state from the map).
- `mission = new Mission(game, level, view, def)`.
- Fresh: `player.reset(level.start.x, level.start.z, def.startYaw)`,
  `pickups.spawnLevel(new Set())`, call `mission.begin()` when the player
  deploys, then take a checkpoint so "retry" and "continue" work immediately.
- From checkpoint: `mission.restore(cp.mission)`, player position/yaw/health/
  shield, `weapons.restore(cp.weapons)`, `pickups.spawnLevel(mission.collected)`,
  restore `stats`.

Checkpoint snapshot shape:

```js
{ level, difficulty,
  player: { x, z, yaw, health, shield },
  weapons: weapons.serialize(),
  mission: mission.snapshot(),
  stats: { ...stats } }
```

Chapter-select loadouts: level 2 starts with pistol + rifle, level 3 with
pistol + rifle + shotgun.

### 6.5 Frame loop

`dt = min(0.05, elapsed)` (slow frames become slow motion, never tunnelling).
While `playing`, in this order:

1. every 0.25 s `level.updateFlow(player.pos.x, player.pos.z)`
2. `player.update(dt)` → `weapons.update(dt, true)`
3. `level.updateDoors(dt, actors, onToggle)` — actors = player position plus
   every live enemy position; `onToggle` plays `door` / `doorClose` at the door
4. `enemies.update(dt)` → `projectiles.update(dt)` → `pickups.update(dt)`
5. `mission.update(dt)`
6. `fx.update(dt, camera)`, `view.update(dt, time, player.pos)`,
   `sky.update(dt, camera)`, `audio.setListener(x, z, yaw)`
7. sample `level.sampleLight(x, z)` → `weapons.setAmbient(rgb)`
8. decay `engine.fx.damage` and `engine.fx.flash`; `engine.fx.desat`/`fade`
   rise while dead
9. combat state: `n = enemies.engaged()` → `view.setAlarm(n > 0)`,
   `audio.setIntensity(n > 0 ? min(1, 0.5 + n * 0.1) : 0)`
10. `hud.update(dt)`, `dialogue.update(dt)`
11. `engine.render(dt, time)`; finally `input.endFrame()`

`dead`: keep simulating enemies/effects with the dead camera. `paused`: render
only. `title`/`intro`/`ready`: slow orbiting attract camera inside level 1's
hangar (orbit centre ≈ (20, 20), radius ≈ 12, height ≈ 3.2, looking at the
ship near (15, 2, 18)); always use level 0 as the title backdrop.

Also handle keys while playing: `Escape`/`KeyP` → pause (needed in free-look
mode, where Esc does not release a pointer lock), `KeyJ` → pause + journal.

### 6.6 Pointer lock

Lock must be requested from a user gesture, which is why a "CLICK TO DEPLOY"
card sits between loading and playing. If `input.requestLock()` resolves
`false` twice in a row, set `input.freeLook = true` and tell the player via a
toast (embedded previews often forbid pointer lock). Browsers refuse to
re-lock for about a second after the user pressed Esc — on failure stay paused
with `menus.show('pause', { note })`.

### 6.7 Combat helpers

- `explode`: player damage = `damage * (1 - d / radius)` when within radius
  and `level.lineOfSight` holds; `enemies.damageRadius(x, y, z, radius,
  damage * enemyScale)`; barrels within ~0.9 × radius detonate ~0.12 s later.
- `damageBarrel`: fuel cells die to any hit; blast radius ≈ 6, damage ≈ 70,
  `enemyScale` ≈ 1.6.
- Drops in `onEnemyKilled`: juggernaut → one health + one ammo orb; otherwise
  ~22% health orb when the player is under 70 health, else ~28% ammo orb when
  `weapons.needsAmmo()`.

### 6.8 Settings

`applySettings(key)`: `master`/`music`/`sfx` → `audio.applyVolumes()`;
`quality` → `engine.setQuality()`, `engine.applyTheme(theme)`,
`view.applyQuality(engine.quality)`; `difficulty` → update `game.difficulty`;
`shake` → `fx.shakeEnabled`; `fov`/`sensitivity`/`invertY`/`dynRes` are read
live from `save.settings`.

### 6.9 `src/main.js`

Import the font CSS (`@fontsource/orbitron/{500,700,900}.css`,
`@fontsource/rajdhani/{400,500,600,700}.css`), `./styles.css`, create
`new Game(canvas#game, div#ui)` and call `boot()`. Suggested debug hooks for
testing: `?debug` exposes `window.__game`; `?level=N` jumps to a chapter.

---

## 7. Specification for the missing `src/styles.css`

`#app` fills the viewport; `canvas#game` is 100vw × 100vh; `#ui` overlays it.
The HUD must not capture the mouse (`pointer-events: none`); menus must.
Intended look: dark glass panels, thin lines, cyan accent (`#6fe9ff`), amber
for warnings, Orbitron for titles, Rajdhani for UI text, uppercase with letter
spacing. State classes are toggled from JS as listed.

HUD (`.hud`, `.hud.hidden`) — elements are created in `src/ui/hud.js`:

- `.lowhealth` (`.show`) — pulsing red edge vignette
- `.obj-panel` (`.flash` restarts an attention animation), `.obj-chapter`,
  `.obj-label`, `.obj-text` — top left
- `.radar-wrap` > `canvas.radar` (176×176) + `.radar-n` (positioned from the
  centre via `transform`) — top right
- `.boss` (`.show`, `.shielded`), `.boss-name`, `.boss-bar` > `.boss-fill`
  (scaled with `transform: scaleX`, needs `transform-origin: left`), `.boss-tag`
- `.crosshair` (`.ads`) with `i.ch.ch-t/.ch-b/.ch-l/.ch-r` offset by the CSS
  variable `--gap`, and `i.ch-dot`
- `.hitmarker` (`.show`, `.crit`, `.kill`) with four `<i>` strokes
- `.dmg-ring` > `.dmg-arc` (rotated inline; fades out within 0.9 s)
- `.prompt` (`.show`, `.locked`) containing `<b>` key cap, text, `<span>` label
- `.marker` (`.show`, `.edge`) positioned by inline `transform: translate(x, y)`
  from the top-left corner; children `.marker-icon`, `.marker-dist`
- `.vitals` > `.vital.shield` (`.broken`) / `.vital.health` (`.critical`) with
  `.v-icon`, `.v-bar` > `.v-fill` (scaleX), `.v-num`
- `.weapon` > `.w-slots` (`span.slot.s0` not owned / `.s1` owned / `.s2`
  active), `.w-name` (+ inner `<span>` kind), `.w-ammo` > `.w-mag` (`.empty`,
  `.lowmag`), `.w-sep`, `.w-res`, and `.w-state`
- `.toasts` > `.toast.info|.good|.warn|.hint` (`.out` when leaving)
- `.transmission` (`.show`; colour from CSS variable `--speaker`) > `.tx-head`
  (`.tx-wave` with four `<i>` bars, `.tx-name`, `.tx-tag`) + `.tx-text`
- `.logpanel` (`.show`) > `.log-kicker`, `.log-title`, `.log-author`,
  `.log-text`, `.log-foot`
- `.chapter-card` (`.show` plays a ~4.5 s in/out animation) > `.cc-chapter`,
  `.cc-title`, `.cc-sub`

Menus (`.screens`, `.screens.show`, plus `.screen-<name>`) — templates in
`src/ui/menus.js`:

- `.btn` (`.primary`, `.ghost`, `.skip`; may contain `<small>`)
- `.center`, `.spinner`, `.loading-text`
- `.panel` (`.narrow`, `.wide`, `.dead`, `.choice`), `h2` (+ `<small>`), `h3`,
  `.muted`, `.note`, `.kicker`, `.panel-foot`, `.menu`
- title: `.title-wrap`, `.emblem` > `i` (the hollow-sun ring), `.logo`,
  `.tagline`, `.title-foot`
- `.cards` > `button.card` (`.featured`, `.special`, `[disabled]`) with
  `.card-kicker`, `.card-title`, `.card-text`
- settings: `.cols`, `label.row` (`.check`), `input[type=range]`, `output`,
  `select`, `input[type=checkbox]` followed by `i.switch`
- controls: `.keys` > `.key` > `kbd` + `span`
- journal: `.journal` > `article.entry` (`.missing`) with `h4`, `.entry-author`
- `button.deploy` (full screen) with `.cc-chapter`, `.cc-title`, `.cc-sub`,
  `.deploy-cta`
- `.stats` > `.stat` > `.stat-v`, `.stat-k`
- `.cinema` (`.ending`) > `.lines` > `p.line` (`.in` fades in, `.dim` for
  earlier lines), `.cinema-foot`, `.after-lines` (`.show`), `.credits`,
  `.ending-title`

The title, intro and deploy screens should stay see-through enough to show the
live 3D scene behind them.

---

## 8. Plan to finish (in order)

1. Write `src/game.js`, `src/main.js`, `src/styles.css` per §5–§7.
2. `npm run build` to catch syntax and import errors.
3. Run `npm run dev`, open in a browser, fix runtime errors until the title
   screen renders over the hangar.
4. Start a new game and verify the core loop in level 1: movement and
   collision, power terminal, drone ambush, door unlock, checkpoint, death and
   retry.
5. Play-test each enemy type and each weapon; fix AI or balance problems.
6. Level 2: relay terminals in any order, optional hydro lab, spine fight.
7. Level 3: armoury dialogue, boss phases, all three endings.
8. Visual tuning from screenshots: light-bake intensity, pool-light power,
   bloom, fog density, exposure, window shafts, sky.
9. Performance check on each quality preset; confirm dynamic resolution.
10. Write the README (story, controls, how to run, structure), add the preview
    config, open a pull request.

Nice-to-haves, only after the above: gamepad support, a difficulty-aware hint
system, more ambient set dressing, a level-select time/accuracy record.

---

## 9. What has actually been verified

- `npm install` — succeeded (three 0.187.0, vite 8.3.8, fontsource 5.3.0).
- `node scripts/validate-maps.mjs` — **all maps OK**: rows are rectangular,
  start/exit/terminals/logs/weapons match the level definitions, every hostile
  is inside a labelled zone, doors have a walkable passage and solid jambs, no
  floor touches the void, every walkable cell is reachable, nav grid and a
  forward raycast work.

Nothing else has been executed. In particular: no build, no shader has been
compiled, no frame has been rendered, no sound has been played.

---

## 10. Known risks and things to double-check on first run

- **Shaders written blind:** sky (`gfx/sky.js`), particles/dust
  (`gfx/effects.js`), water and the Warden's shield (`world/builder.js`,
  `entities/boss.js`), final grade pass (`core/engine.js`), foliage wind
  (`onBeforeCompile` in `gfx/materials.js`).
- **Lighting balance is a guess:** light-bake intensity (3.1 per fixture,
  divided by π in the shader), pool-light power (30 cd), sun intensity, hemi
  light, environment intensity, bloom strength, exposure, fog density.
- **Face winding / UVs** of the hand-built quads in `gfx/geo.js` (`QuadBatch`)
  were derived on paper; back-face culling will reveal any mistake.
- **Door orientation and sign placement** for `axis: 'z'` doors.
- **Window shafts** (additive quads) may be too strong or misplaced.
- **Semi-auto trigger queueing** in `WeaponSystem.update`.
- **Enemy pathing** around props relies on a 1 m nav grid with 0.45 m
  padding; large enemies (juggernaut radius 0.98) may snag in tight spots.
- **Boss tuning** (2,500 HP, beam 36 dps, ring spacing) is untested.
- `Menus` and `HUD` use `innerHTML` templates; all interpolated text comes
  from the game's own data files, never from user input.
- Pointer lock inside an embedded preview iframe may be refused; the
  free-look fallback exists but is untested.

---

## 11. Notes for an AI agent continuing this work

- The repository is the source of truth: check out the branch named at the top
  and read this file first.
- Dev-server verification needs WebGL in headless Chrome; launch flags such as
  `--enable-unsafe-swiftshader` (or `--use-angle=swiftshader`) are usually
  required. Software rendering is slow, so disable dynamic resolution when
  taking screenshots (`save.settings.dynRes = false`).
- `scripts/validate-maps.mjs` only needs Node; run it after any map edit.
- Keep `src/world/level.js` free of three.js imports so that script keeps
  working.
- Keep this file current: update §1, §8 and §9 whenever the state changes.
