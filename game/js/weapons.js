// Weapons: the Kestrel rifle, the Wren pistol, the Field knife and the frag grenade.
// Definitions, first-person view-models built from the blueprint's shapes (section 8),
// the firing model (spread that punishes movement, recoil, damage falloff, headshots),
// and the pooled tracers, flashes and impact particles, so hot loops allocate nothing.

import * as THREE from 'three';
import { PAL } from './config.js';
import { state, pushEvent } from './state.js';
import { rayHitDistance } from './world.js';
import { damageFighter } from './combat.js';

export const WEAPONS = {
  rifle: {
    slot: 1, name: 'Kestrel', label: 'Rifle', damage: 36, headshotBonus: true,
    interval: 0.1, automatic: true, mag: 30, reserve: 90, reloadTime: 1.6,
    spreadBase: 0.35, range: 90, pellets: 1,
  },
  rifleUp: {
    slot: 1, name: 'Kestrel Long', label: 'Rifle', damage: 44, headshotBonus: true,
    interval: 0.115, automatic: true, mag: 30, reserve: 90, reloadTime: 1.6,
    spreadBase: 0.22, range: 110, pellets: 1,
  },
  pistol: {
    slot: 2, name: 'Wren', label: 'Pistol', damage: 34, headshotBonus: true,
    interval: 0.17, automatic: false, mag: 12, reserve: 60, reloadTime: 1.1,
    spreadBase: 0.5, range: 60, pellets: 1,
  },
  knife: {
    slot: 3, name: 'Field', label: 'Knife', damage: 55, headshotBonus: false,
    interval: 0.45, automatic: false, mag: Infinity, reserve: Infinity, reloadTime: 0,
    spreadBase: 0, range: 1.7, pellets: 0,
  },
  grenade: {
    slot: 4, name: 'Frag', label: 'Grenade', damage: 90, headshotBonus: false,
    interval: 0.8, automatic: false, mag: 1, reserve: 0, reloadTime: 0,
    spreadBase: 0, range: 0, pellets: 0,
  },
};

export function weaponDef(f) {
  if (f.slot === 1) return f.rifleUpgraded ? WEAPONS.rifleUp : WEAPONS.rifle;
  if (f.slot === 2) return WEAPONS.pistol;
  if (f.slot === 3) return WEAPONS.knife;
  return WEAPONS.grenade;
}

// Per-fighter ammunition state, reset each round by the round director.
export function freshLoadout(f) {
  return {
    slot: 1,
    mag: { 1: WEAPONS.rifle.mag, 2: WEAPONS.pistol.mag },
    reserve: { 1: WEAPONS.rifle.reserve, 2: WEAPONS.pistol.reserve },
    reloadingUntil: 0,
    nextShotAt: 0,
    shotsBurst: 0,
    lastShotAt: -9,
  };
}

// --- View-models (blueprint section 8: boxes and cylinders, Ink family, Signal trim) ---

const MAT = {
  dark: new THREE.MeshStandardMaterial({ color: 0x2b3042, roughness: 0.8, metalness: 0.1 }),
  mid: new THREE.MeshStandardMaterial({ color: 0x4a5068, roughness: 0.8, metalness: 0.1 }),
  deep: new THREE.MeshStandardMaterial({ color: 0x151b30, roughness: 0.85, metalness: 0.1 }),
  blade: new THREE.MeshStandardMaterial({ color: 0xdde3f0, roughness: 0.35, metalness: 0.6 }),
  glove: new THREE.MeshStandardMaterial({ color: 0xd5d9e6, roughness: 0.9, metalness: 0 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x30384f, roughness: 0.9, metalness: 0 }),
  trim: new THREE.MeshBasicMaterial({ color: PAL.signal }),
  frag: new THREE.MeshStandardMaterial({ color: 0x3a4057, roughness: 0.7, metalness: 0.2 }),
};

function bx(parent, mat, w, h, d, x, y, z, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.z = rz;
  parent.add(m);
  return m;
}

function buildHands(group, gripZ) {
  // Two box gloves and forearms (blueprint section 8).
  bx(group, MAT.glove, 0.07, 0.07, 0.16, 0.05, -0.06, gripZ);
  bx(group, MAT.glove, 0.07, 0.07, 0.14, -0.09, -0.075, gripZ + 0.14);
  const armR = bx(group, MAT.sleeve, 0.08, 0.08, 0.3, 0.1, -0.13, gripZ + 0.22);
  armR.rotation.x = 0.5;
  const armL = bx(group, MAT.sleeve, 0.08, 0.08, 0.3, -0.13, -0.14, gripZ + 0.3);
  armL.rotation.x = 0.5;
  bx(group, MAT.trim, 0.085, 0.02, 0.085, 0.1, -0.115, gripZ + 0.13);
}

// A muzzle flash: two crossed star planes and a small sphere (blueprint section 8),
// hidden until the frame loop shows it for 50ms after a shot.
function buildFlash() {
  const flash = new THREE.Group();
  const core = new THREE.MeshBasicMaterial({ color: PAL.flashCore, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const outer = new THREE.MeshBasicMaterial({ color: PAL.flashOuter, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.045), outer);
  const s2 = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.045), outer);
  s2.rotation.z = Math.PI / 2;
  const s3 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), core);
  s3.rotation.y = Math.PI / 2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), core);
  flash.add(s1, s2, s3, ball);
  flash.visible = false;
  return flash;
}

export function buildViewModel(slot) {
  const g = new THREE.Group();
  if (slot === 1) {
    bx(g, MAT.dark, 0.09, 0.11, 0.55, 0, 0, -0.1);            // receiver
    bx(g, MAT.mid, 0.07, 0.08, 0.28, 0, 0.01, -0.5);          // handguard
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8), MAT.deep);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.78); g.add(barrel);
    bx(g, MAT.deep, 0.05, 0.04, 0.07, 0, 0.02, -0.9);         // muzzle brake
    bx(g, MAT.deep, 0.04, 0.16, 0.07, 0, -0.13, -0.12, 0);    // magazine
    g.children[g.children.length - 1].rotation.x = -0.21;
    bx(g, MAT.dark, 0.06, 0.1, 0.22, 0, -0.01, 0.28);         // stock
    bx(g, MAT.deep, 0.02, 0.05, 0.02, 0, 0.09, 0.05);         // rear sight
    bx(g, MAT.deep, 0.015, 0.04, 0.015, 0, 0.085, -0.6);      // front sight
    bx(g, MAT.trim, 0.092, 0.012, 0.4, 0, 0.058, -0.12);      // Signal stripe
    buildHands(g, -0.42);
    const flash = buildFlash();
    flash.position.set(0, 0.02, -0.98);
    g.add(flash);
    g.userData.flash = flash;
    g.position.set(0.22, -0.2, -0.45);
  } else if (slot === 2) {
    bx(g, MAT.mid, 0.04, 0.05, 0.19, 0, 0.02, -0.05);         // slide
    bx(g, MAT.dark, 0.035, 0.06, 0.15, 0, -0.02, -0.02);      // frame
    const grip = bx(g, MAT.dark, 0.04, 0.11, 0.06, 0, -0.08, 0.05);
    grip.rotation.x = 0.21;
    bx(g, MAT.deep, 0.02, 0.02, 0.03, 0, 0.03, -0.16);        // barrel nub
    bx(g, MAT.trim, 0.01, 0.01, 0.01, 0, 0.05, -0.14);        // Signal dot sight
    buildHands(g, -0.02);
    const flash = buildFlash();
    flash.position.set(0, 0.03, -0.2);
    flash.scale.setScalar(0.6);
    g.add(flash);
    g.userData.flash = flash;
    g.position.set(0.18, -0.17, -0.38);
  } else if (slot === 3) {
    const blade = bx(g, MAT.blade, 0.025, 0.012, 0.2, 0, 0, -0.2);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.06, 4), MAT.blade);
    tip.rotation.x = -Math.PI / 2; tip.rotation.y = Math.PI / 4;
    tip.position.set(0, 0, -0.33); g.add(tip);
    bx(g, MAT.dark, 0.03, 0.03, 0.11, 0, -0.01, -0.03);       // handle
    bx(g, MAT.trim, 0.032, 0.032, 0.015, 0, -0.01, -0.06);   // wrap rings
    bx(g, MAT.trim, 0.032, 0.032, 0.015, 0, -0.01, -0.005);
    buildHands(g, 0.02);
    g.position.set(0.2, -0.18, -0.4);
    void blade;
  } else {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), MAT.frag);
    body.position.set(0, -0.02, -0.15); body.scale.y = 1.25; g.add(body);
    bx(g, MAT.deep, 0.02, 0.05, 0.02, 0, 0.06, -0.15);        // fuse head
    bx(g, MAT.trim, 0.058, 0.012, 0.058, 0, 0.005, -0.15);
    buildHands(g, -0.05);
    g.position.set(0.2, -0.18, -0.4);
  }
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

// --- Pooled effects: tracers, muzzle flashes, impact cubes ---

const TRACER_MAX = 24;
const tracerPool = [];
let tracerIdx = 0;
const PARTICLE_MAX = 90;
const particlePool = [];
let particleIdx = 0;

export function initEffects(scene) {
  const tGeom = new THREE.BoxGeometry(0.015, 0.015, 6);
  const tMat = new THREE.MeshBasicMaterial({ color: PAL.tracer });
  for (let i = 0; i < TRACER_MAX; i += 1) {
    const m = new THREE.Mesh(tGeom, tMat);
    m.visible = false;
    scene.add(m);
    tracerPool.push({ mesh: m, until: 0 });
  }
  const pGeom = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  for (let i = 0; i < PARTICLE_MAX; i += 1) {
    const m = new THREE.Mesh(pGeom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    m.visible = false;
    scene.add(m);
    particlePool.push({ mesh: m, vel: new THREE.Vector3(), until: 0, born: 0 });
  }
}

const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function spawnTracer(from, to) {
  const t = tracerPool[tracerIdx]; tracerIdx = (tracerIdx + 1) % TRACER_MAX;
  if (!t) return;
  _mid.copy(from).add(to).multiplyScalar(0.5);
  t.mesh.position.copy(_mid);
  t.mesh.lookAt(to);
  const len = from.distanceTo(to);
  t.mesh.scale.set(1, 1, Math.max(0.1, len / 6));
  t.mesh.visible = true;
  t.until = state.time + 0.08;
}

export function spawnImpact(point, colorHex, count = 5) {
  for (let i = 0; i < count; i += 1) {
    const p = particlePool[particleIdx]; particleIdx = (particleIdx + 1) % PARTICLE_MAX;
    if (!p) return;
    p.mesh.position.copy(point);
    p.mesh.material.color.setHex(colorHex);
    p.vel.set((Math.random() - 0.5) * 2.4, Math.random() * 2.2, (Math.random() - 0.5) * 2.4);
    p.born = state.time;
    p.until = state.time + 0.25;
    p.mesh.visible = true;
  }
}

export function stepEffects(dt) {
  for (const t of tracerPool) if (t.mesh.visible && state.time > t.until) t.mesh.visible = false;
  for (const p of particlePool) {
    if (!p.mesh.visible) continue;
    if (state.time > p.until) { p.mesh.visible = false; continue; }
    p.vel.y -= 6 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
  }
}

// --- Firing ---

const _origin = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _hitPoint = new THREE.Vector3();

// Segment vs a fighter's body capsule and head sphere; returns { dist, group } or null.
function rayFighter(origin, dir, f) {
  const crouch = f.crouch;
  const headY = f.pos.y + (crouch ? 1.22 : 1.58);
  const bodyTop = f.pos.y + (crouch ? 1.1 : 1.4);
  const bodyBot = f.pos.y + 0.2;
  let best = null;
  // Head sphere, radius 0.17.
  _dir.copy(origin); _dir.x -= f.pos.x; _dir.y -= headY; _dir.z -= f.pos.z;
  const b = _dir.dot(dir);
  const c = _dir.lengthSq() - 0.17 * 0.17;
  const disc = b * b - c;
  if (disc > 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0) best = { dist: t, group: 'head' };
  }
  // Body: vertical segment, radius 0.34; group by height fraction.
  const ox = origin.x - f.pos.x, oz = origin.z - f.pos.z;
  const a2 = dir.x * dir.x + dir.z * dir.z;
  if (a2 > 1e-8) {
    const t = -(ox * dir.x + oz * dir.z) / a2;
    if (t > 0 && (!best || t < best.dist)) {
      const px = origin.x + dir.x * t - f.pos.x;
      const pz = origin.z + dir.z * t - f.pos.z;
      if (px * px + pz * pz < 0.34 * 0.34) {
        const hy = origin.y + dir.y * t;
        if (hy >= bodyBot - 0.1 && hy <= bodyTop + 0.05) {
          const frac = (hy - f.pos.y) / (crouch ? 1.3 : 1.8);
          const group = frac > 0.78 ? 'chest' : frac > 0.5 ? 'stomach' : 'legs';
          best = { dist: t, group };
        }
      }
    }
  }
  return best;
}

// Current spread in radians for a fighter firing def, from stance and movement.
export function currentSpread(f, def) {
  const speed = Math.hypot(f.vel.x, f.vel.z);
  let deg = def.spreadBase;
  deg += (speed / 4.5) * 1.7;                    // firing on the move is punished
  if (!f.onGround) deg += 3;                     // firing in the air is wild
  if (f.crouch) deg *= 0.65;                     // crouching steadies the shot
  deg += Math.min(0.9, f.loadout.shotsBurst * 0.11); // sustained fire blooms
  return (deg * Math.PI) / 180;
}

// Fire one shot for fighter f along its aim. Handles ammo, spread, hit resolution,
// tracers and impacts. Returns true when a shot actually left the weapon.
export function fireOnce(f, rng) {
  const def = weaponDef(f);
  const lo = f.loadout;
  if (state.time < lo.nextShotAt || state.time < lo.reloadingUntil) return false;
  if (def.slot === 3) { // knife swing
    lo.nextShotAt = state.time + def.interval;
    pushEvent({ type: 'swing', fighter: f });
    let best = null;
    for (const t of state.fighters) {
      if (t === f || !t.alive || t.team === f.team) continue;
      const d = Math.hypot(t.pos.x - f.pos.x, t.pos.z - f.pos.z);
      if (d < def.range + 0.3 && Math.abs(t.pos.y - f.pos.y) < 1.6) {
        _aim.set(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize();
        _dir.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
        if (_aim.dot(_dir) > 0.5 && (!best || d < best.d)) best = { t, d };
      }
    }
    if (best) damageFighter(best.t, def.damage, 'chest', f);
    return true;
  }
  if (def.slot === 4) return false; // grenades are thrown by throwGrenade
  if (lo.mag[def.slot] <= 0) {
    lo.nextShotAt = state.time + 0.3;
    pushEvent({ type: 'empty', fighter: f });
    return false;
  }
  lo.mag[def.slot] -= 1;
  lo.nextShotAt = state.time + def.interval;
  if (state.time - lo.lastShotAt > 0.35) lo.shotsBurst = 0;
  lo.lastShotAt = state.time;
  lo.shotsBurst += 1;

  // Aim direction from yaw and pitch, perturbed by spread (seeded rng for bots,
  // Math.random for the player: the sim never replays, only the dossier must match).
  const spread = currentSpread(f, def);
  const rand = rng || Math.random;
  const yaw = f.yaw + (rand() - 0.5) * 2 * spread;
  const pitch = f.pitch + (rand() - 0.5) * 2 * spread + (f.isPlayer ? 0 : 0);
  _aim.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
  _origin.set(f.pos.x, f.pos.y + (f.crouch ? 1.28 : 1.62), f.pos.z);

  const wallDist = rayHitDistance(_origin.x, _origin.y, _origin.z, _aim.x, _aim.y, _aim.z, def.range);
  let bestHit = null;
  for (const t of state.fighters) {
    if (t === f || !t.alive || t.team === f.team) continue;
    const hit = rayFighter(_origin, _aim, t);
    if (hit && hit.dist < wallDist && (!bestHit || hit.dist < bestHit.dist)) bestHit = { ...hit, target: t };
  }
  const dist = bestHit ? bestHit.dist : wallDist;
  _hitPoint.copy(_origin).addScaledVector(_aim, dist);
  // Muzzle position, roughly at the weapon tip.
  _dir.copy(_origin).addScaledVector(_aim, 0.7); _dir.y -= 0.12;
  if (lo.shotsBurst % 3 === 1 || dist < 8) spawnTracer(_dir.clone(), _hitPoint.clone());
  if (bestHit) {
    const falloff = dist > 25 ? Math.max(0.55, 1 - (dist - 25) / 120) : 1;
    const killed = damageFighter(bestHit.target, Math.round(def.damage * falloff), bestHit.group, f);
    spawnImpact(_hitPoint, bestHit.target.team === 'tide' ? 0x3d8bff : 0xff8a2b, 4);
    pushEvent({ type: 'hit', attacker: f, target: bestHit.target, group: bestHit.group, killed });
  } else if (wallDist < def.range) {
    spawnImpact(_hitPoint, 0xd9d2cc, 5);
  }
  pushEvent({ type: 'shot', fighter: f, def });
  // Recoil: the view kicks up; the player controller eases it back.
  f.recoil = Math.min(1.6, (f.recoil || 0) + (def.slot === 1 ? 0.5 : 0.35));
  return true;
}

export function startReload(f) {
  const def = weaponDef(f);
  const lo = f.loadout;
  if (def.reloadTime === 0 || lo.mag[def.slot] >= def.mag || lo.reserve[def.slot] <= 0) return false;
  if (state.time < lo.reloadingUntil) return false;
  lo.reloadingUntil = state.time + def.reloadTime;
  lo.reloadEndsAt = lo.reloadingUntil;
  lo.reloadSlot = def.slot;
  pushEvent({ type: 'reload', fighter: f });
  return true;
}

export function finishReloads() {
  for (const f of state.fighters) {
    const lo = f.loadout;
    if (lo.reloadEndsAt && state.time >= lo.reloadEndsAt) {
      const def = f.rifleUpgraded && lo.reloadSlot === 1 ? WEAPONS.rifleUp : WEAPONS[lo.reloadSlot === 1 ? 'rifle' : 'pistol'];
      const need = def.mag - lo.mag[lo.reloadSlot];
      const take = Math.min(need, lo.reserve[lo.reloadSlot]);
      lo.mag[lo.reloadSlot] += take;
      lo.reserve[lo.reloadSlot] -= take;
      lo.reloadEndsAt = 0;
    }
  }
}

// --- Grenades: a small pooled set of live projectiles ---

const grenades = [];
export function throwGrenade(f, scene) {
  if (f.grenades <= 0) return false;
  f.grenades -= 1;
  f.loadout.nextShotAt = state.time + WEAPONS.grenade.interval;
  const dir = new THREE.Vector3(-Math.sin(f.yaw) * Math.cos(f.pitch + 0.25), Math.sin(f.pitch + 0.25), -Math.cos(f.yaw) * Math.cos(f.pitch + 0.25)).normalize();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), MAT.frag);
  mesh.position.set(f.pos.x, f.pos.y + 1.5, f.pos.z);
  scene.add(mesh);
  grenades.push({
    mesh,
    vel: dir.multiplyScalar(16).add(new THREE.Vector3(f.vel.x, 1.5, f.vel.z)),
    fuse: state.time + 1.4,
    owner: f,
  });
  pushEvent({ type: 'throw', fighter: f });
  return true;
}

export function stepGrenades(scene, explodeFn) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    const dt = 1 / 60;
    g.vel.y -= 14 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    const p = g.mesh.position;
    if (p.y < 0.06) { p.y = 0.06; g.vel.y *= -0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
    if (state.time >= g.fuse) {
      explodeFn(p.x, p.y, p.z, 6.5, WEAPONS.grenade.damage, g.owner);
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}
