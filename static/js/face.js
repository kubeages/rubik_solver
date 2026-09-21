// Reading one face of the cube at a time.
//
// This is a much easier problem than reading three faces at once from a
// corner: a face is a flat 3x3 grid, its stickers are big and all the same
// size, and there is no silhouette to find. We segment the sticker patches
// (the holes of the dark frame, which survives printed logos and shading),
// work out the two directions of the grid from the patches themselves, and
// place each patch in its row and column. No camera, no perspective fitting.

import { segmentHoles, segmentBlobs, smooth } from "./detect.js";

// Patches that belong to one flat 3x3 grid, arranged in rows and columns.
export function detectFace(data, w, h) {
  const shapes = new Uint8ClampedArray(data);
  smooth(shapes, w, h);
  let best = null;
  const minArea = Math.max(12, Math.round((w * h) / 4000));
  for (const width of [w / 22, w / 14, w / 9]) {
    const block = Math.max(6, Math.round(width));
    for (const patches of [
      segmentHoles(shapes, w, h, { colorFrom: data, block, thicken: 1, minArea }),
      segmentBlobs(shapes, w, h, { colorFrom: data, minArea }),
    ]) {
      const grid = arrangeGrid(patches, w, h);
      if (grid && (!best || grid.score > best.score)) best = grid;
    }
  }
  return best;
}

// Given candidate patches, find nine of them that sit on a 3x3 lattice.
function arrangeGrid(patches, w, h) {
  if (patches.length < 6) return null;
  // stickers of one face are all about the same size: take the commonest size
  const sizes = patches.map((p) => p.size).sort((a, b) => a - b);
  const median = sizes[sizes.length >> 1];
  const kept = patches.filter((p) => p.size > median * 0.6 && p.size < median * 1.7);
  if (kept.length < 6) return null;

  // the step between neighbours gives the two directions of the grid
  const steps = [];
  for (let i = 0; i < kept.length; i++) {
    for (let j = i + 1; j < kept.length; j++) {
      const dx = kept[j].cx - kept[i].cx, dy = kept[j].cy - kept[i].cy;
      const d = Math.hypot(dx, dy);
      if (d > median * 0.8 && d < median * 1.8) steps.push([dx, dy, d]);
    }
  }
  if (steps.length < 4) return null;
  let axisA = dominantDirection(steps, null);
  if (!axisA) return null;
  let axisB = dominantDirection(steps, axisA);
  if (!axisB) return null;
  // Put the axes in the picture's own order: the first going right, the
  // second going down. Otherwise the face comes out transposed or mirrored,
  // which reads every sticker into the wrong square.
  if (Math.abs(axisA[0]) < Math.abs(axisB[0])) { const t = axisA; axisA = axisB; axisB = t; }
  if (axisA[0] < 0) axisA = [-axisA[0], -axisA[1]];
  if (axisB[1] < 0) axisB = [-axisB[0], -axisB[1]];

  // project every patch on the two axes: that gives its row and column
  const det = axisA[0] * axisB[1] - axisA[1] * axisB[0];
  if (Math.abs(det) < 1e-6) return null;
  let bestGrid = null;
  for (const origin of kept) {
    const cells = new Map();
    for (const p of kept) {
      const dx = p.cx - origin.cx, dy = p.cy - origin.cy;
      const u = (dx * axisB[1] - dy * axisB[0]) / det;
      const v = (axisA[0] * dy - axisA[1] * dx) / det;
      const ru = Math.round(u), rv = Math.round(v);
      if (Math.abs(u - ru) > 0.28 || Math.abs(v - rv) > 0.28) continue;
      if (ru < -2 || ru > 2 || rv < -2 || rv > 2) continue;
      const key = `${ru},${rv}`;
      const prev = cells.get(key);
      const err = Math.hypot(u - ru, v - rv);
      if (!prev || err < prev.err) cells.set(key, { patch: p, u: ru, v: rv, err });
    }
    if (cells.size < 6) continue;
    // the 3x3 window that holds the most patches
    for (let u0 = -2; u0 <= 0; u0++) {
      for (let v0 = -2; v0 <= 0; v0++) {
        const picked = [];
        for (let du = 0; du < 3; du++) {
          for (let dv = 0; dv < 3; dv++) {
            const c = cells.get(`${u0 + du},${v0 + dv}`);
            if (c) picked.push({ ...c, row: dv, col: du });
          }
        }
        if (picked.length < 6) continue;
        const score = picked.length / 9 - picked.reduce((s, c) => s + c.err, 0) / 9;
        if (!bestGrid || score > bestGrid.score) {
          bestGrid = { score, picked, origin, axisA, axisB, u0, v0, median };
        }
      }
    }
  }
  if (!bestGrid) return null;

  // fill the cells that no patch covered, from where the grid says they are
  const cells = [];
  for (let row = 0; row < 3; row++) {
    cells.push([]);
    for (let col = 0; col < 3; col++) {
      const found = bestGrid.picked.find((c) => c.row === row && c.col === col);
      const u = bestGrid.u0 + col, v = bestGrid.v0 + row;
      const xy = [
        bestGrid.origin.cx + u * bestGrid.axisA[0] + v * bestGrid.axisB[0],
        bestGrid.origin.cy + u * bestGrid.axisA[1] + v * bestGrid.axisB[1],
      ];
      cells[row].push({
        xy: found ? [found.patch.cx, found.patch.cy] : xy,
        rgb: found ? found.patch.rgb : null,
        found: !!found,
      });
    }
  }
  return {
    cells,
    size: bestGrid.median,
    found: bestGrid.picked.length,
    score: bestGrid.score,
    axes: [bestGrid.axisA, bestGrid.axisB],
  };
}

// The commonest direction among the steps, optionally ignoring one already taken.
function dominantDirection(steps, avoid) {
  const bins = new Array(24).fill(null).map(() => []);
  for (const [dx, dy, d] of steps) {
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI;
    bins[Math.min(23, Math.floor((a / Math.PI) * 24))].push([dx, dy, d, a]);
  }
  const order = bins.map((v, i) => [v.length, i]).sort((x, y) => y[0] - x[0]);
  for (const [count, i] of order) {
    if (count < 2) break;
    const angle = ((i + 0.5) / 24) * Math.PI;
    if (avoid) {
      const avoidAngle = (Math.atan2(avoid[1], avoid[0]) + Math.PI) % Math.PI;
      let diff = Math.abs(angle - avoidAngle);
      diff = Math.min(diff, Math.PI - diff);
      if (diff < 0.5) continue;         // too close to the first direction
    }
    const list = bins[i];
    const mean = list.reduce((acc, [dx, dy]) => {
      const flip = dx * Math.cos(angle) + dy * Math.sin(angle) < 0 ? -1 : 1;
      acc[0] += dx * flip / list.length;
      acc[1] += dy * flip / list.length;
      return acc;
    }, [0, 0]);
    return mean;
  }
  return null;
}

// -- telling one face from another, whatever the light -------------------
//
// Comparing raw colours does not work. A white sticker read at 226 and, a
// moment later with the cube tilted towards a lamp, at 180, is 80 units
// apart: further than white is from yellow. So two readings of the same
// face look like different faces, and the same face gets scanned twice.
//
// What a change of light does NOT change is the *share* of red, green and
// blue in a colour (its chromaticity) and how bright a sticker is next to
// the brightest one on the same face. That is what we compare.

function stickerKey(rgb, maxLum) {
  const sum = Math.max(1, rgb[0] + rgb[1] + rgb[2]);
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return [rgb[0] / sum, rgb[1] / sum, lum / Math.max(1, maxLum)];
}

export function faceKeys(colors) {
  if (!colors || colors.length !== 9 || colors.some((c) => !c)) return null;
  const maxLum = Math.max(...colors.map((c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]));
  return colors.map((c) => stickerKey(c, maxLum));
}

const KEY_WEIGHT = [2.6, 2.6, 0.45];   // the colour's share matters, its brightness barely
function keyDistance(a, b) {
  return Math.hypot(
    KEY_WEIGHT[0] * (a[0] - b[0]),
    KEY_WEIGHT[1] * (a[1] - b[1]),
    KEY_WEIGHT[2] * (a[2] - b[2]));
}

const TURN = [6, 3, 0, 7, 4, 1, 8, 5, 2];   // the nine stickers after a quarter turn

// How badly two faces disagree, under the turn that suits them best. Three
// stickers are forgiven: a highlight or a shadow can spoil one or two of
// them, and one bad sticker must not hide the fact that it is the same face.
export function patternDistance(a, b) {
  let order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let best = Infinity;
  for (let t = 0; t < 4; t++) {
    const ds = a.map((k, i) => keyDistance(k, b[order[i]])).sort((p, q) => q - p);
    best = Math.min(best, ds[3]);          // the fourth worst of the nine
    order = TURN.map((j) => order[j]);
    if (best === 0) break;
  }
  return best;
}

// The centre alone, with both faces first put under the same light: each
// reading is divided by its own average colour (the grey-world assumption).
function balancedCentre(colors) {
  const mean = [0, 1, 2].map((k) => colors.reduce((s, c) => s + c[k], 0) / colors.length);
  return [0, 1, 2].map((k) => colors[4][k] / Math.max(1, mean[k]));
}

export function centreDistance(a, b) {
  const p = balancedCentre(a), q = balancedCentre(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// Chosen by measurement: over 7500 simulated scans with the light swinging
// from 0.6x to 1.3x and a warm/cold tint, no repeated face got through, and
// 2% of genuinely new faces were rejected (which the button undoes).
const SAME_PATTERN = 0.35;
const SAME_CENTRE = 0.14;

// Is this face one of the faces already scanned?  Returns the matching entry
// of `stored` ({ key, colors, ... }) or null. A cube has six faces of six
// different colours, so a face that matches one already stored is that one
// being shown again: it must not be recorded twice, or the cube comes out
// impossible at the end.
export function matchStored(colors, stored) {
  const keys = faceKeys(colors);
  if (!keys) return null;
  let best = null;
  for (const entry of stored) {
    const other = faceKeys(entry.colors);
    if (!other) continue;
    const pattern = patternDistance(keys, other);
    const centre = centreDistance(colors, entry.colors);
    const score = Math.min(pattern / SAME_PATTERN, centre / SAME_CENTRE);
    if (score < 1 && (!best || score < best.score)) best = { ...entry, score, pattern, centre };
  }
  return best;
}

function medianAt(data, w, h, x, y, r) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
  if (x1 <= x0 || y1 <= y0) return null;
  const rs = [], gs = [], bs = [];
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const k = (py * w + px) * 4;
    rs.push(data[k]); gs.push(data[k + 1]); bs.push(data[k + 2]);
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

// Reads one face over several frames, settling when the nine agree.
export class FaceReader {
  constructor({ votes = 3, tolerance = 40 } = {}) {
    this.votesNeeded = votes;
    this.tolerance = tolerance;
    this.reset();
  }

  reset() {
    this.votes = Array.from({ length: 9 }, () => []);
    this.settled = new Array(9).fill(null);
    this.lastGrid = null;
  }

  get read() { return this.settled.filter(Boolean).length; }
  get done() { return this.read === 9; }

  update(data, w, h) {
    const grid = detectFace(data, w, h);
    this.lastGrid = grid;
    if (!grid || grid.found < 5) {
      return { grid, read: this.read, message: "Enseña una cara entera, de frente y llenando el recuadro" };
    }
    grid.cells.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell.rgb) return;
      const i = r * 3 + c;
      const list = this.votes[i];
      list.push(cell.rgb);
      if (list.length > 6) list.shift();
      const agreed = this._consensus(list);
      if (agreed) this.settled[i] = agreed;
    }));
    const read = this.read;
    return {
      grid, read,
      message: read === 9 ? "Cara leída" : `Leídas ${read} de 9 · mantén la cara de frente`,
    };
  }

  _consensus(list) {
    let best = null;
    for (const pivot of list) {
      const close = list.filter((v) =>
        Math.hypot(v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]) < this.tolerance);
      if (close.length >= this.votesNeeded && (!best || close.length > best.length)) best = close;
    }
    if (!best) return null;
    return [0, 1, 2].map((k) => best.reduce((s, v) => s + v[k], 0) / best.length);
  }

  colors() {
    return this.settled.slice();
  }

  // Finish a face whose last sticker refuses to settle (a highlight sitting on
  // it, usually): read it where the grid says it is. Returns how many were
  // filled in, so the caller can say so.
  fillFromGrid(data, w, h) {
    const grid = this.lastGrid;
    if (!grid) return 0;
    let filled = 0;
    grid.cells.forEach((row, r) => row.forEach((cell, c) => {
      const i = r * 3 + c;
      if (this.settled[i]) return;
      const rgb = cell.rgb || medianAt(data, w, h, cell.xy[0], cell.xy[1], Math.max(2, grid.size * 0.22));
      if (!rgb) return;
      this.settled[i] = rgb;
      filled++;
    }));
    return filled;
  }
}
