// Finding the cube in a camera frame.
//
// Rather than asking the user to fit the cube inside a guide, we look for the
// stickers themselves: patches of uniform colour, roughly square, all about
// the same size. Then we fit the cube's grid (position, size, rotation and a
// bit of perspective) so that its 27 sticker centres land on those patches.
// Readings are accumulated over frames until every sticker has been seen
// several times with the same colour, which survives glare and blur far
// better than any single frame.

const HANDLE_ANGLE = { T: -90, UR: -30, LR: 30, B: 90, LL: 150, UL: 210 };

export function poseHandles(cx, cy, r, theta) {
  const out = { C: [cx, cy] };
  for (const [k, a] of Object.entries(HANDLE_ANGLE)) {
    const ang = (a * Math.PI) / 180 + theta;
    out[k] = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sticker-like patches
// ---------------------------------------------------------------------------

// A gentle 3x3 average: sensor noise and the speckle of a glossy sticker make
// the patches ragged, and the shapes are what we are about to measure.
export function smooth(data, w, h) {
  const src = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          sum += src[k + c + (dy * w + dx) * 4];
        }
        data[k + c] = sum / 9;
      }
    }
  }
}

// Stretch the frame so a washed-out picture (a bright room, a phone that
// over-exposes) gets its contrast back before anything else is measured.
// Each channel is mapped from its own 2nd..98th percentile, which also
// evens out the colour of the light.
export function normalize(data, w, h) {
  const n = w * h;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const step = n > 120000 ? 2 : 1;        // sampling is plenty for percentiles
  let count = 0;
  for (let p = 0; p < n; p += step) {
    const k = p * 4;
    hist[0][data[k]]++; hist[1][data[k + 1]]++; hist[2][data[k + 2]]++;
    count++;
  }
  const map = [];
  let needed = false;
  for (let c = 0; c < 3; c++) {
    const lowCut = count * 0.02, highCut = count * 0.98;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[c][v]; if (acc >= lowCut) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[c][v]; if (acc >= highCut) { hi = v; break; } }
    if (hi - lo < 25) { lo = 0; hi = 255; }
    if (lo > 8 || hi < 247) needed = true;
    const table = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      table[v] = Math.max(0, Math.min(255, Math.round(((v - lo) * 255) / (hi - lo))));
    }
    map.push(table);
  }
  if (!needed) return false;
  for (let p = 0; p < n; p++) {
    const k = p * 4;
    data[k] = map[0][data[k]];
    data[k + 1] = map[1][data[k + 1]];
    data[k + 2] = map[2][data[k + 2]];
  }
  return true;
}

// maxArea is generous on purpose: held close to the camera a single sticker
// can cover a good part of the frame, and dropping those left nothing to find.
// Mask of the cube's dark frame, decided locally.
//
// A single threshold for the whole picture cannot work: against a window, a
// dark green sticker is darker than the black plastic in the lit part of the
// cube. So each pixel is compared with the average of its surroundings, which
// is what makes the thin dark lines stand out wherever they are.
function darkMask(data, w, h, block) {
  const n = w * h;
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      row += 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(4, block >> 1);
  const mask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * (w + 1) + x1 + 1] - integral[y0 * (w + 1) + x1 + 1] -
        integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / area;
      const k = (y * w + x) * 4;
      const L = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
      // dark compared with its own surroundings, and not merely a shaded face
      if (L < mean * 0.86 - 2) mask[y * w + x] = 1;
    }
  }
  return mask;
}

// Thicken the frame by one pixel so that a line broken by blur or by a soft
// shadow still separates the two stickers beside it.
function dilate(mask, w, h, times) {
  for (let t = 0; t < times; t++) {
    const out = new Uint8Array(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (mask[p]) continue;
        if (mask[p - 1] || mask[p + 1] || mask[p - w] || mask[p + w]) out[p] = 1;
      }
    }
    mask.set(out);
  }
  return mask;
}

// Stickers as the holes of the cube's dark frame.
//
// Grouping pixels by colour was the first approach and it broke on a real
// cube: printed logos, shading and a hazy webcam split every sticker into
// crumbs. The black plastic between stickers survives all of that, so we mark
// the frame and keep the patches it encloses.
export function segmentHoles(data, w, h, { colorFrom = null, minArea = 12, block = 0, thicken = 0 } = {}) {
  const src = colorFrom || data;
  const n = w * h;
  const mask = darkMask(data, w, h, block || Math.round(w / 10));
  if (thicken) dilate(mask, w, h, thicken);
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const blobs = [];
  const maxPixels = 0.2 * n;
  for (let start = 0; start < n; start++) {
    if (label[start] !== -1) continue;
    if (mask[start]) { label[start] = -2; continue; }
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = blobs.length;
    let count = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0, touches = false;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      count++; sx += x; sy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (count > maxPixels) break;
      const push = (q) => {
        if (label[q] !== -1) return;
        if (mask[q]) { label[q] = -2; return; }
        label[q] = blobs.length;
        queue[tail++] = q;
      };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const aspect = bw / bh;
    if (touches || count < minArea || count > maxPixels) continue;
    if (aspect < 0.4 || aspect > 2.5) continue;
    // A sticker seen at an angle is a rhombus, and a rhombus fills exactly
    // half of its bounding box: asking for more than that threw away almost
    // every sticker of a tilted cube.
    if (count / (bw * bh) < 0.34) continue;
    const cx = sx / count, cy = sy / count;
    // colour from the middle, by median, so a printed logo cannot drag it
    const inner = 0.5 * Math.sqrt(count / Math.PI);
    const rs = [], gs = [], bs = [];
    for (let t = 0; t < tail; t++) {
      const p = queue[t];
      const dx = (p % w) - cx, dy = ((p / w) | 0) - cy;
      if (dx * dx + dy * dy > inner * inner) continue;
      const k = p * 4;
      rs.push(src[k]); gs.push(src[k + 1]); bs.push(src[k + 2]);
    }
    if (!rs.length) continue;
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    blobs.push({
      cx, cy, area: count, size: Math.sqrt(count / 0.87),
      rgb: [med(rs), med(gs), med(bs)],
    });
  }
  return blobs;
}

// `colorFrom` lets the shapes be found on a contrast-stretched copy while the
// colours are still read from the original pixels, which is what the rest of
// the pipeline compares between the two views.
export function segmentBlobs(data, w, h, { minArea = 10, maxArea = 0.16, split = false, colorFrom = null } = {}) {
  const src = colorFrom || data;
  const n = w * h;
  const drift = split ? 70 : 150;
  const edgeJump = split ? 45 : 85;
  const seen = new Uint8Array(n);
  const blobs = [];
  const queue = new Int32Array(n);
  const maxPixels = maxArea * n;
  const luma = (k) => 0.299 * data[k * 4] + 0.587 * data[k * 4 + 1] + 0.114 * data[k * 4 + 2];

  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const L0 = luma(start);
    if (L0 < 55) { seen[start] = 1; continue; }          // cube body, shadows
    const edge = Math.max(45, L0 * 0.62);                // the dark line around a sticker
    const r0 = data[start * 4], g0 = data[start * 4 + 1], b0 = data[start * 4 + 2];
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let count = 0;
    let minX = w, maxX = 0, minY = h, maxY = 0, sx = 0, sy = 0;
    while (head < tail) {
      const p = queue[head++];
      const k = p * 4;
      const x = p % w, y = (p / w) | 0;
      sx += x; sy += y; count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (count > maxPixels) break;
      const push = (q) => {
        if (seen[q]) return;
        const j = q * 4;
        // stop at the dark line between stickers, judged against this patch
        if (luma(q) < edge) { seen[q] = 1; return; }
        // stop at a sharp edge, which is what separates two bright stickers
        // when the light is strong enough to wash the line between them out
        if (Math.abs(data[j] - data[k]) + Math.abs(data[j + 1] - data[k + 1]) +
            Math.abs(data[j + 2] - data[k + 2]) > edgeJump) return;
        // and grow only while the colour stays close to where the patch started
        if (Math.abs(data[j] - r0) + Math.abs(data[j + 1] - g0) + Math.abs(data[j + 2] - b0) > 95) return;
        seen[q] = 1;
        queue[tail++] = q;
      };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    if (count < minArea || count > maxPixels) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const aspect = bw / bh;
    if (aspect < 0.45 || aspect > 2.2) continue;
    if (count / (bw * bh) < 0.34) continue;              // a rhombus fills half
    const cx = sx / count, cy = sy / count;
    // Colour from the middle of the patch only: its border blurs into the
    // black line around the sticker, and averaging that in drags the colour
    // towards grey.
    const inner = 0.55 * Math.sqrt(count / Math.PI);
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let t = 0; t < tail; t++) {
      const p = queue[t];
      const dx = (p % w) - cx, dy = ((p / w) | 0) - cy;
      if (dx * dx + dy * dy > inner * inner) continue;
      const k = p * 4;
      cr += src[k]; cg += src[k + 1]; cb += src[k + 2]; cn++;
    }
    if (!cn) continue;
    blobs.push({
      cx, cy, area: count,
      size: Math.sqrt(count / 0.87),                     // side of a rhombic sticker
      rgb: [cr / cn, cg / cn, cb / cn],
    });
  }
  return blobs;
}

// ---------------------------------------------------------------------------
// Fitting the cube's grid to those patches
// ---------------------------------------------------------------------------

// --- fitting a camera ------------------------------------------------------
//
// A cube held at arm's length is described well by a weak-perspective camera:
// image = A * point + t, with A a 2x3 matrix. That is eight numbers, solved
// exactly by least squares. The full projective camera was tried first and
// rejected: with eleven free numbers it can skew the grid until it lands on
// the cube's own lattice one cell across, which reads every sticker wrong.

// Scaled orthographic camera: image = s*R*point + t, with R the two first
// rows of a rotation. Fitting a free 2x3 matrix instead is tempting, and
// wrong: a shear slides the grid one cell along the cube's own lattice and
// every sticker is then read from its neighbour. Forcing the two rows to be
// orthogonal and equally long removes exactly that freedom.
export function solveCamera(pts3, pts2) {
  const n = pts3.length;
  if (n < 4) return null;
  let px = 0, py = 0, pz = 0, qx = 0, qy = 0;
  for (let i = 0; i < n; i++) {
    px += pts3[i][0]; py += pts3[i][1]; pz += pts3[i][2];
    qx += pts2[i][0]; qy += pts2[i][1];
  }
  px /= n; py /= n; pz /= n; qx /= n; qy /= n;
  // free affine fit: A = (Q'P)(P'P)^-1
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [[0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const p = [pts3[i][0] - px, pts3[i][1] - py, pts3[i][2] - pz];
    const q = [pts2[i][0] - qx, pts2[i][1] - qy];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) S[r][c] += p[r] * p[c];
      B[0][r] += q[0] * p[r];
      B[1][r] += q[1] * p[r];
    }
  }
  const inv = invert3(S);
  if (!inv) return null;
  const A = [0, 1].map((r) => [0, 1, 2].map((c) =>
    B[r][0] * inv[0][c] + B[r][1] * inv[1][c] + B[r][2] * inv[2][c]));

  // nearest scaled-orthographic matrix: equalise the two singular values
  const g11 = A[0][0] ** 2 + A[0][1] ** 2 + A[0][2] ** 2;
  const g22 = A[1][0] ** 2 + A[1][1] ** 2 + A[1][2] ** 2;
  const g12 = A[0][0] * A[1][0] + A[0][1] * A[1][1] + A[0][2] * A[1][2];
  const tr = g11 + g22, det = g11 * g22 - g12 * g12;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc), l2 = tr / 2 - Math.sqrt(disc);
  if (l2 <= 1e-9) return null;
  const s1 = Math.sqrt(l1), s2 = Math.sqrt(l2), s = (s1 + s2) / 2;
  // eigenvectors of the 2x2 Gram matrix give the directions to rescale
  const ev = (l) => {
    const v = Math.abs(g12) > 1e-9 ? [l - g22, g12] : (l === l1 ? [1, 0] : [0, 1]);
    const norm = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / norm, v[1] / norm];
  };
  const u1 = ev(l1), u2 = ev(l2);
  // A' = (s/s1) u1 u1' A + (s/s2) u2 u2' A
  const Ap = [[0, 0, 0], [0, 0, 0]];
  for (const [u, f] of [[u1, s / s1], [u2, s / s2]]) {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      Ap[r][c] += f * u[r] * (u[0] * A[0][c] + u[1] * A[1][c]);
    }
  }
  const P = [
    Ap[0][0], Ap[0][1], Ap[0][2], qx - (Ap[0][0] * px + Ap[0][1] * py + Ap[0][2] * pz),
    Ap[1][0], Ap[1][1], Ap[1][2], qy - (Ap[1][0] * px + Ap[1][1] * py + Ap[1][2] * pz),
  ];
  return P.every((v) => isFinite(v)) ? P : null;
}

function invert3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-9) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

export function project(P, [X, Y, Z]) {
  return [P[0] * X + P[1] * Y + P[2] * Z + P[3], P[4] * X + P[5] * Y + P[6] * Z + P[7]];
}

// The 27 visible stickers in cube coordinates, and the 7 visible corners.
export function visibleStickers(model) {
  return model.stickers
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => s.normal.some((v) => v === 1))
    .map((s) => ({
      key: s.pos.join(",") + "|" + s.normal.join(","),
      p3: s.pos.map((v, k) => v + 0.5 * s.normal[k]),
    }));
}

export const CORNERS_3D = {
  C: [1.5, 1.5, 1.5], T: [-1.5, 1.5, -1.5], UR: [1.5, 1.5, -1.5],
  LR: [1.5, -1.5, -1.5], B: [1.5, -1.5, 1.5], LL: [-1.5, -1.5, 1.5], UL: [-1.5, 1.5, 1.5],
};

// The 27 visible sticker centres of a view, in screen coordinates.
export function stickerCenters(model, handles) {
  const VEC = {
    "1,1,1": "C", "-1,1,-1": "T", "1,1,-1": "UR", "1,-1,-1": "LR",
    "1,-1,1": "B", "-1,-1,1": "LL", "-1,1,1": "UL",
  };
  const out = [];
  for (const { pos, normal } of model.stickers) {
    const axis = normal.findIndex((v) => v === 1);
    if (axis < 0) continue;
    const [i, j] = [0, 1, 2].filter((k) => k !== axis);
    const corner = (si, sj) => {
      const v = [0, 0, 0];
      v[axis] = 1; v[i] = si; v[j] = sj;
      return handles[VEC[v.join(",")]];
    };
    const p00 = corner(-1, -1), p10 = corner(1, -1), p11 = corner(1, 1), p01 = corner(-1, 1);
    const u = (pos[i] + 1.5) / 3, v = (pos[j] + 1.5) / 3;
    // bilinear inside the face: good enough for a mild perspective
    const xy = [0, 1].map((c) =>
      (1 - u) * (1 - v) * p00[c] + u * (1 - v) * p10[c] + u * v * p11[c] + (1 - u) * v * p01[c]);
    out.push({ key: pos.join(",") + "|" + normal.join(","), xy });
  }
  return out;
}

// How many of the 27 expected stickers actually have a patch under them.
export function matchScore(model, handles, blobs, cell) {
  const centers = stickerCenters(model, handles);
  const tol = cell * 0.55;
  let score = 0, hits = 0;
  const used = new Set();
  for (const c of centers) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      const d = Math.hypot(b.cx - c.xy[0], b.cy - c.xy[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best === null) continue;
    const b = blobs[best];
    const sizeOk = b.size > cell * 0.35 && b.size < cell * 1.6;
    if (!sizeOk) continue;
    const v = Math.max(0, 1 - bestD / tol);
    score += v;
    if (v > 0.3) { hits++; used.add(best); }
  }
  return { score: score / centers.length, hits, spread: used.size / Math.max(1, centers.length) };
}

// Keep only the patches that sit on a regular lattice: a cube's stickers are
// all about the same size and about one cell apart from their neighbours, so
// they form one big connected group. A hand, a shirt or a poster in the
// background do not, and letting them into the fit was dragging the grid off
// the cube.
export function latticeCluster(blobs) {
  if (blobs.length < 9) return blobs;
  const sizes = blobs.map((b) => b.size).sort((a, b) => a - b);
  const s = sizes[sizes.length >> 1];
  const candidates = blobs.filter((b) => b.size > s * 0.55 && b.size < s * 1.9);
  if (candidates.length < 9) return blobs;
  const step = s * 1.15;                      // centre to centre of neighbours
  const parent = candidates.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const d = Math.hypot(candidates[i].cx - candidates[j].cx, candidates[i].cy - candidates[j].cy);
      if (d > step * 0.55 && d < step * 1.6) union(i, j);
    }
  }
  const groups = new Map();
  candidates.forEach((b, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(b);
  });
  let best = [];
  for (const g of groups.values()) if (g.length > best.length) best = g;
  return best.length >= 9 ? best : blobs;
}

function clusterSeed(blobs) {
  // centre of the densest group of patches: that is where the cube is
  let best = null, bestCount = -1;
  const sizes = blobs.map((b) => b.size).sort((a, b) => a - b);
  const s = sizes[sizes.length >> 1] || 10;
  for (const b of blobs) {
    let count = 0, sx = 0, sy = 0;
    for (const o of blobs) {
      if (Math.hypot(o.cx - b.cx, o.cy - b.cy) < s * 4.2 && o.size > s * 0.45 && o.size < s * 2.2) {
        count++; sx += o.cx; sy += o.cy;
      }
    }
    if (count > bestCount) { bestCount = count; best = [sx / count, sy / count]; }
  }
  return { center: best, size: s, count: bestCount };
}

// Seen from a corner, a cube looks the same when turned 120 degrees about that
// corner, so the grid fits equally well with the three faces swapped. Only the
// layout tells them apart: in this view the top face is U, and of the other
// two, the one on the right is R. This returns true when P agrees with that.
function orientationOk(P) {
  const u = project(P, [0, 1.5, 0]), r = project(P, [1.5, 0, 0]), f = project(P, [0, 0, 1.5]);
  if (!u || !r || !f) return false;
  return u[1] < r[1] && u[1] < f[1] && r[0] > f[0];
}

// The two other ways round: rotating the cube 120 or 240 degrees about the
// corner pointing at the camera.
function cyclePermutations(stickers) {
  const key = (p) => p.map((v) => v.toFixed(2)).join(",");
  const index = new Map(stickers.map((s, i) => [key(s.p3), i]));
  const turns = [([x, y, z]) => [z, x, y], ([x, y, z]) => [y, z, x]];
  return turns.map((t) => stickers.map((s) => index.get(key(t(s.p3)))));
}

// --- polygons: does the grid cover the same footprint as the patches? ------

function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return build(pts).concat(build(pts.reverse()));
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

// Sutherland-Hodgman, valid because both polygons are convex
function clipPoly(subject, clip) {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}

function footprintOverlap(centers, blobs, cell) {
  let cx = 0, cy = 0;
  for (const c of centers) { cx += c[0]; cy += c[1]; }
  cx /= centers.length; cy /= centers.length;
  const near = blobs.filter((b) =>
    b.size > cell * 0.4 && b.size < cell * 1.7 && Math.hypot(b.cx - cx, b.cy - cy) < cell * 4.3);
  if (near.length < 9) return 0;
  const hullGrid = convexHull(centers);
  const hullBlobs = convexHull(near.map((b) => [b.cx, b.cy]));
  if (hullGrid.length < 3 || hullBlobs.length < 3) return 0;
  const inter = polyArea(clipPoly(hullGrid, hullBlobs));
  const union = polyArea(hullGrid) + polyArea(hullBlobs) - inter;
  return union > 0 ? inter / union : 0;
}

// Quality of a fitted grid. Counting matched stickers is not enough: a grid
// shifted by one cell also lands on patches. So patches that sit next to the
// cube and are left unexplained count against it, which pins the grid down.
function gridScore(centers, blobs, cell) {
  const tol = cell * 0.5;
  let cx = 0, cy = 0;
  for (const c of centers) { cx += c[0]; cy += c[1]; }
  cx /= centers.length; cy /= centers.length;
  const near = blobs.filter((b) =>
    b.size > cell * 0.4 && b.size < cell * 1.7 && Math.hypot(b.cx - cx, b.cy - cy) < cell * 4.3);
  const takenBlob = new Set();
  let matched = 0;
  for (const c of centers) {
    let best = -1, bestD = Infinity;
    near.forEach((b, i) => {
      const d = Math.hypot(b.cx - c[0], b.cy - c[1]);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD < tol && !takenBlob.has(best)) { takenBlob.add(best); matched++; }
  }
  const unexplained = near.length - takenBlob.size;
  return { matched, unexplained, score: (matched - unexplained) / 27 };
}

// Do the black lines of the cube fall between the slots of this grid?
// A grid shifted by one cell matches just as many patches, but its boundaries
// land in the middle of stickers and on the background, so this tells them
// apart. Faces are given as the nine slot positions of each face, in order.
function lineScore(centers, data, w, h, cell) {
  const lum = (x, y) => {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= w || py >= h) return null;
    const k = (py * w + px) * 4;
    return 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
  };
  const patch = (x, y, r) => {
    let sum = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const v = lum(x + dx, y + dy);
      if (v !== null) { sum += v; n++; }
    }
    return n ? sum / n : null;
  };
  const r = Math.max(1, Math.round(cell * 0.12));
  const darkest = (a, b) => {           // darkest spot on the segment between two slots
    let best = Infinity;
    for (const t of [0.42, 0.5, 0.58]) {
      for (const u of [-0.18, 0, 0.18]) {   // and a little along the line itself
        const x = a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) * u;
        const y = a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) * u;
        const v = lum(x, y);
        if (v !== null && v < best) best = v;
      }
    }
    return isFinite(best) ? best : null;
  };
  let good = 0, total = 0;
  for (let f = 0; f < 3; f++) {
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const here = centers[f * 9 + row * 3 + col];
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const r2 = row + dr, c2 = col + dc;
        if (r2 > 2 || c2 > 2) continue;
        const there = centers[f * 9 + r2 * 3 + c2];
        const mid = [(here[0] + there[0]) / 2, (here[1] + there[1]) / 2];
        const a = patch(here[0], here[1], r), b = patch(there[0], there[1], r);
        const m = darkest(here, there);
        if (a === null || b === null || m === null) continue;
        total++;
        const ref = Math.min(a, b);
        if (m < Math.max(0.74 * ref, 32)) good++;
      }
    }
  }
  return total ? good / total : 0;
}

// Stickers found just outside the grid, where the cube should already have
// ended. A grid shifted by one cell leaves a whole row of real stickers out
// there, so this is what finally pins it down: inside the cube every lattice
// looks alike, the silhouette does not.
function outsideHits(P, blobs, cell) {
  const probes = [];
  // for each visible face, the two rows beyond its silhouette edges
  for (const [axis, sign] of [[1, 1], [0, 1], [2, 1]]) {        // faces U, R, F
    const others = [0, 1, 2].filter((k) => k !== axis);
    for (const out of others) {
      for (const t of [-1, 0, 1]) {
        const p = [0, 0, 0];
        p[axis] = 1.5 * sign;
        p[out] = -2;                                            // one row past the edge
        p[others.find((k) => k !== out)] = t;
        probes.push(p);
      }
    }
  }
  let hits = 0;
  for (const p of probes) {
    const xy = project(P, p);
    if (!xy) continue;
    for (const b of blobs) {
      if (b.size < cell * 0.4 || b.size > cell * 1.7) continue;
      if (Math.hypot(b.cx - xy[0], b.cy - xy[1]) < cell * 0.45) { hits++; break; }
    }
  }
  return { hits, probes: probes.length };
}

// Seeds built from the lattice itself.
//
// Neighbouring stickers are one cell apart, and on a cube seen from a corner
// those steps fall into three directions. Recovering them from the patches
// and placing the grid on the centre of the cluster gives a starting point
// that is already almost right, which a search over sizes and rotations can
// miss entirely.
export function latticeSeeds(model, blobs) {
  if (blobs.length < 9) return [];
  const sizes = blobs.map((b) => b.size).sort((a, b) => a - b);
  const cell = sizes[sizes.length >> 1] * 1.15;
  // steps between close patches, folded to 0..180 degrees
  const bins = new Array(36).fill(null).map(() => []);
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const dx = blobs[j].cx - blobs[i].cx, dy = blobs[j].cy - blobs[i].cy;
      const d = Math.hypot(dx, dy);
      if (d < cell * 0.6 || d > cell * 1.45) continue;
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI;
      bins[Math.min(35, Math.floor((a / Math.PI) * 36))].push([dx, dy, d]);
    }
  }
  // three dominant directions, at least 25 degrees apart
  const order = bins.map((v, i) => [v.length, i]).sort((x, y) => y[0] - x[0]);
  const picked = [];
  for (const [count, i] of order) {
    if (!count) break;
    const angle = ((i + 0.5) / 36) * Math.PI;
    if (picked.some((p) => {
      const d = Math.abs(p.angle - angle);
      return Math.min(d, Math.PI - d) < 0.42;
    })) continue;
    const list = bins[i];
    const mean = list.reduce((acc, [dx, dy]) => {
      const flip = dx * Math.cos(angle) + dy * Math.sin(angle) < 0 ? -1 : 1;
      acc[0] += dx * flip; acc[1] += dy * flip;
      return acc;
    }, [0, 0]).map((v) => v / list.length);
    picked.push({ angle, vec: mean, count });
    if (picked.length === 3) break;
  }
  if (picked.length < 3) return [];
  const centre = blobs.reduce((acc, b) => [acc[0] + b.cx / blobs.length, acc[1] + b.cy / blobs.length], [0, 0]);
  const stickers = visibleStickers(model);
  const seeds = [];
  // each axis can point either way; the three that spread out around the
  // centre are the ones that describe the cube
  for (const signs of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]]) {
    const axes = picked.map((p, k) => [p.vec[0] * signs[k], p.vec[1] * signs[k]]);
    for (const order3 of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
      const [ax, ay, az] = order3.map((k) => axes[k]);
      const centers = stickers.map((st) => {
        // sticker centre = near corner + offsets along the two in-face axes
        const p = st.p3;
        const u = (p[0] - 1.5), v = (p[1] - 1.5), t = (p[2] - 1.5);
        return [
          centre[0] + u * ax[0] + v * ay[0] + t * az[0],
          centre[1] + u * ax[1] + v * ay[1] + t * az[1],
        ];
      });
      seeds.push({ centers, cell });
    }
  }
  return seeds;
}

// Sticker centres by interpolating inside the cube's silhouette.
export function centersFromHandles(model, handles) {
  return stickerCenters(model, handles).map((c) => c.xy);
}

// Fit from the silhouette rather than from the patch centres.
//
// The outline of a cube seen from a corner is a hexagon, and under a parallel
// projection its centre is exactly the near corner. Taking the six vertices
// as the extreme patches in six directions, and the near corner as the middle,
// places the grid far better than fitting a camera to patch centres: the
// outline is the one thing a cube always shows clearly.
export function fitFromSilhouette(model, blobs, w, h, data) {
  if (blobs.length < 9) return null;
  const cx = blobs.reduce((a, b) => a + b.cx, 0) / blobs.length;
  const cy = blobs.reduce((a, b) => a + b.cy, 0) / blobs.length;
  const sizes = blobs.map((b) => b.size).sort((a, b) => a - b);
  const cell = sizes[sizes.length >> 1] * 1.15;
  let hex = null, bestReach = -Infinity;
  for (let deg = 0; deg < 60; deg += 2) {
    const verts = [0, 1, 2, 3, 4, 5].map((k) => {
      const a = ((deg + k * 60) * Math.PI) / 180;
      let far = null, reach = -Infinity;
      for (const b of blobs) {
        const v = (b.cx - cx) * Math.cos(a) + (b.cy - cy) * Math.sin(a);
        if (v > reach) { reach = v; far = b; }
      }
      return { xy: [far.cx + Math.cos(a) * cell * 0.62, far.cy + Math.sin(a) * cell * 0.62], reach };
    });
    const total = verts.reduce((acc, v) => acc + v.reach, 0);
    if (total > bestReach) { bestReach = total; hex = verts.map((v) => v.xy); }
  }
  if (!hex) return null;
  // the topmost vertex is the top of the hexagon; the rest follow clockwise
  const top = hex.map((p, i) => [p[1], i]).sort((a, b) => a[0] - b[0])[0][1];
  const names = ["T", "UR", "LR", "B", "LL", "UL"];
  const handles = { C: [cx, cy] };
  for (let k = 0; k < 6; k++) handles[names[k]] = hex[(top + k) % 6];

  // let the seven corners settle where the grid explains the picture best
  const evaluate = (hs) => {
    const centers = centersFromHandles(model, hs);
    if (centers.some((c) => !isFinite(c[0]) || !isFinite(c[1]))) return -1;
    const q = gridScore(centers, blobs, cell);
    const lines = data ? lineScore(centers, data, w, h, cell) : 0;
    return 0.4 * q.score + 0.6 * lines;
  };
  let score = evaluate(handles);
  let step = cell * 0.4;
  for (let round = 0; round < 7; round++) {
    let improved = false;
    for (const name of Object.keys(handles)) {
      for (const axis of [0, 1]) for (const dir of [1, -1]) {
        const cand = JSON.parse(JSON.stringify(handles));
        cand[name][axis] += dir * step;
        const sc = evaluate(cand);
        if (sc > score + 1e-4) { Object.assign(handles, cand); score = sc; improved = true; }
      }
    }
    if (!improved) step *= 0.55;
  }
  const centers = centersFromHandles(model, handles);
  const q = gridScore(centers, blobs, cell);
  const lines = data ? lineScore(centers, data, w, h, cell) : 0;
  const foot = footprintOverlap(centers, blobs, cell);
  return {
    handles, centers, cell, stickers: visibleStickers(model),
    hits: q.matched, unexplained: q.unexplained, lines, foot, patches: q.score,
    score: 0.3 * q.score + 0.35 * lines + 0.35 * foot,
  };
}

export function fitCube(model, blobs, w, h, start, data) {
  if (blobs.length < 9) return null;
  const seed = clusterSeed(blobs);
  if (!seed.center || seed.count < 9) return null;
  const stickers = visibleStickers(model);
  const perms = cyclePermutations(stickers);

  const finish = (fit) => {
    if (!fit || fit.matched.length < 10) return null;
    const handles = {};
    for (const [name, p3] of Object.entries(CORNERS_3D)) {
      const xy = project(fit.P, p3);
      if (!xy) return null;
      handles[name] = xy;
    }
    return {
      P: fit.P, handles, cell: fit.cell, centers: fit.centers, stickers,
      score: Math.max(0, fit.total), patches: fit.score, lines: fit.lines, foot: fit.foot,
      hits: fit.matched.length, unexplained: fit.unexplained,
    };
  };

  // Several hypotheses for size and rotation, refined and judged in full.
  // A single starting guess is not enough: the grid can settle one cell off
  // along the cube's own lattice, and from there no local step escapes.
  const icp = (startCenters, startCell, iterations = 5) => {
    let centers = startCenters, cell = startCell, P = null, matched = [];
    for (let iter = 0; iter < iterations; iter++) {
      const pairs = [];
      centers.forEach((c, i) => {
        blobs.forEach((b, j) => {
          const d = Math.hypot(b.cx - c[0], b.cy - c[1]);
          if (d < cell * 0.7 && b.size > cell * 0.3 && b.size < cell * 1.7) pairs.push([d, i, j]);
        });
      });
      pairs.sort((x, y) => x[0] - y[0]);
      const usedSticker = new Set(), usedBlob = new Set();
      matched = [];
      for (const [, i, j] of pairs) {
        if (usedSticker.has(i) || usedBlob.has(j)) continue;
        usedSticker.add(i); usedBlob.add(j);
        matched.push({ sticker: i, blob: j });
      }
      if (matched.length < 8) return null;
      const pts2 = matched.map((m) => [blobs[m.blob].cx, blobs[m.blob].cy]);
      let Pn = solveCamera(matched.map((m) => stickers[m.sticker].p3), pts2);
      if (!Pn) return null;
      if (!orientationOk(Pn)) {
        let fixed = null;
        for (const perm of perms) {
          if (perm.some((v) => v === undefined)) continue;
          const alt = solveCamera(matched.map((m) => stickers[perm[m.sticker]].p3), pts2);
          if (alt && orientationOk(alt)) {
            matched = matched.map((m) => ({ ...m, sticker: perm[m.sticker] }));
            fixed = alt;
            break;
          }
        }
        if (!fixed) return null;
        Pn = fixed;
      }
      const proj = stickers.map((st) => project(Pn, st.p3));
      if (proj.some((c) => !c || !isFinite(c[0]) || !isFinite(c[1]))) return null;
      P = Pn;
      centers = proj;
      const d1 = Math.hypot(centers[0][0] - centers[1][0], centers[0][1] - centers[1][1]);
      const d2 = Math.hypot(centers[0][0] - centers[3][0], centers[0][1] - centers[3][1]);
      cell = Math.max(3, Math.min(d1, d2) || cell);
    }
    const q = gridScore(centers, blobs, cell);
    const lines = data ? lineScore(centers, data, w, h, cell) : 0;
    const foot = footprintOverlap(centers, blobs, cell);
    return {
      P, centers, cell, matched, ...q, lines, foot,
      total: 0.35 * q.score + 0.2 * lines + 0.45 * foot,
    };
  };

  // Tracking: once the grid is known, following it from frame to frame is
  // cheap. Only a fresh acquisition pays for the full search below.
  if (start && start.P) {
    const c0 = stickers.map((st) => project(start.P, st.p3));
    if (!c0.some((c) => !c)) {
      const d = Math.hypot(c0[0][0] - c0[1][0], c0[0][1] - c0[1][1]);
      const tracked = icp(c0, Math.max(3, d));
      if (tracked && tracked.total > 0.62) return finish(tracked);
    }
  }

  const hypotheses = [];
  for (const seed of latticeSeeds(model, blobs)) {
    const ok = seed.centers.every((c) => isFinite(c[0]) && isFinite(c[1]));
    if (ok) hypotheses.push({ centers: seed.centers, cell: seed.cell, rough: 0.5 });
  }
  for (let f = 2.7; f <= 4.3; f += 0.2) {
    for (let th = -0.38; th <= 0.381; th += 0.076) {
      for (const [ox, oy] of [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]) {
        const pose = [seed.center[0] + ox * seed.size, seed.center[1] + oy * seed.size, seed.size * f, th];
        const handles0 = poseHandles(...pose);
        const rough = matchScore(model, handles0, blobs, pose[2] / 3).score;
        hypotheses.push({ centers: stickerCenters(model, handles0).map((c) => c.xy), cell: pose[2] / 3, rough, pose });
      }
    }
  }
  let best = null;
  const lattice = hypotheses.filter((hy) => hy.rough === 0.5);
  const rest = hypotheses.filter((hy) => hy.rough !== 0.5).sort((x, y) => y.rough - x.rough);
  for (const hyp of lattice.concat(rest.slice(0, 18))) {
    const res = icp(hyp.centers, hyp.cell);
    if (res && (!best || res.total > best.total)) best = res;
    if (best && best.total > 0.93) break;      // good enough, stop early
  }

  return finish(best);
}

// Median colour of a small square, robust to a stray highlight.
function patchColor(data, w, h, x, y, r) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
  if (x1 < x0 || y1 < y0) return null;
  const rs = [], gs = [], bs = [];
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const k = (py * w + px) * 4;
    rs.push(data[k]); gs.push(data[k + 1]); bs.push(data[k + 2]);
  }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}

// ---------------------------------------------------------------------------
// Reading the 27 stickers over several frames
// ---------------------------------------------------------------------------

export class Tracker {
  constructor(model, { votes = 3, tolerance = 44 } = {}) {
    this.goodFrames = 0;
    this.model = model;
    this.votesNeeded = votes;
    this.tolerance = tolerance;
    this.reset();
  }

  reset() {
    this.goodFrames = 0;
    this.votes = new Map();     // sticker key -> [rgb, ...]
    this.locked = new Map();    // sticker key -> rgb
    this.doubts = new Map();    // sticker key -> readings that contradict the locked colour
    this.guessed = new Set();   // filled from a single frame, worth a second look
    this.pose = null;
    this.blockHint = null;
    this.handles = null;
    this.lastFit = null;
    this.stuck = 0;             // frames since the count last went up
  }

  get total() { return 27; }
  get read() { return this.locked.size; }
  get done() { return this.locked.size === 27; }
  get missing() {
    return this.lastFit
      ? this.lastFit.stickers.map((s) => s.key).filter((k) => !this.locked.has(k))
      : [];
  }

  // Agreement by majority, not unanimity: one bad frame (a refocus, a shake)
  // must not block a sticker for ever.
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

  // One frame: returns what was seen, and grows the readings.
  update(data, w, h) {
    // shapes are looked for on a smoothed copy (sensor noise and the speckle
    // of a glossy sticker make the patches ragged), colours always come from
    // the original pixels
    const shapes = new Uint8ClampedArray(data);
    smooth(shapes, w, h);
    // The frame is marked by comparing each pixel with its surroundings, and
    // how wide those surroundings are matters: too wide and the thin lines of
    // a small cube are lost. We do not know how big the cube looks, so a few
    // widths are tried and the one whose grid fits best wins.
    // Two ways of finding the stickers, because neither wins everywhere: the
    // holes of the dark frame (robust to printed logos and shading) and
    // patches of uniform colour (better when the frame is not clearly dark).
    // The width of the surroundings used to mark the frame matters too, and
    // the apparent size of the cube is unknown, so a few are tried. Whichever
    // grid fits best wins.
    const minArea = Math.max(10, Math.round((w * h) / 20000));
    const sources = [];
    if (this.blockHint) {
      sources.push(this.blockHint === "color"
        ? { key: "color", blobs: segmentBlobs(shapes, w, h, { minArea, colorFrom: data }) }
        : { key: this.blockHint, blobs: segmentHoles(shapes, w, h, { colorFrom: data, block: this.blockHint, thicken: 1 }) });
    } else {
      for (const width of [w / 26, w / 16, w / 10]) {
        const block = Math.max(6, Math.round(width));
        sources.push({ key: block, blobs: segmentHoles(shapes, w, h, { colorFrom: data, block, thicken: 1 }) });
      }
      sources.push({ key: "color", blobs: segmentBlobs(shapes, w, h, { minArea, colorFrom: data }) });
    }
    let fit = null, blobs = [];
    for (const source of sources) {
      if (source.blobs.length > blobs.length) blobs = source.blobs;   // for the message
      if (source.blobs.length < 9) continue;
      const onLattice = latticeCluster(source.blobs);
      if (onLattice.length < 9) continue;
      for (const candidate of [
        fitFromSilhouette(this.model, onLattice, w, h, shapes),
        fitCube(this.model, onLattice, w, h, this.pose, shapes),
      ]) {
        if (candidate && (!fit || candidate.score > fit.score)) {
          fit = candidate;
          blobs = onLattice;
          this.blockHint = source.key;
        }
      }
    }
    if (!fit) this.blockHint = null;   // lost it: search the widths again
    this.lastFit = fit;
    if (!fit || fit.score < 0.3) {
      return { blobs: blobs.length, fit: null, read: this.read, message: blobs.length < 8
        ? "Enfoca el cubo: acércalo o busca más luz"
        : "Buscando el cubo…" };
    }
    this.pose = { P: fit.P };
    this.handles = fit.handles;
    this.goodFrames = fit.score >= 0.5 ? this.goodFrames + 1 : 0;
    const centers = fit.stickers.map((s, i) => ({ key: s.key, xy: fit.centers[i] }));
    const tol = fit.cell * 0.5;
    const before = this.read;
    if (fit.score < 0.42) {
      // the grid is not solid enough to trust what is under it
      this.stuck = this.stuck + 1;
      return { blobs: blobs.length, fit, read: this.read, centers, stuck: this.stuck,
               message: `Leídas ${this.read} de 27 · sujeta el cubo un poco más quieto` };
    }
    for (const c of centers) {
      let best = null, bestD = Infinity;
      for (const b of blobs) {
        const d = Math.hypot(b.cx - c.xy[0], b.cy - c.xy[1]);
        if (d < bestD) { bestD = d; best = b; }
      }
      let rgb = null, fromPatch = false;
      if (best && bestD <= tol && best.size > fit.cell * 0.35 && best.size < fit.cell * 1.6) {
        rgb = best.rgb;
      } else if (this.goodFrames >= 1 && fit.score >= 0.45) {
        // no patch here (glare, a shadow, two stickers merged): read the pixels
        // under the grid instead, now that we trust where the grid is
        rgb = patchColor(data, w, h, c.xy[0], c.xy[1], Math.max(1, fit.cell * 0.18));
        fromPatch = true;
      }
      if (!rgb) continue;
      // A sticker that was locked from a bad moment must be able to change its
      // mind: readings that keep contradicting it unlock it.
      const held = this.locked.get(c.key);
      if (held) {
        const far = Math.hypot(rgb[0] - held[0], rgb[1] - held[1], rgb[2] - held[2]) > this.tolerance * 1.3;
        const n = (this.doubts.get(c.key) || 0) + (far ? 1 : -1);
        this.doubts.set(c.key, Math.max(0, n));
        if (n >= 3) {
          this.locked.delete(c.key);
          this.votes.delete(c.key);
          this.doubts.delete(c.key);
          this.guessed.delete(c.key);
        }
      }
      const list = this.votes.get(c.key) || [];
      list.push(rgb);
      if (list.length > 7) list.shift();
      this.votes.set(c.key, list);
      const agreed = this._consensus(list);
      if (agreed) {
        this.locked.set(c.key, agreed);
        this.guessed.delete(c.key);   // settled on its own: no longer a guess
      }
    }
    const read = this.read;
    this.stuck = read > before ? 0 : this.stuck + 1;
    return {
      blobs: blobs.length, fit, read, centers, stuck: this.stuck,
      message: read === 27
        ? "¡Las 27 leídas!"
        : `Leídas ${read} de 27 · gira un poco el cubo o cambia el ángulo`,
    };
  }

  colors() {
    return Object.fromEntries(this.locked);
  }

  // Finish the job from one frame: whatever is still missing is read off the
  // grid we have. Those keys are returned so they can be flagged for review.
  fillFrom(data, w, h) {
    const fit = this.lastFit;
    if (!fit) return [];
    const filled = [];
    fit.stickers.forEach((st, i) => {
      if (this.locked.has(st.key)) return;
      const xy = fit.centers[i];
      const rgb = patchColor(data, w, h, xy[0], xy[1], Math.max(1, fit.cell * 0.18));
      if (!rgb) return;
      this.locked.set(st.key, rgb);
      this.guessed.add(st.key);
      filled.push(st.key);
    });
    return filled;
  }
}
