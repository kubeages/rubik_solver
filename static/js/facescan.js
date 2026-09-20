// Scanning the cube one face at a time.
//
// Six steps, each showing a single face to the camera. Reading a flat 3x3
// grid is a far easier problem than reading three faces at once from a
// corner, which is why this exists: the stickers are big, there is no
// perspective to undo and no ambiguity about which face is which.

import { FaceReader } from "./face.js";

const NS = "http://www.w3.org/2000/svg";

// The order asks for the four sides first, turning the cube always the same
// way, and then the top and the bottom. Following it, each face's rows and
// columns land straight on the cube's own layout.
export const STEPS = [
  {
    face: "F", name: "de delante",
    how: "Sujeta el cubo de frente a la cámara, sin inclinarlo, y acércalo hasta que la cara llene buena parte de la imagen. Esta será la cara de delante.",
  },
  {
    face: "R", name: "de la derecha",
    how: "Gira el cubo un cuarto de vuelta, de forma que la cara que estaba a la derecha quede ahora de frente. Mantén arriba la misma cara de siempre.",
  },
  {
    face: "B", name: "de detrás",
    how: "Otro cuarto de vuelta en el mismo sentido: ahora te mira la cara de detrás.",
  },
  {
    face: "L", name: "de la izquierda",
    how: "Otro cuarto de vuelta más, el último de la vuelta completa: la cara de la izquierda.",
  },
  {
    face: "U", name: "de arriba",
    how: "Vuelve a la posición del principio (la primera cara mirándote) e inclina el cubo hacia delante, como si asomaras la cara de arriba a la cámara.",
  },
  {
    face: "D", name: "de abajo",
    how: "Y ahora al revés: inclina el cubo hacia atrás para enseñar la cara de abajo.",
  },
];

const HOLD_FRAMES = 2;      // frames with the nine settled before moving on
const TURN_PAUSE_MS = 2200; // time to turn the cube before reading the next face
const RESCUE_MS = 7000;     // one sticker stuck: read it off the grid
const PATIENCE_MS = 18000;  // after this, offer to place the grid by hand

export class FaceScan {
  constructor(model, els, { onDone, onCancel, onFrame }) {
    this.model = model;
    this.els = els;
    this.onDone = onDone;
    this.onCancel = onCancel;
    this.onFrame = onFrame || (() => {});
    this.reader = new FaceReader();
    this.faces = {};            // face letter -> nine colours
    this.step = 0;
    this.stream = null;
    this.corners = null;        // manual quad, when placing by hand
    this.dragging = null;

    els.shoot.addEventListener("click", () => this.acceptCurrent());
    els.cancel.addEventListener("click", () => { this.stop(); this.onCancel(); });
    if (els.manual) els.manual.addEventListener("click", () => this.handOver(true));
    if (els.retake) els.retake.addEventListener("click", () => this.retakeFace());
    if (els.use) els.use.addEventListener("click", () => this.acceptManual());
    if (els.diag) els.diag.addEventListener("click", () => this.saveFrame());
    const svg = els.overlay;
    svg.addEventListener("pointerdown", (e) => this._down(e));
    svg.addEventListener("pointermove", (e) => this._move(e));
    svg.addEventListener("pointerup", () => { this.dragging = null; });
    svg.addEventListener("pointercancel", () => { this.dragging = null; });
  }

  async begin() {
    this.faces = {};
    this.step = 0;
    this.reader.reset();
    this.manual = false;
    await this.startCamera();
  }

  async startCamera() {
    this.manual = false;
    this.corners = null;
    this._showButtons("camera");
    this.els.canvas.style.display = "none";
    this.els.video.style.display = "block";
    this._updateTexts();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.els.hint.textContent = "Este navegador no permite usar la cámara aquí (hace falta HTTPS).";
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
      this.size = [v.videoWidth || 1280, v.videoHeight || 960];
      this._startLoop();
    } catch (err) {
      this.els.hint.textContent = "No se pudo abrir la cámara: " + (err.message || err);
    }
  }

  stop() {
    this._stopLoop();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  _startLoop() {
    this._stopLoop();
    this._startedAt = Date.now();
    this._settledFrames = 0;
    const tick = () => {
      this._timer = null;
      if (this._frame() === "done") return;
      this._timer = setTimeout(tick, 160);
    };
    tick();
  }

  _stopLoop() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  _frame() {
    const v = this.els.video;
    if (!v.videoWidth || v.paused || this.manual) return "idle";
    const [w, h] = this.size = [v.videoWidth, v.videoHeight];
    if (!this._scratch) this._scratch = document.createElement("canvas");
    const sw = Math.min(w, 480), sh = Math.round((sw * h) / w);
    if (this._scratch.width !== sw) { this._scratch.width = sw; this._scratch.height = sh; }
    const ctx = this._scratch.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    this._lastFrame = { data, w: sw, h: sh };
    const res = this.reader.update(data, sw, sh);
    const k = w / sw;
    this._draw(res.grid, k);
    this._showProgress(res);
    this.onFrame({ step: this.step, faces: this.faces, current: this.reader.colors() });

    this._settledFrames = this.reader.done ? this._settledFrames + 1 : 0;
    if (this._settledFrames >= HOLD_FRAMES && this.acceptCurrent()) return "done";
    const waiting = Date.now() - this._startedAt;
    // A sticker under a highlight can refuse to settle for ever. If the grid
    // is complete and almost everything agrees, read the rest off the grid.
    if (waiting > RESCUE_MS && this.reader.read >= 7 && res.grid && res.grid.found >= 8) {
      this.reader.fillFromGrid(data, sw, sh);
      if (this.reader.done && this.acceptCurrent()) return "done";
    }
    if (waiting > PATIENCE_MS) {
      this.handOver(false);
      return "done";
    }
    return "reading";
  }

  // -- the face is read: store it and move on ---------------------------
  acceptCurrent() {
    const colors = this.reader.colors();
    if (colors.some((c) => !c)) {
      this.els.hint.textContent = "Aún faltan pegatinas por leer en esta cara.";
      return false;
    }
    // A cube has six different centres, so a face whose centre matches one
    // already stored is a face already scanned: the cube has not been turned,
    // or has been turned back to one that is done. Either way it must not be
    // recorded twice, which was making the cube come out impossible.
    const already = this._alreadyScanned(colors);
    if (already) {
      this.reader.reset();
      this._settledFrames = 0;
      this._startedAt = Date.now();
      if (this.els.quality) {
        this.els.quality.className = "quality near";
        this.els.quality.innerHTML =
          `<span class="quality-bar"><i style="width:100%"></i></span>` +
          `<span class="quality-msg">Esa cara ya la tienes (la ${already}) · enséñame una que falte</span>`;
      }
      return false;
    }
    const previous = this.step > 0 ? this.faces[STEPS[this.step - 1].face] : null;
    if (previous && sameFace(previous, colors)) {
      this.reader.reset();
      this._settledFrames = 0;
      this._startedAt = Date.now();     // the wait does not count against them
      if (this.els.quality) {
        this.els.quality.className = "quality near";
        this.els.quality.innerHTML =
          `<span class="quality-bar"><i style="width:100%"></i></span>` +
          `<span class="quality-msg">Esa es la cara anterior · gira el cubo a la siguiente</span>`;
      }
      return false;            // keep reading: the loop must not stop here
    }
    this._stopLoop();
    this._flash();
    this.faces[STEPS[this.step].face] = colors;
    this.onFrame({ step: this.step, faces: this.faces, current: [] });
    this.step += 1;
    this.reader.reset();
    if (this.step >= STEPS.length) {
      this.stop();
      this.onDone(this.faces);
      return true;
    }
    this.manual = false;
    this.corners = null;
    this._showButtons("camera");
    this.els.canvas.style.display = "none";
    this.els.video.style.display = "block";
    this._updateTexts();
    this._pauseThenRead();
    return true;
  }

  // Which stored face this one is, if any: centres are one per colour.
  _alreadyScanned(colors) {
    const centre = colors[4];
    if (!centre) return null;
    for (const step of STEPS.slice(0, this.step)) {
      const stored = this.faces[step.face];
      if (!stored || !stored[4]) continue;
      const d = Math.hypot(centre[0] - stored[4][0], centre[1] - stored[4][1], centre[2] - stored[4][2]);
      if (d < 50) return step.name.replace(/^de la |^de /, "");
    }
    return null;
  }

  // A moment to turn the cube before the next face starts being read, or the
  // face still in front of the camera would be read again as the next one.
  _pauseThenRead() {
    this._stopLoop();
    if (this.els.quality) {
      this.els.quality.hidden = false;
      this.els.quality.className = "quality near";
      this.els.quality.innerHTML =
        `<span class="quality-bar"><i style="width:100%"></i></span>` +
        `<span class="quality-msg">Gira el cubo a la siguiente cara…</span>`;
    }
    this._timer = setTimeout(() => this._startLoop(), TURN_PAUSE_MS);
  }

  retakeFace() {
    // start this face again from scratch, keeping the ones already stored
    delete this.faces[STEPS[this.step].face];
    this.reader.reset();
    this.manual = false;
    this.corners = null;
    this._showButtons("camera");
    this.els.canvas.style.display = "none";
    this.els.video.style.display = "block";
    this.startCamera();
  }

  // -- placing the grid by hand on a frozen frame ------------------------
  handOver(onRequest) {
    this._stopLoop();
    const v = this.els.video;
    const [w, h] = [v.videoWidth, v.videoHeight];
    if (!w) return;
    const c = this.els.canvas;
    c.width = w; c.height = h;
    c.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, 0, w, h);
    this.els.video.style.display = "none";
    this.els.canvas.style.display = "block";
    this.manual = true;
    const grid = this.reader.lastGrid;
    const k = 1;
    if (grid && grid.found >= 5) {
      // start from where the detector thinks the face is
      const a = grid.axes[0], b = grid.axes[1];
      const c00 = grid.cells[0][0].xy;
      const scale = this.size[0] / (this._lastFrame ? this._lastFrame.w : this.size[0]);
      this.corners = [
        [(c00[0] - a[0] * 0.5 - b[0] * 0.5) * scale, (c00[1] - a[1] * 0.5 - b[1] * 0.5) * scale],
        [(c00[0] + a[0] * 2.5 - b[0] * 0.5) * scale, (c00[1] + a[1] * 2.5 - b[1] * 0.5) * scale],
        [(c00[0] + a[0] * 2.5 + b[0] * 2.5) * scale, (c00[1] + a[1] * 2.5 + b[1] * 2.5) * scale],
        [(c00[0] - a[0] * 0.5 + b[0] * 2.5) * scale, (c00[1] - a[1] * 0.5 + b[1] * 2.5) * scale],
      ];
    } else {
      const s = Math.min(w, h) * 0.3;
      this.corners = [
        [w / 2 - s, h / 2 - s], [w / 2 + s, h / 2 - s],
        [w / 2 + s, h / 2 + s], [w / 2 - s, h / 2 + s],
      ];
    }
    this._showButtons("manual");
    this.els.hint.textContent = onRequest
      ? "Arrastra las 4 esquinas hasta las esquinas de la cara. Los círculos muestran el color que lee cada pegatina."
      : "No consigo leer esta cara solo. Arrastra las 4 esquinas hasta las esquinas de la cara: los círculos muestran el color que lee cada pegatina.";
    this._sampleManual();
  }

  _sampleManual() {
    const [w, h] = this.size;
    const ctx = this.els.canvas.getContext("2d", { willReadFrequently: true });
    const [p00, p10, p11, p01] = this.corners;
    const at = (u, v) => [0, 1].map((i) =>
      (1 - u) * (1 - v) * p00[i] + u * (1 - v) * p10[i] + u * v * p11[i] + (1 - u) * v * p01[i]);
    const mid = [1 / 6, 1 / 2, 5 / 6];
    const cell = Math.hypot(p10[0] - p00[0], p10[1] - p00[1]) / 3;
    const r = Math.max(2, cell * 0.22);
    this.manualCells = [];
    for (let row = 0; row < 3; row++) {
      const cells = [];
      for (let col = 0; col < 3; col++) {
        const xy = at(mid[col], mid[row]);
        cells.push({ xy, rgb: medianPatch(ctx, xy[0], xy[1], r, w, h), found: true });
      }
      this.manualCells.push(cells);
    }
    this._draw({ cells: this.manualCells, found: 9 }, 1, true);
  }

  acceptManual() {
    if (!this.manualCells) return;
    const colors = [];
    for (const row of this.manualCells) for (const cell of row) colors.push(cell.rgb);
    this.faces[STEPS[this.step].face] = colors;
    this._flash();
    this.step += 1;
    this.reader.reset();
    this.manual = false;
    this.corners = null;
    if (this.step >= STEPS.length) {
      this.stop();
      this.onDone(this.faces);
      return;
    }
    this._showButtons("camera");
    this.els.canvas.style.display = "none";
    this.els.video.style.display = "block";
    this._updateTexts();
    this._pauseThenRead();
  }

  // -- drawing -----------------------------------------------------------
  _draw(grid, k, manual = false) {
    const svg = this.els.overlay;
    const [w, h] = this.size;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = "";
    const s = Math.min(w, h) / 480;
    const add = (tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
      svg.appendChild(e);
      return e;
    };
    if (manual && this.corners) {
      add("polygon", {
        points: this.corners.map((p) => p.join(",")).join(" "),
        fill: "none", stroke: "rgba(80,220,140,.9)", "stroke-width": 2.4 * s,
      });
    }
    if (grid && grid.cells) {
      grid.cells.forEach((row, r) => row.forEach((cell, c) => {
        const settled = manual ? cell.rgb : this.reader.settled[r * 3 + c];
        const rgb = settled || cell.rgb;
        add("circle", {
          cx: cell.xy[0] * k, cy: cell.xy[1] * k, r: (rgb ? 11 : 7) * s,
          fill: rgb ? `rgb(${rgb.map(Math.round).join(",")})` : "none",
          stroke: rgb ? "#fff" : "rgba(255,255,255,.6)", "stroke-width": (rgb ? 2.4 : 1.6) * s,
        });
      }));
    }
    if (manual && this.corners) {
      this.corners.forEach((p, i) => {
        const e = add("circle", { cx: p[0], cy: p[1], r: 15 * s, class: "handle", "data-corner": i });
        e.style.strokeWidth = 3 * s;
      });
    }
  }

  _showProgress(res) {
    const box = this.els.quality;
    if (!box) return;
    box.hidden = false;
    const read = res.read || 0;
    box.className = `quality ${read === 9 ? "ok" : read >= 5 ? "near" : "bad"}`;
    const waiting = Date.now() - this._startedAt;
    const left = Math.max(0, Math.ceil((PATIENCE_MS - waiting) / 1000));
    let tail = "";
    if (read < 9 && waiting > 4000 && read >= 6) tail = " · mueve un poco el cubo para quitar reflejos";
    if (read < 9 && left < 8) tail = ` (en ${left} s lo ajustamos a mano)`;
    box.innerHTML =
      `<span class="quality-bar"><i style="width:${Math.round((read / 9) * 100)}%"></i></span>` +
      `<span class="quality-msg">${res.message}${tail}</span>`;
  }

  _updateTexts() {
    const step = STEPS[this.step];
    this.els.title.textContent = `Cara ${this.step + 1} de 6 · ${step.name}`;
    this.els.instructions.textContent = step.how;
    this.els.hint.textContent = "Se pasa sola a la siguiente cara en cuanto lee las 9 pegatinas.";
    if (this.els.onStep) this.els.onStep(this.step, this.faces);
  }

  _showButtons(state) {
    const e = this.els;
    e.shoot.hidden = state !== "camera";
    e.shoot.textContent = "Dar por buena esta cara";
    if (e.manual) e.manual.hidden = state !== "camera";
    if (e.retake) {
      e.retake.hidden = false;
      e.retake.textContent = "Repetir esta cara";
    }
    if (e.use) {
      e.use.hidden = state !== "manual";
      e.use.textContent = "Usar esta cara ›";
    }
    if (e.uploadLabel) e.uploadLabel.hidden = true;
    if (e.autoToggle) e.autoToggle.parentElement.hidden = true;
    if (e.diag) e.diag.hidden = state !== "camera";
  }

  _flash() {
    const wrap = this.els.canvas.parentElement;
    wrap.classList.add("flash");
    setTimeout(() => wrap.classList.remove("flash"), 320);
  }

  saveFrame() {
    const v = this.els.video;
    if (!v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const a = document.createElement("a");
    a.download = `rubik-cara-${STEPS[this.step].face}-${Date.now()}.jpg`;
    a.href = c.toDataURL("image/jpeg", 0.92);
    a.click();
  }

  // -- dragging the manual corners ---------------------------------------
  _svgPoint(e) {
    const svg = this.els.overlay;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  _down(e) {
    if (!this.manual || !this.corners) return;
    const p = this._svgPoint(e);
    let best = -1, bestD = Infinity;
    this.corners.forEach((c, i) => {
      const d = Math.hypot(c[0] - p.x, c[1] - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (bestD < Math.min(...this.size) * 0.12) {
      this.dragging = best;
      this.els.overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  _move(e) {
    if (this.dragging === null || !this.manual) return;
    const p = this._svgPoint(e);
    this.corners[this.dragging] = [p.x, p.y];
    this._sampleManual();
  }
}

// Two readings of nine stickers that agree everywhere are the same face.
function sameFace(a, b) {
  if (!a || !b) return false;
  let worst = 0;
  for (let i = 0; i < 9; i++) {
    if (!a[i] || !b[i]) return false;
    worst = Math.max(worst, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
  }
  return worst < 30;
}

function medianPatch(ctx, x, y, r, w, h) {
  const x0 = Math.max(0, Math.round(x - r)), y0 = Math.max(0, Math.round(y - r));
  const x1 = Math.min(w - 1, Math.round(x + r)), y1 = Math.min(h - 1, Math.round(y + r));
  if (x1 <= x0 || y1 <= y0) return [128, 128, 128];
  const data = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
  const rs = [], gs = [], bs = [];
  for (let i = 0; i < data.length; i += 4) { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); }
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}
