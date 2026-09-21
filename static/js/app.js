import { COLORS, COLOR_KEYS, CubeModel, STANDARD_SCHEME } from "./cubemodel.js";
import { Capture, assemble, assembleDoubtful, classify, VIEW2_COUNT } from "./capture.js";
import { readPieces } from "./pieces.js";
import { FaceScan, STEPS } from "./facescan.js";
import { StickerGraph, drawNeighbors, drawLevels, drawPath, drawCaptureGuide } from "./graphs.js";
import { INFO, attachInfoButtons, techLines } from "./info.js";

const $ = (id) => document.getElementById(id);
const api = async (url, body) => {
  const r = await fetch(url, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (r.status === 401) {
    window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
    throw new Error("Sesión caducada");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
};

const app = {
  model: null,
  meta: null,
  colors: null,        // 54 colour keys being reviewed
  capture: null,       // {viewColors, rotIndex} from the photos
  plan: null,          // solver response
  states: [],          // colour array before each step
  k: 0,                // current step
  cube3d: null,
  graph: null,
  tutorHistory: [],
};

// ---------------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------------

function show(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === `screen-${name}`));
  document.querySelectorAll("[data-screen-link]").forEach((s) => s.classList.toggle("active", s.dataset.screenLink === name));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function modal(html, actions = [{ label: "Entendido", primary: true }]) {
  return new Promise((resolve) => {
    $("modal-body").innerHTML = html;
    const box = $("modal-actions");
    box.innerHTML = "";
    actions.forEach((a, i) => {
      const b = document.createElement("button");
      b.className = "btn" + (a.primary ? " primary" : " ghost");
      b.textContent = a.label;
      b.onclick = () => { $("modal").hidden = true; resolve(i); };
      box.appendChild(b);
    });
    $("modal").hidden = false;
  });
}

// Live technical detail for a box, shown on hover over its ⓘ and repeated
// inside the card for anyone using a finger.
function techContext() {
  const plan = app.plan;
  const step = plan ? plan.steps[app.k] : null;
  return {
    meta: app.meta, plan, step, index: app.k, mode: plan ? plan.mode : null,
    stage: step ? stageOf(step) : null,
    tutor: $("tutor-status") ? $("tutor-status").textContent : "",
  };
}

function techHtml(key) {
  const lines = techLines(key, techContext());
  if (!lines.length) return "";
  return `<dl class="tech">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function openInfo(key) {
  const entry = INFO[key];
  if (!entry) return;
  modal(`<h3>${entry.title}</h3>${entry.html}<h4>Datos técnicos</h4>${techHtml(key)}`,
    [{ label: "Entendido", primary: true }]);
}

let tipEl = null;
let tipAnchor = null;
function showTip(button, key) {
  tipAnchor = { button, key };
  const html = techHtml(key);
  if (!html) return;
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.className = "tip";
    document.body.appendChild(tipEl);
  }
  const entry = INFO[key];
  tipEl.innerHTML = `<b>${entry ? entry.title : ""}</b>${html}<span class="tip-more">Pulsa para la explicación completa</span>`;
  tipEl.hidden = false;
  const r = button.getBoundingClientRect();
  const w = Math.min(340, window.innerWidth - 20);
  tipEl.style.width = `${w}px`;
  const top = r.bottom + 8;
  tipEl.style.left = `${Math.max(10, Math.min(window.innerWidth - w - 10, r.right - w))}px`;
  tipEl.style.top = `${top}px`;
  const h = tipEl.getBoundingClientRect().height;
  if (top + h > window.innerHeight - 10) {
    tipEl.style.top = `${Math.max(10, r.top - h - 8)}px`;
  }
}

function hideTip() {
  tipAnchor = null;
  if (tipEl) tipEl.hidden = true;
}

function repositionTip() {
  if (tipAnchor) showTip(tipAnchor.button, tipAnchor.key);
}

const colorName = (key) => (COLORS[key] ? COLORS[key].name : "?");
const dot = (key) => `<span style="display:inline-block;width:.85em;height:.85em;border-radius:3px;background:${COLORS[key].hex};border:1px solid #0003;vertical-align:-1px"></span>`;

// ---------------------------------------------------------------------------
// home
// ---------------------------------------------------------------------------

function heroAnimation() {
  const svg = $("hero-sticker-graph");
  const g = new StickerGraph(svg, app.model, { scale: 44, nodeR: 4.8 });
  let colors = app.model.fromFacelets(app.meta.solved);
  g.setColors(colors);
  const faces = "URFDLB";
  const scramble = [];
  let t = 0;
  // scramble for 10 moves, then undo them: the graph ends solved again
  const loop = async () => {
    if (!document.getElementById("screen-home").classList.contains("active")) {
      setTimeout(loop, 1500);
      return;
    }
    let m;
    if (t < 10) {
      const last = scramble.length ? scramble[scramble.length - 1][0] : "";
      do { m = faces[Math.floor(Math.random() * 6)] + ["", "'", "2"][Math.floor(Math.random() * 3)]; } while (m[0] === last);
      scramble.push(m);
    } else {
      const u = scramble.pop();
      m = u.endsWith("2") ? u : u.endsWith("'") ? u[0] : u + "'";
    }
    t = (t + 1) % 20;
    await g.play([m]);
    setTimeout(loop, t === 0 ? 1600 : 350);
  };
  g.speed = 0.8;
  setTimeout(loop, 800);
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

function initCapture() {
  app.captureCtl = new Capture(app.model, {
    title: $("capture-title"), instructions: $("capture-instructions"), video: $("capture-video"),
    canvas: $("capture-canvas"), overlay: $("capture-overlay"), shoot: $("btn-shoot"),
    uploadLabel: $("btn-upload-label"), file: $("file-input"), retake: $("btn-retake"),
    use: $("btn-use"), cancel: $("btn-capture-cancel"), hint: $("capture-hint"),
    quality: $("capture-quality"), autoToggle: $("auto-toggle"), diag: $("btn-diag"),
    manual: $("btn-manual"),
    onGuide: (view) => drawCaptureGuide($("capture-guide-svg"), view),
  }, {
    onDone: (res) => {
      app.capture = res;
      app.colors = assemble(app.model, res.viewColors, res.rotIndex);
      app.doubtful = new Set(res.doubtful || []);
      openReview({ fromPhotos: true });
    },
    onCancel: () => show(app.plan ? "solve" : "home"),
    onFrame: (state) => updateCapturePreview(state),
  });
}

function startCapture(mode) {
  show("capture");
  // the sidebar explains whichever way of scanning is in use
  $("guide-faces").hidden = mode !== "camera";
  $("guide-corner").hidden = mode === "camera";
  $("preview-hint").textContent = mode === "camera"
    ? "Las caras que aún no ha leído salen en gris."
    : "Las pegatinas que aún no ha leído salen en gris.";
  if (mode === "camera") {
    ensureFaceScan();
    app.faceCtl.begin();
  } else {
    app.captureCtl.begin(mode);
  }
  ensureCapturePreview();
}

// Camera scanning goes face by face: a flat 3x3 grid is far easier to read
// than three faces at once, which is what kept failing on real cubes.
function ensureFaceScan() {
  if (app.faceCtl) return;
  app.faceCtl = new FaceScan(app.model, {
    title: $("capture-title"), instructions: $("capture-instructions"), video: $("capture-video"),
    canvas: $("capture-canvas"), overlay: $("capture-overlay"), shoot: $("btn-shoot"),
    uploadLabel: $("btn-upload-label"), retake: $("btn-retake"), use: $("btn-use"),
    cancel: $("btn-capture-cancel"), hint: $("capture-hint"), quality: $("capture-quality"),
    autoToggle: $("auto-toggle"), diag: $("btn-diag"), manual: $("btn-manual"),
    onStep: (step, faces) => updateFacePreview(faces, step),
  }, {
    onDone: (faces, doubtful) => {
      app.orientedFaces = 0;
      app.rearranged = null;
      app.ambiguous = false;
      app.overruled = [];
      app.repairedStickers = 0;
      app.doubtful = new Set();
      app.capture = null;
      app.colors = facesToColors(faces, doubtful);   // this also marks the stickers to check
      openReview();
    },
    onCancel: () => show(app.plan ? "solve" : "home"),
    onFrame: ({ faces, current, step }) => updateFacePreview(faces, step, current),
  });
}

// The nine colours of each face land straight on the cube's own layout,
// because the order the steps ask for keeps the same face up throughout.
// What the camera read are raw colours, so they still have to be sorted into
// the six of the cube, anchored on the centres and nine of each.
function facesToColors(faces, doubtful = {}) {
  const samples = {};
  const centreIds = [];
  const lights = {};        // each face was read on its own, under its own light
  const unsure = new Set(); // stickers the camera could not read cleanly
  "URFDLB".split("").forEach((f, k) => {
    const nine = faces[f];
    for (let i = 0; i < 9; i++) {
      const id = String(k * 9 + i);
      samples[id] = nine && nine[i] ? nine[i] : [128, 128, 128];
      lights[id] = k;
      if (i === 4) centreIds.push(id);
      if ((doubtful[f] || []).includes(i)) unsure.add(k * 9 + i);
    }
  });
  app.rawSamples = samples;          // kept for the bug report button
  app.rawUnsure = [...unsure];
  const { colors, margin, lab, prototypes } =
    classify(samples, centreIds, lights, new Set([...unsure].map(String)));
  const centreKeys = centreIds.map((id) => colors[id]);
  const read = readPieces(lab, prototypes, centreKeys, app.model, app.meta, { unsure });
  // Where reading by pieces disagrees with reading each sticker on its own,
  // the structure of the cube has overruled the camera. It is usually right,
  // but it is exactly where a mistake would hide, so those stickers are
  // marked for the user to check.
  const overruled = [];
  for (let i = 0; i < 54; i++) if (read[i] !== colors[String(i)]) overruled.push(i);
  const oriented = orientFaces(read);
  if (app.model.isValid(oriented)) {
    // the marks point at positions, so they only mean anything if the faces
    // stayed where they were read
    const moved = oriented.some((c, i) => c !== read[i]);
    app.overruled = moved ? [] : overruled;
    app.doubtful = new Set([...app.overruled, ...(moved ? [] : unsure)]);
    return oriented;
  }
  // No way of holding the cube explains these colours, so one of them is
  // wrong. Red against orange, white against yellow under a warm light: the
  // doubtful ones are swapped in pairs until the cube makes sense.
  const shaky = Object.keys(margin)
    .sort((a, b) => margin[a] - margin[b])
    .slice(0, 10)
    .map(Number);
  for (let i = 0; i < shaky.length; i++) {
    for (let j = i + 1; j < shaky.length; j++) {
      const a = shaky[i], b = shaky[j];
      if (read[a] === read[b]) continue;
      const candidate = read.slice();
      candidate[a] = read[b];
      candidate[b] = read[a];
      const fixed = orientFaces(candidate);
      if (app.model.isValid(fixed)) {
        app.repairedStickers = 2;
        return fixed;
      }
    }
  }
  return oriented;
}

// Turn a face's nine stickers a quarter turn clockwise.
function turnFace(nine) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 3 + (2 - r)] = nine[r * 3 + c];
  return out;
}

// Work out how the cube was actually held.
//
// The order of the steps assumes a particular way of turning the cube, and a
// hand does not always oblige: a face ends up rotated, or the cube is turned
// the other way round, and then the cube comes out impossible. So the faces
// are tried turned every way, under a handful of ways of holding the cube.
//
// What is NOT tried is putting the faces in any order at all, tempting as it
// was. Measured: with the six faces shuffled, exactly 24 arrangements make a
// cube that could exist and only one of them is the cube in your hands. The
// other 23 are legal cubes made of your stickers glued together differently,
// and solving one of those would send the user turning faces for nothing.
// Six loose faces simply do not say how they were joined; what says it is the
// order they were shown in. So the order is trusted, and if nothing fits, the
// colours are what is wrong, not the way the cube was held.
//
// The search is cut down as it goes: a corner of a cube always shows three
// different colours, and so does no edge, so an assignment that breaks that
// is abandoned before the rest of it is tried.
const POSITIONS = ["U", "R", "F", "D", "L", "B"];
// pieces to check as soon as the faces they touch are placed (facelet indices)
const CORNER_CHECKS = [
  [[8, 9, 20], [0, 1, 2]],        // URF: needs U, R, F
  [[6, 18, 38], [0, 2, 4]],       // UFL
  [[0, 36, 47], [0, 4, 5]],       // ULB
  [[2, 45, 11], [0, 5, 1]],       // UBR
  [[29, 26, 15], [3, 2, 1]],      // DFR
  [[27, 44, 24], [3, 4, 2]],      // DLF
  [[33, 53, 42], [3, 5, 4]],      // DBL
  [[35, 17, 51], [3, 1, 5]],      // DRB
];
const EDGE_CHECKS = [
  [[5, 10], [0, 1]], [[7, 19], [0, 2]], [[3, 37], [0, 4]], [[1, 46], [0, 5]],
  [[32, 16], [3, 1]], [[28, 25], [3, 2]], [[30, 43], [3, 4]], [[34, 52], [3, 5]],
  [[23, 12], [2, 1]], [[21, 41], [2, 4]], [[50, 39], [5, 4]], [[48, 14], [5, 1]],
];

// The ways of holding the cube that the six steps can be read as. Each one
// says which scanned face goes in position U, R, F, D, L, B. They are real
// ways of holding a cube, not arbitrary shuffles, so each gives back the cube
// that is actually in the user's hands.
const HOLDINGS = [
  { how: null, order: [0, 1, 2, 3, 4, 5] },
  { how: "girando el cubo al revés", order: [0, 4, 2, 3, 1, 5] },
  { how: "enseñando abajo donde pedía arriba", order: [3, 1, 2, 0, 4, 5] },
  { how: "girando al revés y con arriba y abajo cambiados", order: [3, 4, 2, 0, 1, 5] },
];

function orientFaces(read) {
  if (app.model.isValid(read)) return read;
  const scanned = POSITIONS.map((_, k) => read.slice(k * 9, k * 9 + 9));
  const turns = scanned.map((nine) => {
    const list = [nine];
    for (let i = 0; i < 3; i++) list.push(turnFace(list[list.length - 1]));
    return list;
  });

  const placed = new Array(6).fill(null);     // position -> turn given to its face
  const ready = new Array(6).fill(false);     // ...which is 0 for an unturned one
  const board = new Array(54).fill(null);
  let order = null;

  const fits = (position) => {
    for (const [facelets, faces] of CORNER_CHECKS) {
      if (!faces.includes(position) || faces.some((f) => !ready[f])) continue;
      const [a, b, c] = facelets.map((i) => board[i]);
      if (a === b || b === c || a === c) return false;
    }
    for (const [facelets, faces] of EDGE_CHECKS) {
      if (!faces.includes(position) || faces.some((f) => !ready[f])) continue;
      if (board[facelets[0]] === board[facelets[1]]) return false;
    }
    return true;
  };

  // every turn of every face, in the order this way of holding the cube says
  const found = [];
  const search = (position) => {
    if (position === 6) {
      const candidate = board.slice();
      if (app.model.isValid(candidate)) {
        found.push({ colors: candidate, how, turned: placed.filter(Boolean).length, holding: rank });
      }
      return;
    }
    for (let turn = 0; turn < 4; turn++) {
      const nine = turns[order[position]][turn];
      for (let i = 0; i < 9; i++) board[position * 9 + i] = nine[i];
      placed[position] = turn;
      ready[position] = true;
      if (fits(position)) search(position + 1);
      ready[position] = false;
      placed[position] = null;
    }
  };

  let how = null, rank = 0;
  HOLDINGS.forEach((holding, i) => {
    order = holding.order;
    how = holding.how;
    rank = i;
    search(0);
  });
  if (!found.length) return read;      // nothing fits: it is the colours that are wrong

  // Take the reading that changes the least of what the user was asked to do.
  // If two different cubes both fit, the faces genuinely do not say which one
  // is on the table, so the user is told to look at the drawing.
  found.sort((a, b) => a.holding - b.holding || a.turned - b.turned);
  const answer = found[0];
  const distinct = new Set(found.map((f) => f.colors.join(""))).size;
  app.rearranged = answer.how;
  app.orientedFaces = answer.turned;
  app.ambiguous = distinct > 1;
  return answer.colors;
}

function updateFacePreview(faces, step, current) {
  const badge = $("preview-count");
  const done = Object.keys(faces || {}).length;
  if (badge) badge.textContent = `${done} de 6 caras`;
  const chips = $("face-progress");
  if (chips) {
    const order = STEPS.map((s) => s.face);
    [...chips.children].forEach((chip, i) => {
      chip.hidden = i >= 6;
      const f = order[i];
      chip.firstChild.textContent = STEPS[i].name.replace("de ", "").replace("la ", "");
      const n = faces[f] ? 9 : (i === step && current ? current.filter(Boolean).length : 0);
      chip.querySelector("b").textContent = `${n}/9`;
      chip.classList.toggle("done", n === 9);
    });
  }
  if (!app.preview) return;
  const painted = new Array(54).fill(UNREAD);
  "URFDLB".split("").forEach((f, k) => {
    const nine = faces[f];
    if (!nine) return;
    for (let i = 0; i < 9; i++) painted[k * 9 + i] = nine[i];
  });
  app.preview.setColors(painted);
}

// A cube next to the camera showing, live, the stickers already read. The
// three faces being shown to the camera are always painted on the same three
// faces of this cube, so it mirrors what the user is holding.
async function ensureCapturePreview() {
  if (app.preview || app.previewFailed) return;
  try {
    const { Cube3D } = await import("./cube3d.js");
    app.preview = new Cube3D($("capture-preview"), app.model);
    app.preview.controls.enableZoom = false;
    app.preview.camera.position.set(4.6, 4.1, 6.4);
    app.preview.setColors(new Array(54).fill(UNREAD));
  } catch (e) {
    app.previewFailed = true;
  }
}

const UNREAD = "#33343a";

function updateCapturePreview({ read, colors, faces }) {
  const badge = $("preview-count");
  if (badge) badge.textContent = `${read} de 27`;
  if (faces) {
    for (const chip of $("face-progress").children) {
      const n = faces[chip.dataset.face] || 0;
      chip.querySelector("b").textContent = `${n}/9`;
      chip.classList.toggle("done", n === 9);
    }
  }
  if (!app.preview) return;
  const painted = new Array(54).fill(UNREAD);
  app.model.stickers.forEach(({ pos, normal }, i) => {
    if (!normal.some((v) => v === 1)) return;          // hidden in this view
    const rgb = colors.get(`${pos.join(",")}|${normal.join(",")}`);
    if (rgb) painted[i] = rgb;
  });
  app.preview.setColors(painted);
}

// ---------------------------------------------------------------------------
// review / manual editor
// ---------------------------------------------------------------------------

let activeColor = "W";
let validateTimer = null;

function openReview({ fromPhotos = false } = {}) {
  $("btn-rotate-view2").hidden = !fromPhotos;
  renderPalette();
  renderNet();
  scheduleValidate();
  show("review");
}

function renderPalette() {
  const p = $("palette");
  p.innerHTML = "";
  const counts = Object.fromEntries(COLOR_KEYS.map((k) => [k, 0]));
  app.colors.forEach((c) => { if (c in counts) counts[c]++; });
  for (const k of COLOR_KEYS) {
    const b = document.createElement("button");
    b.className = "swatch" + (k === activeColor ? " active" : "");
    b.style.background = COLORS[k].hex;
    b.title = `${colorName(k)} (${counts[k]} de 9)`;
    b.textContent = counts[k];
    if (counts[k] !== 9) b.style.color = "#c00";
    b.onclick = () => { activeColor = k; renderPalette(); };
    p.appendChild(b);
  }
}

function renderNet() {
  const net = $("net");
  net.innerHTML = "";
  const faces = app.model.faces;
  for (const f of "ULFRBD") {
    const k = faces.indexOf(f);
    const face = document.createElement("div");
    face.className = "net-face";
    face.dataset.face = f;
    for (let i = 0; i < 9; i++) {
      const idx = 9 * k + i;
      const b = document.createElement("button");
      const doubt = app.doubtful && app.doubtful.has(idx);
      const guilty = app.guilty && app.guilty.has(idx);
      b.className = "net-cell" + (i === 4 ? " center" : "") + (doubt ? " doubt" : "") + (guilty ? " bad" : "");
      if (doubt) b.title += " · leída con dudas, compruébala";
      b.style.background = COLORS[app.colors[idx]] ? COLORS[app.colors[idx]].hex : "#666";
      b.title = `${f}${i + 1}`;
      b.onclick = () => {
        app.colors[idx] = activeColor;
        if (app.doubtful) app.doubtful.delete(idx);
        renderPalette();
        renderNet();
        scheduleValidate();
      };
      face.appendChild(b);
    }
    net.appendChild(face);
  }
}

function scheduleValidate() {
  clearTimeout(validateTimer);
  validateTimer = setTimeout(runValidate, 250);
}

async function runValidate() {
  const st = $("review-status");
  const centres = [0, 1, 2, 3, 4, 5].map((k) => app.colors[9 * k + 4]);
  $("btn-solve").disabled = true;
  if (new Set(centres).size !== 6) {
    st.className = "review-status err";
    st.textContent = "Dos caras se han leído con el mismo color en el centro, así que alguna está " +
      "repetida o mal leída. Corrige los centros abajo o vuelve a escanear.";
    return;
  }
  const facelets = app.model.toFacelets(app.colors);
  app.guilty = new Set();
  try {
    const r = await api("/api/validate", { facelets });
    if (r.ok && r.solved) {
      st.className = "review-status ok";
      st.textContent = "¡Este cubo ya está resuelto! Mézclalo y vuelve a escanearlo.";
    } else if (r.ok) {
      st.className = "review-status ok";
      const doubts = app.doubtful ? app.doubtful.size : 0;
      const overruled = app.overruled ? app.overruled.length : 0;
      if (overruled && !app.repairedStickers) {
        st.textContent = `✓ Es un cubo válido. ${overruled === 1 ? "Una pegatina no cuadraba" :
          `${overruled} pegatinas no cuadraban`} con ninguna pieza posible y ${overruled === 1 ?
          "la he corregido" : "las he corregido"} (${overruled === 1 ? "va marcada" : "van marcadas"} ` +
          `abajo con borde discontinuo): compruébal${overruled === 1 ? "a" : "as"} antes de seguir.`;
        $("btn-solve").disabled = false;
        renderBasePicker();
        return;
      }
      if (app.repairedStickers) {
        st.textContent = "✓ Es un cubo válido, pero he tenido que corregir un par de colores que " +
          "no encajaban (suele pasar entre rojo y naranja, o blanco y amarillo). Échales un ojo abajo antes de seguir.";
        $("btn-solve").disabled = false;
        renderBasePicker();
        return;
      }
      if (app.orientedFaces || app.rearranged) {
        const parts = [];
        if (app.orientedFaces) {
          parts.push(app.orientedFaces === 1 ? "una cara estaba girada" : `${app.orientedFaces} caras estaban giradas`);
        }
        if (app.rearranged) parts.push(`parece que lo escaneaste ${app.rearranged}`);
        st.textContent = `✓ Es un cubo válido. Lo he corregido solo: ${parts.join(" y ")}.` +
          (app.ambiguous ? " Ojo: estas seis caras encajan de más de una manera, así que compruebá" +
           "ndolo en el dibujo de abajo antes de seguir." : "");
        $("btn-solve").disabled = false;
        renderBasePicker();
        return;
      }
      st.textContent = doubts
        ? `✓ Es un cubo válido, pero ${doubts} ${doubts === 1 ? "pegatina se leyó" : "pegatinas se leyeron"} con dudas (marcadas con borde discontinuo): compruébalas antes de seguir.`
        : "✓ Es un cubo válido. Elige el modo y calcula el camino.";
      $("btn-solve").disabled = false;
    } else {
      st.className = "review-status err";
      st.textContent = r.error;
      markGuilty(r.error);
    }
  } catch (e) {
    st.className = "review-status err";
    st.textContent = e.message;
  }
  renderBasePicker();
}

// The server names the piece it cannot make sense of; show which stickers
// those are, so there is somewhere to look.
function markGuilty(error) {
  app.guilty = new Set();
  const corner = (error.match(/esquina ([A-Z]{3})/) || [])[1];
  const edge = (error.match(/arista ([A-Z]{2})/) || [])[1];
  if (corner) {
    const i = app.meta.corner_names.indexOf(corner);
    if (i >= 0) app.meta.corner_facelets[i].forEach((f) => app.guilty.add(f));
  } else if (edge) {
    const i = app.meta.edge_names.indexOf(edge);
    if (i >= 0) app.meta.edge_facelets[i].forEach((f) => app.guilty.add(f));
  }
  renderNet();
}

function renderBasePicker() {
  const box = $("base-colors");
  box.innerHTML = "";
  const mode = document.querySelector("input[name=mode]:checked").value;
  $("base-picker").style.display = mode === "learn" ? "" : "none";
  const centres = [0, 1, 2, 3, 4, 5].map((k) => app.colors[9 * k + 4]);
  if (!centres.includes(app.baseColor)) app.baseColor = centres.includes("W") ? "W" : centres[3];
  for (const c of centres) {
    const b = document.createElement("button");
    b.className = "swatch" + (c === app.baseColor ? " active" : "");
    b.style.background = COLORS[c].hex;
    b.title = colorName(c);
    b.onclick = () => { app.baseColor = c; renderBasePicker(); };
    box.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// solving
// ---------------------------------------------------------------------------

async function solve() {
  const mode = document.querySelector("input[name=mode]:checked").value;
  const facelets = app.model.toFacelets(app.colors);
  const base = "URFDLB"[[0, 1, 2, 3, 4, 5].find((k) => app.colors[9 * k + 4] === app.baseColor)];
  const btn = $("btn-solve");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Buscando el camino…';
  try {
    const plan = await api("/api/solve", { facelets, mode, base });
    startGuide(plan);
  } catch (e) {
    await modal(`<h3>No se pudo resolver</h3><p>${e.message}</p>`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Calcular el camino ›";
  }
}

async function startGuide(plan) {
  app.plan = plan;
  // colours in the orientation the solver works in
  const start = app.model.applyAll(app.colors, plan.rotation);
  app.states = [start];
  for (const s of plan.steps) app.states.push(app.model.applyAll(app.states[app.states.length - 1], s.moves));
  app.k = 0;
  app.tutorHistory = [];
  $("tutor-log").innerHTML = "";
  show("solve");
  await ensureViews();
  app.cube3d && app.cube3d.jumpTo(app.colors);
  app.graph.jumpTo(start);
  renderStageStrip();

  const up = app.model.centerColor(start, "U"), front = app.model.centerColor(start, "F");
  const rotText = plan.rotation.length
    ? `<p>Gira el cubo entero (sin mover capas) para que quede así:</p>`
    : `<p>Sujeta el cubo así durante toda la resolución:</p>`;
  await modal(`
    <h3>Antes de empezar: cómo sujetar el cubo</h3>
    ${rotText}
    <p style="font-size:1.1rem">${dot(up)} <b>${colorName(up)}</b> arriba · ${dot(front)} <b>${colorName(front)}</b> mirando hacia ti</p>
    <p class="hint">La notación: <b>R</b> = gira la cara derecha un cuarto en sentido horario (mirándola de frente),
    <b>R'</b> = antihorario, <b>R2</b> = media vuelta. Igual con U (arriba), F (delante), L (izquierda), D (abajo) y B (detrás).</p>
    <p class="hint">Total: ${plan.steps.length} pasos, ${plan.move_count} giros.</p>`,
    [{ label: "Ya lo tengo así ›", primary: true }]);
  if (plan.rotation.length && app.cube3d) {
    await app.cube3d.play(plan.rotation);
  }
  showStep(0);
}

let views3dFailed = false;
async function ensureViews() {
  if (!app.graph) app.graph = new StickerGraph($("sticker-graph"), app.model);
  if (!app.cube3d && !views3dFailed) {
    try {
      const { Cube3D } = await import("./cube3d.js");
      app.cube3d = new Cube3D($("cube3d"), app.model);
      app.cube3d.setColors(app.colors);
      app.cube3d.speed = +$("speed").value;
    } catch (e) {
      views3dFailed = true;
      $("cube3d").innerHTML = `<p class="hint" style="padding:16px">No se pudo cargar la vista 3D (${e.message}). El resto funciona igual.</p>`;
    }
  }
}

function stageOf(step) {
  return app.plan.stages.find((s) => s.key === step.stage);
}

function stageBounds() {
  // index of the first step of each stage
  const out = [];
  let i = 0;
  for (const st of app.plan.stages) {
    out.push({ stage: st, from: i, to: i + st.steps });
    i += st.steps;
  }
  return out;
}

function renderStageStrip() {
  const strip = $("stage-strip");
  strip.innerHTML = "";
  for (const b of stageBounds()) {
    const seg = document.createElement("div");
    seg.className = "seg";
    seg.style.flexGrow = Math.max(1, b.to - b.from);
    const num = (b.stage.title.match(/^(?:Fase )?(\d+)/) || [])[1] || "";
    seg.innerHTML = `<div class="bar"><i></i></div>${num}`;
    seg.title = b.stage.title;
    seg.dataset.from = b.from;
    seg.dataset.to = b.to;
    strip.appendChild(seg);
  }
}

function updateStageStrip() {
  for (const seg of $("stage-strip").children) {
    const from = +seg.dataset.from, to = +seg.dataset.to;
    const frac = to === from ? (app.k >= to ? 1 : 0) : Math.min(1, Math.max(0, (app.k - from) / (to - from)));
    seg.querySelector("i").style.width = `${frac * 100}%`;
    seg.classList.toggle("current", app.k >= from && app.k < to);
  }
}

function explain(step, stage) {
  const mode = app.plan.mode;
  const nbs = step.neighbors;
  if (mode === "learn") {
    const closer = nbs.filter((n) => n.d < step.d_before).length;
    const macroNote = step.moves.length > 1
      ? ` Esta arista es un algoritmo completo (${step.moves.length} giros): para el grafo de esta fase cuenta como un solo paso, porque lo único que mira son sus piezas.`
      : "";
    return `Estás en un vértice a distancia ${step.d_before} de la meta de esta fase. ` +
      `De las ${nbs.length} aristas que salen de él, ${closer} ${closer === 1 ? "baja" : "bajan"} la distancia (en verde). ` +
      `Tomamos «${step.label}» y quedarás a distancia ${step.d_after}.${macroNote}`;
  }
  if (step.stage === "phase1") {
    return `Fase 1: todavía no estás en el subgrupo H. La cota inferior dice que faltan al menos ${step.h_before} ` +
      `giros para entrar en H; los números de los vecinos son su propia cota. IDA* no sigue la cota a ciegas: ` +
      `ya exploró el camino entero (${app.plan.search.nodes_phase1.toLocaleString("es")} vértices en esta fase) ` +
      `y sabe que este giro lleva a H en ${stage.steps - app.k} pasos.`;
  }
  const outside = nbs.filter((n) => n.d === null).length;
  return `Fase 2: ya estás en H. Solo valen las 10 aristas que no te sacan de H (las ${outside} con guion lo harían). ` +
    `Faltan ${step.d_before} giros; la cota inferior es ${step.h_before}.`;
}

function showStep(k) {
  app.k = k;
  const plan = app.plan;
  const steps = plan.steps;
  updateStageStrip();
  if (k >= steps.length) {
    finish();
    return;
  }
  const step = steps[k];
  const stage = stageOf(step);
  $("step-stage").textContent = stage.title;
  $("step-counter").textContent = `Paso ${k + 1} de ${steps.length}`;
  $("step-label").textContent = step.moves.length > 1 ? step.label : `Gira ${describeMove(step.moves[0])}`;
  $("step-text").textContent = explain(step, stage);
  $("btn-prev").disabled = k === 0;

  const tokens = $("step-moves");
  tokens.innerHTML = "";
  step.moves.forEach((m, i) => {
    const t = document.createElement("button");
    t.className = "move-token";
    t.textContent = m;
    t.title = describeMove(m);
    t.onclick = () => playStep(i);
    tokens.appendChild(t);
  });

  // graph panels
  const mode = plan.mode;
  $("neighbors-sub").textContent = mode === "learn"
    ? "Cada arista es un movimiento; el número, la distancia a la meta"
    : "Cada arista es un movimiento; el número, una cota inferior";
  drawNeighbors($("neighbor-graph"), step, { mode });
  $("neighbor-legend").innerHTML =
    `<span><i style="background:var(--good)"></i>más cerca</span><span><i style="background:var(--same)"></i>igual</span>` +
    `<span><i style="background:var(--bad)"></i>más lejos</span><span><i style="background:var(--accent)"></i>arista elegida</span>`;

  if (mode === "learn") {
    $("levels-title").textContent = "Capas del grafo de la fase (BFS desde la meta)";
    $("levels-sub").textContent = "Cuántos vértices hay a cada distancia de la meta";
    drawLevels($("levels-graph"), stage.histogram, step.d_before);
  } else {
    const tp = app.meta.twophase;
    const key = step.stage === "phase1" ? "twist_slice" : "corners_slice";
    $("levels-title").textContent = step.stage === "phase1"
      ? "Base de datos de patrones de la fase 1" : "Base de datos de patrones de la fase 2";
    $("levels-sub").textContent = "Distancias en un grafo reducido, usadas como cota inferior";
    drawLevels($("levels-graph"), tp.histograms[key], step.h_before, { label: "cota inferior" });
  }

  // path chart
  if (mode === "learn") {
    const series = steps.map((s) => s.d_before).concat([0]);
    const seps = stageBounds().map((b) => b.from).filter((x) => x > 0);
    drawPath($("path-graph"), series, k, { separators: seps });
    $("path-sub").textContent = "Distancia a la meta de la fase en curso";
  } else {
    const series = steps.map((s) => s.d_before).concat([0]);
    const bounds = steps.map((s) => s.h_before).concat([0]);
    drawPath($("path-graph"), series, k, { bounds, separators: [plan.search.phase1_length] });
    $("path-sub").textContent = "Giros que faltan (continua) y cota inferior (discontinua)";
  }
  playStep(0);
}

function describeMove(m) {
  const names = { U: "la cara de arriba", D: "la cara de abajo", R: "la cara derecha", L: "la cara izquierda", F: "la cara de delante", B: "la cara de detrás" };
  const how = m.endsWith("2") ? "media vuelta" : m.endsWith("'") ? "un cuarto en sentido antihorario" : "un cuarto en sentido horario";
  return `${names[m[0]]} ${how}`;
}

function playStep(from = 0) {
  const step = app.plan.steps[app.k];
  const before = app.model.applyAll(app.states[app.k], step.moves.slice(0, from));
  const rest = step.moves.slice(from);
  const tokens = [...$("step-moves").children];
  const mark = (i) => tokens.forEach((t, j) => {
    t.classList.toggle("playing", j === i + from);
    t.classList.toggle("done", j < i + from);
  });
  if (app.cube3d) {
    app.cube3d.jumpTo(before);
    app.cube3d.play(rest, { onMove: mark });
  }
  app.graph.jumpTo(before);
  app.graph.play(rest);
}

async function finish() {
  const total = app.plan.move_count;
  if (app.cube3d) app.cube3d.jumpTo(app.states[app.states.length - 1]);
  app.graph.jumpTo(app.states[app.states.length - 1]);
  const choice = await modal(`
    <h3>🎉 ¡Resuelto!</h3>
    <p>Has recorrido un camino de ${app.plan.steps.length} aristas (${total} giros) hasta el vértice «resuelto».</p>
    <p class="hint">${app.plan.mode === "learn"
      ? "Prueba ahora el modo rápido con otro cubo: el mismo grafo, pero buscando un camino de unos 20 giros."
      : "Ningún cubo necesita más de 20 giros: el diámetro de este grafo es 20."}</p>`,
    [{ label: "Resolver otro cubo", primary: true }, { label: "Quedarme aquí" }]);
  if (choice === 0) show("home");
}

// ---------------------------------------------------------------------------
// tutor
// ---------------------------------------------------------------------------

function tutorContext() {
  const step = app.plan.steps[app.k];
  if (!step) return { estado: "resuelto" };
  const stage = stageOf(step);
  return {
    modo: app.plan.mode === "learn" ? "aprendizaje por capas" : "rápido (Kociemba)",
    fase: stage.title, objetivo_fase: stage.goal, grafo_fase: stage.graph,
    paso: `${app.k + 1} de ${app.plan.steps.length}`,
    arista_elegida: step.label, giros: step.moves.join(" "),
    distancia_antes: step.d_before, distancia_despues: step.d_after,
    cota_inferior: step.h_before,
    vecinos: step.neighbors.map((n) => `${n.short || n.label}:${n.d ?? "sale de H"}`).join(", "),
  };
}

// Ask the server whether the LLM is actually answering, and show it as a light.
async function checkTutor(force) {
  const dot = $("tutor-dot");
  const label = $("tutor-status");
  if (!app.meta.tutor) {
    dot.className = "status-dot off";
    dot.title = "Sin LLM configurado";
    label.textContent = "Tutor desactivado (sin LLM configurado)";
    setTutorControls(false);
    return false;
  }
  dot.className = "status-dot checking";
  label.textContent = "Comprobando el LLM…";
  try {
    const s = await api("/api/tutor/status" + (force ? "?force=1" : ""));
    const ms = s.latency_ms;
    const took = s.ok && ms ? ` (${ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s"})` : "";
    setTutorStatus(s.ok, s.detail + took);
    return s.ok;
  } catch (e) {
    setTutorStatus(false, "No se pudo comprobar el LLM");
    return false;
  }
}

function setTutorStatus(ok, detail) {
  const dot = $("tutor-dot");
  dot.className = "status-dot " + (ok ? "ok" : "down");
  dot.title = (ok ? "El tutor responde" : "El tutor no responde") + ": " + detail + " · pulsa para volver a comprobar";
  $("tutor-status").textContent = detail + (ok ? "" : " · pulsa el punto para reintentar");
  setTutorControls(ok);
}

function setTutorControls(on) {
  $("tutor-form").querySelector("button").disabled = !on;
  $("tutor-input").disabled = !on;
  $("btn-explain").hidden = !on;
}

async function askTutor(question) {
  const log = $("tutor-log");
  const add = (role, text, cls = "") => {
    const d = document.createElement("div");
    d.className = `msg ${role} ${cls}`;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  add("user", question);
  const pending = add("assistant", "Pensando…", "pending");
  try {
    const r = await api("/api/tutor", { question, context: tutorContext(), history: app.tutorHistory });
    pending.textContent = r.answer;
    pending.classList.remove("pending");
    app.tutorHistory.push({ role: "user", content: question }, { role: "assistant", content: r.answer });
    setTutorStatus(true, "Conectado · " + (app.meta.tutor_model || "LLM"));
  } catch (e) {
    pending.textContent = "El tutor no está disponible ahora mismo. La explicación del paso sigue arriba.";
    checkTutor(true);
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function boot() {
  app.meta = await api("/api/meta");
  app.model = new CubeModel(app.meta);
  heroAnimation();
  initCapture();
  attachInfoButtons(openInfo);
  document.querySelectorAll(".info-btn").forEach((b) => {
    const key = b.dataset.info;
    b.addEventListener("mouseenter", () => showTip(b, key));
    b.addEventListener("focus", () => showTip(b, key));
    b.addEventListener("mouseleave", hideTip);
    b.addEventListener("blur", hideTip);
  });
  window.addEventListener("scroll", repositionTip, { passive: true });
  window.addEventListener("resize", repositionTip);

  // A way to send back exactly what the camera saw. Everything here has been
  // tuned against cubes I made up, which is why it keeps being wrong about
  // real ones: these numbers are the only thing that fixes that.
  if ($("btn-report")) {
    $("btn-report").addEventListener("click", async () => {
      const report = {
        cuando: new Date().toISOString(),
        leidoCrudo: app.rawSamples
          ? Array.from({ length: 54 }, (_, i) => (app.rawSamples[String(i)] || []).map(Math.round))
          : null,
        inseguras: app.rawUnsure || [],
        colores: app.colors ? app.colors.join("") : null,
        corregidas: app.overruled || [],
        caraGirada: app.rearranged || null,
      };
      const text = JSON.stringify(report);
      try {
        await navigator.clipboard.writeText(text);
        $("btn-report").textContent = "Copiado · pégalo en el mensaje";
      } catch (err) {
        await modal(`<h3>Lectura del cubo</h3><p>Copia este texto y pégamelo:</p>` +
          `<textarea readonly style="width:100%;height:9em;font-family:monospace;font-size:.72rem">${text}</textarea>`);
      }
      setTimeout(() => { $("btn-report").textContent = "Copiar lectura para informar de un fallo"; }, 4000);
    });
  }

  document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.action;
    if (a === "scan-camera") startCapture("camera");
    if (a === "scan-upload") startCapture("upload");
    if (a === "manual") {
      app.colors = app.model.fromFacelets(app.meta.solved);
      app.capture = null;
      app.doubtful = new Set();
      openReview();
    }
    if (a === "demo") {
      const r = await api("/api/random");
      app.colors = app.model.fromFacelets(r.facelets, STANDARD_SCHEME);
      app.capture = null;
      app.doubtful = new Set();
      openReview();
    }
  }));

  $("btn-rotate-view2").onclick = () => {
    if (!app.capture) return;
    app.capture.rotIndex = (app.capture.rotIndex + 1) % VIEW2_COUNT;
    app.colors = assemble(app.model, app.capture.viewColors, app.capture.rotIndex);
    app.doubtful = new Set(assembleDoubtful(app.model, app.captureCtl.viewDoubtful, app.capture.rotIndex));
    renderPalette(); renderNet(); scheduleValidate();
  };
  $("btn-rescan").onclick = () => startCapture("camera");
  $("btn-solve").onclick = solve;
  document.querySelectorAll("input[name=mode]").forEach((r) => r.addEventListener("change", renderBasePicker));

  $("btn-done").onclick = () => showStep(app.k + 1);
  $("btn-prev").onclick = () => { if (app.k > 0) showStep(app.k - 1); };
  $("btn-replay").onclick = () => playStep(0);
  $("btn-reset-view").onclick = () => app.cube3d && app.cube3d.resetView();
  $("speed").oninput = (e) => {
    if (app.cube3d) app.cube3d.speed = +e.target.value;
    if (app.graph) app.graph.speed = +e.target.value;
  };
  $("btn-lost").onclick = async () => {
    const c = await modal(`<h3>¿Te has perdido?</h3>
      <p>No pasa nada: tu cubo sigue siendo un vértice del grafo. Escanéalo tal como está ahora y calcularemos un camino nuevo desde ahí.</p>`,
      [{ label: "Escanear de nuevo", primary: true }, { label: "Cancelar" }]);
    if (c === 0) startCapture("camera");
  };
  $("tutor-form").onsubmit = (e) => {
    e.preventDefault();
    const q = $("tutor-input").value.trim();
    if (!q) return;
    $("tutor-input").value = "";
    askTutor(q);
  };
  $("btn-explain").onclick = () => askTutor("Explícame este paso con otras palabras: qué hago con el cubo y qué significa en el grafo.");
  $("tutor-dot").onclick = () => { if (app.meta.tutor) checkTutor(true); };
  checkTutor(false);
  document.addEventListener("keydown", (e) => {
    if (!$("screen-solve").classList.contains("active") || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowRight" || e.key === "Enter") $("btn-done").click();
    if (e.key === "ArrowLeft") $("btn-prev").click();
  });
}

boot().catch((e) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    `<div class="review-status err">No se pudo iniciar la aplicación: ${e.message}</div>`);
});
