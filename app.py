"""Rubik Solver: a guided, graph-theory based Rubik's cube solver."""

from __future__ import annotations

import json
import logging
import os
import threading

from flask import Flask, jsonify, render_template, request, session

import auth
from cube import stages, tutor, twophase
from cube.i18n import LANGS, negotiate, tr
from cube.model import (CORNER_FACELETS, CORNER_NAMES, EDGE_FACELETS, EDGE_NAMES, FACES, MOVE_PERMS,
                        MOVES, SOLVED, STICKERS, InvalidCube,
                        apply_moves, random_state, ring_cycles, validate)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rubik")
auth.init(app)  # /login gate; open when no password is configured

SITE_DOMAIN = os.environ.get("SITE_DOMAIN", "")
# TwoPhaseSolver keeps its search state on the instance: one search at a time per worker.
_solve_lock = threading.Lock()


def _warm_up():
    stages.get_stages()
    twophase.get_solver()
    log.info("tables ready")


# Loading the tables takes a few seconds; do it in the background so the
# first request (and the readiness probe) do not wait for it.
threading.Thread(target=_warm_up, daemon=True).start()


# The words of the interface, one file per language. The server uses them to
# draw the page already in the reader's language (no flash of the other one),
# and hands both to the browser so the switch can change language without a
# reload.
_I18N_DIR = os.path.join(os.path.dirname(__file__), "static", "i18n")
UI_STRINGS = {code: json.load(open(os.path.join(_I18N_DIR, f"{code}.json"), encoding="utf-8"))
              for code in LANGS}


def ui_text(lang: str, key: str) -> str:
    return UI_STRINGS.get(lang, {}).get(key) or UI_STRINGS["en"].get(key) or key


def lang_of() -> str:
    """The language this request wants: ?lang=, then the cookie the page sets
    when the user picks one, then the browser's Accept-Language."""
    return negotiate(request.args.get("lang"), request.cookies.get("lang"),
                     request.headers.get("Accept-Language"))


@app.context_processor
def inject_globals():
    lang = lang_of()
    return {"site_domain": SITE_DOMAIN, "auth_enabled": auth.enabled(),
            "auth_user": session.get("user", ""), "lang": lang, "langs": LANGS,
            "t": lambda key: ui_text(lang, key), "ui_strings": UI_STRINGS}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/meta")
def meta():
    """Geometry shared with the browser, so both sides use the same cube model."""
    perms = {m: MOVE_PERMS[m] for m in MOVES + ["x", "x'", "x2", "y", "y'", "y2", "z", "z'", "z2"]}
    solver = twophase.get_solver()
    return jsonify({
        "faces": FACES,
        "solved": SOLVED,
        "stickers": [{"pos": p, "normal": n} for p, n in STICKERS],
        "moves": MOVES,
        "perms": perms,
        "rings": {f: ring_cycles(f) for f in FACES},
        "corner_facelets": CORNER_FACELETS,
        "edge_facelets": EDGE_FACELETS,
        "corner_names": CORNER_NAMES,
        "edge_names": EDGE_NAMES,
        "stages": [s.info() for s in stages.get_stages()],
        "twophase": {
            "sizes": solver.sizes,
            "histograms": solver.histograms,
            "phase2_moves": [MOVES[m] for m in twophase.PHASE2_MOVES],
        },
        "tutor": tutor.enabled(),
        "tutor_model": tutor.VLLM_MODEL,
    })


@app.route("/api/validate", methods=["POST"])
def api_validate():
    facelets = (request.get_json(silent=True) or {}).get("facelets", "")
    try:
        validate(facelets)
    except InvalidCube as e:
        return jsonify({"ok": False, "error": e.message(lang_of()), "code": e.key, "piece": e.piece})
    return jsonify({"ok": True, "solved": facelets == SOLVED})


@app.route("/api/random")
def api_random():
    return jsonify({"facelets": random_state()})


@app.route("/api/solve", methods=["POST"])
def api_solve():
    data = request.get_json(silent=True) or {}
    facelets = data.get("facelets", "")
    mode = data.get("mode", "learn")
    try:
        validate(facelets)
    except InvalidCube as e:
        return jsonify({"error": e.message(lang_of()), "code": e.key}), 400
    if mode == "fast":
        return jsonify(_solve_fast(facelets))
    base = data.get("base") or "D"
    front = data.get("front")
    if base not in FACES or (front and front not in FACES):
        return jsonify({"error": tr(lang_of(), "api.bad_base")}), 400
    result = stages.solve_layers(facelets, base, front)
    result["mode"] = "learn"
    return jsonify(result)


def _solve_fast(facelets: str) -> dict:
    solver = twophase.get_solver()
    with _solve_lock:
        res = solver.solve(facelets, max_time=float(os.environ.get("SOLVE_SECONDS", "2.5")))
    moves = res["moves"]
    info = solver.explain_path(facelets, moves, res["phase1_length"])
    steps = []
    for k, m in enumerate(moves):
        phase = info[k]["phase"]
        steps.append({
            "stage": f"phase{phase}",
            "label": m, "key": "move", "args": {"move": m},
            "alg": m,
            "moves": [m],
            "d_before": info[k]["remaining"],
            "d_after": info[k + 1]["remaining"],
            "h_before": info[k]["h"],
            "h_after": info[k + 1]["h"] if info[k + 1]["phase"] == phase else 0,
            "neighbors": [
                {"label": n["move"], "key": "move", "args": {"move": n["move"]}, "alg": n["move"], "d": n["h"]}
                for n in info[k]["neighbors"]
            ],
        })
    assert apply_moves(facelets, moves) == SOLVED
    return {
        "mode": "fast",
        "rotation": [],
        "letter_map": {f: f for f in FACES},
        "facelets": facelets,
        "steps": steps,
        "move_count": len(moves),
        "search": {k: v for k, v in res.items() if k != "moves"},
        "stages": [
            {"key": "phase1", "title": "Fase 1 · Llegar al subgrupo H",
             "goal": "Orientar todas las piezas y llevar las 4 aristas centrales a su capa: "
                     "a partir de ahí basta con U, D y medias vueltas del resto.",
             "graph": "Grafo cociente G/H: 2.217.093.120 vértices (giro de esquinas × orientación "
                      "de aristas × posición de las aristas centrales), 18 aristas por vértice.",
             "steps": res["phase1_length"]},
            {"key": "phase2", "title": "Fase 2 · Resolver dentro de H",
             "goal": "Colocar todas las piezas usando solo U, D, R2, L2, F2 y B2.",
             "graph": "Subgrafo H: 19.508.428.800 vértices, 10 aristas por vértice "
                      "(los movimientos que no deshacen la fase 1).",
             "steps": len(moves) - res["phase1_length"]},
        ],
    }


@app.route("/api/tutor", methods=["POST"])
def api_tutor():
    data = request.get_json(silent=True) or {}
    question = (data.get("question") or "").strip()[:1000]
    if not question:
        return jsonify({"error": tr(lang_of(), "api.empty_question")}), 400
    context = data.get("context") or {}
    answer = tutor.ask(question, context, data.get("history") or [], lang=lang_of())
    if answer is None:
        return jsonify({"error": tr(lang_of(), "api.tutor_unavailable")}), 503
    allowed = context.get("giros_posibles") if isinstance(context, dict) else None
    invented = tutor.invented_moves(answer, allowed if isinstance(allowed, list) else [])
    return jsonify({"answer": answer, "invented": invented})


@app.route("/api/tutor/status")
def api_tutor_status():
    return jsonify(tutor.describe(tutor.probe(force=request.args.get("force") == "1"), lang_of()))


@app.route("/healthz")
def healthz():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    app.config["SESSION_COOKIE_SECURE"] = False  # plain http in local development
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
