"""Kociemba's two-phase algorithm, written to be explained.

Graph view
----------
The cube group G is a graph (a Cayley graph): one vertex per reachable
position (~4.3e19) and one edge per face turn (18 per vertex).  Solving
means finding a path from the scrambled vertex to the solved vertex.

Phase 1 walks the *quotient graph* G/H, where H = <U, D, R2, L2, F2, B2>.
Two positions are the same vertex of G/H when they only differ by moves of
H, so a vertex is described by three small coordinates: corner twist (2187),
edge flip (2048) and which positions hold the four middle-layer edges (495).
Phase 2 then walks the subgraph H (only the 10 moves of H) down to solved.

Both phases use IDA*: depth-first search with a limit that is raised one
step at a time, pruning any vertex whose lower bound on the remaining
distance exceeds the budget left.  The lower bounds are *pattern
databases*: exact distances computed by breadth-first search in even
smaller quotient graphs (twist x slice, flip x slice, ...), which can never
overestimate the true distance.
"""

from __future__ import annotations

import itertools
import os
import time
from array import array
from pathlib import Path

import numpy as np

from .model import CUBIE_MOVES, MOVES, CubieCube, validate

N_MOVES = 18
PHASE2_MOVES = [MOVES.index(m) for m in ("U", "U2", "U'", "R2", "F2", "D", "D2", "D'", "L2", "B2")]
PHASE2_SET = set(PHASE2_MOVES)

N_TWIST, N_FLIP, N_SLICE, N_COMB, N_SPERM, N_PERM8 = 2187, 2048, 11880, 495, 24, 40320

TABLE_DIR = Path(os.environ.get("TABLE_DIR", Path(__file__).resolve().parent.parent / "tables"))

_MOVE_CUBES = [CUBIE_MOVES[m] for m in MOVES]
# dest[m][p]: position that the piece sitting at p moves to under move m
_EDGE_DEST = [[c.ep.index(p) for p in range(12)] for c in _MOVE_CUBES]
_CORNER_DEST = [[c.cp.index(p) for p in range(8)] for c in _MOVE_CUBES]


# ---------------------------------------------------------------------------
# Coordinates
# ---------------------------------------------------------------------------

def twist_of(co) -> int:
    t = 0
    for i in range(7):
        t = 3 * t + co[i]
    return t


def flip_of(eo) -> int:
    f = 0
    for i in range(11):
        f = 2 * f + eo[i]
    return f


_SLICE_TUPLES = list(itertools.permutations(range(12), 4))  # positions of edges FR, FL, BL, BR
_SLICE_INDEX = {t: i for i, t in enumerate(_SLICE_TUPLES)}
_COMBS = list(itertools.combinations(range(12), 4))
_COMB_INDEX = {c: i for i, c in enumerate(_COMBS)}
_PERM4 = list(itertools.permutations(range(8, 12)))
_PERM4_INDEX = {p: i for i, p in enumerate(_PERM4)}
_PERM8 = list(itertools.permutations(range(8)))
_PERM8_INDEX = {p: i for i, p in enumerate(_PERM8)}


def slice_of(ep) -> int:
    pos = tuple(ep.index(e) for e in range(8, 12))
    return _SLICE_INDEX[pos]


def corners_of(cp) -> int:
    return _PERM8_INDEX[tuple(cp)]


def ud_edges_of(ep) -> int:
    return _PERM8_INDEX[tuple(ep[:8])]


SOLVED_TWIST = 0
SOLVED_FLIP = 0
SOLVED_SLICE = _SLICE_INDEX[(8, 9, 10, 11)]
SOLVED_COMB = _COMB_INDEX[(8, 9, 10, 11)]
SOLVED_SPERM = _PERM4_INDEX[(8, 9, 10, 11)]
SOLVED_CORNERS = _PERM8_INDEX[tuple(range(8))]
SOLVED_UD = SOLVED_CORNERS


# ---------------------------------------------------------------------------
# Table construction (run once, at image build time)
# ---------------------------------------------------------------------------

def _build_move_tables() -> dict[str, np.ndarray]:
    twist = np.zeros((N_TWIST, N_MOVES), np.uint16)
    for t in range(N_TWIST):
        co, x = [0] * 8, t
        for i in range(6, -1, -1):
            co[i] = x % 3
            x //= 3
        co[7] = (-sum(co)) % 3
        for m, mc in enumerate(_MOVE_CUBES):
            twist[t, m] = twist_of([(co[mc.cp[i]] + mc.co[i]) % 3 for i in range(8)])

    flip = np.zeros((N_FLIP, N_MOVES), np.uint16)
    for f in range(N_FLIP):
        eo, x = [0] * 12, f
        for i in range(10, -1, -1):
            eo[i] = x % 2
            x //= 2
        eo[11] = sum(eo) % 2
        for m, mc in enumerate(_MOVE_CUBES):
            flip[f, m] = flip_of([(eo[mc.ep[i]] + mc.eo[i]) % 2 for i in range(12)])

    slc = np.zeros((N_SLICE, N_MOVES), np.uint16)
    for s, pos in enumerate(_SLICE_TUPLES):
        for m in range(N_MOVES):
            d = _EDGE_DEST[m]
            slc[s, m] = _SLICE_INDEX[tuple(d[p] for p in pos)]

    corners = np.zeros((N_PERM8, N_MOVES), np.uint16)
    ud = np.zeros((N_PERM8, N_MOVES), np.uint16)
    for k, perm in enumerate(_PERM8):
        for m, mc in enumerate(_MOVE_CUBES):
            corners[k, m] = _PERM8_INDEX[tuple(perm[mc.cp[i]] for i in range(8))]
            if m in PHASE2_SET:
                ud[k, m] = _PERM8_INDEX[tuple(perm[mc.ep[i]] for i in range(8))]

    slice_comb = np.array([_COMB_INDEX[tuple(sorted(p))] for p in _SLICE_TUPLES], np.uint16)
    slice_perm = np.array(
        [_PERM4_INDEX.get(tuple(sorted(range(8, 12), key=lambda e: p[e - 8])), 255)
         if set(p) == {8, 9, 10, 11} else 255 for p in _SLICE_TUPLES], np.uint16)
    return dict(twist=twist, flip=flip, slice=slc, corners=corners, ud=ud,
                slice_comb=slice_comb, slice_perm=slice_perm)


def _bfs_pair(move_a, move_b, n_b, start, moves) -> np.ndarray:
    """Distances from ``start`` in the product graph of two coordinates."""
    n = move_a.shape[0] * n_b
    dist = np.full(n, -1, np.int8)
    dist[start] = 0
    frontier = np.array([start], np.int64)
    depth = 0
    while frontier.size:
        a, b = frontier // n_b, frontier % n_b
        nxt = []
        for m in moves:
            nxt.append(move_a[a, m].astype(np.int64) * n_b + move_b[b, m])
        nxt = np.unique(np.concatenate(nxt))
        nxt = nxt[dist[nxt] < 0]
        depth += 1
        dist[nxt] = depth
        frontier = nxt
    return dist


def build_tables() -> dict[str, np.ndarray]:
    t = _build_move_tables()
    # move table on the unordered slice set (495), derived from the ordered one
    comb_move = np.zeros((N_COMB, N_MOVES), np.uint16)
    for s in range(N_SLICE):
        comb_move[t["slice_comb"][s]] = t["slice_comb"][t["slice"][s]]
    # move table on the arrangement of the slice edges inside the slice (phase 2)
    sperm_move = np.zeros((N_SPERM, N_MOVES), np.uint16)
    for s in range(N_SLICE):
        p = t["slice_perm"][s]
        if p != 255:
            for m in PHASE2_MOVES:
                sperm_move[p, m] = t["slice_perm"][t["slice"][s, m]]
    all_moves = list(range(N_MOVES))
    t["comb"] = comb_move
    t["sperm"] = sperm_move
    t["prune_twist"] = _bfs_pair(t["twist"], comb_move, N_COMB, SOLVED_TWIST * N_COMB + SOLVED_COMB, all_moves)
    t["prune_flip"] = _bfs_pair(t["flip"], comb_move, N_COMB, SOLVED_FLIP * N_COMB + SOLVED_COMB, all_moves)
    t["prune_corners"] = _bfs_pair(t["corners"], sperm_move, N_SPERM,
                                   SOLVED_CORNERS * N_SPERM + SOLVED_SPERM, PHASE2_MOVES)
    t["prune_ud"] = _bfs_pair(t["ud"], sperm_move, N_SPERM, SOLVED_UD * N_SPERM + SOLVED_SPERM, PHASE2_MOVES)
    return t


def load_tables() -> dict[str, np.ndarray]:
    path = TABLE_DIR / "twophase.npz"
    if path.exists():
        with np.load(path) as z:
            return {k: z[k] for k in z.files}
    tables = build_tables()
    try:
        TABLE_DIR.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, **tables)
    except OSError:
        pass
    return tables


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class _Timeout(Exception):
    pass


class TwoPhaseSolver:
    def __init__(self, tables: dict[str, np.ndarray] | None = None):
        t = tables or load_tables()
        # flat arrays: indexing an array('H') / bytes is much faster than numpy scalars
        self.tw = array("H", t["twist"].ravel().tolist())
        self.fl = array("H", t["flip"].ravel().tolist())
        self.sl = array("H", t["slice"].ravel().tolist())
        self.co = array("H", t["corners"].ravel().tolist())
        self.ud = array("H", t["ud"].ravel().tolist())
        self.sp = array("H", t["sperm"].ravel().tolist())
        self.scomb = array("H", t["slice_comb"].tolist())
        self.sperm = array("H", t["slice_perm"].tolist())
        self.p_tw = bytes(t["prune_twist"].astype(np.uint8))
        self.p_fl = bytes(t["prune_flip"].astype(np.uint8))
        self.p_co = bytes(t["prune_corners"].astype(np.uint8))
        self.p_ud = bytes(t["prune_ud"].astype(np.uint8))
        self.sizes = {
            "twist_slice": int((t["prune_twist"] >= 0).sum()),
            "flip_slice": int((t["prune_flip"] >= 0).sum()),
            "corners_slice": int((t["prune_corners"] >= 0).sum()),
            "edges_slice": int((t["prune_ud"] >= 0).sum()),
        }
        self.histograms = {
            k: np.bincount(t[p][t[p] >= 0]).tolist()
            for k, p in (("twist_slice", "prune_twist"), ("flip_slice", "prune_flip"),
                         ("corners_slice", "prune_corners"), ("edges_slice", "prune_ud"))
        }

    # -- heuristics -------------------------------------------------------
    def h1(self, tw, fl, sl) -> int:
        c = self.scomb[sl]
        return max(self.p_tw[tw * N_COMB + c], self.p_fl[fl * N_COMB + c])

    def h2(self, co, ud, sp) -> int:
        return max(self.p_co[co * N_SPERM + sp], self.p_ud[ud * N_SPERM + sp])

    # -- search -----------------------------------------------------------
    def solve(self, facelets: str, max_time: float = 3.0, target: int = 21) -> dict:
        cc = validate(facelets)
        start = time.monotonic()
        self._deadline = start + max_time
        self._cube = cc
        self._best: list[int] | None = None
        self._best_split = 0
        self._target = target
        self._nodes1 = 0
        self._nodes2 = 0
        self._phase1_solutions = 0
        self._depth_log: list[dict] = []
        tw, fl, sl = twist_of(cc.co), flip_of(cc.eo), slice_of(cc.ep)
        corners = corners_of(cc.cp)
        h = self.h1(tw, fl, sl)
        self._path1: list[int] = []
        try:
            for depth in range(h, 21):
                before = self._nodes1
                self._max_total = len(self._best) - 1 if self._best else 30
                if depth > self._max_total:
                    break
                self._search1(tw, fl, sl, corners, depth, -1)
                self._depth_log.append({"depth": depth, "nodes": self._nodes1 - before,
                                        "best": len(self._best) if self._best else None})
                if self._best and len(self._best) <= target:
                    break
        except _Timeout:
            pass
        if self._best is None:
            raise RuntimeError("No se encontró solución a tiempo")
        moves = [MOVES[m] for m in self._best]
        return {
            "moves": moves,
            "phase1_length": self._best_split,
            "nodes_phase1": self._nodes1,
            "nodes_phase2": self._nodes2,
            "phase1_solutions_tried": self._phase1_solutions,
            "depth_log": self._depth_log,
            "time": round(time.monotonic() - start, 3),
            "start_h1": h,
        }

    def _tick(self):
        if time.monotonic() > self._deadline and self._best is not None:
            raise _Timeout

    def _search1(self, tw, fl, sl, corners, togo, last_face):
        self._nodes1 += 1
        if (self._nodes1 & 1023) == 0:
            self._tick()
        if togo == 0:
            if tw == SOLVED_TWIST and fl == SOLVED_FLIP and self.scomb[sl] == SOLVED_COMB:
                # a phase-1 path ending in a phase-2 move is redundant: a shorter one exists
                if not self._path1 or self._path1[-1] not in PHASE2_SET:
                    self._start_phase2(sl, corners)
            return
        path = self._path1
        for m in range(N_MOVES):
            face = m // 3
            if face == last_face or face == last_face - 3:
                continue
            ntw = self.tw[tw * N_MOVES + m]
            nfl = self.fl[fl * N_MOVES + m]
            nsl = self.sl[sl * N_MOVES + m]
            c = self.scomb[nsl]
            if self.p_tw[ntw * N_COMB + c] >= togo or self.p_fl[nfl * N_COMB + c] >= togo:
                continue
            path.append(m)
            self._search1(ntw, nfl, nsl, self.co[corners * N_MOVES + m], togo - 1, face)
            path.pop()

    def _start_phase2(self, sl, corners):
        self._phase1_solutions += 1
        cube = self._cube.apply([MOVES[m] for m in self._path1])
        ud = ud_edges_of(cube.ep)
        sp = self.sperm[sl]
        n1 = len(self._path1)
        limit = self._max_total - n1
        h = self.h2(corners, ud, sp)
        last_face = self._path1[-1] // 3 if self._path1 else -1
        self._path2: list[int] = []
        for depth in range(h, min(limit, 18) + 1):
            if self._search2(corners, ud, sp, depth, last_face):
                self._best = self._path1 + self._path2
                self._best_split = n1
                self._max_total = len(self._best) - 1
                if len(self._best) <= self._target:
                    raise _Timeout
                return

    def _search2(self, co, ud, sp, togo, last_face) -> bool:
        self._nodes2 += 1
        if (self._nodes2 & 1023) == 0:
            self._tick()
        if togo == 0:
            return co == SOLVED_CORNERS and ud == SOLVED_UD and sp == SOLVED_SPERM
        path = self._path2
        for m in PHASE2_MOVES:
            face = m // 3
            if face == last_face or face == last_face - 3:
                continue
            nco = self.co[co * N_MOVES + m]
            nud = self.ud[ud * N_MOVES + m]
            nsp = self.sp[sp * N_MOVES + m]
            if self.p_co[nco * N_SPERM + nsp] >= togo or self.p_ud[nud * N_SPERM + nsp] >= togo:
                continue
            path.append(m)
            if self._search2(nco, nud, nsp, togo - 1, face):
                return True
            path.pop()
        return False

    # -- explanation data -------------------------------------------------
    def explain_path(self, facelets: str, moves: list[str], phase1_length: int) -> list[dict]:
        """Per step: lower bounds and the bound of every neighbour (the 18 edges)."""
        cc = validate(facelets)
        tw, fl, sl = twist_of(cc.co), flip_of(cc.eo), slice_of(cc.ep)
        corners = corners_of(cc.cp)
        out = []
        cube = cc
        for k in range(len(moves) + 1):
            phase = 1 if k < phase1_length else 2
            info = {"index": k, "phase": phase, "remaining": len(moves) - k}
            if phase == 1:
                info["h"] = self.h1(tw, fl, sl)
                info["neighbors"] = [
                    {"move": MOVES[m],
                     "h": self.h1(self.tw[tw * 18 + m], self.fl[fl * 18 + m], self.sl[sl * 18 + m])}
                    for m in range(N_MOVES)
                ]
            else:
                ud = ud_edges_of(cube.ep)
                sp = self.sperm[sl]
                info["h"] = self.h2(corners, ud, sp)
                info["neighbors"] = [
                    {"move": MOVES[m],
                     "h": self.h2(self.co[corners * 18 + m], self.ud[ud * 18 + m], self.sp[sp * 18 + m])
                     if m in PHASE2_SET else None}
                    for m in range(N_MOVES)
                ]
            out.append(info)
            if k < len(moves):
                m = MOVES.index(moves[k])
                tw, fl, sl = self.tw[tw * 18 + m], self.fl[fl * 18 + m], self.sl[sl * 18 + m]
                corners = self.co[corners * 18 + m]
                cube = cube.multiply(CUBIE_MOVES[moves[k]])
        return out


_solver: TwoPhaseSolver | None = None


def get_solver() -> TwoPhaseSolver:
    global _solver
    if _solver is None:
        _solver = TwoPhaseSolver()
    return _solver
