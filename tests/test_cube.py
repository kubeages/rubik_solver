import random

import pytest

from cube import stages, twophase
from cube.model import (CUBIE_MOVES, MOVES, SOLVED, CubieCube, InvalidCube, apply_move,
                        apply_moves, parse_alg, random_state, ring_cycles, rotate_whole, validate)


def test_quarter_turn_has_order_four():
    for m in "URFDLB":
        assert apply_moves(SOLVED, [m] * 4) == SOLVED


def test_cubie_moves_match_kociemba_tables():
    assert CUBIE_MOVES["U"].cp == [3, 0, 1, 2, 4, 5, 6, 7]
    assert CUBIE_MOVES["R"].co == [2, 0, 0, 1, 1, 0, 0, 2]
    assert CUBIE_MOVES["F"].eo == [0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]


def test_facelet_and_cubie_models_agree():
    rng = random.Random(1)
    for _ in range(50):
        moves = [rng.choice(MOVES) for _ in range(25)]
        f = apply_moves(SOLVED, moves)
        assert CubieCube.solved().apply(moves).to_facelets() == f
        validate(f)


def test_ring_is_shifted_by_three_by_a_quarter_turn():
    for face in "URFDLB":
        ring = ring_cycles(face)["ring"]
        f = list(range(54))
        from cube.model import MOVE_PERMS
        perm = MOVE_PERMS[face]
        assert [perm[i] for i in ring] == ring[3:] + ring[:3]


@pytest.mark.parametrize("mutate,msg", [
    (lambda s: s[:8] + s[9] + s[8] + s[10:], "orden imposible"),
    (lambda s: s[:1] + s[46] + s[2:46] + s[1] + s[47:], "volteada"),
])
def test_invalid_cubes_are_rejected(mutate, msg):
    with pytest.raises(InvalidCube, match=msg):
        validate(mutate(apply_move(SOLVED, "R")))


def test_rotate_whole_keeps_cube_valid():
    f = random_state(random.Random(3))
    for rot in (["x"], ["y2"], ["z'"], ["x", "y"]):
        validate(rotate_whole(f, rot))


def test_twophase_solves():
    solver = twophase.get_solver()
    rng = random.Random(7)
    for _ in range(5):
        f = random_state(rng)
        res = solver.solve(f, max_time=3)
        assert apply_moves(f, res["moves"]) == SOLVED
        assert len(res["moves"]) <= 24


def test_layer_method_solves_every_stage():
    rng = random.Random(5)
    for base in "URFDLB":
        f = random_state(rng)
        res = stages.solve_layers(f, base=base)
        moves = [m for s in res["steps"] for m in s["moves"]]
        assert apply_moves(res["facelets"], moves) == SOLVED
        for s in res["steps"]:
            assert s["d_after"] == s["d_before"] - 1


def test_stage_graph_sizes():
    sizes = {s.key: len(s.codes) for s in stages.get_stages()}
    assert sizes["cross"] == 190080          # 12*11*10*9 * 2^4
    assert sizes["corners"] == 136080        # 8*7*6*5 * 3^4
    assert sizes["middle"] == 26880          # 8*7*6*5 * 2^4


def test_macros_keep_earlier_stages():
    for st in stages.get_stages():
        for m in st.macros:
            c = m.cube
            if st.key != "cross":
                assert all(c.ep[i] == i and c.eo[i] == 0 for i in (4, 5, 6, 7)), m.label
            if st.key not in ("cross", "corners"):
                assert all(c.cp[i] == i and c.co[i] == 0 for i in (4, 5, 6, 7)), m.label


def test_alg_parsing():
    assert parse_alg("R U R' U'") == ["R", "U", "R'", "U'"]
    with pytest.raises(ValueError):
        parse_alg("R Q")
