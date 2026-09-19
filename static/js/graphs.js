// SVG graph views: the sticker graph (54 facelets + face-turn rings), the
// neighbourhood of the current vertex, the BFS layers of the stage graph
// and the path followed so far.
import { COLORS } from "./cubemodel.js";

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const FACE_ACCENT = { U: "#7a5cff", R: "#e8590c", F: "#2b8a3e", D: "#868e96", L: "#d6336c", B: "#1971c2" };

// ---------------------------------------------------------------------------
// Sticker graph
// ---------------------------------------------------------------------------

// Lambert azimuthal equal-area projection centred on the URF corner: the
// three faces you see in the first photo sit in the middle and the three
// hidden ones wrap around the outside, every sticker keeping the same area.
function project(p) {
  const len = Math.hypot(...p);
  const u = p.map((v) => v / len);
  const w = [1, 1, 1].map((v) => v / Math.sqrt(3));
  const e1 = [1, 0, -1].map((v) => v / Math.SQRT2);
  const e2 = [-1, 2, -1].map((v) => v / Math.sqrt(6));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cosT = Math.max(-1, Math.min(1, dot(u, w)));
  const theta = Math.acos(cosT);
  const phi = Math.atan2(dot(u, e2), dot(u, e1));
  const r = 2 * Math.sin(theta / 2);
  return [r * Math.cos(phi), -r * Math.sin(phi)];
}

// closed centripetal Catmull-Rom curve through pts, sampled `per` times per segment
function closedCurve(pts, per = 14) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) =>
        0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  return out;
}

function pathD(samples) {
  return "M" + samples.map((p) => p[0].toFixed(2) + "," + p[1].toFixed(2)).join("L") + "Z";
}

export class StickerGraph {
  constructor(svg, model, { scale = 46, nodeR = 4.6 } = {}) {
    this.svg = svg;
    this.model = model;
    this.scale = scale;
    this.nodeR = nodeR;
    this.speed = 1;
    this.colors = null;
    this.gen = 0;
    this.queue = Promise.resolve();
    this.pos = model.stickers.map(({ pos, normal }) => {
      const p = pos.map((v, k) => v + 0.5 * normal[k]);
      return project(p).map((v) => v * scale);
    });
    this._cycles();
    this._draw();
  }

  _cycles() {
    // per face: ring (12 stickers, a quarter turn shifts by 3) and face cycle (8, shifts by 2)
    this.cycles = {};
    const faces = this.model.faces.split("");
    for (const f of faces) {
      const ring = this.model.rings[f].ring;
      const perm = this.model.perms[f];
      const k = faces.indexOf(f);
      let cyc = [0, 1, 2, 5, 8, 7, 6, 3].map((i) => 9 * k + i);
      if (perm[cyc[0]] !== cyc[2]) cyc = cyc.reverse();
      this.cycles[f] = {
        ring: { idx: ring, shift: 3, samples: closedCurve(ring.map((i) => this.pos[i])) },
        face: { idx: cyc, shift: 2, samples: closedCurve(cyc.map((i) => this.pos[i]), 10) },
      };
    }
  }

  _draw() {
    this.svg.innerHTML = "";
    const R = this.scale * 2 + 8;
    this.svg.setAttribute("viewBox", `${-R} ${-R} ${2 * R} ${2 * R}`);
    const ringColor = css("--ring") || "#c9c3b5";
    this.ringLayer = el("g", { fill: "none" }, this.svg);
    this.ringPaths = {};
    for (const [f, c] of Object.entries(this.cycles)) {
      this.ringPaths[f] = {
        ring: el("path", { d: pathD(c.ring.samples), stroke: ringColor, "stroke-width": 0.8, opacity: 0.9 }, this.ringLayer),
        face: el("path", { d: pathD(c.face.samples), stroke: ringColor, "stroke-width": 0.5, opacity: 0.6 }, this.ringLayer),
      };
    }
    this.nodeLayer = el("g", {}, this.svg);
    this.nodes = this.pos.map((p, i) => {
      const center = i % 9 === 4;
      const c = el("circle", {
        cx: p[0], cy: p[1], r: center ? this.nodeR * 1.12 : this.nodeR,
        stroke: "#222", "stroke-width": center ? 1.1 : 0.6, fill: "#999",
      }, this.nodeLayer);
      const t = el("title", {}, c);
      t.textContent = `${this.model.faces[Math.floor(i / 9)]}${(i % 9) + 1}`;
      return c;
    });
  }

  setColors(colors) {
    this.colors = colors.slice();
    this.nodes.forEach((n, i) => {
      n.setAttribute("fill", COLORS[colors[i]] ? COLORS[colors[i]].hex : "#999");
      n.setAttribute("cx", this.pos[i][0]);
      n.setAttribute("cy", this.pos[i][1]);
    });
  }

  focus(indices) {
    const set = new Set(indices || []);
    this.nodes.forEach((n, i) => {
      n.setAttribute("opacity", set.size && !set.has(i) ? 0.35 : 1);
      n.setAttribute("stroke-width", set.has(i) ? 1.6 : (i % 9 === 4 ? 1.1 : 0.6));
    });
  }

  play(moves) {
    const gen = this.gen;
    this.queue = this.queue.then(async () => {
      for (const m of moves) {
        if (gen !== this.gen) return;
        await this._animate(m);
      }
    });
    return this.queue;
  }

  jumpTo(colors) {
    this.gen++;
    this.queue = this.queue.then(() => this.setColors(colors));
    return this.queue;
  }

  _animate(move) {
    const face = move[0];
    const cyc = this.cycles[face];
    if (!cyc) return Promise.resolve();
    const turns = move.endsWith("2") ? 2 : move.endsWith("'") ? -1 : 1;
    const paths = this.ringPaths[face];
    const accent = FACE_ACCENT[face];
    paths.ring.setAttribute("stroke", accent);
    paths.ring.setAttribute("stroke-width", 2.4);
    paths.face.setAttribute("stroke", accent);
    paths.face.setAttribute("stroke-width", 1.4);
    this.ringLayer.appendChild(paths.ring);
    const duration = (turns === 2 ? 620 : 420) / this.speed;
    const movers = [];
    for (const part of [cyc.ring, cyc.face]) {
      const n = part.idx.length;
      const per = part.samples.length / n;
      part.idx.forEach((sticker, k) => {
        movers.push({ node: this.nodes[sticker], samples: part.samples, from: k * per, delta: turns * part.shift * per });
      });
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - t0) / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        for (const m of movers) {
          const L = m.samples.length;
          let x = (m.from + m.delta * e) % L;
          if (x < 0) x += L;
          const i0 = Math.floor(x), f = x - i0;
          const a = m.samples[i0], b = m.samples[(i0 + 1) % L];
          m.node.setAttribute("cx", a[0] + (b[0] - a[0]) * f);
          m.node.setAttribute("cy", a[1] + (b[1] - a[1]) * f);
        }
        if (t < 1) {
          requestAnimationFrame(step);
          return;
        }
        const ringColor = css("--ring") || "#c9c3b5";
        paths.ring.setAttribute("stroke", ringColor);
        paths.ring.setAttribute("stroke-width", 0.8);
        paths.face.setAttribute("stroke", ringColor);
        paths.face.setAttribute("stroke-width", 0.5);
        this.setColors(this.model.apply(this.colors, move));
        resolve();
      };
      requestAnimationFrame(step);
    });
  }
}

// ---------------------------------------------------------------------------
// Neighbourhood of the current vertex
// ---------------------------------------------------------------------------

export function drawNeighbors(svg, step, { mode }) {
  svg.innerHTML = "";
  if (!step) return;
  const good = css("--good"), same = css("--same"), bad = css("--bad"), accent = css("--accent");
  const ink = css("--ink"), surface = css("--surface"), line = css("--line");
  const nbs = step.neighbors;
  const d0 = mode === "fast" ? step.h_before : step.d_before;
  const n = nbs.length;
  const R = n > 12 ? 78 : 70;
  const edges = el("g", {}, svg);
  const nodes = el("g", {}, svg);
  nbs.forEach((nb, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const x = R * Math.cos(a), y = R * Math.sin(a);
    const chosen = nb.label === step.label && nb.alg === step.alg;
    let col = same;
    if (nb.d === null || nb.d === undefined) col = line;
    else if (nb.d < d0) col = good;
    else if (nb.d > d0) col = bad;
    el("line", {
      x1: 0, y1: 0, x2: x, y2: y, stroke: chosen ? accent : col,
      "stroke-width": chosen ? 3.2 : 1.2, opacity: chosen ? 1 : 0.7,
      "stroke-dasharray": nb.d === null ? "3 3" : "none",
    }, edges);
    const r = n > 12 ? 9.5 : 11;
    el("circle", { cx: x, cy: y, r, fill: surface, stroke: chosen ? accent : col, "stroke-width": chosen ? 3 : 2 }, nodes);
    const t = el("text", { x, y: y + 3.6, "text-anchor": "middle", "font-size": 9.5, "font-weight": 700, fill: ink }, nodes);
    t.textContent = nb.d === null || nb.d === undefined ? "–" : nb.d;
    const lx = (R + (n > 12 ? 21 : 24)) * Math.cos(a), ly = (R + (n > 12 ? 20 : 23)) * Math.sin(a);
    const lab = el("text", {
      x: lx, y: ly + 3.5, "text-anchor": "middle", "font-size": n > 12 ? 9 : 9.5,
      "font-weight": chosen ? 700 : 500, fill: chosen ? accent : css("--ink-2"), class: "mono",
    }, nodes);
    lab.textContent = nb.short || nb.label;
    const title = el("title", {}, lab);
    title.textContent = `${nb.label}${nb.alg !== nb.label ? " · " + nb.alg : ""}`;
  });
  el("circle", { cx: 0, cy: 0, r: 17, fill: accent }, nodes);
  const c = el("text", { x: 0, y: 5, "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: "#fff" }, nodes);
  c.textContent = d0;
}

// ---------------------------------------------------------------------------
// Layers of the stage graph (BFS levels, log scale)
// ---------------------------------------------------------------------------

export function drawLevels(svg, histogram, current, { label = "distancia a la meta" } = {}) {
  svg.innerHTML = "";
  if (!histogram || !histogram.length) return;
  const W = 320, H = 170, left = 34, bottom = 28, top = 18, right = 8;
  const accent = css("--accent"), muted = css("--ring"), ink2 = css("--ink-3");
  const maxLog = Math.log10(Math.max(...histogram) + 1);
  const n = histogram.length;
  const bw = (W - left - right) / n;
  for (let k = 0; k <= Math.ceil(maxLog); k++) {
    const y = H - bottom - (k / maxLog) * (H - bottom - top);
    if (y < top - 1) break;
    el("line", { x1: left, x2: W - right, y1: y, y2: y, stroke: css("--line"), "stroke-width": 0.6 }, svg);
    const t = el("text", { x: left - 4, y: y + 3, "text-anchor": "end", "font-size": 8, fill: ink2 }, svg);
    t.textContent = k === 0 ? "1" : "10" + "⁰¹²³⁴⁵⁶⁷⁸⁹"[k];
  }
  histogram.forEach((v, d) => {
    const h = (Math.log10(v + 1) / maxLog) * (H - bottom - top);
    const x = left + d * bw + 1.5;
    const isCur = d === current;
    const r = el("rect", {
      x, y: H - bottom - h, width: Math.max(1, bw - 3), height: h, rx: 2,
      fill: isCur ? accent : muted, opacity: isCur ? 1 : 0.8,
    }, svg);
    const tt = el("title", {}, r);
    tt.textContent = `${v.toLocaleString("es")} vértices a distancia ${d}`;
    if (n <= 22 || d % 2 === 0) {
      const t = el("text", { x: x + (bw - 3) / 2, y: H - bottom + 11, "text-anchor": "middle", "font-size": 8.5, fill: ink2 }, svg);
      t.textContent = d;
    }
    if (isCur) {
      const t = el("text", { x: x + (bw - 3) / 2, y: H - bottom - h - 5, "text-anchor": "middle", "font-size": 9, "font-weight": 700, fill: accent }, svg);
      t.textContent = "tú";
    }
  });
  const t = el("text", { x: (W + left) / 2, y: H - 3, "text-anchor": "middle", "font-size": 9, fill: ink2 }, svg);
  t.textContent = label;
}

// ---------------------------------------------------------------------------
// Path so far: distance to the (stage) goal after every step
// ---------------------------------------------------------------------------

export function drawPath(svg, series, current, { bounds = null, separators = [] } = {}) {
  svg.innerHTML = "";
  const W = 320, H = 150, left = 26, right = 8, top = 10, bottom = 20;
  const n = series.length;
  if (!n) return;
  const accent = css("--accent"), ink3 = css("--ink-3"), line = css("--line");
  const maxY = Math.max(1, ...series, ...(bounds || []).filter((v) => v != null));
  const X = (i) => left + (n === 1 ? 0 : (i / (n - 1)) * (W - left - right));
  const Y = (v) => top + (1 - v / maxY) * (H - top - bottom);
  for (const s of separators) {
    el("line", { x1: X(s), x2: X(s), y1: top, y2: H - bottom, stroke: line, "stroke-dasharray": "2 3" }, svg);
  }
  el("line", { x1: left, x2: W - right, y1: Y(0), y2: Y(0), stroke: line }, svg);
  for (const v of [0, maxY]) {
    const t = el("text", { x: left - 4, y: Y(v) + 3, "text-anchor": "end", "font-size": 8, fill: ink3 }, svg);
    t.textContent = v;
  }
  if (bounds) {
    el("polyline", {
      points: bounds.map((v, i) => `${X(i)},${Y(v ?? 0)}`).join(" "),
      fill: "none", stroke: ink3, "stroke-width": 1.2, "stroke-dasharray": "3 3",
    }, svg);
  }
  const done = series.slice(0, current + 1).map((v, i) => `${X(i)},${Y(v)}`).join(" ");
  const todo = series.slice(current).map((v, i) => `${X(i + current)},${Y(v)}`).join(" ");
  el("polyline", { points: todo, fill: "none", stroke: css("--ring"), "stroke-width": 1.6 }, svg);
  el("polyline", { points: done, fill: "none", stroke: accent, "stroke-width": 2.2 }, svg);
  el("circle", { cx: X(current), cy: Y(series[current]), r: 4.5, fill: accent, stroke: css("--surface"), "stroke-width": 1.5 }, svg);
  const t = el("text", { x: (W + left) / 2, y: H - 4, "text-anchor": "middle", "font-size": 9, fill: ink3 }, svg);
  t.textContent = "pasos →";
}

// Small isometric sketch used on the capture screen to show which faces must be visible.
export function drawCaptureGuide(svg, view, faceColors) {
  svg.innerHTML = "";
  const pts = {
    C: [0, 0], T: [0, -50], UR: [43.3, -25], LR: [43.3, 25], B: [0, 50], LL: [-43.3, 25], UL: [-43.3, -25],
  };
  const faces = [["C", "UL", "T", "UR"], ["C", "UL", "LL", "B"], ["C", "UR", "LR", "B"]];
  const labels = view === 0 ? ["arriba", "delante", "derecha"] : ["antes abajo", "antes izquierda", "antes detrás"];
  faces.forEach((q, i) => {
    el("polygon", {
      points: q.map((k) => pts[k].join(",")).join(" "),
      fill: faceColors && faceColors[i] ? COLORS[faceColors[i]].hex : ["#e9e5da", "#d8d3c6", "#c7c1b2"][i],
      stroke: "#333", "stroke-width": 1.2,
    }, svg);
    const cx = q.reduce((s, k) => s + pts[k][0], 0) / 4, cy = q.reduce((s, k) => s + pts[k][1], 0) / 4;
    const t = el("text", { x: cx, y: cy + 3, "text-anchor": "middle", "font-size": 7.5, "font-weight": 600, fill: "#222" }, svg);
    t.textContent = labels[i];
  });
}
