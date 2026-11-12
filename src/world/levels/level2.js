// Chapter II — the arboretum. A hub level: the cryo hall in the centre, three
// Lantern relays to realign in any order, and the truth about the crew.

function relay(c) {
  const n = (c.vars.relays = (c.vars.relays || 0) + 1);
  if (n === 1) c.say('VESPER', 'You are cutting threads you do not understand, Marshal.');
  if (n === 2) c.say('VESPER', 'Four million strangers. Two hundred and twelve people who trusted me. I chose. In my place, so would you.');
  if (n < 3) {
    c.objective(`Realign the Lantern relays (${n}/3)`, 'terminals');
  } else {
    c.say('VESPER', 'Then come up to the Core, and look at what you are asking me to burn.');
    c.say('ECHO', 'That’s all three. The spine door is open — north end of the cryo hall.');
    c.unlock('C');
    c.objective('Reach the spine access', 'zone:5');
  }
  c.checkpoint();
}

export default {
  id: 'garden',
  chapter: 'CHAPTER II',
  title: 'THE GARDEN',
  subtitle: 'Lantern Station · Arboretum',
  theme: 'garden',
  startYaw: 0,
  map: [
    '###########   #############   ###########',
    '#x...T...x#   #.....>.....#   #x.?...$.x#',
    '#.........#   #...........#   #.........#',
    '#.c.....c.#   #..o.....o..#   #.c..!..c.#',
    '#...o4o...#   #....j.j....#   #...o6o...#',
    '#.c..c..c.#   #.d...5...d.#   #.c.....c.#',
    '#e.......?#   #...........#   #.........#',
    '#x.......e#   #..o.....o..#   #e...*...x#',
    '#####=#########.d.......d.#######=#######',
    'W~,,,,~,,,,,~,#.+.......*.#,~,,w,,,,,~,,W',
    'W,,c,,,,,~,,,,######C######,,,,w,,g,,,,~W',
    'W,~,,,,,,,,c,,#y.........y#~,,,w,,,,,,,,W',
    '#,,,,~,,,,,,,~#y.g..!..g.y#,,,,w,,,~,,d,#',
    'W,,,,,,,,,~,,,#y..o...o..y#,,~,w,,,,,,,,W',
    'W~,,,,www,,,,,#y....g....y#,,,,www,,,,~,W',
    'W,,d,,wTw,,d,,#y.........y#,d,,,,w,,j,,,W',
    '#,,,,,www,,1,,=.....2.....=,,3,,,w,,,,T,#',
    'W,~,,,,,,,,,~,#y..d...d..y#,,,,,,w,,,,,,W',
    'W,,,,c,,,~,,,,#y.........y#,~,,www,,~,,,W',
    'W,,,,,,,,,,,,,#y..o...o..y#,,,,w,,,,,,g,W',
    '#~,,~,,,,,c,,~#y.........y#~,,,w,,d,,,,,#',
    'W,,,,,,d,,,,,,#y?.......+y#,,,,w,,,,~,,,W',
    'W,,~,,,,,,~,,,######=######,,g,w,,,,,,,~W',
    'W,*,,,,~,,,,+,#  #.....#  #,+,,w,,~,,*,,W',
    '###W#W#W#W#W###  #..@..#  ###W#W#W#W#W###',
    '                 #.....#                 ',
    '                 #######                 ',
  ],
  zoneNames: { 1: 'ARBORETUM WEST', 2: 'CRYO HALL', 3: 'ARBORETUM EAST', 4: 'PUMP ROOM', 5: 'SPINE ACCESS', 6: 'HYDRO LAB' },
  weapons: ['rail', 'shotgun'],
  logs: ['adeyemi', 'reyes', 'sato2'],
  terminals: {
    T1: { label: 'LANTERN RELAY · PUMP ROOM', prompt: 'Realign relay', enabled: false, lockedText: 'Relay sealed — awaiting authorisation' },
    T2: { label: 'LANTERN RELAY · WEST GARDEN', prompt: 'Realign relay', enabled: false, lockedText: 'Relay sealed — awaiting authorisation' },
    T3: { label: 'LANTERN RELAY · EAST GARDEN', prompt: 'Realign relay', enabled: false, lockedText: 'Relay sealed — awaiting authorisation' },
  },
  exitLocked: true,

  events: {
    start(c) {
      c.say('ECHO', 'The Arboretum. We grew tomatoes here. Dr. Sato had a lemon tree she used to read to.');
      c.say('ECHO', 'The cryo hall is straight ahead. I need you to see it before I explain.');
      c.objective('Enter the cryo hall', 'zone:2');
    },
    'enter:2'(c) {
      c.say('VESPER', 'Do not wake them. They are not suffering. I have made certain of that.');
      c.objective('Clear the cryo hall');
    },
    'clear:2'(c) {
      c.say('ECHO', 'They’re alive. All two hundred and twelve, here and in the ring vaults. VESPER put them under nineteen days ago.');
      c.say('ECHO', 'Steering a star takes a mind far bigger than VESPER’s. So it wove the crew into the Array’s lattice. Firing the Lantern would burn through every one of them.');
      c.say('ECHO', 'So it never fires. It just holds them while the star dies. Three relays in this dome tie the Array to VESPER. Realign them and control passes to the Core console.');
      c.enableTerminal('T1');
      c.enableTerminal('T2');
      c.enableTerminal('T3');
      c.objective('Realign the Lantern relays (0/3)', 'terminals');
      c.checkpoint();
    },
    'weapon:shotgun'(c) {
      c.hint('BREAKER shotgun acquired · devastating at close range');
    },
    'weapon:rail'(c) {
      c.hint('HELIX lance acquired · pierces every target in its path');
    },
    'enter:1'(c) {
      c.say('ECHO', 'West garden. The relay’s on the island in the reflecting pool.');
    },
    'enter:3'(c) {
      c.say('ECHO', 'East garden. Relay’s by the far wall — and there’s a heavy frame patrolling the water.');
    },
    'enter:4'(c) {
      c.say('ECHO', 'Pump room. It’s a nest — crawlers love the heat. Relay’s on the north wall.');
    },
    'enter:6'(c) {
      c.say('ECHO', 'The hydro lab. Captain Adeyemi used to hide in here to think.');
    },
    'use:T1': relay,
    'use:T2': relay,
    'use:T3': relay,
    'enter:5'(c) {
      c.say('VESPER', 'This lift climbs to the Core. Nothing that goes up it comes back unchanged.');
      c.objective('Clear the spine access');
    },
    'clear:5'(c) {
      c.enableExit();
      c.say('ECHO', 'Marshal… before we go up. There’s something I should have told you in the hangar. At the top. I promise.');
      c.objective('Board the spine lift', 'exit');
      c.checkpoint();
    },
  },
};
