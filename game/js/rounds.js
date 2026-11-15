// The round director: match and round flow, team plans, the buy phase and economy,
// the plant and defuse channels, win checks and scoring. It owns the state machine
// in state.js; the HUD only reads what it leaves behind.

import * as THREE from 'three';
import { RULES, PRICES } from './config.js';
import { state, Phase, pushEvent } from './state.js';
import { spawnPads, siteZones } from './world.js';
import { createFighter, makeAI, attachSoldier } from './bots.js';
import { ALL_NAMES } from './config.js';
import { freshLoadout } from './weapons.js';

export function setupMatch(scene) {
  state.fighters = [];
  for (const team of ['azurite', 'realgar']) {
    for (let i = 0; i < RULES.teamSize; i += 1) {
      const isPlayer = team === 'azurite' && i === 0;
      const f = createFighter(ALL_NAMES[team][i], team, isPlayer);
      if (!isPlayer) {
        f.ai = makeAI(f);
        attachSoldier(f, scene);
      } else {
        state.player = f;
      }
      state.fighters.push(f);
    }
  }
  state.newMatch();
}

// Where each team holds and pushes, per site. Positions are [x, z, yaw].
const HOLD = {
  A: [[-20, -16.5, 2.6], [-33.5, -8, -0.6]],
  B: [[32, -16.5, -2.6], [19, -7.5, 0.7]],
  mid: [[2.8, -7, 3.14]],
};
const PUSH = {
  A: [[-24, -10], [-30, -14]],
  B: [[24, -10], [30, -14]],
};

function assignPlans(site) {
  const azurite = state.teamFighters('azurite').filter((f) => !f.isPlayer);
  const realgar = state.teamFighters('realgar');
  const other = site === 'A' ? 'B' : 'A';
  // Azurite: the carrier plants, two escort to the site, one shows at the other site.
  const carrier = azurite[0];
  state.chargeCarrier = carrier.id;
  carrier.ai.plan = { kind: 'plant', site };
  carrier.ai.goal = null;
  const escorts = azurite.slice(1, 3);
  escorts.forEach((f, i) => {
    f.ai.plan = { kind: 'escort', to: PUSH[site][i], yaw: site === 'A' ? -2.2 : 2.2 };
    f.ai.goal = null;
  });
  if (azurite[3]) {
    azurite[3].ai.plan = { kind: 'escort', to: PUSH[other][0], yaw: 0 };
    azurite[3].ai.goal = null;
  }
  if (state.player) state.player.ai = null;
  state.targetSite = site;
  // Realgar: two hold each site, one holds mid; the mid and one holder rotate on alerts.
  const spots = [...HOLD.A.map((h) => [...h, 'A']), ...HOLD.B.map((h) => [...h, 'B']), [...HOLD.mid[0], 'mid']];
  realgar.forEach((f, i) => {
    const [x, z, yaw, where] = spots[i % spots.length];
    f.ai.plan = { kind: 'hold', at: [x, z], yaw, crouch: i % 2 === 0, rotateOnAlert: where !== state.targetSite && i !== 0 };
    f.ai.goal = null;
  });
}

export function startRound() {
  state.round += 1;
  state.phase = Phase.BUY;
  state.phaseTime = RULES.buySeconds;
  state.roundClock = RULES.roundSeconds;
  state.detonateClock = 0;
  state.plantedSite = null;
  state.planting = null;
  state.roundWinner = null;
  state.winReason = '';
  state.slowmo = 0;
  const site = Math.random() < 0.5 ? 'A' : 'B';
  for (const team of ['azurite', 'realgar']) {
    state.teamFighters(team).forEach((f, i) => {
      const [x, z] = spawnPads[team][i];
      f.pos.set(x, 0, z);
      f.vel.set(0, 0, 0);
      f.yaw = team === 'azurite' ? 0 : Math.PI;
      f.pitch = 0;
      f.crouch = false;
      f.walking = false;
      f.alive = true;
      f.hp = 100;
      f.slot = 1;
      f.loadout = freshLoadout(f);
      f.recoil = 0;
      if (f.group) f.group.visible = true;
      if (f.ai) {
        f.ai.path = []; f.ai.goal = null; f.ai.target = null; f.ai.mode = 'advance';
        f.ai.grenadeThrown = false; f.ai.alertPos = null;
      }
    });
  }
  assignPlans(site);
  // Bots spend their money with simple priorities.
  for (const f of state.fighters) if (!f.isPlayer) botBuy(f);
  pushEvent({ type: 'roundStart', round: state.round });
}

export function botBuy(f) {
  if (f.armour <= 0 && f.money >= PRICES.armour) buy(f, 'armour');
  if (f.armour > 0 && !f.helmet && f.money >= PRICES.helmet + 300) buy(f, 'helmet');
  if (f.grenades === 0 && f.money >= PRICES.grenade + 400) buy(f, 'grenade');
  if (!f.rifleUpgraded && f.money >= PRICES.rifleUpgrade + 1200) buy(f, 'rifleUpgrade');
}

export function buy(f, item) {
  if (state.phase !== Phase.BUY && state.phase !== Phase.FREEZE) return false;
  const price = PRICES[item];
  if (price === undefined || f.money < price) return false;
  if (item === 'armour' && f.armour >= 100) return false;
  if (item === 'helmet' && f.helmet) return false;
  if (item === 'grenade' && f.grenades >= 2) return false;
  if (item === 'rifleUpgrade' && f.rifleUpgraded) return false;
  f.money -= price;
  if (item === 'armour') f.armour = 100;
  if (item === 'helmet') f.helmet = true;
  if (item === 'grenade') f.grenades += 1;
  if (item === 'rifleUpgrade') f.rifleUpgraded = true;
  pushEvent({ type: 'buy', fighter: f, item });
  return true;
}

function endRound(winner, reason) {
  state.phase = Phase.ROUND_END;
  state.phaseTime = RULES.roundEndSeconds;
  state.roundWinner = winner;
  state.winReason = reason;
  state.scores[winner] += 1;
  state.planting = null;
  const planted = state.plantedSite !== null || reason === 'detonation' || reason === 'defuse';
  for (const f of state.fighters) {
    f.money = Math.min(RULES.maxMoney, f.money + (f.team === winner ? RULES.rewardWin : RULES.rewardLoss));
    if (planted && f.team === 'azurite') f.money = Math.min(RULES.maxMoney, f.money + RULES.rewardPlant);
    if (!f.alive) { f.armour = 0; f.helmet = false; f.grenades = 0; }
  }
  // The round-ending kill earns the slow moment (blueprint section 10).
  if (reason === 'elimination' && state.time - state.lastKillTime < 0.15 && !state.reducedMotion) {
    state.slowmo = 0.9;
  }
  pushEvent({ type: 'roundEnd', winner, reason });
}

function checkWins() {
  const azuriteAlive = state.aliveCount('azurite');
  const realgarAlive = state.aliveCount('realgar');
  if (state.phase === Phase.PLANTED) {
    if (realgarAlive === 0) return endRound('azurite', 'elimination');
    if (state.detonateClock <= 0) return endRound('azurite', 'detonation');
    return;
  }
  if (state.phase !== Phase.LIVE) return;
  if (realgarAlive === 0) return endRound('azurite', 'elimination');
  if (azuriteAlive === 0) return endRound('realgar', 'elimination');
  if (state.roundClock <= 0) return endRound('realgar', 'time');
}

// Progress the plant or defuse channel, if one is running.
function stepChannel(dt) {
  const ch = state.planting;
  if (!ch) return;
  const f = ch.fighter;
  const zone = siteZones[ch.site];
  const inZone = f.pos.x > zone.minX - 1 && f.pos.x < zone.maxX + 1 && f.pos.z > zone.minZ - 1 && f.pos.z < zone.maxZ + 1;
  if (!f.alive || !inZone || f.speed > 0.4) {
    pushEvent({ type: 'channelStop', kind: ch.kind });
    state.planting = null;
    return;
  }
  const need = ch.kind === 'plant' ? RULES.plantSeconds : RULES.defuseSeconds;
  ch.progress += dt / need;
  pushEvent({ type: 'channel', kind: ch.kind, progress: ch.progress });
  if (ch.progress >= 1) {
    state.planting = null;
    if (ch.kind === 'plant') {
      state.plantedSite = ch.site;
      state.phase = Phase.PLANTED;
      state.detonateClock = RULES.detonateSeconds;
      state.chargeCarrier = null;
      f.money = Math.min(RULES.maxMoney, f.money + RULES.rewardPlant);
      // Defenders converge: the two nearest living Realgar bots get the defuse job
      // and escorts, the rest hold.
      const zoneC = siteZones[ch.site];
      const realgars = state.teamFighters('realgar').filter((e) => e.alive)
        .sort((a, b) => a.pos.distanceTo(new THREE.Vector3(zoneC.cx, 0, zoneC.cz)) - b.pos.distanceTo(new THREE.Vector3(zoneC.cx, 0, zoneC.cz)));
      if (realgars[0]) { realgars[0].ai.plan = { kind: 'defuse' }; realgars[0].ai.goal = null; }
      if (realgars[1]) { realgars[1].ai.plan = { kind: 'escort', to: [zoneC.cx + 5, zoneC.cz + 5], yaw: 0 }; realgars[1].ai.goal = null; }
      pushEvent({ type: 'planted', site: ch.site });
    } else {
      f.money = Math.min(RULES.maxMoney, f.money + RULES.rewardDefuse);
      pushEvent({ type: 'defused', site: ch.site });
      endRound('realgar', 'defuse');
    }
  }
}

// One fixed step of the round state machine. Movement and combat are stepped by
// main.js; this advances clocks, channels and phase transitions.
export function stepRounds(dt) {
  if (state.paused) return;
  switch (state.phase) {
    case Phase.BUY:
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) { state.phase = Phase.FREEZE; state.phaseTime = RULES.freezeSeconds; pushEvent({ type: 'freeze' }); }
      break;
    case Phase.FREEZE:
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) { state.phase = Phase.LIVE; pushEvent({ type: 'live' }); }
      break;
    case Phase.LIVE:
      state.roundClock -= dt;
      stepChannel(dt);
      checkWins();
      break;
    case Phase.PLANTED:
      state.detonateClock -= dt;
      stepChannel(dt);
      checkWins();
      break;
    case Phase.ROUND_END:
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        if (state.scores.azurite >= RULES.winTarget || state.scores.realgar >= RULES.winTarget || state.round >= RULES.maxRounds) {
          state.phase = Phase.MATCH_END;
          pushEvent({ type: 'matchEnd' });
        } else {
          startRound();
        }
      }
      break;
    default:
      break;
  }
}

// Who the spectator camera follows when the player is dead.
export function spectateTarget() {
  const mates = state.teamFighters('azurite').filter((f) => f.alive && !f.isPlayer);
  return mates[0] || null;
}
