// The HUD and every screen, as a DOM overlay above the canvas (blueprint section 6
// and the menu sections). This module only reads state and writes DOM; the round
// director owns the game, main.js owns input. Phase changes are watched here so
// banners, the buy menu and the match-end screen appear at the right moment.

import { state, Phase } from './state.js';
import { RULES, PRICES, TEAMS, areaAt } from './config.js';
import { weaponDef } from './weapons.js';

const $ = (id) => document.getElementById(id);
const els = {};
let handlers = {};
let lastPhase = '';
let lastArea = '';
let bannerTimer = null;
let feedBuilt = 0;

export function initHUD(h) {
  handlers = h;
  for (const id of ['menu', 'howto', 'settingsPanel', 'startPrompt', 'hud', 'buyPanel', 'pauseMenu',
    'scoreboard', 'matchEnd', 'banner', 'freezeCount', 'crosshair', 'hitmarker', 'healthNum',
    'healthBar', 'armourPlate', 'armourNum', 'armourBar', 'ammoMag', 'ammoReserve', 'weaponName',
    'timerText', 'roundLabel', 'scoreAzurite', 'scoreRealgar', 'pipsAzurite', 'pipsRealgar', 'killfeed',
    'reloadPrompt', 'locationLabel', 'locationDot', 'locationText', 'enemyName', 'confirmText',
    'dmgWedge', 'vignette', 'moneyText', 'channelWrap', 'channelLabel', 'channelFill',
    'objectiveText', 'spectateLabel', 'menuHint', 'pauseFooter', 'buyMoney']) {
    els[id] = $(id);
  }
  // Menu wiring.
  $('btnPlay').addEventListener('click', () => handlers.onPlay && handlers.onPlay());
  $('btnHowto').addEventListener('click', () => showPanel('howto'));
  $('btnSettings').addEventListener('click', () => showPanel('settings'));
  $('btnHowtoBack').addEventListener('click', () => showPanel(null));
  $('btnSettingsBack').addEventListener('click', () => showPanel(null));
  $('btnSettingsSave').addEventListener('click', () => { saveSettings(); showPanel(null); });
  $('btnStart').addEventListener('click', () => handlers.onLock && handlers.onLock());
  $('btnResume').addEventListener('click', () => handlers.onResume && handlers.onResume());
  $('btnPauseSettings').addEventListener('click', () => showPanel('settings', true));
  $('btnQuit').addEventListener('click', () => handlers.onQuit && handlers.onQuit());
  $('btnAgain').addEventListener('click', () => handlers.onPlayAgain && handlers.onPlayAgain());
  $('btnToMenu').addEventListener('click', () => handlers.onQuit && handlers.onQuit());
  const hints = { btnPlay: 'Start a match', btnHowto: 'Controls and round rules', btnSettings: 'Sensitivity and volume' };
  for (const [id, text] of Object.entries(hints)) {
    $(id).addEventListener('mouseenter', () => { els.menuHint.textContent = text; });
    $(id).addEventListener('focus', () => { els.menuHint.textContent = text; });
  }
  // Settings sliders preview live and persist on save.
  const sens = $('sensSlider'), vol = $('volSlider');
  sens.value = state.settings.sensitivity;
  vol.value = state.settings.volume;
  $('sensVal').textContent = sens.value;
  $('volVal').textContent = `${vol.value}%`;
  sens.addEventListener('input', () => { $('sensVal').textContent = sens.value; handlers.onSensitivity && handlers.onSensitivity(Number(sens.value)); });
  vol.addEventListener('input', () => { $('volVal').textContent = `${vol.value}%`; handlers.onVolume && handlers.onVolume(Number(vol.value)); });
  // Buy rows.
  document.querySelectorAll('.buy-row').forEach((row) => {
    row.addEventListener('click', () => handlers.onBuy && handlers.onBuy(row.dataset.item));
  });
  buildPips();
}

function saveSettings() {
  state.settings.sensitivity = Number($('sensSlider').value);
  state.settings.volume = Number($('volSlider').value);
  try {
    localStorage.setItem('halovane-settings', JSON.stringify(state.settings));
  } catch { /* offline file: settings simply do not persist */ }
  handlers.onSaveSettings && handlers.onSaveSettings();
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem('halovane-settings');
    if (raw) {
      const s = JSON.parse(raw);
      if (s.sensitivity) state.settings.sensitivity = s.sensitivity;
      if (s.volume !== undefined) state.settings.volume = s.volume;
    }
  } catch { /* first run */ }
  state.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function showPanel(which, fromPause = false) {
  els.howto.classList.toggle('hidden', which !== 'howto');
  els.settingsPanel.classList.toggle('hidden', which !== 'settings');
  if (which === 'settings') {
    $('sensSlider').value = state.settings.sensitivity;
    $('volSlider').value = state.settings.volume;
    $('sensVal').textContent = state.settings.sensitivity;
    $('volVal').textContent = `${state.settings.volume}%`;
  }
  void fromPause;
}

export function showScreen(name) {
  els.menu.classList.toggle('hidden', name !== 'menu');
  els.hud.classList.toggle('hidden', name !== 'game');
  els.matchEnd.classList.toggle('hidden', name !== 'matchEnd');
  els.startPrompt.classList.add('hidden');
  if (name === 'menu') showPanel(null);
}

export function showStartPrompt() { els.startPrompt.classList.remove('hidden'); }
export function hideStartPrompt() { els.startPrompt.classList.add('hidden'); }
export function setPausedUI(on) {
  els.pauseMenu.classList.toggle('hidden', !on);
  if (on) {
    els.pauseFooter.textContent = `Round ${state.round}    Azurite ${state.scores.azurite}    Realgar ${state.scores.realgar}`;
  }
}

function buildPips() {
  for (const [el, team] of [[els.pipsAzurite, 'azurite'], [els.pipsRealgar, 'realgar']]) {
    el.innerHTML = '';
    for (let i = 0; i < RULES.teamSize; i += 1) {
      const s = document.createElement('span');
      s.className = `pip ${team}`;
      el.appendChild(s);
    }
  }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function showBanner(kind, title, sub, holdMs = 2000) {
  const b = els.banner;
  b.className = `banner show ${kind}`;
  $('bannerTitle').textContent = title;
  $('bannerSub').textContent = sub;
  $('bannerSplit').style.display = kind === 'matchwin' || kind === 'matchlose' ? 'block' : 'none';
  if (bannerTimer) clearTimeout(bannerTimer);
  // In a staged screenshot the banner holds, like the tracer and the flash:
  // a wall-clock timer could expire before the capture's first frame lands.
  bannerTimer = state.staged ? null : setTimeout(() => { b.classList.remove('show'); }, holdMs);
}

// Events from the simulation: kill feed rows, hit markers, damage feedback, sounds
// are main.js's job; this renders the visual side.
export function handleEvent(ev) {
  const p = state.player;
  if (ev.type === 'kill') {
    addFeedRow(ev);
    if (p && ev.attacker === p) showConfirm(ev);
  }
  if (ev.type === 'hit' && p && ev.attacker === p) flashHitmarker(ev.group === 'head', ev.killed);
  if (ev.type === 'damage' && p && ev.target === p && ev.attacker && ev.attacker !== p) {
    showDamageWedge(ev.attacker);
    pulseVignette(Math.min(0.65, 0.15 + (ev.dmg / 100) * 0.5));
  }
  if (ev.type === 'planted') showBanner('info', 'Charge planted', `Site ${ev.site} — stop the defuse`, 1800);
  if (ev.type === 'channel' && ev.fighter === undefined) void 0;
}

function addFeedRow(ev) {
  const row = document.createElement('div');
  row.className = 'feed-row';
  const k = ev.attacker;
  const killerName = k ? k.name : 'The charge';
  const killerTeam = k ? k.team : ev.target.team === 'azurite' ? 'realgar' : 'azurite';
  row.innerHTML = `<span class="fname ${killerTeam}">${killerName}</span><span class="bullet ${ev.target.team}"></span><span class="fname ${ev.target.team}">${ev.target.name}</span>${ev.headshot ? '<span class="hs"></span>' : ''}`;
  if (k === state.player || ev.target === state.player) row.classList.add('mine');
  els.killfeed.appendChild(row);
  while (els.killfeed.children.length > 5) els.killfeed.removeChild(els.killfeed.firstChild);
  setTimeout(() => row.classList.add('fade'), 4500);
  setTimeout(() => row.remove(), 5100);
}

let hitTimer = null;
function flashHitmarker(head, killed) {
  els.hitmarker.className = `show ${head ? 'head' : ''} ${killed ? 'kill' : ''}`;
  if (hitTimer) clearTimeout(hitTimer);
  hitTimer = setTimeout(() => { els.hitmarker.className = ''; }, killed ? 200 : 140);
}

let confirmTimer = null;
function showConfirm(ev) {
  els.confirmText.textContent = `Eliminated ${ev.target.name}`;
  els.confirmText.classList.add('show');
  if (confirmTimer) clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => els.confirmText.classList.remove('show'), 900);
}

let wedgeTimer = null;
function showDamageWedge(attacker) {
  const p = state.player;
  const bearing = Math.atan2(-(attacker.pos.x - p.pos.x), -(attacker.pos.z - p.pos.z));
  let rel = bearing - p.yaw;
  els.dmgWedge.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
  els.dmgWedge.classList.add('show');
  if (wedgeTimer) clearTimeout(wedgeTimer);
  wedgeTimer = setTimeout(() => els.dmgWedge.classList.remove('show'), 1000);
}

let vigTimer = null;
function pulseVignette(alpha) {
  els.vignette.style.opacity = String(alpha);
  if (vigTimer) clearTimeout(vigTimer);
  vigTimer = setTimeout(() => { els.vignette.style.opacity = '0'; }, 600);
}

// Per-frame refresh: numbers, pips, chips, timer, location, channel bar, phase UI.
export function updateHUD() {
  const p = state.player;
  if (!p) return;
  // Phase-driven screens.
  if (state.phase !== lastPhase) {
    onPhaseChange(lastPhase, state.phase);
    lastPhase = state.phase;
  }
  if (els.hud.classList.contains('hidden')) return;

  els.healthNum.textContent = Math.max(0, Math.ceil(p.hp));
  els.healthNum.classList.toggle('low', p.hp <= 25);
  els.healthBar.style.width = `${Math.max(0, p.hp)}%`;
  els.healthBar.classList.toggle('low', p.hp <= 25);
  els.armourPlate.style.display = p.armour > 0 ? 'block' : 'none';
  els.armourNum.textContent = Math.ceil(p.armour);
  els.armourBar.style.width = `${p.armour}%`;

  const def = weaponDef(p);
  const mag = p.loadout.mag[def.slot];
  els.weaponName.textContent = def.slot === 4 ? `Frag × ${p.grenades}` : def.name;
  els.ammoMag.textContent = def.slot === 3 ? '—' : def.slot === 4 ? p.grenades : mag;
  els.ammoReserve.textContent = def.slot === 1 || def.slot === 2 ? p.loadout.reserve[def.slot] : '';
  els.ammoMag.classList.toggle('low', def.mag !== Infinity && mag <= def.mag * 0.3);
  for (let s = 1; s <= 4; s += 1) {
    const chip = $(`chip${s}`);
    if (chip) chip.classList.toggle('active', p.slot === s);
  }
  const gChip = $('chip4');
  if (gChip) gChip.querySelector('.chip-count').textContent = p.grenades;
  els.moneyText.textContent = `$${p.money}`;

  const clock = state.phase === Phase.PLANTED ? state.detonateClock : state.roundClock;
  els.timerText.textContent = state.phase === Phase.BUY ? fmtTime(state.phaseTime) : fmtTime(clock);
  els.timerText.classList.toggle('urgent', (state.phase === Phase.LIVE || state.phase === Phase.PLANTED) && clock <= 10);
  els.roundLabel.textContent = state.phase === Phase.BUY ? 'Buy phase' : state.phase === Phase.PLANTED ? 'Charge planted' : `Round ${state.round}`;
  els.scoreAzurite.textContent = state.scores.azurite;
  els.scoreRealgar.textContent = state.scores.realgar;
  updatePips(els.pipsAzurite, 'azurite');
  updatePips(els.pipsRealgar, 'realgar');

  const showReload = p.alive && (def.slot === 1 || def.slot === 2) && mag === 0;
  const lowAmmo = p.alive && (def.slot === 1 || def.slot === 2) && mag > 0 && mag <= def.mag * 0.3 && p.loadout.reserve[def.slot] > 0;
  els.reloadPrompt.textContent = showReload ? 'Press R to reload' : lowAmmo ? 'Press R to reload' : '';
  els.reloadPrompt.className = showReload ? 'blink' : '';

  // Location label.
  const spectator = !p.alive ? spectateFighter() : p;
  const area = areaAt(spectator.pos.x, spectator.pos.z);
  const areaName = area ? area.name : 'Halbeck Works';
  if (areaName !== lastArea) {
    lastArea = areaName;
    els.locationText.textContent = areaName;
    els.locationDot.style.background = area ? area.css : '#A3ACC6';
    els.locationLabel.classList.remove('fadein');
    void els.locationLabel.offsetWidth;
    els.locationLabel.classList.add('fadein');
  }
  els.objectiveText.textContent = objectiveLine();
  els.spectateLabel.style.display = !p.alive && state.phase !== Phase.MATCH_END ? 'block' : 'none';
  if (!p.alive) {
    const t = spectateFighter();
    els.spectateLabel.textContent = t ? `Spectating ${t.name}` : 'Spectating';
  }

  // Freeze countdown number.
  if (state.phase === Phase.FREEZE) {
    els.freezeCount.textContent = Math.ceil(state.phaseTime);
    els.freezeCount.classList.add('show');
  } else {
    els.freezeCount.classList.remove('show');
  }
  // Channel bar (the player is never the planter, but a defuse cannot happen for
  // Azurite; the bar also mirrors a nearby teammate's channel for feedback).
  const ch = state.planting;
  if (ch && (state.phase === Phase.LIVE || state.phase === Phase.PLANTED)) {
    els.channelWrap.classList.remove('hidden');
    els.channelLabel.textContent = ch.kind === 'plant' ? `${ch.fighter.name} is planting the charge` : `${ch.fighter.name} is defusing`;
    els.channelFill.style.width = `${Math.round(ch.progress * 100)}%`;
  } else {
    els.channelWrap.classList.add('hidden');
  }
  // Buy panel contents.
  if (state.phase === Phase.BUY || state.phase === Phase.FREEZE) refreshBuy(p);
  // Low-health vignette.
  if (p.alive && p.hp <= 25) els.vignette.style.opacity = '0.25';
  else if (!vigTimer || els.vignette.style.opacity === '0.25') els.vignette.style.opacity = '0';
}

function spectateFighter() {
  return state.teamFighters('azurite').find((f) => f.alive && !f.isPlayer) || state.player;
}

function objectiveLine() {
  if (state.phase === Phase.BUY) return `Buy gear — Azurite attacks Site ${state.targetSite || 'A'}`;
  if (state.phase === Phase.PLANTED) return `Charge planted at Site ${state.plantedSite} — hold the site`;
  if (state.phase === Phase.LIVE || state.phase === Phase.FREEZE) {
    const carrier = state.fighters.find((f) => f.id === state.chargeCarrier);
    return carrier ? `${carrier.name} carries the charge to Site ${state.targetSite}` : `Eliminate Realgar or plant at Site ${state.targetSite}`;
  }
  return '';
}

function updatePips(el, team) {
  const fighters = state.teamFighters(team);
  [...el.children].forEach((pip, i) => {
    pip.classList.toggle('dead', fighters[i] ? !fighters[i].alive : true);
  });
}

function refreshBuy(p) {
  els.buyMoney.textContent = `$${p.money}`;
  document.querySelectorAll('.buy-row').forEach((row) => {
    const item = row.dataset.item;
    const owned = (item === 'armour' && p.armour >= 100) || (item === 'helmet' && p.helmet)
      || (item === 'rifleUpgrade' && p.rifleUpgraded) || (item === 'grenade' && p.grenades >= 2);
    row.classList.toggle('owned', owned);
    row.classList.toggle('cant', !owned && p.money < PRICES[item]);
    row.querySelector('.buy-state').textContent = owned ? 'Owned' : `$${PRICES[item]}`;
  });
}

function onPhaseChange(prev, next) {
  if (next === Phase.BUY) {
    els.buyPanel.classList.remove('hidden');
    els.killfeed.innerHTML = '';
    feedBuilt = 0;
  } else if (next === Phase.LIVE || next === Phase.FREEZE) {
    els.buyPanel.classList.add('hidden');
  }
  if (next === Phase.FREEZE) showBanner('round', `Round ${state.round}`, 'Eliminate the other team', 1500);
  if (next === Phase.ROUND_END) {
    const won = state.roundWinner === 'azurite';
    const verb = state.winReason === 'detonation' ? 'Charge detonated' : state.winReason === 'defuse' ? 'Charge defused' : state.winReason === 'time' ? 'Time expired' : '';
    if (state.scores.azurite >= RULES.winTarget || state.scores.realgar >= RULES.winTarget || state.round >= RULES.maxRounds) {
      // Match end screen comes with the MATCH_END phase; the banner is the short form.
      showBanner(won ? 'matchwin' : 'matchlose', won ? 'Victory' : 'Defeat', `Azurite ${state.scores.azurite} — Realgar ${state.scores.realgar}`, 2400);
    } else {
      showBanner(won ? 'won' : 'lost', won ? 'Round won' : 'Round lost',
        `${verb ? `${verb} — ` : ''}${TEAMS[state.roundWinner].name} lead ${Math.max(state.scores.azurite, state.scores.realgar)} to ${Math.min(state.scores.azurite, state.scores.realgar)}`.replace('lead', state.scores.azurite === state.scores.realgar ? 'tied' : 'lead'), 2200);
    }
  }
  if (next === Phase.MATCH_END) buildMatchEnd();
}

function buildMatchEnd() {
  const won = state.scores.azurite > state.scores.realgar;
  $('endTitle').textContent = won ? 'Victory' : 'Defeat';
  $('endTitle').style.color = won ? TEAMS.azurite.css : TEAMS.realgar.css;
  $('endScore').innerHTML = `<span class="win">Azurite ${state.scores.azurite}</span>   <span class="lose">Realgar ${state.scores.realgar}</span>`;
  for (const team of ['azurite', 'realgar']) {
    const body = $(`endTable-${team}`);
    body.innerHTML = '';
    const rows = state.teamFighters(team).slice().sort((a, b) => b.kills - a.kills);
    for (const f of rows) {
      const tr = document.createElement('tr');
      if (f.isPlayer) tr.className = 'me';
      tr.innerHTML = `<td>${f.name}</td><td>${f.kills}</td><td>${f.deaths}</td><td>${Math.round(f.damageDealt)}</td>`;
      body.appendChild(tr);
    }
  }
  showScreen('matchEnd');
}

// The Tab scoreboard mirrors the match-end tables with live numbers.
export function setScoreboardVisible(on) {
  els.scoreboard.classList.toggle('hidden', !on);
  if (!on) return;
  for (const team of ['azurite', 'realgar']) {
    const body = $(`tabTable-${team}`);
    body.innerHTML = '';
    const rows = state.teamFighters(team).slice().sort((a, b) => b.kills - a.kills);
    for (const f of rows) {
      const tr = document.createElement('tr');
      if (f.isPlayer) tr.className = 'me';
      tr.innerHTML = `<td>${f.name}</td><td>${f.kills}</td><td>${f.deaths}</td><td>${Math.round(f.damageDealt)}</td>`;
      body.appendChild(tr);
    }
  }
  $('tabScore').textContent = `Azurite ${state.scores.azurite} — Realgar ${state.scores.realgar} · Round ${state.round}`;
}

// Crosshair: spread in pixels and whether it sits on an enemy.
export function setCrosshair(spreadPx, hot) {
  els.crosshair.style.setProperty('--gap', `${spreadPx}px`);
  els.crosshair.classList.toggle('hot', hot);
}

// Name of the enemy under the crosshair (blueprint 6.2).
export function setEnemyName(name) {
  els.enemyName.textContent = name || '';
}
