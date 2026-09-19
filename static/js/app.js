import { COLORS, COLOR_KEYS, CubeModel, STANDARD_SCHEME } from "./cubemodel.js";
import { Capture, assemble, VIEW2_COUNT } from "./capture.js";
import { StickerGraph, drawNeighbors, drawLevels, drawPath, drawCaptureGuide } from "./graphs.js";

const $ = (id) => document.getElementById(id);
const api = async (url, body) => {
  const r = await fetch(url, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
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
    onGuide: (view) => drawCaptureGuide($("capture-guide-svg"), view),
  }, {
    onDone: (res) => {
      app.capture = res;
      app.colors = assemble(app.model, res.viewColors, res.rotIndex);
      openReview({ fromPhotos: true });
    },
    onCancel: () => show(app.plan ? "solve" : "home"),
  });
}

function startCapture(mode) {
  show("capture");
  app.captureCtl.begin(mode);
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
      b.className = "net-cell" + (i === 4 ? " center" : "");
      b.style.background = COLORS[app.colors[idx]] ? COLORS[app.colors[idx]].hex : "#666";
      b.title = `${f}${i + 1}`;
      b.onclick = () => {
        app.colors[idx] = activeColor;
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
    st.textContent = "Los seis centros deben ser de colores distintos.";
    return;
  }
  const facelets = app.model.toFacelets(app.colors);
  try {
    const r = await api("/api/validate", { facelets });
    if (r.ok && r.solved) {
      st.className = "review-status ok";
      st.textContent = "¡Este cubo ya está resuelto! Mézclalo y vuelve a escanearlo.";
    } else if (r.ok) {
      st.className = "review-status ok";
      st.textContent = "✓ Es un cubo válido. Elige el modo y calcula el camino.";
      $("btn-solve").disabled = false;
    } else {
      st.className = "review-status err";
      st.textContent = r.error;
    }
  } catch (e) {
    st.className = "review-status err";
    st.textContent = e.message;
  }
  renderBasePicker();
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
    ? `${step.neighbors.length} aristas salen de aquí · número = distancia exacta a la meta de la fase`
    : step.stage === "phase1"
      ? "18 aristas · número = cota inferior de la distancia hasta H"
      : "número = cota inferior de la distancia a resuelto · guion = sale de H";
  drawNeighbors($("neighbor-graph"), step, { mode });
  $("neighbor-legend").innerHTML =
    `<span><i style="background:var(--good)"></i>más cerca</span><span><i style="background:var(--same)"></i>igual</span>` +
    `<span><i style="background:var(--bad)"></i>más lejos</span><span><i style="background:var(--accent)"></i>arista elegida</span>`;

  if (mode === "learn") {
    $("levels-title").textContent = "Capas del grafo de la fase (BFS desde la meta)";
    $("levels-sub").textContent = `${stage.vertices.toLocaleString("es")} vértices, ${stage.edges_per_vertex} aristas por vértice. ` +
      `Cada barra cuenta los vértices a esa distancia (escala logarítmica).`;
    drawLevels($("levels-graph"), stage.histogram, step.d_before);
  } else {
    const tp = app.meta.twophase;
    const key = step.stage === "phase1" ? "twist_slice" : "corners_slice";
    $("levels-title").textContent = step.stage === "phase1"
      ? "Base de datos de patrones de la fase 1" : "Base de datos de patrones de la fase 2";
    $("levels-sub").textContent = step.stage === "phase1"
      ? `Grafo reducido (giro de esquinas × posición de las aristas centrales): ${tp.sizes.twist_slice.toLocaleString("es")} vértices recorridos con BFS. Su distancia nunca supera la real: es una cota inferior.`
      : `Grafo reducido (permutación de esquinas × aristas centrales): ${tp.sizes.corners_slice.toLocaleString("es")} vértices.`;
    drawLevels($("levels-graph"), tp.histograms[key], step.h_before, { label: "cota inferior" });
  }

  // path chart
  if (mode === "learn") {
    const series = steps.map((s) => s.d_before).concat([0]);
    const seps = stageBounds().map((b) => b.from).filter((x) => x > 0);
    drawPath($("path-graph"), series, k, { separators: seps });
    $("path-sub").textContent = "Distancia a la meta de cada fase; al acabar una fase empieza el grafo de la siguiente.";
  } else {
    const series = steps.map((s) => s.d_before).concat([0]);
    const bounds = steps.map((s) => s.h_before).concat([0]);
    drawPath($("path-graph"), series, k, { bounds, separators: [plan.search.phase1_length] });
    $("path-sub").textContent = "Línea: giros que faltan. Discontinua: cota inferior de la fase (IDA*).";
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
  } catch (e) {
    pending.textContent = "El tutor no está disponible ahora mismo. La explicación del paso sigue arriba.";
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

  document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.action;
    if (a === "scan-camera") startCapture("camera");
    if (a === "scan-upload") startCapture("upload");
    if (a === "manual") {
      app.colors = app.model.fromFacelets(app.meta.solved);
      app.capture = null;
      openReview();
    }
    if (a === "demo") {
      const r = await api("/api/random");
      app.colors = app.model.fromFacelets(r.facelets, STANDARD_SCHEME);
      app.capture = null;
      openReview();
    }
  }));

  $("btn-rotate-view2").onclick = () => {
    if (!app.capture) return;
    app.capture.rotIndex = (app.capture.rotIndex + 1) % VIEW2_COUNT;
    app.colors = assemble(app.model, app.capture.viewColors, app.capture.rotIndex);
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
  if (!app.meta.tutor) {
    $("tutor-status").textContent = "Tutor desactivado (sin LLM configurado)";
    $("tutor-form").querySelector("button").disabled = true;
    $("btn-explain").hidden = true;
  } else {
    $("tutor-status").textContent = "Un LLM que conoce el paso en el que estás";
  }
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
