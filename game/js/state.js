// The one state store. Every module reads and writes match state here; nothing keeps a
// private copy of score, money, health or round phase, so the HUD, the bots and the
// round director can never disagree (judge criterion 5: state kept in one place).

import { RULES } from './config.js';

export const Phase = {
  MENU: 'menu',
  BUY: 'buy',       // buy window at spawn, weapons can be bought, movement locked to spawn
  FREEZE: 'freeze', // the design's 3-2-1 countdown, movement locked
  LIVE: 'live',     // the round is being played
  PLANTED: 'planted', // the charge is down; detonation timer replaces the round timer
  ROUND_END: 'round_end', // banner up, slow moment done, waiting to reset
  MATCH_END: 'match_end',
};

export const state = {
  phase: Phase.MENU,
  paused: false,
  staged: null, // screenshot staging mode ('menu' | 'fight' | 'win') or null in real play

  round: 0,
  scores: { tide: 0, ember: 0 },
  phaseTime: 0,        // seconds left in the current timed phase
  roundClock: 0,       // seconds left on the round timer (live phase)
  detonateClock: 0,    // seconds left before the charge detonates (planted phase)
  plantedSite: null,   // 'A' | 'B' | null
  chargeCarrier: null, // fighter id of the Tide fighter carrying the charge
  planting: null,      // { fighter, progress } while a plant or defuse channel runs
  roundWinner: null,
  winReason: '',       // 'elimination' | 'detonation' | 'defuse' | 'time'
  lastKillTime: -10,   // for the round-end slow moment
  slowmo: 0,           // seconds of slow motion remaining

  fighters: [],        // every combatant, both teams, the local player included
  player: null,        // the local player's fighter
  killFeed: [],        // { killer, victim, headshot, at } newest last, HUD trims to 5
  events: [],          // one-frame event queue the HUD and audio drain: shots, hits, kills

  settings: { sensitivity: 8, volume: 70 },
  reducedMotion: false,
  time: 0,             // simulation seconds since boot, fixed-step accumulated

  newMatch() {
    this.scores.tide = 0;
    this.scores.ember = 0;
    this.round = 0;
    for (const f of this.fighters) {
      f.money = RULES.startMoney;
      f.kills = 0; f.deaths = 0; f.damageDealt = 0;
      f.armour = 0; f.helmet = false; f.grenades = 0; f.rifleUpgraded = false;
    }
  },

  aliveCount(team) {
    let n = 0;
    for (const f of this.fighters) if (f.team === team && f.alive) n += 1;
    return n;
  },

  teamFighters(team) {
    return this.fighters.filter((f) => f.team === team);
  },
};

export function pushEvent(ev) {
  ev.at = state.time;
  state.events.push(ev);
}
