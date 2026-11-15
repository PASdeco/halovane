// Halovane's handoff program for make.fun's threejs-fps-02 bounty (Node 22,
// standard library only). The game itself is the game/ folder beside this file:
// plain static files, ES modules, three.js 0.187.0 vendored under game/vendor.
// This program copies game/ and screenshots/ into the output directory and writes
// dossier.json there with the kit's vendored library, exactly as the gate expects:
// the scorer rebuilds the dossier from the output and compares it byte for byte.
//
// In the grader the output is /output; anywhere else, MAKEFUN_OUTPUT_DIR names it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with: node serve.ts  (then open http://localhost:8080)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps are the scorer's own (the gate's reference numbers): the dossier text is
// capped at 160 KiB, screenshots at 4 files of 256 KiB, the game at 993 files and
// 48 MiB, all inside the output's 1,000-entry, 64 MiB envelope.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
