// Reading the cube from two pictures.
//
// Each picture shows three faces with one corner pointing at the camera.
// Seven handles (that corner plus the six outer corners of the hexagonal
// silhouette) define three quadrilaterals; a homography per face maps the
// 3x3 sticker grid into the picture, so perspective is handled.  The 54
// samples are then clustered around the six centre colours with a balanced
// assignment (every colour appears exactly nine times).

import { COLORS, COLOR_KEYS } from "./cubemodel.js";

const NS = "http://www.w3.org/2000/svg";
const HANDLE_VEC = {
  C: [1, 1, 1], T: [-1, 1, -1], UR: [1, 1, -1], LR: [1, -1, -1], B: [1, -1, 1], LL: [-1, -1, 1], UL: [-1, 1, 1],
};
const VEC_HANDLE = Object.fromEntries(Object.entries(HANDLE_VEC).map(([k, v]) => [v.join(","), k]));
const HANDLE_ANGLE = { T: -90, UR: -30, LR: 30, B: 90, LL: 150, UL: 210 };

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

// homography mapping the unit square (0,0),(1,0),(1,1),(0,1) onto p0..p3
function squareToQuad(p0, p1, p2, p3) {
  const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0], dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1];
  const sx = p0[0] - p1[0] + p2[0] - p3[0], sy = p0[1] - p1[1] + p2[1] - p3[1];
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = p1[0] - p0[0] + g * p1[0], b = p3[0] - p0[0] + h * p3[0], c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1], e = p3[1] - p0[1] + h * p3[1], f = p0[1];
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

function matVec(M, v) {
  return [0, 1, 2].map((r) => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]);
}

function det3(M) {
  return M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
}

// all 24 rotation matrices of the cube
function rotations() {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let r = 0; r < 3; r++) M[r][p[r]] = (s >> r) & 1 ? -1 : 1;
    if (det3(M) === 1) out.push(M);
  }
  return out;
}

const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Second picture: any rotation that brings the hidden corner (-1,-1,-1) to the camera.
const VIEW2_ROTATIONS = rotations()
  .filter((M) => matVec(M, [-1, -1, -1]).join(",") === "1,1,1")
  // prefer "former bottom face now on top"
  .sort((A, B) => (matVec(B, [0, -1, 0])[1] - matVec(A, [0, -1, 0])[1]));

// Where each visible sticker of a view lands in the picture.
// Returns [{key, xy}] for the 27 stickers of a view, key = view-frame "pos|normal".
function viewPoints(model, handles) {
  const pts = [];
  for (const { pos, normal } of model.stickers) {
    const axis = normal.findIndex((v) => v === 1);
    if (axis < 0) continue; // only faces with outward normal +x, +y or +z are visible
    const [i, j] = [0, 1, 2].filter((k) => k !== axis);
    const corner = (si, sj) => {
      const v = [0, 0, 0];
      v[axis] = 1; v[i] = si; v[j] = sj;
      return handles[VEC_HANDLE[v.join(",")]];
    };
    const H = squareToQuad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    const u = (pos[i] + 1.5) / 3, v = (pos[j] + 1.5) / 3;
    pts.push({ key: pos.join(",") + "|" + normal.join(","), xy: H(u, v), u, v, axis });
  }
  return pts;
}

function gridLines(model, handles) {
  // 4 lines per direction per face, as polylines in picture coordinates
  const lines = [];
  for (const axis of [0, 1, 2]) {
    const [i, j] = [0, 1, 2].filter((k) => k !== axis);
    const corner = (si, sj) => {
      const v = [0, 0, 0];
      v[axis] = 1; v[i] = si; v[j] = sj;
      return handles[VEC_HANDLE[v.join(",")]];
    };
    const H = squareToQuad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    for (let k = 0; k <= 3; k++) {
      lines.push([H(k / 3, 0), H(k / 3, 1)]);
      lines.push([H(0, k / 3), H(1, k / 3)]);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// colour science
// ---------------------------------------------------------------------------

function srgbToLab([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  let Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  let Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = f(X); Y = f(Y); Z = f(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

function labDist(a, b) {
  // lightness varies a lot with shading, so it weighs less than hue
  return Math.hypot(0.55 * (a[0] - b[0]), a[1] - b[1], a[2] - b[2]);
}

function samplePatch(ctx, x, y, r, w, h) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
  if (x1 <= x0 || y1 <= y0) return [128, 128, 128];
  const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  const rs = [], gs = [], bs = [];
  for (let k = 0; k < data.length; k += 4) { rs.push(data[k]); gs.push(data[k + 1]); bs.push(data[k + 2]); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

// samples: {id: rgb}; centreIds: six ids that are centres -> {id: colourKey}
export function classify(samples, centreIds) {
  const ids = Object.keys(samples);
  const lab = Object.fromEntries(ids.map((id) => [id, srgbToLab(samples[id])]));
  let means = centreIds.map((id) => lab[id]);
  let assign = {};
  for (let iter = 0; iter < 3; iter++) {
    // balanced greedy assignment: nine stickers per cluster, centres fixed
    assign = {};
    const count = [0, 0, 0, 0, 0, 0];
    centreIds.forEach((id, k) => { assign[id] = k; count[k]++; });
    const pairs = [];
    for (const id of ids) {
      if (id in assign) continue;
      for (let k = 0; k < 6; k++) pairs.push([labDist(lab[id], means[k]), id, k]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [, id, k] of pairs) {
      if (id in assign || count[k] >= 9) continue;
      assign[id] = k; count[k]++;
    }
    // pairwise swaps while they lower the total cost
    let improved = true, guard = 0;
    const free = ids.filter((id) => !centreIds.includes(id));
    while (improved && guard++ < 50) {
      improved = false;
      for (let a = 0; a < free.length; a++) for (let b = a + 1; b < free.length; b++) {
        const A = free[a], B = free[b], p = assign[A], q = assign[B];
        if (p === q) continue;
        const now = labDist(lab[A], means[p]) + labDist(lab[B], means[q]);
        const swapped = labDist(lab[A], means[q]) + labDist(lab[B], means[p]);
        if (swapped + 1e-9 < now) { assign[A] = q; assign[B] = p; improved = true; }
      }
    }
    // move the cluster centres to the mean of their members
    means = [0, 1, 2, 3, 4, 5].map((k) => {
      const mem = ids.filter((id) => assign[id] === k).map((id) => lab[id]);
      return [0, 1, 2].map((c) => mem.reduce((s, v) => s + v[c], 0) / mem.length);
    });
  }
  // name the clusters: the permutation of colour names with the lowest cost
  let best = null;
  const permute = (arr, k = 0) => {
    if (k === arr.length) {
      const cost = arr.reduce((s, key, i) => s + labDist(means[i], COLORS[key].lab), 0);
      if (!best || cost < best.cost) best = { cost, keys: arr.slice() };
      return;
    }
    for (let i = k; i < arr.length; i++) {
      [arr[k], arr[i]] = [arr[i], arr[k]];
      permute(arr, k + 1);
      [arr[k], arr[i]] = [arr[i], arr[k]];
    }
  };
  permute(COLOR_KEYS.slice());
  // margin: how much worse the second-best cluster is (small = doubtful sticker)
  const margin = {};
  for (const id of ids) {
    const d = means.map((m) => labDist(lab[id], m));
    const own = d[assign[id]];
    margin[id] = centreIds.includes(id) ? Infinity : Math.min(...d.filter((_, k) => k !== assign[id])) - own;
  }
  return { colors: Object.fromEntries(ids.map((id) => [id, best.keys[assign[id]]])), margin };
}

// If the read cube is impossible, try swapping the colours of the most
// doubtful stickers (red/orange mix-ups are the usual culprit) until the cube
// becomes valid.  Returns {viewColors, rotIndex, repaired} or null.
export function repair(model, viewColors, margin, order) {
  const valid = (vc, r) => model.isValid(assemble(model, vc, r));
  for (const r of order) if (valid(viewColors, r)) return { viewColors, rotIndex: r, repaired: 0 };
  const doubtful = Object.keys(margin).sort((a, b) => margin[a] - margin[b]).slice(0, 12);
  const get = (vc, id) => { const [v, k] = id.split(":"); return vc[+v][k]; };
  const swapped = (vc, pairs) => {
    const out = [{ ...vc[0] }, { ...vc[1] }];
    for (const [a, b] of pairs) {
      const [va, ka] = a.split(":"), [vb, kb] = b.split(":");
      const ca = out[+va][ka];
      out[+va][ka] = out[+vb][kb];
      out[+vb][kb] = ca;
    }
    return out;
  };
  const swaps = [];
  for (let i = 0; i < doubtful.length; i++) for (let j = i + 1; j < doubtful.length; j++) {
    const a = doubtful[i], b = doubtful[j];
    if (get(viewColors, a) !== get(viewColors, b)) swaps.push([a, b]);
  }
  for (const sw of swaps) for (const r of order) {
    const vc = swapped(viewColors, [sw]);
    if (valid(vc, r)) return { viewColors: vc, rotIndex: r, repaired: 2 };
  }
  const few = swaps.slice(0, 40);
  for (let i = 0; i < few.length; i++) for (let j = i + 1; j < few.length; j++) {
    const ids = new Set([...few[i], ...few[j]]);
    if (ids.size < 4) continue;
    for (const r of order) {
      const vc = swapped(viewColors, [few[i], few[j]]);
      if (valid(vc, r)) return { viewColors: vc, rotIndex: r, repaired: 4 };
    }
  }
  return null;
}

// Build the 54-sticker colour array from the two views for one view-2 orientation.
export function assemble(model, viewColors, rotIndex) {
  const rots = [IDENTITY, VIEW2_ROTATIONS[rotIndex]];
  return model.stickers.map(({ pos, normal }) => {
    for (let v = 0; v < 2; v++) {
      const n = matVec(rots[v], normal);
      if (n.some((x) => x === 1)) {
        const key = matVec(rots[v], pos).join(",") + "|" + n.join(",");
        return viewColors[v][key];
      }
    }
    return null;
  });
}

// Plausibility score of an assembled cube: pieces whose colours could exist.
export function plausibility(model, colors) {
  const opposite = {};
  const faces = model.faces;
  const centre = (f) => colors[9 * faces.indexOf(f) + 4];
  [["U", "D"], ["R", "L"], ["F", "B"]].forEach(([a, b]) => {
    opposite[centre(a)] = centre(b);
    opposite[centre(b)] = centre(a);
  });
  const byCubie = {};
  model.stickers.forEach(({ pos }, i) => {
    const k = pos.join(",");
    (byCubie[k] = byCubie[k] || []).push(colors[i]);
  });
  let score = 0;
  for (const cols of Object.values(byCubie)) {
    if (cols.length < 2) continue;
    let ok = new Set(cols).size === cols.length;
    for (const a of cols) if (cols.includes(opposite[a])) ok = false;
    if (ok) score++;
  }
  return score;
}

export const VIEW2_COUNT = VIEW2_ROTATIONS.length;

// ---------------------------------------------------------------------------
// Live quality check of the camera preview
// ---------------------------------------------------------------------------

function patchStats(data, w, h, x, y, r) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
  if (x1 < x0 || y1 < y0) return null;
  let n = 0, sr = 0, sg = 0, sb = 0, minL = 255, maxL = 0;
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const k = (py * w + px) * 4;
    const R = data[k], G = data[k + 1], B = data[k + 2];
    const L = 0.299 * R + 0.587 * G + 0.114 * B;
    sr += R; sg += G; sb += B; n++;
    if (L < minL) minL = L;
    if (L > maxL) maxL = L;
  }
  if (!n) return null;
  const rgb = [sr / n, sg / n, sb / n];
  const luma = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  const mx = Math.max(...rgb), mn = Math.min(...rgb);
  return { rgb, luma, minLuma: minL, spread: maxL - minL, sat: mx > 0 ? (mx - mn) / mx : 0 };
}

const READY_SCORE = 0.8;
const HOLD_FRAMES = 4;   // consecutive good frames before the shot is taken

// The seven handles of a regular hexagon, from position, size and rotation.
export function poseHandles(cx, cy, r, theta) {
  const out = { C: [cx, cy] };
  for (const [k, a] of Object.entries(HANDLE_ANGLE)) {
    const ang = (a * Math.PI) / 180 + theta;
    out[k] = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }
  return out;
}

// Score of a candidate pose: how dark the grid lines are compared with the
// stickers around them, sampled all along each line. Averaging over the whole
// line (instead of a few points) makes the score fall off gently as the
// hexagon drifts, which is what the search below needs.
function poseScore(model, data, w, h, pose) {
  const handles = poseHandles(...pose);
  const cell = pose[2] / 3;
  const rSticker = Math.max(1, cell * 0.12);
  const rLine = Math.max(1, cell * 0.06);
  const ALONG = 15;
  let sum = 0, count = 0, outside = 0;
  for (const axis of [0, 1, 2]) {
    const [i, j] = [0, 1, 2].filter((k) => k !== axis);
    const corner = (si, sj) => {
      const v = [0, 0, 0];
      v[axis] = 1; v[i] = si; v[j] = sj;
      return handles[VEC_HANDLE[v.join(",")]];
    };
    const H = squareToQuad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    const mid = [1 / 6, 1 / 2, 5 / 6];
    const lumas = [];
    for (const u of mid) for (const v of mid) {
      const xy = H(u, v);
      if (xy[0] < 0 || xy[1] < 0 || xy[0] >= w || xy[1] >= h) outside++;
      const st = patchStats(data, w, h, xy[0], xy[1], rSticker);
      if (st) lumas.push(st.luma);
    }
    if (lumas.length < 9) continue;
    lumas.sort((x, y) => x - y);
    const ref = lumas[4];               // median sticker of this face
    for (const t of [1 / 3, 2 / 3]) {
      for (let k = 0; k < ALONG; k++) {
        const a = 0.04 + (0.92 * k) / (ALONG - 1);
        for (const p of [H(t, a), H(a, t)]) {
          const g = patchStats(data, w, h, p[0], p[1], rLine);
          if (!g) continue;
          sum += Math.min(1, Math.max(0, (ref - g.luma) / Math.max(25, ref * 0.4)));
          count++;
        }
      }
    }
  }
  return count ? sum / count - outside * 0.02 : 0;
}

export function fitPose(model, data, w, h, start) {
  const m = Math.min(w, h);
  const minR = m * 0.2, maxR = m * 0.48;
  const inside = (p) => p[2] >= minR && p[2] <= maxR &&
    p[0] > w * 0.2 && p[0] < w * 0.8 && p[1] > h * 0.15 && p[1] < h * 0.85 && Math.abs(p[3]) < 0.45;

  const descend = (from, steps0, rounds) => {
    let best = from.slice();
    let bestScore = poseScore(model, data, w, h, best);
    let steps = steps0.slice();
    for (let round = 0; round < rounds; round++) {
      let improved = false;
      for (let k = 0; k < 4; k++) for (const dir of [1, -1]) {
        const cand = best.slice();
        cand[k] += dir * steps[k];
        if (!inside(cand)) continue;
        const sc = poseScore(model, data, w, h, cand);
        if (sc > bestScore + 1e-4) { best = cand; bestScore = sc; improved = true; }
      }
      if (!improved) steps = steps.map((v) => v * 0.5);
    }
    return best;
  };

  // pick the most promising size, then walk position, size and rotation
  const seeds = [];
  for (let f = 0.24; f <= 0.46; f += 0.03) seeds.push([w / 2, h / 2, m * f, 0]);
  if (start) seeds.unshift(start);
  let best = null, bestScore = -Infinity;
  for (const seed of seeds) {
    const sc = poseScore(model, data, w, h, seed);
    if (sc > bestScore) { best = seed; bestScore = sc; }
  }
  best = descend(best, [w * 0.02, w * 0.02, w * 0.018, 0.05], 8);
  if (start) {
    const alt = descend(start, [w * 0.012, w * 0.012, w * 0.01, 0.03], 6);
    if (poseScore(model, data, w, h, alt) > poseScore(model, data, w, h, best)) best = alt;
  }
  return { pose: best, fit: poseScore(model, data, w, h, best) };
}

// How well does the picture behind `handles` look like a cube right now?
//
// The telling signal is the black plastic between stickers: on a cube lined up
// with the hexagon, every point on the grid lines is clearly darker than the
// two stickers beside it. A flat wall or a cube out of place fails that.
export function evaluateFrame(model, handles, data, w, h, previous) {
  const span = Math.hypot(handles.C[0] - handles.T[0], handles.C[1] - handles.T[1]);
  const r = Math.max(1, (span / 3) * 0.14);
  const stickers = [];
  const points = [];
  const gaps = [];
  const at = (c) => c && c[Math.round(c.length / 2)];
  for (const axis of [0, 1, 2]) {
    const [i, j] = [0, 1, 2].filter((k) => k !== axis);
    const corner = (si, sj) => {
      const v = [0, 0, 0];
      v[axis] = 1; v[i] = si; v[j] = sj;
      return handles[VEC_HANDLE[v.join(",")]];
    };
    const H = squareToQuad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
    const mid = [1 / 6, 1 / 2, 5 / 6];
    const cells = mid.map((u) => mid.map((v) => {
      const xy = H(u, v);
      const st = patchStats(data, w, h, xy[0], xy[1], r);
      if (st) { stickers.push(st); points.push({ xy }); }
      return st;
    }));
    // points on the lines between neighbouring stickers, in both directions
    for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) {
      for (const [p, n1, n2] of [
        [H((a + 1) / 3, mid[b]), cells[a][b], cells[a + 1][b]],
        [H(mid[b], (a + 1) / 3), cells[b][a], cells[b][a + 1]],
      ]) {
        const g = patchStats(data, w, h, p[0], p[1], Math.max(1, r * 0.3));
        if (g && n1 && n2) gaps.push({ luma: g.luma, neighbour: Math.min(n1.luma, n2.luma) });
      }
    }
  }
  if (stickers.length < 27 || gaps.length < 30) {
    return { score: 0, ready: false, message: "Encaja el cubo dentro del hexágono", colors: [], points: [] };
  }
  // a gap counts when it is clearly darker than the stickers around it
  const dark = gaps.filter((g) => g.luma < Math.max(0.72 * g.neighbour, 30) || g.luma < 55).length / gaps.length;
  const flat = stickers.filter((s) => s.spread < 70).length / stickers.length;
  const cubeLike = stickers.filter((s) => s.sat > 0.28 || s.luma > 120).length / stickers.length;
  let moved = 0;
  if (previous && previous.length === stickers.length) {
    moved = stickers.reduce((acc, s, k) => acc +
      Math.abs(s.rgb[0] - previous[k][0]) + Math.abs(s.rgb[1] - previous[k][1]) +
      Math.abs(s.rgb[2] - previous[k][2]), 0) / stickers.length / 3;
  }
  const steady = previous ? moved < 9 : false;
  const score = 0.5 * dark + 0.25 * flat + 0.25 * cubeLike;
  let message;
  if (score < 0.45) message = "Pon el cubo dentro del hexágono, con una esquina hacia la cámara";
  else if (dark < 0.7) message = "Encaja mejor: las líneas del hexágono deben caer entre las pegatinas";
  else if (score < READY_SCORE) message = "Casi: acerca el cubo hasta llenar el hexágono";
  else if (!steady) message = "Sujétalo quieto…";
  else message = "¡Listo!";
  return {
    score, ready: score >= READY_SCORE && dark >= 0.8 && steady, message,
    metrics: { dark, flat, cubeLike, moved },
    colors: stickers.map((s) => s.rgb),
    points,
  };
}

// ---------------------------------------------------------------------------
// Capture UI controller
// ---------------------------------------------------------------------------

export class Capture {
  constructor(model, els, { onDone, onCancel }) {
    this.model = model;
    this.els = els;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.view = 0;
    this.viewColors = [null, null];
    this.viewSamples = [null, null];
    this.stream = null;
    this.handles = null;
    this.dragging = null;
    this.mode = "camera";
    this.auto = true;          // take the picture by itself when it looks right
    this._live = null;         // last evaluation of the preview
    this._readyFrames = 0;
    this._prevColors = null;
    this._pose = null;         // hexagon tracked on the cube: [cx, cy, r, angle]

    els.shoot.addEventListener("click", () => this.shoot());
    if (els.autoToggle) {
      els.autoToggle.addEventListener("change", () => {
        this.auto = els.autoToggle.checked;
        this._readyFrames = 0;
      });
    }
    els.retake.addEventListener("click", () => this.startCamera());
    els.use.addEventListener("click", () => this.useView());
    els.cancel.addEventListener("click", () => { this.stop(); this.onCancel(); });
    els.file.addEventListener("change", (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (f) this.loadFile(f);
    });
    const svg = els.overlay;
    svg.addEventListener("pointerdown", (e) => this._down(e));
    svg.addEventListener("pointermove", (e) => this._move(e));
    svg.addEventListener("pointerup", () => { this.dragging = null; });
    svg.addEventListener("pointercancel", () => { this.dragging = null; });
  }

  begin(mode) {
    this.mode = mode;
    this.view = 0;
    this.viewColors = [null, null];
    this.viewSamples = [null, null];
    this._updateTexts();
    if (mode === "camera") this.startCamera();
    else this._idleUpload();
  }

  _updateTexts() {
    const e = this.els;
    e.title.textContent = `Foto ${this.view + 1} de 2`;
    e.instructions.textContent = this.view === 0
      ? "Sujeta el cubo con una esquina apuntando a la cámara, de forma que se vean las caras de arriba, delante y derecha. Encájalo en el hexágono."
      : "Ahora dale la vuelta: que apunte a la cámara la esquina opuesta (la que estaba abajo, detrás, a la izquierda). Deben verse las tres caras que faltaban.";
    this.els.onGuide && this.els.onGuide(this.view);
  }

  async startCamera() {
    this._showButtons("camera");
    this.els.canvas.style.display = "none";
    this.els.video.style.display = "block";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._cameraError("Este navegador no permite usar la cámara aquí (hace falta HTTPS). Sube una foto en su lugar.");
      return;
    }
    try {
      if (!this.stream) {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      }
      const v = this.els.video;
      v.srcObject = this.stream;
      await v.play();
      const w = v.videoWidth || 1280, h = v.videoHeight || 960;
      this.size = [w, h];
      this.handles = this._defaultHandles(w, h);
      this._renderOverlay({ interactive: false });
      this.els.hint.textContent = this.auto
        ? "Coloca el cubo en el hexágono: la foto se toma sola en cuanto se vea bien."
        : "Acerca o aleja el cubo hasta que encaje en el hexágono y pulsa Capturar.";
      this._startLiveCheck();
    } catch (err) {
      this._cameraError("No se pudo abrir la cámara: " + (err.message || err) + ". Puedes subir una foto.");
    }
  }

  _cameraError(msg) {
    this.els.hint.textContent = msg;
    this._idleUpload();
  }

  _idleUpload() {
    this._showButtons("upload-idle");
    this.els.video.style.display = "none";
    this.els.canvas.style.display = "none";
    this.els.overlay.innerHTML = "";
    this.els.overlay.removeAttribute("viewBox");
  }

  _startLiveCheck() {
    this._stopLiveCheck();
    this._readyFrames = 0;
    this._prevColors = null;
    this._pose = null;
    const tick = () => {
      this._liveTimer = null;
      if (this._checkFrame() === "captured") return;
      this._liveTimer = setTimeout(tick, 170);
    };
    tick();
  }

  _stopLiveCheck() {
    if (this._liveTimer) clearTimeout(this._liveTimer);
    this._liveTimer = null;
    this._live = null;
    if (this.els.quality) this.els.quality.hidden = true;
  }

  // One evaluation of the live preview; captures by itself when it stays good.
  _checkFrame() {
    const v = this.els.video;
    if (!v.videoWidth || v.paused || this.els.use.hidden === false) return "idle";
    const [w, h] = this.size;
    if (!this._scratch) this._scratch = document.createElement("canvas");
    const sw = 480, sh = Math.round((480 * h) / w);
    if (this._scratch.width !== sw) { this._scratch.width = sw; this._scratch.height = sh; }
    const ctx = this._scratch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const k = sw / w;
    // snap the hexagon onto the cube, carrying on from the previous frame
    const { pose } = fitPose(this.model, data, sw, sh, this._pose);
    this._pose = pose;
    const small = poseHandles(...pose);
    this.handles = Object.fromEntries(Object.entries(small).map(([n, p]) => [n, [p[0] / k, p[1] / k]]));
    const res = evaluateFrame(this.model, small, data, sw, sh, this._prevColors);
    // the evaluation ran on the reduced frame: bring its points back to video size
    res.points = res.points.map((p) => ({ xy: [p.xy[0] / k, p.xy[1] / k] }));
    this._prevColors = res.colors.length ? res.colors : null;
    this._live = res;
    this._readyFrames = res.ready ? this._readyFrames + 1 : 0;
    this._showQuality(res);
    this._renderOverlay({ interactive: false });
    if (this.auto && this._readyFrames >= HOLD_FRAMES) {
      this._flash();
      this.shoot();
      return "captured";
    }
    return "checking";
  }

  _showQuality(res) {
    const box = this.els.quality;
    if (!box) return;
    box.hidden = false;
    const level = res.ready ? "ok" : res.score >= 0.6 ? "near" : "bad";
    box.className = `quality ${level}`;
    const held = Math.min(1, this._readyFrames / HOLD_FRAMES);
    box.innerHTML =
      `<span class="quality-bar"><i style="width:${Math.round(Math.min(1, res.score / READY_SCORE) * 100)}%"></i></span>` +
      `<span class="quality-msg">${res.message}${this.auto && res.ready ? ` ${Math.round(held * 100)}%` : ""}</span>`;
  }

  _flash() {
    const wrap = this.els.canvas.parentElement;
    wrap.classList.add("flash");
    setTimeout(() => wrap.classList.remove("flash"), 350);
  }

  stop() {
    this._stopLiveCheck();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  _showButtons(state) {
    const e = this.els;
    e.shoot.hidden = state !== "camera";
    if (e.autoToggle) e.autoToggle.parentElement.hidden = state !== "camera";
    e.uploadLabel.hidden = state === "adjust";
    e.retake.hidden = !(state === "adjust" && this.mode === "camera");
    e.use.hidden = state !== "adjust";
  }

  _defaultHandles(w, h) {
    const r = Math.min(w, h) * 0.36;
    const cx = w / 2, cy = h / 2;
    const out = { C: [cx, cy] };
    for (const [k, a] of Object.entries(HANDLE_ANGLE)) {
      out[k] = [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
    }
    return out;
  }

  shoot() {
    this._stopLiveCheck();
    const v = this.els.video;
    const [w, h] = [v.videoWidth, v.videoHeight];
    if (!w) return;
    const c = this.els.canvas;
    c.width = w; c.height = h;
    c.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0, w, h);
    this._enterAdjust(w, h, this.handles);
  }

  loadFile(file) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = this.els.canvas;
      c.width = w; c.height = h;
      c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(img.src);
      this._enterAdjust(w, h, null);
    };
    img.src = URL.createObjectURL(file);
  }

  _enterAdjust(w, h, handles) {
    this.size = [w, h];
    this.els.video.style.display = "none";
    this.els.canvas.style.display = "block";
    this.handles = handles ? JSON.parse(JSON.stringify(handles)) : this._defaultHandles(w, h);
    this._showButtons("adjust");
    this.els.hint.textContent = "Arrastra los 7 puntos azules hasta las esquinas del cubo si no encajan. Los círculos muestran el color leído.";
    this._sample();
    this._renderOverlay({ interactive: true });
  }

  _sample() {
    const [w, h] = this.size;
    const ctx = this.els.canvas.getContext("2d", { willReadFrequently: true });
    const pts = viewPoints(this.model, this.handles);
    // patch radius: a fraction of the distance between neighbouring stickers
    const span = Math.hypot(this.handles.C[0] - this.handles.T[0], this.handles.C[1] - this.handles.T[1]);
    const r = Math.max(2, span / 3 * 0.16);
    this.samples = {};
    for (const p of pts) this.samples[p.key] = samplePatch(ctx, p.xy[0], p.xy[1], r, w, h);
    this.points = pts;
  }

  _renderOverlay({ interactive }) {
    const svg = this.els.overlay;
    const [w, h] = this.size;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = "";
    const s = Math.min(w, h) / 480;
    const g = document.createElementNS(NS, "g");
    svg.appendChild(g);
    const live = this._live;
    const stroke = !live ? "rgba(255,255,255,.85)"
      : live.ready ? "rgba(64,220,120,.95)"
        : live.score >= 0.6 ? "rgba(255,200,60,.95)" : "rgba(255,90,90,.9)";
    for (const [a, b] of gridLines(this.model, this.handles)) {
      const l = document.createElementNS(NS, "line");
      Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke, "stroke-width": (live && live.ready ? 2.4 : 1.6) * s }).forEach(([k, v]) => l.setAttribute(k, v));
      g.appendChild(l);
    }
    if (live && live.points && live.score > 0.45) {
      live.points.forEach((p, i) => {
        const rgb = live.colors[i];
        if (!rgb) return;
        const c = document.createElementNS(NS, "circle");
        Object.entries({ cx: p.xy[0], cy: p.xy[1], r: 5 * s, fill: `rgb(${rgb.map(Math.round).join(",")})`,
                         stroke: "rgba(255,255,255,.8)", "stroke-width": 1.2 * s }).forEach(([k, v]) => c.setAttribute(k, v));
        g.appendChild(c);
      });
    }
    if (interactive && this.points) {
      for (const p of this.points) {
        const c = document.createElementNS(NS, "circle");
        const rgb = this.samples[p.key];
        Object.entries({ cx: p.xy[0], cy: p.xy[1], r: 7 * s, fill: `rgb(${rgb.join(",")})`, stroke: "#fff", "stroke-width": 2 * s }).forEach(([k, v]) => c.setAttribute(k, v));
        g.appendChild(c);
      }
      for (const [k, p] of Object.entries(this.handles)) {
        const c = document.createElementNS(NS, "circle");
        Object.entries({ cx: p[0], cy: p[1], r: 13 * s, class: "handle", "data-handle": k }).forEach(([a, v]) => c.setAttribute(a, v));
        c.style.strokeWidth = 3 * s;
        g.appendChild(c);
      }
    }
  }

  _svgPoint(e) {
    const svg = this.els.overlay;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  _down(e) {
    if (this.els.use.hidden) return;
    const p = this._svgPoint(e);
    // grab the nearest handle within reach (touch friendly)
    let best = null, bestD = Infinity;
    for (const [k, h] of Object.entries(this.handles)) {
      const d = Math.hypot(h[0] - p.x, h[1] - p.y);
      if (d < bestD) { bestD = d; best = k; }
    }
    const reach = Math.min(...this.size) * 0.09;
    if (bestD < reach) {
      this.dragging = best;
      this.els.overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  _move(e) {
    if (!this.dragging) return;
    const p = this._svgPoint(e);
    this.handles[this.dragging] = [p.x, p.y];
    this._sample();
    this._renderOverlay({ interactive: true });
  }

  useView() {
    this._sample();
    this.viewSamples[this.view] = this.samples;
    if (this.view === 0) {
      this.view = 1;
      this._updateTexts();
      if (this.mode === "camera") this.startCamera();
      else this._idleUpload();
      return;
    }
    this.stop();
    this.onDone(this.finish());
  }

  finish() {
    // classify the 54 samples together; ids are "view:key"
    const all = {};
    const centreIds = [];
    this.viewSamples.forEach((s, v) => {
      for (const [k, rgb] of Object.entries(s)) {
        all[`${v}:${k}`] = rgb;
        const [pos] = k.split("|");
        if (pos.split(",").filter((x) => x === "0").length === 2) centreIds.push(`${v}:${k}`);
      }
    });
    const { colors: cls, margin } = classify(all, centreIds);
    const viewColors = [{}, {}];
    for (const [id, key] of Object.entries(cls)) {
      const [v, k] = id.split(":");
      viewColors[+v][k] = key;
    }
    // orientations of the second picture, most plausible first
    const order = [...Array(VIEW2_COUNT).keys()]
      .map((r) => [r, plausibility(this.model, assemble(this.model, viewColors, r))])
      .sort((a, b) => b[1] - a[1]).map(([r]) => r);
    return repair(this.model, viewColors, margin, order) || { viewColors, rotIndex: order[0], repaired: 0 };
  }
}
