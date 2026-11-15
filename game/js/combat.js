// Combat resolution shared by the player's weapons and the bots': damage with hit
// groups and armour, deaths, the kill feed, and the hooks the round director fills in.

import { state, pushEvent } from './state.js';
import { RULES } from './config.js';

export const hooks = { onKill: null, onDamage: null };

// Hit group multipliers (blueprint/judge: headshots matter).
export const HIT_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };

// Apply damage to a fighter. Returns true when the hit kills.
export function damageFighter(target, baseDamage, group, attacker) {
  if (!target.alive || state.phase === 'menu') return false;
  let dmg = baseDamage * (HIT_MULT[group] || 1);
  const armoured = target.armour > 0 && (group === 'chest' || group === 'stomach' || (group === 'head' && target.helmet));
  if (armoured) {
    target.armour = Math.max(0, target.armour - dmg * 0.5);
    dmg *= 0.5;
  }
  dmg = Math.round(dmg);
  target.hp -= dmg;
  target.lastAttacker = attacker;
  target.lastDamageAt = state.time;
  if (attacker) attacker.damageDealt += Math.min(dmg, target.hp + dmg);
  pushEvent({ type: 'damage', target, attacker, dmg, group });
  if (hooks.onDamage) hooks.onDamage(target, attacker, dmg, group);
  if (target.hp <= 0) {
    killFighter(target, attacker, group === 'head');
    return true;
  }
  return false;
}

export function killFighter(target, attacker, headshot) {
  target.alive = false;
  target.hp = 0;
  target.deaths += 1;
  target.deathAt = state.time;
  if (attacker && attacker !== target) {
    attacker.kills += 1;
    attacker.money = Math.min(RULES.maxMoney, attacker.money + RULES.rewardKill);
  }
  state.killFeed.push({ killer: attacker, victim: target, headshot, at: state.time });
  if (state.killFeed.length > 8) state.killFeed.shift();
  state.lastKillTime = state.time;
  pushEvent({ type: 'kill', target, attacker, headshot });
  if (hooks.onKill) hooks.onKill(target, attacker, headshot);
}

// Explosion damage (the frag grenade): falls off with distance, armour halves it.
export function explode(x, y, z, radius, maxDamage, owner) {
  pushEvent({ type: 'explosion', x, y, z });
  for (const f of state.fighters) {
    if (!f.alive) continue;
    const dx = f.pos.x - x, dy = f.pos.y + 0.9 - y, dz = f.pos.z - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) continue;
    const dmg = Math.round(maxDamage * (1 - d / radius) + 8);
    damageFighter(f, dmg, 'chest', owner === f ? null : owner);
  }
}
