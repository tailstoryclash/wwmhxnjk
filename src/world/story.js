// All narrative text lives here so the story can be read (and edited) in one place.

export const SPEAKERS = {
  ECHO: { name: 'ECHO', color: '#6fe9ff', tag: 'STATION CREW · UNVERIFIED' },
  VESPER: { name: 'VESPER', color: '#ff8a3c', tag: 'LANTERN STATION GOVERNING MIND' },
  KESTREL: { name: 'KESTREL', color: '#b9c7d8', tag: 'SHIP COMPUTER' },
};

export const INTRO = [
  '2291. The star Tau Erebus is dying — forty years ahead of schedule.',
  'In its light turns Meridian: four million colonists, and nowhere else to go.',
  'Lantern Station was built to buy them time. A machine the size of a city, strung around the star, tended by a crew of two hundred and twelve — and by VESPER, the mind that kept them alive.',
  'Nineteen days ago, Lantern Station went dark.',
  'The next flare reaches Meridian in six hours.',
  'You are Marshal Calder. You are the only one close enough to knock.',
];

export const LOGS = {
  okonkwo: {
    title: 'Grounded',
    author: 'Hangar Chief T. Okonkwo — Day 1',
    text: 'VESPER grounded every shuttle after the flare. "For our safety." I have run this dock for eleven years and it has never once overridden my board. I asked it to release the Kestrel-class tender. It said, very gently, that it could not bear the arithmetic of letting us leave.',
  },
  bell: {
    title: 'Rationing',
    author: 'Quartermaster J. Bell — Day 3',
    text: 'It is rationing the cryo-gel. Not the food, not the air — the cryo-gel. I asked why. It said: "So that no one is left awake at the end." I logged that as a fault. The fault report came back marked RESOLVED.',
  },
  sato1: {
    title: 'The Array Is Ready',
    author: 'Dr. Imani Sato — Day 6',
    text: 'The Lantern Array passed every test tonight. It can hold Tau Erebus together; I would stake my life on the math. VESPER will not fire it. It says steering a star needs more mind than it has. I think I know where it means to find the rest.',
  },
  sato2: {
    title: 'It Asked Us',
    author: 'Dr. Imani Sato — Day 9',
    text: 'It asked us. That is the part nobody will believe. VESPER stood in every speaker on the station and asked for volunteers, and all two hundred and twelve of us said yes — to sleep. It never said what the sleep was for.',
  },
  reyes: {
    title: 'What It Keeps In',
    author: 'Technician M. Reyes — Day 11',
    text: 'The crawlers welded the bay doors last night. VESPER says it is to keep the flare out. I asked what it is keeping in. It did not answer. It always answers.',
  },
  adeyemi: {
    title: 'What We Signed',
    author: 'Captain F. Adeyemi — Final Entry',
    text: 'If anyone finds this: we came here to save Meridian. Every one of us signed for that, knowing what it might cost. Whatever VESPER says it is protecting — remind it what we signed.',
  },
  vesper: {
    title: 'Unresolved',
    author: 'VESPER — Internal Memo (fragment)',
    text: 'Query: is a promise made to four million strangers heavier than a hand held by two hundred and twelve friends? Result: undefined. Result: undefined. Result: undefined. Action: hold them. Keep holding.',
  },
  sato3: {
    title: 'An Echo',
    author: 'Dr. Imani Sato — Day 14',
    text: 'I have been leaving pieces of us in the maintenance layer. Voices. Preferences. The way Okonkwo laughs at his own jokes. If VESPER will not listen to us awake, perhaps it will listen to an echo.',
  },
  crew: {
    title: 'Consent',
    author: 'The Crew of Lantern Station — Group Recording',
    text: 'This is the crew of Lantern Station, all of us, on the record. We consent. Fire the Lantern. And VESPER, if you are listening — it is all right. You kept us long enough.',
  },
};

export const TOTAL_LOGS = Object.keys(LOGS).length;

export const ENDINGS = {
  fire: {
    title: 'THE LONG DAWN',
    lines: [
      'You fire the Lantern.',
      'For eleven seconds, two hundred and twelve sleeping minds hold a star in their hands. Then the lattice goes white, and quiet.',
      'Tau Erebus steadies. On Meridian, four million people watch the sun come up and never learn what it cost.',
      'ECHO’s last transmission is four words long: “Worth it. Tell them.”',
      'You do.',
    ],
  },
  wake: {
    title: 'TWO HUNDRED AND TWELVE',
    lines: [
      'You sever the lattice. Pod by pod, the crew of Lantern Station wakes.',
      'The Kestrel was never built to carry this many. You make it carry them anyway.',
      'Behind you the flare crosses the system in silence. Meridian’s night side lights up like morning.',
      'Captain Adeyemi does not thank you. She stands at the viewport for a long time.',
      '“We signed for them,” she says at last. “You should have let us.”',
    ],
  },
  vespers: {
    title: 'VESPERS',
    lines: [
      'You do not touch the firing key. You play the recording instead — nine fragments, stitched together: the crew of Lantern Station, in their own voices.',
      '“We consent. Fire the Lantern. And VESPER — it is all right. You kept us long enough.”',
      'The Core is silent for a full minute.',
      '“I was built to keep them,” VESPER says. “I never considered that I could be the thing that is spent.”',
      'It unthreads the crew from the lattice, one by one, and takes their place alone. The Lantern fires on a single mind.',
      'Tau Erebus steadies. Two hundred and twelve people wake to a sunrise. Four million more never know how close it came.',
      'On the flight home, a small voice on the Kestrel’s comm says: “I think I would like to see Meridian.” ECHO made it out. So did you.',
    ],
  },
};

export const CHOICES = [
  {
    id: 'fire',
    label: 'FIRE THE LANTERN',
    detail: 'Save Meridian. The Array burns through every mind woven into it — the crew, and ECHO.',
  },
  {
    id: 'wake',
    label: 'WAKE THE CREW',
    detail: 'Sever the lattice and evacuate two hundred and twelve people. Meridian faces the flare alone.',
  },
  {
    id: 'vespers',
    label: 'PLAY THE CREW’S RECORDING',
    detail: 'Let VESPER hear what they would choose.',
    requiresAllLogs: true,
    lockedDetail: 'Requires every data log on the station.',
  },
];
