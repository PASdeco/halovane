// Synthesised sound with WebAudio: no audio files ship with the game (blueprint
// section 10). Short filtered noise bursts and sine ticks stand in for gunfire,
// hits, reloads and the charge. Everything is guarded: no context, no sound.

import { state } from './state.js';

let ctx = null;
let master = null;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = (state.settings.volume / 100) * 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function setVolume(v) {
  state.settings.volume = v;
  if (master) master.gain.value = (v / 100) * 0.5;
}

function noiseBurst(dur, freq, gain, type = 'lowpass') {
  if (!ctx) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < n; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start();
}

function tick(freq, dur, gain, type = 'sine') {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.connect(g); g.connect(master);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

export const sfx = {
  shot(near) { noiseBurst(0.11, near ? 2600 : 900, near ? 0.5 : 0.12); },
  pistol(near) { noiseBurst(0.08, near ? 3000 : 1100, near ? 0.4 : 0.1); },
  swing() { noiseBurst(0.06, 5000, 0.08, 'highpass'); },
  empty() { tick(1400, 0.04, 0.1, 'square'); },
  hit() { tick(2100, 0.05, 0.16, 'square'); },
  headshot() { tick(2800, 0.07, 0.2, 'square'); },
  kill() { tick(880, 0.12, 0.2); setTimeout(() => tick(1320, 0.14, 0.18), 60); },
  hurt() { noiseBurst(0.09, 500, 0.25); },
  reload() { tick(500, 0.05, 0.12, 'square'); setTimeout(() => tick(700, 0.05, 0.12, 'square'), 350); },
  buy() { tick(990, 0.06, 0.15); },
  click() { tick(660, 0.04, 0.1); },
  plantBeep() { tick(1175, 0.07, 0.15, 'square'); },
  planted() { tick(784, 0.15, 0.2, 'square'); setTimeout(() => tick(784, 0.15, 0.2, 'square'), 200); },
  explosion() { noiseBurst(0.5, 220, 0.7); },
  throwIt() { noiseBurst(0.05, 3000, 0.06, 'highpass'); },
  roundWin() { tick(659, 0.14, 0.16); setTimeout(() => tick(880, 0.2, 0.16), 120); },
  roundLose() { tick(392, 0.14, 0.16); setTimeout(() => tick(330, 0.22, 0.16), 120); },
};
