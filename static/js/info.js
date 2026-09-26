// Didactic help for every box: what it shows, how to read it, what to do with it.
// Each entry is opened by the ⓘ button in the corner of its box.

import { t, lang } from "./i18n.js";
import { stageTitle, macroName } from "./names.js";

// Each entry's words are in the language files (info.<key>.title, .html).
export const INFO = new Proxy({}, {
  get: (_, key) => ({ title: t(`info.${String(key)}.title`), html: t(`info.${String(key)}.html`) }),
});

// Technical facts for the tooltip: live numbers about what each box is doing.
// `ctx` is filled in by app.js with the current plan, step and metadata.
export function techLines(key, ctx) {
  const { meta, plan, step, stage, mode, tutor } = ctx;
  const n = (v) => (v === undefined || v === null ? "—" : Number(v).toLocaleString(lang()));
  const L = (k) => t(`tech.l.${k}`);
  const V = (k, p) => t(`tech.v.${k}`, p);
  switch (key) {
    case "cube3d":
      return [
        [L("engine"), "three.js r169 (WebGL)"],
        [L("scene"), V("scene")],
        [L("animation"), V("animation")],
        [L("state"), V("state")],
      ];
    case "step":
      return [
        [L("step"), plan ? V("step_of", { k: (ctx.index ?? 0) + 1, n: plan.steps.length }) : "—"],
        [L("edge"), step ? V("edge", { name: macroName(step), n: step.moves.length }) : "—"],
        [L("sequence"), step ? step.moves.join(" ") : "—"],
        [L("distance"), step ? `${step.d_before} → ${step.d_after}` : "—"],
        [L("path_total"), plan ? V("path_total", { edges: plan.steps.length, moves: plan.move_count }) : "—"],
      ];
    case "sticker":
      return [
        [L("vertices"), V("sticker_vertices")],
        [L("cycles"), V("cycles")],
        [L("projection"), V("projection")],
        [L("current_turn"), step ? step.moves.join(" ") : "—"],
        [L("groups"), V("groups")],
      ];
    case "neighbors":
      if (mode === "learn") {
        return [
          [L("stage"), stage ? stageTitle(stage) : "—"],
          [L("edges_per_vertex"), stage ? n(stage.edges_per_vertex) : "—"],
          [L("stage_vertices"), stage ? n(stage.vertices) : "—"],
          [L("numbers"), V("learn_numbers")],
          [L("your_distance"), step ? step.d_before : "—"],
          [L("closer_edges"), step ? step.neighbors.filter((x) => x.d < step.d_before).length : "—"],
        ];
      }
      return [
        [L("stage"), stage ? stageTitle(stage) : "—"],
        [L("edges"), step && step.stage === "phase1" ? V("edges_p1") : V("edges_p2")],
        [L("numbers"), V("fast_numbers")],
        [L("current_bound"), step ? step.h_before : "—"],
        [L("turns_left"), step ? step.d_before : "—"],
      ];
    case "levels":
      if (mode === "learn") {
        return [
          [L("graph"), stage ? V("stage_graph", { vertices: n(stage.vertices), edges: stage.edges_per_vertex }) : "—"],
          [L("max_distance"), stage ? stage.max_distance : "—"],
          [L("computation"), V("bfs_exact")],
          [L("scale"), V("log_scale")],
          [L("your_bar"), step ? step.d_before : "—"],
        ];
      }
      return [
        [L("database"), step && step.stage === "phase1"
          ? V("db_p1", { n: n(meta.twophase.sizes.twist_slice) })
          : V("db_p2", { n: n(meta.twophase.sizes.corners_slice) })],
        [L("computation"), V("db_bfs")],
        [L("use"), V("db_use")],
        [L("your_value"), step ? step.h_before : "—"],
      ];
    case "path":
      if (mode === "learn") {
        return [
          [L("path"), plan ? V("path_total", { edges: plan.steps.length, moves: plan.move_count }) : "—"],
          [L("stages"), plan ? V("stage_steps", { list: plan.stages.map((s) => s.steps).join(" + ") }) : "—"],
          [L("height"), V("height")],
          [L("method"), V("descent")],
        ];
      }
      return [
        [L("path"), plan ? V("turns", { n: plan.move_count }) : "—"],
        [L("phases"), plan ? `${plan.search.phase1_length} + ${plan.move_count - plan.search.phase1_length}` : "—"],
        [L("explored"), plan ? V("explored", { p1: n(plan.search.nodes_phase1), p2: n(plan.search.nodes_phase2) }) : "—"],
        [L("p1_tried"), plan ? n(plan.search.phase1_solutions_tried) : "—"],
        [L("search_time"), plan ? V("seconds", { s: plan.search.time }) : "—"],
        [L("dashed"), V("dashed")],
      ];
    case "tutor":
      return [
        [L("model"), meta.tutor_model || "—"],
        [L("state"), tutor || "—"],
        [L("check"), V("tutor_check")],
        [L("context"), V("tutor_context")],
        [L("quick"), V("tutor_quick")],
        [L("answer_check"), V("tutor_answer_check")],
        [L("warning"), V("tutor_warning")],
      ];
    case "capture":
      return [
        [L("detection"), V("detection")],
        [L("grid"), V("grid")],
        [L("resolution"), V("resolution")],
        [L("reading"), V("reading")],
        [L("repeats"), V("repeats")],
        [L("colours"), V("colours")],
        [L("fingers"), V("fingers")],
        [L("last_check"), V("last_check")],
      ];
    case "review":
      return [
        [L("reading"), V("review_reading")],
        [L("light"), V("light")],
        [L("checks"), V("checks")],
        [L("orientations"), V("orientations")],
        [L("parity"), V("parity")],
        [L("photo2"), V("photo2")],
        [L("holding"), V("holding")],
        [L("repair"), V("repair")],
      ];
    case "mode":
      return [
        [L("learn"), V("mode_learn")],
        [L("fast"), V("mode_fast", { g: n(2217093120), h: n(19508428800) })],
        [L("full_graph"), V("full_graph")],
        [L("bounds"), V("bounds")],
      ];
    default:
      return [];
  }
}

export function attachInfoButtons(openInfo) {
  const targets = [
    ["cube3d", ".cube3d-wrap"],
    ["step", "#step-card"],
    ["sticker", "#panel-sticker"],
    ["neighbors", "#panel-neighbors"],
    ["levels", "#panel-levels"],
    ["path", "#panel-path"],
    ["tutor", "#tutor-panel"],
    ["capture", ".capture-guide"],
    ["review", "#panel-review"],
    ["mode", ".mode-card"],
  ];
  for (const [key, selector] of targets) {
    const box = document.querySelector(selector);
    if (!box) continue;
    const b = document.createElement("button");
    b.className = "info-btn";
    b.type = "button";
    b.textContent = "i";
    b.title = t("info.button_title");
    b.setAttribute("aria-label", t("info.button_label", { title: INFO[key].title }));
    b.onclick = () => openInfo(key);
    b.dataset.info = key;
    box.appendChild(b);
  }
}

// After a change of language.
export function retitleInfoButtons() {
  document.querySelectorAll(".info-btn").forEach((b) => {
    b.title = t("info.button_title");
    b.setAttribute("aria-label", t("info.button_label", { title: INFO[b.dataset.info].title }));
  });
}
