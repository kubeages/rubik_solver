"""Layer-by-layer method, where every stage is an explicit graph.

Each stage only looks at a few pieces (the white cross edges, the white
corners, ...).  A vertex of the stage graph is "where those pieces are and
how they are twisted"; an edge is either a single face turn or a whole
algorithm that a human can memorise (a *macro-operator*, in Korf's terms).
Because the stage graphs are small (at most a few hundred thousand
vertices) we compute, once, the exact distance of every vertex to the goal
with a breadth-first search that starts at the goal and walks the edges
backwards.  Solving a stage is then just following any edge that lowers
the distance by one: a shortest path, found greedily.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import numpy as np

from .model import (CORNER_NAMES, CUBIE_MOVES, EDGE_NAMES, FACES, CubieCube,
                    parse_alg, rotate_whole, validate)

RADIX = 24  # every tracked piece has 24 slots: 8 corners x 3 twists or 12 edges x 2 flips

_Y_MAP = {"F": "R", "R": "B", "B": "L", "L": "F", "U": "U", "D": "D"}


def _from_side(alg: str, side: int) -> str:
    """Rewrite an algorithm written for the front face so it works on another side.

    side 0 = front, 1 = right, 2 = back, 3 = left (the face you look at).
    """
    out = []
    for tok in alg.split():
        f = tok[0]
        for _ in range(side):
            f = _Y_MAP[f]
        out.append(f + tok[1:])
    return " ".join(out)


SIDE_NAMES = ["frontal", "derecha", "trasera", "izquierda"]
SLOT_NAMES = ["delante-derecha", "detrás-derecha", "detrás-izquierda", "delante-izquierda"]
SLOT_SHORT = ["FR", "BR", "BL", "FL"]

U_TURNS = [("U", "U"), ("U'", "U'"), ("U2", "U2")]


@dataclass
class Macro:
    label: str
    alg: str
    short: str = ""
    moves: list[str] = field(init=False)
    cube: CubieCube = field(init=False)

    def __post_init__(self):
        self.moves = parse_alg(self.alg)
        self.short = self.short or self.label
        self.cube = CubieCube.solved().apply(self.moves)


@dataclass
class Stage:
    key: str
    title: str
    goal_text: str
    graph_text: str
    corners: list[int]
    edges: list[int]
    macros: list[Macro]
    seeds: list[CubieCube] | None = None

    # filled by build()
    codes: np.ndarray | None = None
    dist: np.ndarray | None = None

    # -- vectorised state handling ---------------------------------------
    def _slots(self, cube: CubieCube) -> list[int]:
        s = []
        for c in self.corners:
            p = cube.cp.index(c)
            s.append(p * 3 + cube.co[p])
        for e in self.edges:
            p = cube.ep.index(e)
            s.append(p * 2 + cube.eo[p])
        return s

    def code(self, cube: CubieCube) -> int:
        code = 0
        for v in reversed(self._slots(cube)):
            code = code * RADIX + v
        return code

    def _tables(self, mc: CubieCube):
        """Slot transition table (24 -> 24) of a macro, for corners and for edges."""
        ct = np.zeros(RADIX, np.int64)
        for p in range(8):
            q = mc.cp.index(p)
            for o in range(3):
                ct[p * 3 + o] = q * 3 + (o + mc.co[q]) % 3
        et = np.zeros(RADIX, np.int64)
        for p in range(12):
            q = mc.ep.index(p)
            for o in range(2):
                et[p * 2 + o] = q * 2 + (o + mc.eo[q]) % 2
        return ct, et

    def _apply(self, codes: np.ndarray, tables) -> np.ndarray:
        ct, et = tables
        out = np.zeros_like(codes)
        rest = codes.copy()
        mult = 1
        n = len(self.corners) + len(self.edges)
        for i in range(n):
            slot = rest % RADIX
            rest //= RADIX
            t = ct if i < len(self.corners) else et
            out += t[slot] * mult
            mult *= RADIX
        return out

    def build(self):
        seeds = self.seeds or [CubieCube.solved()]
        frontier = np.unique(np.array([self.code(s) for s in seeds], np.int64))
        inverse_tables = [self._tables(m.cube.inverse()) for m in self.macros]
        levels = [frontier]
        seen = frontier
        while True:
            nxt = np.unique(np.concatenate([self._apply(frontier, t) for t in inverse_tables]))
            nxt = nxt[~np.isin(nxt, seen, assume_unique=True)]
            if nxt.size == 0:
                break
            levels.append(nxt)
            seen = np.union1d(seen, nxt)
            frontier = nxt
        codes = np.concatenate(levels)
        dist = np.concatenate([np.full(len(l), d, np.int8) for d, l in enumerate(levels)])
        order = np.argsort(codes)
        self.codes, self.dist = codes[order], dist[order]
        self.forward_tables = [self._tables(m.cube) for m in self.macros]

    def distance(self, cube: CubieCube) -> int:
        c = self.code(cube)
        i = np.searchsorted(self.codes, c)
        if i < len(self.codes) and self.codes[i] == c:
            return int(self.dist[i])
        raise ValueError(f"Estado fuera del grafo de la fase {self.key}")

    def info(self) -> dict:
        hist = np.bincount(self.dist).tolist()
        return {
            "key": self.key, "title": self.title, "goal": self.goal_text, "graph": self.graph_text,
            "vertices": int(len(self.codes)), "edges_per_vertex": len(self.macros),
            "max_distance": len(hist) - 1, "histogram": hist,
            "macros": [{"label": m.label, "short": m.short, "alg": m.alg} for m in self.macros],
        }

    def solve(self, cube: CubieCube) -> tuple[list[dict], CubieCube]:
        """Follow the distance function down to 0; one entry per edge taken."""
        steps = []
        d = self.distance(cube)
        while d > 0:
            neighbours = []
            chosen = None
            for m in self.macros:
                nd = self.distance(cube.multiply(m.cube))
                neighbours.append({"label": m.label, "short": m.short, "alg": m.alg, "d": nd})
                if chosen is None and nd == d - 1:
                    chosen = m
            steps.append({
                "stage": self.key, "label": chosen.label, "short": chosen.short, "alg": chosen.alg, "moves": chosen.moves,
                "d_before": d, "d_after": d - 1, "neighbors": neighbours,
            })
            cube = cube.multiply(chosen.cube)
            d -= 1
        return steps, cube


def _u_perms(pieces: str) -> list[CubieCube]:
    """Goal seeds: the solved cube and, optionally, its last layer turned by U."""
    c = CubieCube.solved()
    out = [c]
    if pieces == "auf":
        for m in ("U", "U2", "U'"):
            out.append(c.apply([m]))
    return out


def _orientation_seeds(kind: str) -> list[CubieCube]:
    """Every arrangement of the four U pieces with all of them facing up."""
    out = []
    for perm in itertools.permutations(range(4)):
        c = CubieCube.solved()
        if kind == "edges":
            c.ep[:4] = list(perm)
        else:
            c.cp[:4] = list(perm)
        out.append(c)
    return out


def _make_stages() -> list[Stage]:
    single = [Macro(m, m) for m in (f + s for f in FACES for s in ("", "'", "2"))]
    corner_macros = [Macro(u, a) for u, a in U_TURNS] + [
        Macro(f"Esquina al hueco {SLOT_NAMES[i]}", _from_side("R U R' U'", i), SLOT_SHORT[i]) for i in range(4)
    ]
    middle_macros = [Macro(u, a) for u, a in U_TURNS]
    for i in range(4):
        middle_macros.append(Macro(f"Arista a la derecha (cara {SIDE_NAMES[i]})",
                                   _from_side("U R U' R' U' F' U F", i), "→" + "FRBL"[i]))
        middle_macros.append(Macro(f"Arista a la izquierda (cara {SIDE_NAMES[i]})",
                                   _from_side("U' L' U L U F U' F'", i), "←" + "FRBL"[i]))
    return [
        Stage(
            "cross", "1 · Cruz de la base",
            "Las cuatro aristas de la base (abajo) en su sitio y bien orientadas.",
            "Vértices: dónde están y cómo están giradas las 4 aristas de la base. "
            "Aristas del grafo: los 18 giros de cara.",
            corners=[], edges=[4, 5, 6, 7], macros=single),
        Stage(
            "corners", "2 · Esquinas de la base",
            "Las cuatro esquinas de la base en su sitio, completando la primera capa.",
            "Vértices: posición y giro de las 4 esquinas de la base. Aristas: girar arriba (U) "
            "o aplicar R U R' U' sobre uno de los cuatro huecos (no rompe la cruz).",
            corners=[4, 5, 6, 7], edges=[], macros=corner_macros),
        Stage(
            "middle", "3 · Segunda capa",
            "Las cuatro aristas de la capa central en su sitio.",
            "Vértices: posición y orientación de las 4 aristas centrales. Aristas: girar arriba "
            "o uno de los 8 algoritmos de inserción (no rompen la primera capa).",
            corners=[], edges=[8, 9, 10, 11], macros=middle_macros),
        Stage(
            "eo", "4 · Cruz de arriba",
            "Las cuatro aristas de arriba con el color de arriba mirando hacia arriba.",
            "Vértices: posición y orientación de las aristas de arriba. Aristas: girar arriba o F R U R' U' F'.",
            corners=[], edges=[0, 1, 2, 3],
            macros=[Macro(u, a) for u, a in U_TURNS] + [Macro("Cruz: F R U R' U' F'", "F R U R' U' F'", "Cruz")],
            seeds=_orientation_seeds("edges")),
        Stage(
            "co", "5 · Cara de arriba",
            "Las cuatro esquinas de arriba con el color de arriba mirando hacia arriba.",
            "Vértices: posición y giro de las esquinas de arriba. Aristas: girar arriba, Sune o Antisune.",
            corners=[0, 1, 2, 3], edges=[],
            macros=[Macro(u, a) for u, a in U_TURNS] + [
                Macro("Sune", "R U R' U R U2 R'"), Macro("Antisune", "R U2 R' U' R U' R'", "Anti")],
            seeds=_orientation_seeds("corners")),
        Stage(
            "cp", "6 · Esquinas de arriba en su sitio",
            "Las esquinas de arriba colocadas entre sí (basta un giro de U para alinearlas).",
            "Vértices: posición de las esquinas de arriba. Aristas: girar arriba o una A-perm, "
            "que cicla tres esquinas sin girarlas.",
            corners=[0, 1, 2, 3], edges=[],
            macros=[Macro(u, a) for u, a in U_TURNS] + [
                Macro("A-perm a", "R' F R' B2 R F' R' B2 R2", "Aa"),
                Macro("A-perm b", "R2 B2 R F R' B2 R F' R", "Ab")],
            seeds=_u_perms("auf")),
        Stage(
            "ep", "7 · Aristas de arriba en su sitio",
            "Todo resuelto: aristas de arriba colocadas y la capa alineada.",
            "Vértices: posición de esquinas y aristas de arriba. Aristas: girar arriba o una U-perm, "
            "que cicla tres aristas sin tocar las esquinas.",
            corners=[0, 1, 2, 3], edges=[0, 1, 2, 3],
            macros=[Macro(u, a) for u, a in U_TURNS] + [
                Macro("U-perm a", "R U' R U R U R U' R' U' R2", "Ua"),
                Macro("U-perm b", "R2 U R U R' U' R' U' R' U R'", "Ub")]),
    ]


_stages: list[Stage] | None = None


def get_stages() -> list[Stage]:
    global _stages
    if _stages is None:
        stages = _make_stages()
        for s in stages:
            s.build()
        _stages = stages
    return _stages


# ---------------------------------------------------------------------------
# Orientation: the method builds the first layer on the D face
# ---------------------------------------------------------------------------

_ROTATIONS = [[]] + [[r] for r in ("x", "x'", "x2", "z", "z'")]
_Y = [[], ["y"], ["y2"], ["y'"]]


def orientation_for(facelets: str, base: str, front: str | None = None) -> list[str]:
    """Whole-cube rotations that bring the centre ``base`` down (and ``front`` to the front)."""
    best = None
    for r in _ROTATIONS:
        for y in _Y:
            rot = r + y
            new_letters = _centre_map(rot)
            if new_letters[base] != "D":
                continue
            if front and new_letters[front] != "F":
                continue
            if best is None or len(rot) < len(best):
                best = rot
    return best or []


def _centres_only() -> str:
    return "".join(f * 9 for f in FACES)


def _centre_map(rot: list[str]) -> dict[str, str]:
    """old centre letter -> face it ends up on after the rotations."""
    from .model import apply_moves
    s = apply_moves(_centres_only(), rot)
    return {s[9 * k + 4]: FACES[k] for k in range(6)}


def solve_layers(facelets: str, base: str = "D", front: str | None = None) -> dict:
    validate(facelets)
    rot = orientation_for(facelets, base, front)
    cmap = _centre_map(rot)
    oriented = rotate_whole(facelets, rot) if rot else facelets
    cube = validate(oriented)
    stages = get_stages()
    all_steps = []
    stage_infos = []
    for st in stages:
        steps, cube = st.solve(cube)
        info = st.info()
        info["start_distance"] = steps[0]["d_before"] if steps else 0
        info["steps"] = len(steps)
        stage_infos.append(info)
        all_steps.extend(steps)
    assert cube.to_facelets() == "".join(f * 9 for f in FACES)
    return {
        "rotation": rot,
        "letter_map": cmap,
        "facelets": oriented,
        "stages": stage_infos,
        "steps": all_steps,
        "move_count": sum(len(s["moves"]) for s in all_steps),
    }


def piece_names() -> dict:
    return {"corners": CORNER_NAMES, "edges": EDGE_NAMES}
