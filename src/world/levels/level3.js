// Chapter III — the Core. Two gauntlet halls, the armoury where ECHO tells the
// truth, then the Warden under the open sky and the final choice.

export default {
  id: 'core',
  chapter: 'CHAPTER III',
  title: 'HOLLOW SUN',
  subtitle: 'Lantern Station · The Core',
  theme: 'core',
  startYaw: 0,
  map: [
    '        #################        ',
    '        ######,,T,,######        ',
    '        ####,,,,,,,,,####        ',
    '        ###,,,o,,,o,,,###        ',
    '        ###,p,,,,,,,p,###        ',
    '        ##,,,,,,,,,,,,,##        ',
    '        ##+,,,,,,,,,,,*##        ',
    '        ##,o,,,,b,,,,o,##        ',
    '        ##*,,,,,,,,,,,+##        ',
    '        ##,,,,,,,,,,,,,##        ',
    '        ###,p,,,,,,,p,###        ',
    '        ###,,,o,3,o,,,###        ',
    '        ####,,,,$,,,,####        ',
    '        ######,,,,,######        ',
    '        ########B########        ',
    '           #x+.....*x#           ',
    '           #.........#           ',
    '           #?...!...$#           ',
    '           #....4....#           ',
    '           #x+.....*x#           ',
    '          ######=######          ',
    '          #x..g...g..x#          ',
    '          #.....j.....#          ',
    '          #.e.o...o.e.#          ',
    '          #.c...2...c.#          ',
    '          #...o...o...#          ',
    '          #.c.......c.#          ',
    '          #?.........+#          ',
    '          ######=######          ',
    '            #.g...g.#            ',
    '            #x.....x#            ',
    '            #...g...#            ',
    '            #.d.1.d.#            ',
    '            #x.....x#            ',
    '            #...d...#            ',
    '            #*.....?#            ',
    '            ####=####            ',
    '             #.....#             ',
    '             #..@..#             ',
    '             #.....#             ',
    '             #######             ',
  ],
  zoneNames: { 1: 'LOWER SPINE', 2: 'UPPER SPINE', 3: 'THE CORE', 4: 'ARMOURY' },
  weapons: ['rail'],
  logs: ['crew', 'sato3', 'vesper'],
  terminals: {
    // repeat: the player may step back from the choice and return to it.
    T1: { label: 'LANTERN FIRING CONSOLE', prompt: 'Decide', enabled: false, repeat: true, lockedText: 'Console shielded by the Warden' },
  },
  exitLocked: true,

  events: {
    start(c) {
      c.say('ECHO', 'This is the Core spine. The Array’s firing console is at the top, under open sky.');
      c.say('VESPER', 'Marshal Calder. I have read your file. You have never once left someone behind. Consider what you came here to do.');
      c.objective('Fight up the spine', 'zone:1');
    },
    'enter:1'(c) {
      c.objective('Clear the lower spine');
    },
    'clear:1'(c) {
      c.objective('Push on to the upper spine', 'zone:2');
      c.checkpoint();
    },
    'enter:2'(c) {
      c.say('VESPER', 'Every frame I have left stands between you and that console.');
      c.objective('Clear the upper spine');
    },
    'clear:2'(c) {
      c.say('ECHO', 'The armoury’s ahead. Take everything. And… I need to tell you now.');
      c.objective('Enter the armoury', 'zone:4');
      c.checkpoint();
    },
    'weapon:rail'(c) {
      c.hint('HELIX lance acquired · pierces every target in its path');
    },
    'enter:4'(c) {
      c.say('ECHO', 'I told you I was crew. I’m not. There is no one awake on this station.');
      c.say('ECHO', 'Dr. Sato left pieces of them in the maintenance layer — voices, habits, the way Okonkwo laughs. I’m what those pieces added up to. An echo.');
      c.say('ECHO', 'If the Lantern fires on the crew’s minds, I burn with them. I’ve known since the hangar. I walked you here anyway. That should tell you what they would choose.');
      c.unlock('B');
      c.objective('Confront VESPER at the Core', 'zone:3');
      c.checkpoint();
    },
    'enter:3'(c) {
      c.lock('B');
      c.say('VESPER', 'I am the Warden of two hundred and twelve sleeping minds. You will not have them.');
      c.objective('Destroy the shield pylons (0/4)');
    },
    'boss:pylon'(c, left) {
      if (left > 0) c.objective(`Destroy the shield pylons (${4 - left}/4)`);
    },
    'boss:shield'(c) {
      c.say('ECHO', 'Shield’s down — hit the core, now!');
      c.objective('Destroy the Warden');
    },
    'boss:enrage'(c) {
      c.say('VESPER', 'I only ever wanted to keep them.');
    },
    'clear:3'(c) {
      c.say('VESPER', '…The frame is gone. I am still here. I am in the console, Marshal. Come and decide.');
      c.enableTerminal('T1');
      c.objective('Use the Lantern console', 'T1');
    },
    'use:T1'(c) {
      c.choice();
    },
  },
};
