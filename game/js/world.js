// Saltworks: the map from the design blueprint, section 7. Everything static is merged
// into a handful of draw calls: one vertex-coloured Lambert mesh for the shaded world,
// one basic-material mesh for signage. The same boxes that are drawn are registered as
// collision solids, so what you see is exactly what blocks you.
//
// Coordinates: x east, z south. Tide (attack) spawns south at Intake, Ember (defence)
// north at Boiler. Two sites: A (Brine Pans) north-west, B (Tank Farm) north-east,
// Conveyor down the middle, Pump House and Loading Dock as connectors, West Channel
// and East Ramp as the long flanks.

import * as THREE from 'three';
import { PAL, TEAMS } from './config.js';

export const solids = [];   // { minX, maxX, minZ, maxZ, baseY, topY }
export const ramps = [];    // { minX, maxX, minZ, maxZ, y0, y1, axis: 'x'|'z', dir: 1 }
const buckets = new Map();  // material key -> geometry list

function bucket(key) {
  if (!buckets.has(key)) buckets.set(key, []);
  return buckets.get(key);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function pushGeom(key, geom, x, y, z, ry = 0, color = null) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  if (color !== null) {
    _c.setHex(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  _e.set(0, ry, 0);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  bucket(key).push(g);
}

function solid(minX, maxX, minZ, maxZ, baseY, topY) {
  solids.push({ minX, maxX, minZ, maxZ, baseY, topY });
}

// A box in the shaded world. cy is the centre height. solidTop registers collision.
export function box(w, h, d, x, cy, z, color, opts = {}) {
  pushGeom('world', new THREE.BoxGeometry(w, h, d), x, cy, z, opts.ry || 0, color);
  if (opts.solidTop !== undefined) solid(x - w / 2, x + w / 2, z - d / 2, z + d / 2, cy - h / 2, opts.solidTop);
}

function basicBox(w, h, d, x, cy, z, color, ry = 0) {
  pushGeom('basic', new THREE.BoxGeometry(w, h, d), x, cy, z, ry, color);
}

function cyl(rt, rb, h, seg, x, cy, z, color, solidTop) {
  pushGeom('world', new THREE.CylinderGeometry(rt, rb, h, seg), x, cy, z, 0, color);
  if (solidTop !== undefined) solid(x - rt, x + rt, z - rt, z + rt, cy - h / 2, solidTop);
}

// A wall run along one axis with a 1m team band at its base (blueprint 7.2: the Split
// shown in space; Tide south, Ember north, neutral near Conveyor).
function wall(x0, z0, x1, z1, h = 4, color = PAL.plaster) {
  const w = Math.abs(x1 - x0) || 0.8;
  const d = Math.abs(z1 - z0) || 0.8;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  box(w, h, d, cx, h / 2, cz, color, { solidTop: h });
  const band = cz > 2 ? TEAMS.tide.deep : cz < -2 ? TEAMS.ember.deep : PAL.slateConcrete;
  const bw = w === 0.8 ? 0.92 : w, bd = d === 0.8 ? 0.92 : d;
  box(bw, 1, bd, cx, 0.5, cz, band, {});
}

function hazardStripe(x, z, len, alongX = true) {
  // Alternating 1m blocks of Signal and Hazard dark (blueprint 7.2).
  const n = Math.floor(len);
  for (let i = 0; i < n; i += 1) {
    const off = -len / 2 + i + 0.5;
    const col = i % 2 === 0 ? PAL.signal : PAL.hazardDark;
    if (alongX) basicBox(1, 0.12, 0.3, x + off, 0.06, z, col);
    else basicBox(0.3, 0.12, 1, x, 0.06, z + off, col);
  }
}

const LETTER_A = ['01110', '10001', '10001', '11111', '10001', '10001', '10001'];
const LETTER_B = ['11110', '10001', '10001', '11110', '10001', '10001', '11110'];

function letter(rows, cx, cz, wallZ) {
  // Block letters built from 0.6 cells on the wall (blueprint 7.2), Signal basic material.
  const cell = 0.6;
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 5; c += 1) {
      if (rows[r][c] !== '1') continue;
      basicBox(cell, cell, 0.15, cx + (c - 2) * cell, 0.3 + (6 - r) * cell + cell / 2, wallZ, PAL.signal);
    }
  }
}

function chevron(x, y, z, ry) {
  // Two thin boxes rotated to an arrow, Signal on a dark plate (blueprint 7.2).
  basicBox(1.5, 1.5, 0.1, x, y, z, PAL.hazardDark, ry);
  const g = new THREE.BoxGeometry(0.9, 0.22, 0.12);
  pushGeom('basic', g, x, y + 0.25, z, ry, PAL.signal);
  const g2 = new THREE.BoxGeometry(0.9, 0.22, 0.12);
  _e.set(0, ry, Math.PI / 2 - 0.0); // placeholder rotation handled below via matrix
  // Simpler: two angled bars via rotated boxes around z in local space is done by the
  // caller-facing group approach in buildWorld; here we draw a flat diamond marker.
  basicBox(0.5, 0.5, 0.12, x, y, z, PAL.signal, ry + Math.PI / 4);
}

export const siteZones = {
  A: { minX: -36, maxX: -16, minZ: -20, maxZ: -6, cx: -26, cz: -13 },
  B: { minX: 16, maxX: 36, minZ: -20, maxZ: -6, cx: 26, cz: -13 },
};

export const spawnPads = {
  tide: [[-6, 27], [-3, 28], [0, 27], [3, 28], [6, 27]],
  ember: [[-6, -27], [-3, -28], [0, -27], [3, -28], [6, -27]],
};

function buildGeometry(scene) {
  // Floors per area (blueprint 7.1 surface colours).
  const floor = (w, d, x, z, color) => box(w, 0.1, d, x, -0.05, z, color, {});
  floor(84, 64, 0, 0, PAL.saltFloor);
  floor(28, 12, 0, 26, PAL.intakeFloor);
  floor(28, 12, 0, -26, PAL.boilerFloor);
  floor(12, 40, 0, 0, PAL.slateConcrete);            // Conveyor strip
  floor(28, 24, -28, -14, PAL.saltFloor);            // Site A ground
  floor(28, 24, 28, -14, PAL.wetConcrete);           // Site B ground
  floor(8, 10, -10, -5, PAL.pumpFloor);              // Pump House
  floor(24, 20, -28, 10, PAL.saltFloor);             // West Channel
  floor(24, 20, 28, 10, PAL.slateConcrete);          // East Ramp

  // Perimeter walls, 6 high.
  wall(-42.5, -32.5, 42.5, -32.5, 6, PAL.plaster);
  wall(-42.5, 32.5, 42.5, 32.5, 6, PAL.plaster);
  wall(-42.5, -32.5, -42.5, 32.5, 6, PAL.plaster);
  wall(42.5, -32.5, 42.5, 32.5, 6, PAL.plaster);

  // The z=-20 divider (Boiler and sites from Conveyor), doors at A north, mid, B north.
  wall(-42, -20, -24, -20); wall(-19, -20, -6, -20); wall(6, -20, 19, -20); wall(24, -20, 42, -20);
  // x=-14 column (A from Boiler and Pump House), door to Pump House at z -8..-4.
  wall(-14, -32, -14, -8); wall(-14, -4, -14, 0);
  // x=14 column (B from Boiler and Dock), door to Dock at z -8..-4.
  wall(14, -32, 14, -8); wall(14, -4, 14, 0);
  // The z=0 line: A south door at x -30..-26, Pump door -13..-9, Dock door 9..13, B door 26..30.
  wall(-42, 0, -30, 0); wall(-26, 0, -13, 0); wall(-9, 0, 6, 0); wall(6, 0, 9, 0 - 0); wall(13, 0, 26, 0); wall(30, 0, 42, 0);
  // The z=20 line: West door -24..-20, Conveyor mouth -6..6, East door 20..24.
  wall(-42, 20, -24, 20); wall(-20, 20, -6, 20); wall(6, 20, 24 - 4, 20); wall(24, 20, 42, 20);
  // West Channel east wall, door at z 8..12. East Ramp west wall, same door.
  wall(-18, 0, -18, 8); wall(-18, 12, -18, 20);
  wall(18, 0, 18, 8); wall(18, 12, 18, 20);
  // Intake side walls.
  wall(-28, 20, -28, 32, 4, PAL.coolShed); wall(28, 20, 28, 32, 4, PAL.coolShed);

  // Conveyor belt: raised walkable top 0.9, ramps at both ends (blueprint 7.1).
  box(2.4, 0.9, 20, 0, 0.45, 0, PAL.slateConcrete, { solidTop: 0.9 });
  ramps.push({ minX: -1.2, maxX: 1.2, minZ: -13, maxZ: -10, y0: 0, y1: 0.9, axis: 'z', dir: -1 });
  ramps.push({ minX: -1.2, maxX: 1.2, minZ: 10, maxZ: 13, y0: 0, y1: 0.9, axis: 'z', dir: 1 });
  // Draw the ramps as sloped boxes (rotated around x).
  const rampGeomN = new THREE.BoxGeometry(2.4, 0.18, 3.4);
  const rgN = rampGeomN.index ? rampGeomN.toNonIndexed() : rampGeomN;
  _e.set(-Math.atan2(0.9, 3), 0, 0); _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(0, 0.42, -11.5), _q, new THREE.Vector3(1, 1, 1));
  rgN.applyMatrix4(_m); bucket('world').push(rgN);
  const rampGeomS = new THREE.BoxGeometry(2.4, 0.18, 3.4);
  const rgS = rampGeomS.index ? rampGeomS.toNonIndexed() : rampGeomS;
  _e.set(Math.atan2(0.9, 3), 0, 0); _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(0, 0.42, 11.5), _q, new THREE.Vector3(1, 1, 1));
  rgS.applyMatrix4(_m); bucket('world').push(rgS);
  hazardStripe(-1.5, 0, 20, false); hazardStripe(1.5, 0, 20, false);
  box(1.2, 1.2, 1.2, -0.0, 0.9 + 0.6, -2, PAL.crateA, { solidTop: 2.1 });
  box(1.2, 1.2, 1.2, 0.0, 0.9 + 0.6, 3, PAL.crateB, { solidTop: 2.1 });

  // Site A: brine pools, salt mound, corner crates, zone outline.
  box(7, 0.04, 5, -31, 0.02, -16, PAL.brine, {});
  box(6, 0.04, 4, -21, 0.02, -8, PAL.brine, {});
  pushGeom('world', new THREE.ConeGeometry(2.2, 1.1, 4), -18.5, 0.55, -17, Math.PI / 4, PAL.saltFloor);
  solid(-20.2, -16.8, -18.7, -15.3, 0, 1.1);
  box(2.4, 2.4, 2.4, -38, 1.2, -18, PAL.crateA, { solidTop: 2.4 });
  box(1.2, 1.2, 1.2, -38, 3.0, -18, PAL.crateB, {});
  box(2.4, 1.2, 2.4, -17, 0.6, -7, PAL.crateB, { solidTop: 1.2 });
  zoneOutline(siteZones.A);
  letter(LETTER_A, -26, 0, -19.5);

  // Site B: five tanks, gantry roof over the north half, crates.
  const tanks = [[20, -16], [28, -17], [34, -12], [22, -8], [31, -7.5]];
  for (const [tx, tz] of tanks) cyl(2.4, 2.4, 5, 14, tx, 2.5, tz, PAL.rust, 5);
  box(24, 0.3, 8, 26, 4.3, -16, PAL.slateConcrete, {}); // gantry roof, above head height
  box(2.4, 1.2, 2.4, 17.5, 0.6, -18, PAL.crateA, { solidTop: 1.2 });
  box(1.2, 1.2, 1.2, 36, 0.6, -18.5, PAL.crateB, { solidTop: 1.2 });
  zoneOutline(siteZones.B);
  letter(LETTER_B, 26, 0, -19.5);
  basicBox(1.2, 0.5, 0.3, 20, 3.4, -10, PAL.lamp);
  basicBox(1.2, 0.5, 0.3, 33, 3.4, -18, PAL.lamp);

  // Boiler: three boilers, pipes, lamps.
  cyl(1.4, 1.4, 3.6, 12, -8, 1.8, -27, PAL.rust, 3.6);
  cyl(1.4, 1.4, 3.6, 12, 0, 1.8, -28, PAL.rust, 3.6);
  cyl(1.4, 1.4, 3.6, 12, 8, 1.8, -27, PAL.rust, 3.6);
  box(16, 0.3, 0.3, 0, 3.3, -27, PAL.slateConcrete, {});
  basicBox(1.4, 0.5, 0.3, -5, 3.2, -24, PAL.lamp);
  basicBox(1.4, 0.5, 0.3, 5, 3.2, -24, PAL.lamp);

  // Pump House: two pumps, a manifold, an emissive window slot.
  box(1.6, 1.1, 1.2, -11, 0.55, -6, PAL.pumpMint, { solidTop: 1.1 });
  box(1.6, 1.1, 1.2, -8.5, 0.55, -3, PAL.pumpMint, { solidTop: 1.1 });
  box(0.25, 2.2, 3, -13.6, 1.1, -2, PAL.slateConcrete, {});
  basicBox(0.1, 0.5, 2.4, -13.9, 2.2, -5, PAL.chalk);

  // Loading Dock: raised platform 1.2 with a ramp from Conveyor, crates, roll door.
  box(6, 1.2, 8, 10, 0.6, -5, PAL.slateConcrete, { solidTop: 1.2 });
  ramps.push({ minX: 5.6, maxX: 7, minZ: -7, maxZ: -3, y0: 0, y1: 1.2, axis: 'x', dir: 1 });
  box(1.2, 1.2, 1.2, 11, 1.8, -7, PAL.crateB, { solidTop: 2.4 });
  box(2.4, 1.2, 1.2, 9, 1.8, -2.5, PAL.crateA, { solidTop: 2.4 });
  box(0.3, 3, 3.4, 13.8, 1.5, -5, PAL.wetConcrete, {});
  hazardStripe(10, -0.8, 6, true);

  // West Channel: cover crates and an overhead pipe.
  box(2.4, 2.4, 2.4, -33, 1.2, 6, PAL.crateA, { solidTop: 2.4 });
  box(2.4, 1.2, 2.4, -24, 0.6, 12, PAL.crateB, { solidTop: 1.2 });
  box(2.4, 2.4, 2.4, -35, 1.2, 17, PAL.crateB, { solidTop: 2.4 });
  box(0.36, 0.36, 20, -28, 3.4, 10, PAL.slateConcrete, {}); // an overhead pipe run

  // East Ramp: a ramp climbing to a 2m ledge over the lane.
  ramps.push({ minX: 22, maxX: 36, minZ: 6, maxZ: 16, y0: 0, y1: 2.0, axis: 'z', dir: -1 });
  const erGeom = new THREE.BoxGeometry(14, 0.2, 11);
  const er = erGeom.index ? erGeom.toNonIndexed() : erGeom;
  _e.set(Math.atan2(2.0, 10), 0, 0); _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(29, 0.95, 11), _q, new THREE.Vector3(1, 1, 1));
  er.applyMatrix4(_m); bucket('world').push(er);
  box(14, 2.0, 4, 29, 1.0, 4, PAL.slateConcrete, { solidTop: 2.0 });
  box(2.4, 1.2, 2.4, 24, 0.6, 17, PAL.crateA, { solidTop: 1.2 });

  // Intake: two concrete barriers and hazard gates.
  box(3, 1.1, 0.8, -5, 0.55, 23, PAL.slateConcrete, { solidTop: 1.1 });
  box(3, 1.1, 0.8, 5, 0.55, 23, PAL.slateConcrete, { solidTop: 1.1 });
  hazardStripe(-3, 20.4, 6, true); hazardStripe(3, 20.4, 6, true);

  // Chevrons above the lane mouths.
  chevron(0, 3, -19.4, 0); chevron(0, 3, 19.4, Math.PI);
  chevron(-21.5, 3, -19.4, 0); chevron(21.5, 3, -19.4, 0);

  // Merge buckets into two meshes.
  for (const [key, geoms] of buckets) {
    const merged = mergeGeoms(geoms);
    const mat = key === 'world'
      ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })
      : new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = key === 'world';
    mesh.receiveShadow = key === 'world';
    scene.add(mesh);
  }
}

function zoneOutline(z) {
  const t = 0.18;
  basicBox(z.maxX - z.minX, 0.03, t, z.cx, 0.02, z.minZ, PAL.signal);
  basicBox(z.maxX - z.minX, 0.03, t, z.cx, 0.02, z.maxZ, PAL.signal);
  basicBox(t, 0.03, z.maxZ - z.minZ, z.minX, 0.02, z.cz, PAL.signal);
  basicBox(t, 0.03, z.maxZ - z.minZ, z.maxX, 0.02, z.cz, PAL.signal);
}

function mergeGeoms(geoms) {
  let total = 0;
  for (const g of geoms) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let off = 0;
  for (const g of geoms) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    if (g.attributes.color) col.set(g.attributes.color.array, off * 3);
    else col.fill(1, off * 3, (off + n) * 3);
    off += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// The height of the floor under a point, given the height the body is coming from:
// standable surfaces are solids whose top is within a step (0.55) above the feet.
export function floorHeightAt(x, z, fromY) {
  let y = 0;
  for (const r of ramps) {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
    const span = r.axis === 'z' ? r.maxZ - r.minZ : r.maxX - r.minX;
    const t = r.axis === 'z' ? (r.dir > 0 ? (z - r.minZ) / span : (r.maxZ - z) / span) : (r.dir > 0 ? (x - r.minX) / span : (r.maxX - x) / span);
    const ry = r.y0 + (r.y1 - r.y0) * Math.min(1, Math.max(0, t));
    if (ry <= fromY + 0.55 && ry > y) y = ry;
  }
  for (const s of solids) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    if (s.topY <= fromY + 0.55 && s.topY > y && s.baseY <= fromY + 0.55) y = s.topY;
  }
  return y;
}

// Push a circle (radius r, feet at fy) out of every solid it overlaps.
export function collide(x, z, r, fy) {
  for (const s of solids) {
    if (s.topY <= fy + 0.55 || s.baseY >= fy + 1.7) continue;
    const nx = Math.max(s.minX, Math.min(x, s.maxX));
    const nz = Math.max(s.minZ, Math.min(z, s.maxZ));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    } else {
      // Centre inside the box: leave by the smallest exit.
      const left = x - s.minX, right = s.maxX - x, top = z - s.minZ, bot = s.maxZ - z;
      const m = Math.min(left, right, top, bot);
      if (m === left) x = s.minX - r;
      else if (m === right) x = s.maxX + r;
      else if (m === top) z = s.minZ - r;
      else z = s.maxZ + r;
    }
  }
  return [x, z];
}

const _box = new THREE.Box3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Does the straight segment a->b pass through any sight-blocking solid?
export function losBlocked(ax, ay, az, bx, by, bz) {
  _a.set(ax, ay, az); _b.set(bx, by, bz);
  const dir = _b.clone().sub(_a);
  const len = dir.length();
  if (len < 0.001) return false;
  dir.divideScalar(len);
  const ray = new THREE.Ray(_a, dir);
  for (const s of solids) {
    if (s.topY < 1.0) continue; // low cover never blocks sight at body height
    _box.min.set(s.minX, s.baseY, s.minZ);
    _box.max.set(s.maxX, s.topY, s.maxZ);
    const hit = ray.intersectBox(_box, new THREE.Vector3());
    if (hit && hit.distanceTo(_a) < len - 0.3) return true;
  }
  return false;
}

// Distance along the ray to the first wall or the ground, for tracers and impacts.
export function rayHitDistance(ox, oy, oz, dx, dy, dz, maxDist) {
  _a.set(ox, oy, oz);
  const ray = new THREE.Ray(_a, new THREE.Vector3(dx, dy, dz));
  let best = maxDist;
  for (const s of solids) {
    _box.min.set(s.minX, s.baseY, s.minZ);
    _box.max.set(s.maxX, s.topY, s.maxZ);
    const hit = ray.intersectBox(_box, new THREE.Vector3());
    if (hit) {
      const d = hit.distanceTo(_a);
      if (d > 0.05 && d < best) best = d;
    }
  }
  if (dy < -0.0001) {
    const t = -oy / dy;
    if (t > 0.05 && t < best) best = t;
  }
  return best;
}

// Waypoint graph for bot navigation: nodes on every lane, door and site, joined where
// a straight walk is not blocked by anything taller than a step.
export const NODES = [
  [-6, 27], [0, 27], [6, 27], [-12, 12], [0, 15], [12, 12], [-22, 20], [22, 20],
  [-34, 14], [-26, 10], [-19, 10], [19, 10], [26, 10], [33, 14], [-18, 10], [18, 10],
  [0, 6], [0, -4], [0, -14], [-28, 0.5], [-11, 1], [11, 1], [28, 0.5],
  [-26, -13], [-33, -9], [-18, -16], [-10, -5], [-21.5, -19], [0, -24], [-8, -23], [8, -23],
  [26, -13], [33, -16], [20, -8], [10, -5], [21.5, -19], [29, 4], [29, 12], [-24, 4],
];
export const EDGES = buildEdges();

function walkable(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.8));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = ax + dx * t, z = az + dz * t;
    const fy = floorHeightAt(x, z, 3);
    for (const s of solids) {
      if (s.baseY > fy + 1.2) continue;
      if (s.topY > fy + 0.6 && x > s.minX - 0.3 && x < s.maxX + 0.3 && z > s.minZ - 0.3 && z < s.maxZ + 0.3) return false;
    }
  }
  return true;
}

function buildEdges() {
  const edges = NODES.map(() => []);
  for (let i = 0; i < NODES.length; i += 1) {
    for (let j = i + 1; j < NODES.length; j += 1) {
      const d = Math.hypot(NODES[i][0] - NODES[j][0], NODES[i][1] - NODES[j][1]);
      if (d > 15) continue;
      if (!walkable(NODES[i][0], NODES[i][1], NODES[j][0], NODES[j][1])) continue;
      edges[i].push(j); edges[j].push(i);
    }
  }
  return edges;
}

export function nearestNode(x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const d = (NODES[i][0] - x) ** 2 + (NODES[i][1] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// A* over the waypoint graph; returns a list of [x, z] waypoints or [] when unreachable.
export function findPath(sx, sz, tx, tz) {
  const start = nearestNode(sx, sz), goal = nearestNode(tx, tz);
  if (start === goal) return [[tx, tz]];
  const open = new Set([start]);
  const came = new Map();
  const g = new Map([[start, 0]]);
  const h = (i) => Math.hypot(NODES[i][0] - NODES[goal][0], NODES[i][1] - NODES[goal][1]);
  const f = new Map([[start, h(start)]]);
  while (open.size) {
    let cur = -1, bf = Infinity;
    for (const i of open) if (f.get(i) < bf) { bf = f.get(i); cur = i; }
    if (cur === goal) {
      const path = [];
      let n = cur;
      while (n !== start) { path.push(NODES[n]); n = came.get(n); }
      path.reverse();
      path.push([tx, tz]);
      return path;
    }
    open.delete(cur);
    for (const nb of EDGES[cur]) {
      const ng = g.get(cur) + Math.hypot(NODES[cur][0] - NODES[nb][0], NODES[cur][1] - NODES[nb][1]);
      if (ng < (g.get(nb) ?? Infinity)) {
        came.set(nb, cur); g.set(nb, ng); f.set(nb, ng + h(nb)); open.add(nb);
      }
    }
  }
  return [[tx, tz]];
}

export function buildWorld(scene) {
  buildGeometry(scene);

  // Sky dome with vertex colours (blueprint 7.3).
  const skyGeom = new THREE.SphereGeometry(280, 24, 16);
  const pos = skyGeom.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const zen = new THREE.Color(PAL.skyZenith), mid = new THREE.Color(PAL.skyMid);
  const hor = new THREE.Color(PAL.skyHorizon), low = new THREE.Color(PAL.haze);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i) / 280;
    if (y > 0.25) tmp.copy(mid).lerp(zen, (y - 0.25) / 0.75);
    else if (y > -0.1) tmp.copy(hor).lerp(mid, (y + 0.1) / 0.35);
    else tmp.copy(low).lerp(hor, Math.min(1, (y + 0.5) / 0.4));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  skyGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  scene.add(sky);

  // The basin floor far beyond the walls, dissolving into haze.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshLambertMaterial({ color: PAL.haze }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  scene.add(ground);

  scene.fog = new THREE.Fog(PAL.haze, 30, 120);

  const sun = new THREE.DirectionalLight(0xffd9a8, 2.4);
  const az = (130 * Math.PI) / 180, el = (24 * Math.PI) / 180;
  sun.position.set(Math.sin(az) * Math.cos(el) * 90, Math.sin(el) * 90, Math.cos(az) * Math.cos(el) * 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xb8c8f2, 0x8b7f9e, 1.3));
  scene.add(new THREE.AmbientLight(0xfff2e0, 0.35));

  // The map's three point lights (blueprint 7.3 caps it at three).
  const lamp1 = new THREE.PointLight(PAL.lamp, 1.4, 14); lamp1.position.set(0, 3, -25); scene.add(lamp1);
  const lamp2 = new THREE.PointLight(PAL.lamp, 1.4, 14); lamp2.position.set(26, 3.2, -13); scene.add(lamp2);
  const lamp3 = new THREE.PointLight(PAL.lamp, 1.2, 12); lamp3.position.set(-10, 2.4, -5); scene.add(lamp3);
}
