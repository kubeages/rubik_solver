// Reading the cube from two pictures.
//
// Each picture shows three faces with one corner pointing at the camera.
// Seven handles (that corner plus the six outer corners of the hexagonal
// silhouette) define three quadrilaterals; a homography per face maps the
// 3x3 sticker grid into the picture, so perspective is handled.  The 54
// samples are then clustered around the six centre colours with a balanced
// assignment (every colour appears exactly nine times).

import { COLORS, COLOR_KEYS } from "./cubemodel.js";
import { Tracker } from "./detect.js";

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
    this._live = null;         // what the detector saw in the last frame
    this.tracker = null;       // accumulates sticker readings across frames

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
      ? "Sujeta el cubo con una esquina apuntando a la cámara, de forma que se vean las caras de arriba, delante y derecha. No hace falta encajarlo en ningún sitio: muévelo despacio hasta que se lean las 27 pegatinas."
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
        ? "Enséñale el cubo a la cámara: lo busca solo y dispara cuando haya leído las 27 pegatinas."
        : "Enséñale el cubo a la cámara y pulsa Capturar ahora cuando quieras.";
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
    this.tracker = new Tracker(this.model);
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

  get readCount() { return this.tracker ? this.tracker.read : 0; }

  // One look at the live preview: find the cube, read what can be read, and
  // take the picture by itself once all 27 stickers of this view are in.
  _checkFrame() {
    const v = this.els.video;
    if (!v.videoWidth || v.paused || this.els.use.hidden === false) return "idle";
    const [w, h] = this.size;
    if (!this._scratch) this._scratch = document.createElement("canvas");
    // enough pixels for the stickers to survive, not so many that it drags
    const sw = Math.min(w, 480), sh = Math.round((sw * h) / w);
    if (this._scratch.width !== sw) { this._scratch.width = sw; this._scratch.height = sh; }
    const ctx = this._scratch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const res = this.tracker.update(data, sw, sh);
    const k = w / sw;   // back to video coordinates
    if (res.fit) {
      this.handles = Object.fromEntries(
        Object.entries(res.fit.handles).map(([n, p]) => [n, [p[0] * k, p[1] * k]]));
      this._live = {
        centers: res.fit.centers.map((c) => [c[0] * k, c[1] * k]),
        keys: res.fit.stickers.map((st) => st.key),
        cell: res.fit.cell * k,
        score: res.fit.score,
      };
    } else {
      this._live = null;
    }
    this._showQuality(res);
    this._renderOverlay({ interactive: false });
    if (this.auto && this.tracker.done) {
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
    const read = res.read || 0;
    const level = read === 27 ? "ok" : read >= 18 ? "near" : "bad";
    box.className = `quality ${level}`;
    box.innerHTML =
      `<span class="quality-bar"><i style="width:${Math.round((read / 27) * 100)}%"></i></span>` +
      `<span class="quality-msg">${res.message}</span>`;
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
    const accumulated = this.tracker && this.tracker.read ? this.tracker.colors() : null;
    this._stopLiveCheck();
    const v = this.els.video;
    const [w, h] = [v.videoWidth, v.videoHeight];
    if (!w) return;
    const c = this.els.canvas;
    c.width = w; c.height = h;
    c.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0, w, h);
    this._enterAdjust(w, h, this.handles);
    if (accumulated) {
      // readings gathered over several frames beat anything read from one
      this._accumulated = accumulated;
      this.manualEdit = false;
      this.samples = { ...this.samples, ...accumulated };
      this._renderOverlay({ interactive: true });
    }
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
      const found = this._detectStill(w, h);
      this._enterAdjust(w, h, found ? found.handles : null);
      if (found) {
        this._accumulated = found.colors;
        this.manualEdit = false;
        this.samples = { ...this.samples, ...found.colors };
        this._renderOverlay({ interactive: true });
        this.els.hint.textContent = found.read === 27
          ? "Cubo encontrado y leídas las 27 pegatinas. Si alguna no cuadra, arrastra los puntos."
          : `Cubo encontrado (${found.read} de 27 pegatinas leídas). Ajusta los puntos si hace falta.`;
      } else {
        this.els.hint.textContent = "No he encontrado el cubo en la foto: arrastra los 7 puntos hasta sus esquinas.";
      }
    };
    img.src = URL.createObjectURL(file);
  }

  // Look for the cube in a still picture (an upload), the same way as in the
  // live preview.
  _detectStill(w, h) {
    const sw = Math.min(w, 640), sh = Math.round((sw * h) / w);
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(this.els.canvas, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const tracker = new Tracker(this.model, { votes: 2 });
    let res = null;
    for (let i = 0; i < 4; i++) res = tracker.update(data, sw, sh);
    if (!res || !res.fit || tracker.read < 18) return null;
    const k = w / sw;
    return {
      read: tracker.read,
      colors: tracker.colors(),
      handles: Object.fromEntries(
        Object.entries(res.fit.handles).map(([n, p]) => [n, [p[0] * k, p[1] * k]])),
    };
  }

  _enterAdjust(w, h, handles) {
    this._accumulated = null;
    this.manualEdit = false;
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
    const add = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      g.appendChild(e);
      return e;
    };
    if (interactive) {
      // adjusting a frozen picture: show the grid and let the corners be dragged
      for (const [a, b] of gridLines(this.model, this.handles)) {
        add("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: "rgba(255,255,255,.85)", "stroke-width": 1.6 * s });
      }
      if (this.points) {
        for (const p of this.points) {
          const rgb = this.samples[p.key];
          if (!rgb) continue;
          add("circle", { cx: p.xy[0], cy: p.xy[1], r: 7 * s, fill: `rgb(${rgb.map(Math.round).join(",")})`,
                          stroke: "#fff", "stroke-width": 2 * s });
        }
      }
      for (const [k, p] of Object.entries(this.handles)) {
        const c = add("circle", { cx: p[0], cy: p[1], r: 13 * s, class: "handle", "data-handle": k });
        c.style.strokeWidth = 3 * s;
      }
      return;
    }
    // live preview: outline the cube we found and mark every sticker read
    const live = this._live;
    if (!live) return;
    const hull = ["T", "UR", "LR", "B", "LL", "UL"].map((k) => this.handles[k]);
    add("polygon", {
      points: hull.map((p) => p.join(",")).join(" "),
      fill: "none", stroke: "rgba(80,220,140,.9)", "stroke-width": 2.2 * s, "stroke-linejoin": "round",
    });
    for (const k of ["T", "UR", "LR", "B", "LL", "UL"]) {
      add("line", { x1: this.handles.C[0], y1: this.handles.C[1], x2: this.handles[k][0], y2: this.handles[k][1],
                    stroke: "rgba(80,220,140,.35)", "stroke-width": 1.2 * s });
    }
    const locked = this.tracker ? this.tracker.locked : new Map();
    live.centers.forEach((xy, i) => {
      const rgb = locked.get(live.keys[i]);
      add("circle", {
        cx: xy[0], cy: xy[1], r: (rgb ? 8 : 5) * s,
        fill: rgb ? `rgb(${rgb.map(Math.round).join(",")})` : "none",
        stroke: rgb ? "#fff" : "rgba(255,255,255,.55)", "stroke-width": (rgb ? 2 : 1.4) * s,
      });
    });
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
    this.manualEdit = true;      // from now on the picture wins over the readings
    const p = this._svgPoint(e);
    this.handles[this.dragging] = [p.x, p.y];
    this._sample();
    this._renderOverlay({ interactive: true });
  }

  useView() {
    if (this.manualEdit || !this._accumulated) {
      this._sample();
      this.viewSamples[this.view] = this.samples;
    } else {
      // keep what the camera read across frames; the frozen frame only fills gaps
      this.viewSamples[this.view] = { ...this.samples, ...this._accumulated };
    }
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
