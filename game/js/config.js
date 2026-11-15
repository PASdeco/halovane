// Saltline configuration: every design token, rule constant and name the game runs on,
// in one place, so the design can change without touching the simulation.
// Colours come from the Saltline design blueprint, section 2. Team names, the map name,
// round length and the win target are constants here by design (blueprint section 13).

export const GAME_NAME = 'Saltline';
export const MAP_NAME = 'Saltworks';
export const VERSION = 'v1.0';

export const TEAMS = {
  tide: { id: 'tide', name: 'Tide', color: 0x3d8bff, deep: 0x1f5fd6, css: '#3D8BFF', role: 'attack' },
  ember: { id: 'ember', name: 'Ember', color: 0xff8a2b, deep: 0xe0600a, css: '#FF8A2B', role: 'defend' },
};

// The palette the world is built from (blueprint section 2.4) plus interface colours.
export const PAL = {
  ink: 0x0b1020, inkRaised: 0x151b30, chalk: 0xf2f5fc, mist: 0xa3acc6, slateLine: 0x2a3350,
  signal: 0xffd23f, alarm: 0xff3355, vital: 0x5be38b, steel: 0xc9d2e8,
  skyZenith: 0x5f82cc, skyMid: 0xa9b9e6, skyHorizon: 0xf4cdb4, haze: 0xe8d8cf,
  saltFloor: 0xefe9df, plaster: 0xd9d2cc, slateConcrete: 0x9aa0b4, wetConcrete: 0x6e7388,
  rust: 0xb4624a, coolShed: 0x7fa0c4, warmShed: 0xc79a74, brine: 0xd58fb2,
  hazardDark: 0x2b3042, crateA: 0x6d7a95, crateB: 0xa98667, pumpMint: 0x86afa8,
  lamp: 0xffc27a, tracer: 0xffe9a8, flashCore: 0xfff1b8, flashOuter: 0xffb347,
  intakeFloor: 0xb7c4d6, boilerFloor: 0xd8b79a, pumpFloor: 0xc9d3cf,
};

// Round and match rules (blueprint defaults: 5v5, 1:45 rounds, first to 8).
export const RULES = {
  teamSize: 5,
  roundSeconds: 105,
  buySeconds: 12,
  freezeSeconds: 3,
  roundEndSeconds: 4.5,
  winTarget: 8,
  maxRounds: 15,
  plantSeconds: 3.2,
  defuseSeconds: 4.5,
  detonateSeconds: 35,
  startMoney: 800,
  maxMoney: 9000,
  rewardWin: 1400,
  rewardLoss: 1000,
  rewardKill: 300,
  rewardPlant: 300,
  rewardDefuse: 300,
};

// Prices in the buy menu (the judge's tactical layer: money earned, money spent).
export const PRICES = { armour: 650, helmet: 350, grenade: 300, rifleUpgrade: 900 };

// Bot names (blueprint section 9). The local player is "You" on Tide.
export const BOT_NAMES = {
  tide: ['Marlow', 'Quill', 'Odette', 'Bram'],
  ember: ['Rook', 'Saffron', 'Dax', 'Mercer', 'Wick'],
};
export const ALL_NAMES = {
  tide: ['You', 'Marlow', 'Quill', 'Odette', 'Bram'],
  ember: ['Rook', 'Saffron', 'Dax', 'Mercer', 'Wick'],
};

// Map areas for the HUD location label (blueprint section 7.1): bounds and identity colour.
export const AREAS = [
  { name: 'Intake', css: '#3D8BFF', minX: -14, maxX: 14, minZ: 18, maxZ: 32 },
  { name: 'Boiler', css: '#FF8A2B', minX: -14, maxX: 14, minZ: -32, maxZ: -18 },
  { name: 'Conveyor', css: '#FFD23F', minX: -6, maxX: 6, minZ: -18, maxZ: 18 },
  { name: 'Brine Pans', css: '#D58FB2', minX: -42, maxX: -14, minZ: -26, maxZ: -2 },
  { name: 'Tank Farm', css: '#B4624A', minX: 14, maxX: 42, minZ: -26, maxZ: -2 },
  { name: 'Pump House', css: '#86AFA8', minX: -14, maxX: -6, minZ: -10, maxZ: 0 },
  { name: 'Loading Dock', css: '#FFD23F', minX: 6, maxX: 14, minZ: -10, maxZ: 0 },
  { name: 'West Channel', css: '#A3ACC6', minX: -42, maxX: -14, minZ: 0, maxZ: 20 },
  { name: 'East Ramp', css: '#6E7388', minX: 14, maxX: 42, minZ: 0, maxZ: 20 },
];

export function areaAt(x, z) {
  for (const a of AREAS) if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a;
  return null;
}
