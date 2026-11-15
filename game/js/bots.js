// Fighters and bot brains. One factory builds every combatant (the local player
// included); bots get a low-poly soldier model from the blueprint (section 9) and a
// brain that navigates the waypoint graph, holds sites, plants and defuses the
// charge, hears gunfire, and fights in bursts, stopping to shoot because the spread
// model punishes moving fire.

import * as THREE from 'three';
import { PAL, TEAMS, RULES } from './config.js';
import { state } from './state.js';
import { findPath, losBlocked, siteZones } from './world.js';
import { moveFighter } from './player.js';
import { fireOnce, startReload, throwGrenade, weaponDef } from './weapons.js';
import { freshLoadout } from './weapons.js';

let nextId = 1;

export function createFighter(name, team, isPlayer) {
  return {
    id: nextId++, name, team, isPlayer,
    alive: true, hp: 100, armour: 0, helmet: false,
    money: RULES.startMoney, kills: 0, deaths: 0, damageDealt: 0,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, crouch: false, walking: false, onGround: true, speed: 0,
    slot: 1, loadout: null, grenades: 0, rifleUpgraded: false,
    recoil: 0, lastAttacker: null, lastDamageAt: -9, deathAt: 0,
    group: null, parts: null, ai: null,
  };
}

// --- The soldier model (blueprint section 9): team colour carries identity ---

function buildSoldier(team) {
  const tc = TEAMS[team].color;
  const g = new THREE.Group();
  const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex });
  const teamMat = mat(tc);
  const parts = {};
  const add = (key, geom, material, x, y, z) => {
    const m = new THREE.Mesh(geom, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    parts[key] = m;
    return m;
  };
  add('legL', new THREE.BoxGeometry(0.16, 0.8, 0.18), mat(0x2b3042), -0.13, 0.4, 0);
  add('legR', new THREE.BoxGeometry(0.16, 0.8, 0.18), mat(0x2b3042), 0.13, 0.4, 0);
  add('torso', new THREE.BoxGeometry(0.5, 0.6, 0.28), teamMat, 0, 1.1, 0);
  add('belt', new THREE.BoxGeometry(0.5, 0.1, 0.3), mat(0x151b30), 0, 0.78, 0);
  add('armL', new THREE.BoxGeometry(0.12, 0.55, 0.12), mat(0x3a4057), -0.33, 1.12, 0.05);
  add('armR', new THREE.BoxGeometry(0.12, 0.55, 0.12), mat(0x3a4057), 0.33, 1.12, 0.05);
  add('padL', new THREE.BoxGeometry(0.16, 0.12, 0.16), teamMat, -0.33, 1.38, 0);
  add('padR', new THREE.BoxGeometry(0.16, 0.12, 0.16), teamMat, 0.33, 1.38, 0);
  add('head', new THREE.SphereGeometry(0.13, 10, 8), mat(0xe6e9f2), 0, 1.58, 0);
  const helm = add('helm', new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), teamMat, 0, 1.6, 0);
  add('visor', new THREE.BoxGeometry(0.2, 0.05, 0.05), mat(0x151b30), 0, 1.58, -0.12);
  add('plate', new THREE.BoxGeometry(0.3, 0.35, 0.04), teamMat, 0, 1.12, 0.16);
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.04, 0.02),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(tc).multiplyScalar(1.2) }),
  );
  light.position.set(0, 1.25, -0.15);
  g.add(light);
  parts.light = light;
  void helm;
  return { group: g, parts };
}

export function attachSoldier(f, scene) {
  const { group, parts } = buildSoldier(f.team);
  f.group = group;
  f.parts = parts;
  scene.add(group);
}

// A posed soldier for the menu backdrop (no fighter attached).
export function displaySoldier(team, scene) {
  const { group } = buildSoldier(team);
  scene.add(group);
  return group;
}

// --- Bot brain ---

const AI = {
  reaction: 0.3,       // seconds between first sight and first shot
  burstMin: 3, burstMax: 6,
  pauseBetween: 0.28,
};

export function makeAI(f) {
  return {
    path: [], pathIdx: 0,
    goal: null,           // current [x, z] destination
    holdPos: null,        // position to defend once arrived
    holdYaw: 0,
    mode: 'advance',      // advance | hold | engage | plant | defuse | rotate
    target: null,         // fighter being engaged
    seenAt: -9,           // when the target was first seen
    aimErr: 0.04,
    burstLeft: 0, burstPauseUntil: 0,
    strafeDir: 1, strafeFlipAt: 0,
    alertPos: null, alertUntil: 0, lastHeardStamp: -1,
    scanPhase: Math.random() * Math.PI * 2,
    repathAt: 0,
    stuckAt: 0, stuckPos: new THREE.Vector3(),
    grenadeThrown: false,
  };
}

function eyeY(f) { return f.pos.y + (f.crouch ? 1.28 : 1.62); }

function canSee(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 75) return false;
  if (dist > 7) {
    // Field of view about 105 degrees around the facing direction.
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    if ((dx * fx + dz * fz) / (dist || 1) < 0.35) return false;
  }
  return !losBlocked(a.pos.x, eyeY(a), a.pos.z, b.pos.x, b.pos.y + 1.1, b.pos.z);
}

function faceToward(f, tx, tz, dt, rate = 10) {
  const want = Math.atan2(-(tx - f.pos.x), -(tz - f.pos.z));
  let d = want - f.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  f.yaw += d * Math.min(1, rate * dt);
}

function setGoal(f, x, z) {
  const ai = f.ai;
  ai.goal = [x, z];
  ai.path = findPath(f.pos.x, f.pos.z, x, z);
  ai.pathIdx = 0;
}

// Move along the path; returns true on arrival.
function followPath(f, dt, speedWalk = false) {
  const ai = f.ai;
  if (!ai.path.length) return true;
  const [tx, tz] = ai.path[Math.min(ai.pathIdx, ai.path.length - 1)];
  const dx = tx - f.pos.x, dz = tz - f.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.75) {
    ai.pathIdx += 1;
    if (ai.pathIdx >= ai.path.length) return true;
    return false;
  }
  faceToward(f, tx, tz, dt, 8);
  f.walking = speedWalk;
  moveFighter(f, dx / dist, dz / dist, false, dt);
  // Stuck detection: barely moved over a second and a half, so repath once.
  if (state.time - ai.stuckAt > 1.5) {
    if (ai.stuckPos.distanceTo(f.pos) < 0.3 && ai.goal) setGoal(f, ai.goal[0], ai.goal[1]);
    ai.stuckPos.copy(f.pos);
    ai.stuckAt = state.time;
  }
  return false;
}

function engage(f, dt) {
  const ai = f.ai;
  const t = ai.target;
  if (!t || !t.alive) { ai.mode = ai.holdPos ? 'hold' : 'advance'; ai.target = null; return; }
  if (!canSee(f, t) && state.time - ai.seenAt > 2.5) {
    ai.alertPos = [t.pos.x, t.pos.z];
    ai.alertUntil = state.time + 4;
    ai.target = null;
    ai.mode = 'advance';
    if (ai.goal) setGoal(f, ai.goal[0], ai.goal[1]);
    return;
  }
  // Aim at the chest, sometimes the head, with error that settles the longer we aim.
  const aimY = t.pos.y + (Math.random() < 0.3 ? 1.5 : 1.05);
  faceToward(f, t.pos.x, t.pos.z, dt, 14);
  const wantPitch = Math.atan2(aimY - eyeY(f), Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z));
  ai.aimErr = Math.max(0.008, ai.aimErr * (1 - 2.2 * dt));
  f.pitch += (wantPitch + (Math.random() - 0.5) * ai.aimErr - f.pitch) * Math.min(1, 12 * dt);

  // Strafe between bursts, stand still during them: the spread model rewards it.
  if (state.time >= ai.strafeFlipAt) { ai.strafeDir = Math.random() < 0.5 ? -1 : 1; ai.strafeFlipAt = state.time + 0.7 + Math.random() * 0.8; }
  const bursting = ai.burstLeft > 0 && state.time >= ai.burstPauseUntil;
  if (!bursting) {
    const sx = Math.cos(f.yaw) * ai.strafeDir, sz = -Math.sin(f.yaw) * ai.strafeDir;
    moveFighter(f, sx, sz, false, dt);
  } else {
    moveFighter(f, 0, 0, false, dt);
  }

  if (state.time - ai.seenAt < AI.reaction) return;
  if (f.loadout.mag[f.slot] === 0) { startReload(f); return; }
  if (ai.burstLeft <= 0) {
    if (state.time < ai.burstPauseUntil) return;
    ai.burstLeft = AI.burstMin + Math.floor(Math.random() * (AI.burstMax - AI.burstMin));
  }
  const def = weaponDef(f);
  if (fireOnce(f)) {
    ai.burstLeft -= 1;
    if (ai.burstLeft <= 0) ai.burstPauseUntil = state.time + AI.pauseBetween + Math.random() * 0.15;
    void def;
  }
}

function perceive(f) {
  const ai = f.ai;
  let best = null, bd = Infinity;
  for (const t of state.fighters) {
    if (t === f || !t.alive || t.team === f.team) continue;
    const d = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
    if (d < bd && canSee(f, t)) { best = t; bd = d; }
  }
  if (best) {
    if (ai.target !== best) { ai.seenAt = state.time; ai.aimErr = 0.045; }
    ai.target = best;
    ai.mode = 'engage';
  }
  // Hearing: enemy shots nearby set an alert position (defenders rotate, attackers check).
  for (const ev of state.events) {
    if (ev.type !== 'shot' || ev.at <= ai.lastHeardStamp) continue;
    ai.lastHeardStamp = ev.at;
    const s = ev.fighter;
    if (!s || s.team === f.team || s === f) continue;
    if (Math.hypot(s.pos.x - f.pos.x, s.pos.z - f.pos.z) < 30) {
      ai.alertPos = [s.pos.x, s.pos.z];
      ai.alertUntil = state.time + 5;
    }
  }
}

// Round plans, assigned by the round director through fighter.ai.plan.
export function stepBot(f, dt) {
  const ai = f.ai;
  if (!f.alive) return;
  perceive(f);
  if (ai.mode === 'engage') { engage(f, dt); return; }

  const plan = ai.plan;
  if (plan) {
    if (plan.kind === 'plant') {
      const zone = siteZones[plan.site];
      const inZone = f.pos.x > zone.minX && f.pos.x < zone.maxX && f.pos.z > zone.minZ && f.pos.z < zone.maxZ;
      if (!inZone) {
        if (!ai.goal || ai.goal[0] !== zone.cx) setGoal(f, zone.cx + (Math.random() * 4 - 2), zone.cz + (Math.random() * 4 - 2));
        followPath(f, dt);
      } else if (state.chargeCarrier === f.id && !state.plantedSite && !state.planting) {
        moveFighter(f, 0, 0, false, dt);
        state.planting = { fighter: f, kind: 'plant', progress: 0, site: plan.site };
      } else {
        // Guard the planter from a nearby angle.
        if (!ai.goal) setGoal(f, zone.cx + 6, zone.cz + 4);
        followPath(f, dt);
      }
      return;
    }
    if (plan.kind === 'guard' || plan.kind === 'hold') {
      // Once the charge is down, every living defender converges on that site:
      // standing at the far site wins nothing.
      if (state.plantedSite && f.team === 'ember') {
        const zone = siteZones[state.plantedSite];
        plan.kind = 'rotate';
        plan.to = [zone.cx + (Math.random() * 8 - 4), zone.cz + (Math.random() * 6 - 3)];
        return;
      }
      const [hx, hz] = plan.at;
      const arrived = Math.hypot(f.pos.x - hx, f.pos.z - hz) < 1.2;
      if (!arrived) {
        if (!ai.goal || ai.goal[0] !== hx) setGoal(f, hx, hz);
        followPath(f, dt);
      } else {
        moveFighter(f, 0, 0, false, dt);
        f.crouch = plan.crouch === true;
        // Slow scan across the likely approach.
        f.yaw = plan.yaw + Math.sin(state.time * 0.4 + ai.scanPhase) * 0.5;
        f.pitch = 0;
        // Rotate to an alert: gunfire heard toward the other site.
        if (ai.alertPos && state.time < ai.alertUntil && plan.rotateOnAlert) {
          plan.kind = 'rotate';
          plan.to = ai.alertPos;
        }
      }
      return;
    }
    if (plan.kind === 'rotate') {
      const [rx, rz] = plan.to;
      if (Math.hypot(f.pos.x - rx, f.pos.z - rz) < 2.5) {
        plan.kind = 'hold';
        plan.at = [f.pos.x, f.pos.z];
        plan.yaw = f.yaw;
      } else {
        if (!ai.goal || ai.goal[0] !== rx) setGoal(f, rx, rz);
        followPath(f, dt);
      }
      return;
    }
    if (plan.kind === 'defuse') {
      const zone = siteZones[state.plantedSite];
      if (!zone) return;
      const d = Math.hypot(f.pos.x - zone.cx, f.pos.z - zone.cz);
      if (d > 1.6) {
        if (!ai.goal || ai.goal[0] !== zone.cx) setGoal(f, zone.cx, zone.cz);
        followPath(f, dt);
      } else if (!state.planting) {
        moveFighter(f, 0, 0, false, dt);
        state.planting = { fighter: f, kind: 'defuse', progress: 0, site: state.plantedSite };
      } else {
        moveFighter(f, 0, 0, false, dt);
      }
      return;
    }
    if (plan.kind === 'escort') {
      const [ex, ez] = plan.to;
      if (Math.hypot(f.pos.x - ex, f.pos.z - ez) > 1.4) {
        if (!ai.goal || Math.abs(ai.goal[0] - ex) > 1) setGoal(f, ex, ez);
        followPath(f, dt);
      } else {
        moveFighter(f, 0, 0, false, dt);
        f.yaw = plan.yaw ?? f.yaw;
      }
      return;
    }
  }
  // No plan: drift toward the enemy half.
  moveFighter(f, 0, 0, false, dt);
}

// A bot with a grenade and a known alert sometimes lobs it toward the alert.
export function maybeGrenade(f, scene) {
  const ai = f.ai;
  if (f.grenades <= 0 || ai.grenadeThrown || !ai.alertPos) return;
  if (Math.random() > 0.3) return;
  faceToward(f, ai.alertPos[0], ai.alertPos[1], 1);
  f.pitch = 0.3;
  if (throwGrenade(f, scene)) ai.grenadeThrown = true;
}

// --- Visual sync: position, limb swing, hit flash, death fall (blueprint section 9) ---

const _col = new THREE.Color();

export function syncBotVisual(f, dt) {
  const g = f.group;
  if (!g) return;
  g.position.copy(f.pos);
  g.rotation.y = f.yaw; // the model's visor faces -z locally; yaw turns it to the facing
  const p = f.parts;
  if (f.alive) {
    const swing = Math.sin(state.time * 9) * Math.min(1, f.speed / 4) * 0.5;
    p.legL.rotation.x = swing;
    p.legR.rotation.x = -swing;
    p.armR.rotation.x = -1.2 + f.pitch * 0.6;
    p.armL.rotation.x = -0.9 + Math.sin(state.time * 9) * Math.min(1, f.speed / 4) * 0.2;
    g.rotation.x = 0;
    g.position.y = f.pos.y + (f.crouch ? -0.35 : 0);
    const flash = state.time - f.lastDamageAt < 0.06;
    for (const key of ['torso', 'head', 'legL', 'legR']) {
      const m = p[key].material;
      if (m.emissive) m.emissive.setHex(flash ? 0x888888 : 0x000000);
    }
  } else {
    // Death: stagger, then fall backward around the feet, desaturate, sink away.
    const t = Math.min(1, (state.time - f.deathAt) / 0.7);
    g.rotation.x = -Math.PI / 2 * t * t;
    const gone = state.time - f.deathAt;
    if (gone > 4) {
      g.position.y = f.pos.y - Math.min(0.3, (gone - 4)) - (gone > 4.3 ? 10 : 0);
      if (gone > 4.3) g.visible = false;
    }
    _col.setHex(0x777777);
    for (const key of ['torso', 'plate', 'padL', 'padR']) p[key].material.color.copy(_col);
  }
}
