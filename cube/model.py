"""Cube model shared by every solver.

Facelets follow Kociemba's layout: a 54-char string with faces in the order
U R F D L B, each face read row by row as seen from outside with
U seen with B at the top, D seen with F at the top and the four side
faces seen with U at the top.  Every letter names the face whose centre has
that colour, so the solved cube is ``UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB``.

Moves are not hand-written tables: each sticker gets a 3D position and a
normal, and a face turn is a -90 degree rotation of the stickers in that
layer.  Everything else (facelet permutations, cubie moves, the rings drawn
in the sticker graph) is derived from that geometry.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

FACES = "URFDLB"
SOLVED = "".join(f * 9 for f in FACES)

# Outward normal of each face in (x, y, z): x to the right, y up, z to the front.
NORMALS = {
    "U": (0, 1, 0), "R": (1, 0, 0), "F": (0, 0, 1),
    "D": (0, -1, 0), "L": (-1, 0, 0), "B": (0, 0, -1),
}


def _sticker_cubie(face: str, r: int, c: int) -> tuple[int, int, int]:
    """Position of the cubie carrying sticker (row r, col c) of a face."""
    if face == "U":
        return (c - 1, 1, r - 1)
    if face == "R":
        return (1, 1 - r, 1 - c)
    if face == "F":
        return (c - 1, 1 - r, 1)
    if face == "D":
        return (c - 1, -1, 1 - r)
    if face == "L":
        return (-1, 1 - r, c - 1)
    return (1 - c, 1 - r, -1)  # B


# STICKERS[i] = (cubie position, outward normal) for facelet index i.
STICKERS: list[tuple[tuple[int, int, int], tuple[int, int, int]]] = [
    (_sticker_cubie(f, i // 3, i % 3), NORMALS[f]) for f in FACES for i in range(9)
]
_STICKER_INDEX = {s: i for i, s in enumerate(STICKERS)}


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _rot_cw(v, n):
    """Rotate v by -90 degrees about axis n (clockwise seen from the tip of n)."""
    c = _cross(n, v)
    d = _dot(n, v)
    return tuple(-c[k] + n[k] * d for k in range(3))


def _turn_perm(axis, layer_test) -> list[int]:
    """perm[i] = where sticker i goes after the turn."""
    perm = list(range(54))
    for i, (pos, nrm) in enumerate(STICKERS):
        if layer_test(pos):
            perm[i] = _STICKER_INDEX[(_rot_cw(pos, axis), _rot_cw(nrm, axis))]
    return perm


def _compose(p, q):
    """Apply p then q (both 'goes to' permutations)."""
    return [q[p[i]] for i in range(len(p))]


def _power(p, k):
    r = list(range(len(p)))
    for _ in range(k):
        r = _compose(r, p)
    return r


# Quarter turns of the six faces plus whole-cube rotations x, y, z
# (x follows R, y follows U, z follows F).
_BASE: dict[str, list[int]] = {}
for _f in FACES:
    _n = NORMALS[_f]
    _BASE[_f] = _turn_perm(_n, lambda p, n=_n: _dot(p, n) == 1)
_BASE["x"] = _turn_perm(NORMALS["R"], lambda p: True)
_BASE["y"] = _turn_perm(NORMALS["U"], lambda p: True)
_BASE["z"] = _turn_perm(NORMALS["F"], lambda p: True)

# MOVE_PERMS["R2"] etc.  Suffix "" = quarter clockwise, "2" = half, "'" = anticlockwise.
MOVE_PERMS: dict[str, list[int]] = {}
for _b, _p in _BASE.items():
    MOVE_PERMS[_b] = _p
    MOVE_PERMS[_b + "2"] = _power(_p, 2)
    MOVE_PERMS[_b + "'"] = _power(_p, 3)

# The 18 face turns, ordered face-major: U U2 U' R R2 R' F ... (index = 3*face + power-1).
MOVES = [f + s for f in FACES for s in ("", "2", "'")]


def apply_move(facelets: str, move: str) -> str:
    perm = MOVE_PERMS[move]
    out = [""] * 54
    for i, ch in enumerate(facelets):
        out[perm[i]] = ch
    return "".join(out)


def apply_moves(facelets: str, moves) -> str:
    for m in moves:
        facelets = apply_move(facelets, m)
    return facelets


def parse_alg(alg: str) -> list[str]:
    out = []
    for tok in alg.replace("’", "'").split():
        if tok not in MOVE_PERMS:
            raise ValueError(f"Movimiento desconocido: {tok}")
        out.append(tok)
    return out


def invert_alg(moves: list[str]) -> list[str]:
    out = []
    for m in reversed(moves):
        if m.endswith("2"):
            out.append(m)
        elif m.endswith("'"):
            out.append(m[:-1])
        else:
            out.append(m + "'")
    return out


def simplify(moves: list[str]) -> list[str]:
    """Merge consecutive turns of the same face (R R -> R2, R R' -> nothing)."""
    stack: list[tuple[str, int]] = []
    for m in moves:
        face, amount = m[0], {"": 1, "2": 2, "'": 3}[m[1:]]
        if stack and stack[-1][0] == face:
            total = (stack[-1][1] + amount) % 4
            stack.pop()
            if total:
                stack.append((face, total))
        else:
            stack.append((face, amount))
    return [f + {1: "", 2: "2", 3: "'"}[a] for f, a in stack]


def ring_cycles(move: str) -> dict:
    """Sticker cycles of a face turn, for the sticker-graph drawing.

    ``ring`` holds the 12 stickers around the face in cyclic order, arranged
    so that consecutive stickers are geometric neighbours and a clockwise
    quarter turn shifts every sticker 3 places forward.  ``face`` holds the
    8 moving stickers on the face itself.
    """
    face = move[0]
    perm = MOVE_PERMS[face]
    moved = [i for i in range(54) if perm[i] != i]
    on_face = [i for i in moved if FACES[i // 9] == face]
    side = [i for i in moved if FACES[i // 9] != face]
    first_face = FACES[side[0] // 9]
    strip = [i for i in side if FACES[i // 9] == first_face]
    axis = next(k for k in range(3) if len({STICKERS[i][0][k] for i in strip}) == 3)
    strip.sort(key=lambda i: STICKERS[i][0][axis])
    # the last sticker of a strip must share a cubie with the first sticker
    # of the next strip (the image of the first one)
    if STICKERS[strip[2]][0] != STICKERS[perm[strip[0]]][0]:
        strip.reverse()
    ring = []
    for _ in range(4):
        ring.extend(strip)
        strip = [perm[i] for i in strip]
    return {"ring": ring, "face": on_face}


# ---------------------------------------------------------------------------
# Cubie level (Kociemba conventions for piece numbering)
# ---------------------------------------------------------------------------

CORNER_NAMES = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"]
EDGE_NAMES = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"]


def _facelet(name: str) -> int:
    return FACES.index(name[0]) * 9 + int(name[1:]) - 1


CORNER_FACELETS = [
    [_facelet(a) for a in t]
    for t in (
        ("U9", "R1", "F3"), ("U7", "F1", "L3"), ("U1", "L1", "B3"), ("U3", "B1", "R3"),
        ("D3", "F9", "R7"), ("D1", "L9", "F7"), ("D7", "B9", "L7"), ("D9", "R9", "B7"),
    )
]
EDGE_FACELETS = [
    [_facelet(a) for a in t]
    for t in (
        ("U6", "R2"), ("U8", "F2"), ("U4", "L2"), ("U2", "B2"), ("D6", "R8"), ("D2", "F8"),
        ("D4", "L8"), ("D8", "B8"), ("F6", "R4"), ("F4", "L6"), ("B6", "L4"), ("B4", "R6"),
    )
]
CORNER_COLORS = [[SOLVED[i] for i in fs] for fs in CORNER_FACELETS]
EDGE_COLORS = [[SOLVED[i] for i in fs] for fs in EDGE_FACELETS]


class InvalidCube(ValueError):
    """Raised with a user-facing (Spanish) message when a cube cannot exist.

    When one piece is to blame, `piece` names it ({"kind": "corner"|"edge",
    "name": "URF"}), so the browser can point at its stickers without having
    to read them back out of the Spanish sentence.
    """

    def __init__(self, message: str, piece: dict | None = None):
        super().__init__(message)
        self.piece = piece


@dataclass
class CubieCube:
    cp: list[int]
    co: list[int]
    ep: list[int]
    eo: list[int]

    @classmethod
    def solved(cls) -> "CubieCube":
        return cls(list(range(8)), [0] * 8, list(range(12)), [0] * 12)

    def copy(self) -> "CubieCube":
        return CubieCube(self.cp[:], self.co[:], self.ep[:], self.eo[:])

    def multiply(self, b: "CubieCube") -> "CubieCube":
        """self * b: apply self, then b (Kociemba's convention)."""
        cp = [self.cp[b.cp[i]] for i in range(8)]
        co = [(self.co[b.cp[i]] + b.co[i]) % 3 for i in range(8)]
        ep = [self.ep[b.ep[i]] for i in range(12)]
        eo = [(self.eo[b.ep[i]] + b.eo[i]) % 2 for i in range(12)]
        return CubieCube(cp, co, ep, eo)

    def inverse(self) -> "CubieCube":
        cp = [0] * 8
        co = [0] * 8
        ep = [0] * 12
        eo = [0] * 12
        for i in range(8):
            cp[self.cp[i]] = i
        for i in range(8):
            co[i] = (-self.co[cp[i]]) % 3
        for i in range(12):
            ep[self.ep[i]] = i
        for i in range(12):
            eo[i] = self.eo[ep[i]]
        return CubieCube(cp, co, ep, eo)

    def apply(self, moves) -> "CubieCube":
        c = self
        for m in moves:
            c = c.multiply(CUBIE_MOVES[m])
        return c

    def to_facelets(self) -> str:
        f = list(SOLVED)
        for i in range(8):
            for k in range(3):
                f[CORNER_FACELETS[i][(k + self.co[i]) % 3]] = CORNER_COLORS[self.cp[i]][k]
        for i in range(12):
            for k in range(2):
                f[EDGE_FACELETS[i][(k + self.eo[i]) % 2]] = EDGE_COLORS[self.ep[i]][k]
        return "".join(f)

    @classmethod
    def from_facelets(cls, s: str) -> "CubieCube":
        cp, co, ep, eo = [0] * 8, [0] * 8, [0] * 12, [0] * 12
        for i in range(8):
            cols = [s[j] for j in CORNER_FACELETS[i]]
            ori = next((k for k in range(3) if cols[k] in "UD"), None)
            if ori is None:
                raise InvalidCube(f"La esquina {CORNER_NAMES[i]} no tiene color de arriba ni de abajo",
                                  {"kind": "corner", "name": CORNER_NAMES[i]})
            c1, c2 = cols[(ori + 1) % 3], cols[(ori + 2) % 3]
            for j in range(8):
                if set(CORNER_COLORS[j]) == set(cols):
                    if (CORNER_COLORS[j][1], CORNER_COLORS[j][2]) != (c1, c2):
                        raise InvalidCube(
                            f"La esquina {CORNER_NAMES[i]} tiene sus colores en un orden imposible: "
                            "revisa esas tres pegatinas",
                            {"kind": "corner", "name": CORNER_NAMES[i]})
                    cp[i], co[i] = j, ori
                    break
            else:
                raise InvalidCube(f"La esquina {CORNER_NAMES[i]} tiene una combinación de colores imposible",
                                  {"kind": "corner", "name": CORNER_NAMES[i]})
        for i in range(12):
            cols = [s[j] for j in EDGE_FACELETS[i]]
            for j in range(12):
                if cols == EDGE_COLORS[j]:
                    ep[i], eo[i] = j, 0
                    break
                if cols[::-1] == EDGE_COLORS[j]:
                    ep[i], eo[i] = j, 1
                    break
            else:
                raise InvalidCube(f"La arista {EDGE_NAMES[i]} tiene una combinación de colores imposible",
                                  {"kind": "edge", "name": EDGE_NAMES[i]})
        return cls(cp, co, ep, eo)

    def corner_parity(self) -> int:
        return _parity(self.cp)

    def edge_parity(self) -> int:
        return _parity(self.ep)


def _parity(p) -> int:
    s = 0
    for i in range(len(p)):
        for j in range(i):
            if p[j] > p[i]:
                s += 1
    return s % 2


def _cubie_from_move(move: str) -> CubieCube:
    return CubieCube.from_facelets(apply_move(SOLVED, move))


CUBIE_MOVES: dict[str, CubieCube] = {m: _cubie_from_move(m) for m in MOVES}


def validate(facelets: str) -> CubieCube:
    """Check that a facelet string is a reachable cube; raise InvalidCube otherwise."""
    if len(facelets) != 54 or any(ch not in FACES for ch in facelets):
        raise InvalidCube("El estado debe tener 54 pegatinas con letras URFDLB")
    for k, f in enumerate(FACES):
        if facelets[9 * k + 4] != f:
            raise InvalidCube("Los centros no coinciden con sus caras")
    for f in FACES:
        n = facelets.count(f)
        if n != 9:
            raise InvalidCube(f"Hay {n} pegatinas del color de la cara {f}; deben ser 9")
    cc = CubieCube.from_facelets(facelets)
    if sorted(cc.cp) != list(range(8)):
        raise InvalidCube("Hay esquinas repetidas: revisa los colores de las esquinas")
    if sorted(cc.ep) != list(range(12)):
        raise InvalidCube("Hay aristas repetidas: revisa los colores de las aristas")
    if sum(cc.co) % 3:
        raise InvalidCube("Una esquina está girada sobre sí misma (el cubo se desmontó o hay un color mal leído)")
    if sum(cc.eo) % 2:
        raise InvalidCube("Una arista está volteada (el cubo se desmontó o hay un color mal leído)")
    if cc.corner_parity() != cc.edge_parity():
        raise InvalidCube("Hay dos piezas intercambiadas: este estado no se puede alcanzar girando caras")
    return cc


def rotate_whole(facelets: str, rotations) -> str:
    """Re-express a cube after whole-cube rotations (x, y, z...).

    The letters are relabelled so that the result again uses the centre
    colours as face names.
    """
    s = apply_moves(facelets, rotations)
    # after rotating, centre of face k carries some letter; map it back
    mapping = {s[9 * k + 4]: FACES[k] for k in range(6)}
    return "".join(mapping[ch] for ch in s)


def random_state(rng: random.Random | None = None) -> str:
    rng = rng or random.Random()
    moves = [rng.choice(MOVES) for _ in range(40)]
    return apply_moves(SOLVED, moves)
