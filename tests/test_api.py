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


def test_tutor_status_without_endpoint(client, monkeypatch):
    from cube import tutor
    monkeypatch.setattr(tutor, "VLLM_URL", "")
    s = client.get("/api/tutor/status").get_json()
    assert s == {"enabled": False, "ok": False, "model": tutor.VLLM_MODEL,
                 "detail": "No hay ningún LLM configurado", "checked_at": s["checked_at"]}


def test_tutor_status_reports_a_broken_endpoint(client, monkeypatch):
    import requests

    from cube import tutor
    monkeypatch.setattr(tutor, "VLLM_URL", "http://llm.invalid/v1")
    monkeypatch.setattr(tutor, "_probe_cache", None)

    def boom(*a, **k):
        raise requests.ConnectionError("nope")

    monkeypatch.setattr(tutor.requests, "get", boom)
    s = client.get("/api/tutor/status").get_json()
    assert s["enabled"] is True and s["ok"] is False
    assert "No se puede conectar" in s["detail"]


def test_tutor_status_ok_and_cached(client, monkeypatch):
    from cube import tutor
    monkeypatch.setattr(tutor, "VLLM_URL", "http://llm.test/v1")
    monkeypatch.setattr(tutor, "_probe_cache", None)
    calls = []

    class Resp:
        status_code = 200
        ok = True

        def json(self):
            return {"data": [{"id": tutor.VLLM_MODEL}]}

    monkeypatch.setattr(tutor.requests, "get", lambda *a, **k: (calls.append(1), Resp())[1])
    assert client.get("/api/tutor/status").get_json()["ok"] is True
    client.get("/api/tutor/status")           # served from the cache
    assert len(calls) == 1
    client.get("/api/tutor/status?force=1")   # forced re-check
    assert len(calls) == 2
    monkeypatch.setattr(tutor, "_probe_cache", None)


def test_wrong_model_is_reported(client, monkeypatch):
    from cube import tutor
    monkeypatch.setattr(tutor, "VLLM_URL", "http://llm.test/v1")
    monkeypatch.setattr(tutor, "_probe_cache", None)

    class Resp:
        status_code = 200
        ok = True

        def json(self):
            return {"data": [{"id": "otro-modelo"}]}

    monkeypatch.setattr(tutor.requests, "get", lambda *a, **k: Resp())
    s = client.get("/api/tutor/status").get_json()
    assert s["ok"] is False and "no sirve el modelo" in s["detail"]
    monkeypatch.setattr(tutor, "_probe_cache", None)
