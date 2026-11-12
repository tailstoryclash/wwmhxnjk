// Chapter I — the docking ring. Teaches movement and shooting, introduces
// ECHO and VESPER, and ends at the transit lift.
//
// Map legend (shared by every level, see world/level.js):
//   #  wall          W  window        .  enclosed floor   ,  glass-roofed floor
//   =  auto door     A-F locked door  :  zone boundary    w  shallow water
//   1-9 zone label   @  player start  >  exit lift        T  terminal
//   d drone  g sentinel  c crawler  j juggernaut  b warden  p shield pylon
//   + medkit  * ammo  $ shield cell  ! weapon  ? data log
//   o pillar  x crates  k container  e fuel cell  ~ tree  i lamp  y cryo pod  S ship

export default {
  id: 'dock',
  chapter: 'CHAPTER I',
  title: 'DEAD AIR',
  subtitle: 'Lantern Station · Docking Ring',
  theme: 'dock',
  startYaw: -Math.PI / 2,
  map: [
    '###########   #########   ##############',
    '#i,,,T,,,i#   #.+...?.#   #x.....e.....#',
    'W,,d,,,d,,#   #.......#   #..kc...g..x.#',
    'W,,,,,,x,,#####..g.g..#####......c.....#',
    'W,,S,,,,,,#...#..o.o..#...#.k..3.....k.#',
    'W,,,,@,,,,A...=...2...=...=!........g..#',
    'W,,,,,,,,,#...#..o.o..#...#.k....c...k.#',
    'W,,,,,,x,,#####.d...d.#####......c.....#',
    'W,,d,,,d,,#   #.*...g.#   #..x..g...e..#',
    '#i1,,,,,,i#   #########   #x.....+..?.x#',
    '###########               #######=######',
    '                                #.#     ',
    '###########                     #.#     ',
    '#.g.....c.#######################:######',
    '#..o...o..#....d.......?.....d.........#',
    '#....5....=......o.....4.....o.....o...#',
    '#T........#...d.......d.......*...d....#',
    '#....j....#WWW#WWW#WWW#WWW#WWW#WWW#WWW##',
    '#..o...o..#                             ',
    '#$c.....g+#                             ',
    '####B######                             ',
    '  #6..#                                 ',
    '  #.>.#                                 ',
    '  #####                                 ',
  ],
  zoneNames: { 1: 'HANGAR 02', 2: 'SECURITY', 3: 'CARGO BAY', 4: 'OBSERVATION', 5: 'TRANSIT HUB', 6: 'TRANSIT LIFT' },
  manualZones: [1], // the hangar ambush is triggered by the script, not on entry
  weapons: ['rifle'],
  logs: ['okonkwo', 'bell', 'sato1'],
  terminals: {
    T1: { label: 'HANGAR POWER RELAY', prompt: 'Restore power' },
    T2: { label: 'TRANSIT LIFT CONTROL', prompt: 'Call the lift', enabled: false, lockedText: 'Lift control — lockdown active' },
  },
  exitLocked: true,

  events: {
    start(c) {
      c.setPower(false);
      c.say('KESTREL', 'Docking clamps engaged. Atmosphere is breathable. Station power is on emergency reserve.');
      c.say('ECHO', 'Hello? Is someone— your ship just tripped the dock sensors. Please tell me you’re real.');
      c.say('ECHO', 'Call me Echo. I’m… station crew. I can talk you through, but you’ll need power first. Relay console, north wall of the hangar.');
      c.objective('Restore power at the hangar relay', 'T1');
      c.hint('WASD move · MOUSE look · SHIFT sprint · SPACE jump · E interact');
    },
    'use:T1'(c) {
      c.setPower(true);
      c.say('ECHO', 'Power’s back. And— oh no. That woke the dock sentries. They don’t know you. VESPER made sure of that.');
      c.objective('Destroy the security drones');
      c.hint('LEFT MOUSE fire · RIGHT MOUSE aim · R reload');
      c.after(2.4, () => c.spawn(1));
    },
    'clear:1'(c) {
      c.unlock('A');
      c.say('ECHO', 'Nice shooting, Marshal. The east door is open — security checkpoint is straight through.');
      c.objective('Head east to the security checkpoint', 'zone:2');
      c.checkpoint();
    },
    'enter:2'(c) {
      c.say('VESPER', 'Unregistered biosignature in the docking ring. Lantern Station is closed. Leave now, and I will let you leave.');
      c.objective('Clear the security checkpoint');
    },
    'clear:2'(c) {
      c.say('ECHO', 'That voice was VESPER. It ran this station. It used to wish us good morning.');
      c.say('ECHO', 'There’s an arms locker just inside the cargo bay door. Take the rifle — you’ll want it for what lives in there.');
      c.objective('Cross the cargo bay', 'zone:3');
      c.checkpoint();
    },
    'weapon:rifle'(c) {
      c.hint('LANCER rifle acquired · press 2 or scroll to switch weapons');
    },
    'enter:3'(c) {
      c.say('ECHO', 'Hull crawlers. They were built to cut plating — don’t let them reach you. And mind the fuel cells; they don’t like bullets.');
      c.objective('Survive the cargo bay');
    },
    'clear:3'(c) {
      c.say('ECHO', 'South door. The observation gallery runs all the way to the transit hub.');
      c.objective('Take the south door to the observation gallery', 'zone:4');
      c.checkpoint();
    },
    'enter:4'(c) {
      c.say('ECHO', 'Look out the glass. That’s Tau Erebus. It isn’t supposed to look like that — hollow, like an eye.');
      c.say('ECHO', 'The Lantern Array was built to hold it together. It’s finished. It’s ready. VESPER just… won’t fire it.');
      c.objective('Fight through the gallery');
    },
    'clear:4'(c) {
      c.say('VESPER', 'You look at the star and see a problem to solve. I look at it and count the people I can still keep.');
      c.objective('Reach the transit hub', 'zone:5');
      c.checkpoint();
    },
    'enter:5'(c) {
      c.say('ECHO', 'Juggernaut frame in the hub! Its armour shrugs off small arms — aim for the core above its shoulders, and keep moving.');
      c.objective('Destroy the Juggernaut');
    },
    'clear:5'(c) {
      c.say('ECHO', 'Hub’s clear. Call the lift from the console on the west wall.');
      c.enableTerminal('T2');
      c.objective('Call the transit lift', 'T2');
      c.checkpoint();
    },
    'use:T2'(c) {
      c.unlock('B');
      c.enableExit();
      c.say('ECHO', 'Lift’s on its way. Next stop is the Arboretum. That’s where… everyone is. You’ll see.');
      c.objective('Board the transit lift', 'exit');
    },
  },
};
