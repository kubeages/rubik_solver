import pytest

from app import app
from cube.model import SOLVED, apply_moves


@pytest.fixture()
def client():
    return app.test_client()


def test_meta(client):
    data = client.get("/api/meta").get_json()
    assert len(data["stickers"]) == 54
    assert len(data["stages"]) == 7


def test_validate(client):
    assert client.post("/api/validate", json={"facelets": SOLVED}).get_json() == {"ok": True, "solved": True}
    bad = client.post("/api/validate", json={"facelets": "U" * 54}).get_json()
    assert bad["ok"] is False and bad["error"]


@pytest.mark.parametrize("mode", ["fast", "learn"])
def test_solve(client, mode):
    f = client.get("/api/random").get_json()["facelets"]
    res = client.post("/api/solve", json={"facelets": f, "mode": mode, "base": "D"})
    assert res.status_code == 200
    plan = res.get_json()
    moves = [m for s in plan["steps"] for m in s["moves"]]
    assert apply_moves(plan["facelets"], moves) == SOLVED


def test_solve_rejects_invalid(client):
    assert client.post("/api/solve", json={"facelets": "x"}).status_code == 400


def test_tutor_disabled_without_endpoint(client, monkeypatch):
    from cube import tutor
    monkeypatch.setattr(tutor, "VLLM_URL", "")
    assert client.post("/api/tutor", json={"question": "hola"}).status_code == 503
