// Reading one face of the cube at a time.
//
// This is a much easier problem than reading three faces at once from a
// corner: a face is a flat 3x3 grid, its stickers are big and all the same
// size, and there is no silhouette to find. We segment the sticker patches
// (the holes of the dark frame, which survives printed logos and shading),
// work out the two directions of the grid from the patches themselves, and
// place each patch in its row and column. No camera, no perspective fitting.

import { segmentHoles, segmentBlobs, smooth, diffuseColor } from "./detect.js";
import { t } from "./i18n.js";

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

function toLab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  let Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  let Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

// Each sticker described in Lab, after bringing the whole face to a common
// exposure: the middle sticker's brightness is the yardstick (the brightest
// is too often a reflection), so a face read in the shade and the same face
// read in the sun describe themselves alike.
export function faceKeys(colors) {
  if (!colors || colors.length !== 9 || colors.some((c) => !c)) return null;
  const lums = colors.map((c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]);
  const reference = Math.max(1, lums.slice().sort((a, b) => a - b)[4]);
  const k = 140 / reference;
  return colors.map((c) => toLab(c.map((v) => Math.min(255, v * k))));
}

// The same comparison the colour classifier uses, and for the same reason:
// on photos of the real cube, a face turned to the window loses brightness
// and strength of colour but keeps its hue. Hue counts in full, lightness and
// chroma for less. Divided by 100 so the numbers stay near the old scale.
function keyDistance(a, b) {
  const c1 = Math.hypot(a[1], a[2]), c2 = Math.hypot(b[1], b[2]);
  let dh = Math.atan2(a[2], a[1]) - Math.atan2(b[2], b[1]);
  if (dh > Math.PI) dh -= 2 * Math.PI;
  if (dh < -Math.PI) dh += 2 * Math.PI;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(dh / 2);
  return Math.hypot(0.35 * (a[0] - b[0]), 0.6 * (c1 - c2), dH) / 100;
}

const TURN = [6, 3, 0, 7, 4, 1, 8, 5, 2];   // the nine stickers after a quarter turn

// How far apart two faces are: the average over the nine stickers, under the
// turn that suits them best.
//
// The average, and not "the worst sticker, forgiving a few". That was the
// first try and it let repeats through on a cube whose red and orange are
// close and whose stickers catch the light: a highlight washes a sticker
// towards white, and a rule that looks only at the worst ones is then reading
// the highlights instead of the face. Averaged, the spoiled ones are outvoted
// by the rest, while two genuinely different faces disagree nearly everywhere
// and stay far apart. The single worst sticker is dropped first, so one badly
// read sticker cannot drag a face away from itself either; measured, that one
// change is what makes the same threshold fit both kinds of trouble.
export function patternDistance(a, b) {
  let order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let best = Infinity;
  for (let t = 0; t < 4; t++) {
    const ds = a.map((k, i) => keyDistance(k, b[order[i]])).sort((p, q) => q - p);
    best = Math.min(best, ds.slice(1).reduce((x, y) => x + y, 0) / 8);
    order = TURN.map((j) => order[j]);
  }
  return best;
}

// How close two readings have to be before they are called the same face.
// Measured with the light swinging from 0.6x to 1.3x and tinted warm and
// cold. The looser number is for the check at the end, where the answer is a
// question to the user rather than a decision taken behind their back.
const SAME_FACE = 0.18;              // with a single stored face to compare
const SAME_FACE_LOOSE = 0.24;        // the last look at the end
const SURELY_THE_SAME = 0.08;        // no argument at this distance
const CLOSER_THAN_THE_NEXT = 0.62;   // ...or this much nearer than the runner-up

// Is this face one of the faces already scanned?  Returns the matching entry
// of `stored` ({ face, name, colors }) or null. A cube has six faces of six
// different colours, so a face that matches one already stored is that one
// being shown again: it must not be recorded twice, or the cube comes out
// impossible at the end.
//
// The distance on its own cannot decide this, because how far apart two
// different faces look depends on the cube and the light. Point a phone at a
// face of a single colour and its white balance pulls that colour towards
// grey, so on a cube with a face already solved every solid face comes back
// washed out and they all look alike. Measured on such a cube, a fixed
// threshold called a third of the new faces repeats, which is the scanner
// refusing to move on.
//
// What decides it instead is the runner-up. A face being shown again is much
// nearer to the one it repeats than to any other stored face, whatever the
// light has done to the colours; a new face is more or less equally unlike
// all of them. That comparison needs no number chosen in advance, and on a
// solved cube it cut the repeats that slipped through from 10% to 3% while
// refusing 1% of new faces; with the hue-based comparison below, 0.7% and
// 0.7%.
export function matchStored(colors, stored, limit = SAME_FACE) {
  const keys = faceKeys(colors);
  if (!keys) return null;
  const ranked = [];
  for (const entry of stored) {
    const other = faceKeys(entry.colors);
    if (other) ranked.push({ entry, distance: patternDistance(keys, other) });
  }
  if (!ranked.length) return null;
  ranked.sort((a, b) => a.distance - b.distance);
  const [best, next] = ranked;
  if (best.distance < SURELY_THE_SAME) return { ...best.entry, distance: best.distance };
  if (!next) return best.distance < limit ? { ...best.entry, distance: best.distance } : null;
  const near = best.distance < CLOSER_THAN_THE_NEXT * next.distance;
  return near && best.distance < limit
    ? { ...best.entry, distance: best.distance }
    : null;
}

// Last look before the cube is handed over: six faces, six colours. If two of
// them are the same face, one was recorded twice in spite of everything, and
// the cube will be impossible on the next screen. Better to notice here and
// ask for that one again. Returns the two entries, the later one first.
//
// This one does not use a threshold. With all six faces in hand there are
// fifteen pairs to look at, and asking fifteen times "are these two closer
// than X?" gets a wrong yes far too often: at a 5% chance each, half the good
// scans would be sent back. So the pairs are compared with each other
// instead: a face recorded twice is not merely close to its twin, it is far
// closer than any other pair of faces on that cube. That ratio is the same
// whatever the cube's colours or the light. Measured, at 0.45 it never
// queried a good scan and caught two thirds to four fifths of the repeats
// that got past the check during scanning.
const CLEARLY_CLOSER = 0.45;

export function repeatedPair(stored) {
  if (stored.length < 4) return null;          // too few pairs to compare with
  const keys = stored.map((entry) => faceKeys(entry.colors));
  if (keys.some((k) => !k)) return null;
  const pairs = [];
  for (let i = 0; i < stored.length; i++) {
    for (let j = i + 1; j < stored.length; j++) {
      pairs.push({ i, j, distance: patternDistance(keys[i], keys[j]) });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const [closest, next] = pairs;
  if (closest.distance > SAME_FACE_LOOSE) return null;
  if (closest.distance > CLEARLY_CLOSER * next.distance) return null;
  return [stored[closest.j], stored[closest.i]];     // the later one first
}

// The colour where the grid says a sticker is, when no patch was found there.
//
// This one has to survive being slightly off target. Land half on the black
// frame and the darkest pixels are the frame, not the sticker; land under a
// reflection and the brightest are the lamp. Both tails are therefore thrown
// away and the middle is kept. Reading the frame by mistake is not a small
// error: it came out as a nearly black centre, and a centre is the colour of
// a whole face, so one bad sample was turning six faces into nonsense.
function medianAt(data, w, h, x, y, r) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
  if (x1 <= x0 || y1 <= y0) return null;
  const rs = [], gs = [], bs = [];
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const k = (py * w + px) * 4;
    rs.push(data[k]); gs.push(data[k + 1]); bs.push(data[k + 2]);
  }
  const n = rs.length;
  if (!n) return null;
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => (0.299 * rs[a] + 0.587 * gs[a] + 0.114 * bs[a]) -
                    (0.299 * rs[b] + 0.587 * gs[b] + 0.114 * bs[b]));
  const keep = order.slice(Math.floor(n * 0.30), Math.max(1, Math.ceil(n * 0.75)));
  const mid = (arr) => {
    const v = keep.map((i) => arr[i]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const lum = (i) => 0.299 * rs[i] + 0.587 * gs[i] + 0.114 * bs[i];
  const spread = lum(order[Math.floor(n * 0.9)]) - lum(order[Math.floor(n * 0.1)]);
  return { rgb: [mid(rs), mid(gs), mid(bs)], spread };
}

// ...and where exactly to take it. The point the grid gives is a guess, and
// when only six of the nine stickers were found the guess can land on the
// black frame between two of them. A frame reading is not a small error: it
// came back as a nearly black centre, and a centre is the colour of a whole
// face, so one bad sample turned the whole cube to nonsense. So a few nearby
// spots are tried and the most uniform one wins, because the inside of a
// sticker is flat and the frame never is.
function sampleCell(data, w, h, x, y, size) {
  const step = Math.max(1, size * 0.20);
  const r = Math.max(2, size * 0.24);
  let best = null;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const got = medianAt(data, w, h, x + dx * step, y + dy * step, r);
      if (!got) continue;
      const penalty = got.spread + (dx || dy ? 3 : 0);   // prefer where the grid said
      if (!best || penalty < best.penalty) best = { ...got, penalty };
    }
  }
  return best ? best.rgb : null;
}

// Is that colour a sticker at all?
//
// Two things on a cube are not stickers: the black frame between them, and
// the lamp reflected in the plastic. Both were being recorded as if they
// were colours. A frame read as a centre renames a whole face, which is how
// a solved green face came back as a mixture. Rather than fixing it later,
// such a reading is refused: the sticker stays unread, the user is asked to
// move the cube a little, and the reflection moves with it.
//
// The test is against the face's own stickers, not against fixed numbers,
// because a cube in the shade is darker everywhere.
function plausible(grid) {
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const found = grid.cells.flat().filter((c) => c.rgb).map((c) => lum(c.rgb)).sort((a, b) => a - b);
  if (found.length < 4) return () => true;
  const middle = found[found.length >> 1];
  // The frame is far darker than any sticker: the darkest colour on a cube is
  // blue, at about a third of the brightness of white, while the frame is
  // around a tenth. A quarter of the middle sticker separates them without
  // ever throwing away a blue one.
  //
  // Only darkness is tested. Refusing bright samples as reflections was tried
  // too and had to come out again: a white sticker under a strong light
  // clips the sensor exactly as a reflection does, so the rule threw away
  // real whites and made the reading worse than leaving the highlights in.
  return (rgb) => lum(rgb) >= middle * 0.25;
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
    this.forced = new Set();     // read under protest: a reflection sat on them
    this.lastGrid = null;
  }

  get read() { return this.settled.filter(Boolean).length; }
  get done() { return this.read === 9; }

  update(data, w, h) {
    const grid = detectFace(data, w, h);
    this.lastGrid = grid;
    if (!grid || grid.found < 5) {
      return { grid, read: this.read, message: t("read.show_face") };
    }
    const believable = plausible(grid);
    grid.cells.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell.rgb || !believable(cell.rgb)) return;
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
      message: read === 9 ? t("read.done") : t("read.progress", { n: read }),
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

  // Which of the nine we are not sure about.
  doubtful() {
    return [...this.forced];
  }

  // Finish a face whose last sticker refuses to settle (a highlight sitting on
  // it, usually): read it where the grid says it is. Returns how many were
  // filled in, so the caller can say so.
  fillFromGrid(data, w, h) {
    const grid = this.lastGrid;
    if (!grid) return 0;
    const believable = plausible(grid);
    let filled = 0;
    grid.cells.forEach((row, r) => row.forEach((cell, c) => {
      const i = r * 3 + c;
      if (this.settled[i]) return;
      const rgb = cell.rgb || sampleCell(data, w, h, cell.xy[0], cell.xy[1], grid.size);
      if (!rgb) return;
      // By now the user has been waiting, and a reflection that will not move
      // should not hold up the whole scan. The reading is taken, but it is
      // written down as doubtful so that what depends on it can weigh it
      // less and the review can point at it.
      //
      // Anything read off the grid, where no sticker was actually seen, is
      // doubtful too. The usual reason a sticker is not seen is a finger over
      // it, and skin is the worst colour there is to misread: measured on
      // photos of the real cube held in a real hand, 11 of 13 skin samples
      // came out nearest to red. Weighed at a quarter, the other stickers of
      // its piece outvote it.
      if (!cell.rgb || !believable(rgb)) this.forced.add(i);
      this.settled[i] = rgb;
      filled++;
    }));
    return filled;
  }
}
