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


def test_validate_names_the_guilty_piece(client):
    # swap two stickers of the URF corner: its colours come out in an order
    # no corner has, and the reply says which corner, as data
    f = list(SOLVED)
    f[8], f[9] = f[9], f[8]
    bad = client.post("/api/validate", json={"facelets": "".join(f)}).get_json()
    assert bad["ok"] is False
    assert bad["piece"] == {"kind": "corner", "name": "URF"}
    # a fault that is not one piece's fault names no piece
    whole = client.post("/api/validate", json={"facelets": "U" * 54}).get_json()
    assert whole["piece"] is None


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
    assert s == {"enabled": False, "ok": False, "model": tutor.VLLM_MODEL, "code": "tutor.not_configured",
                 "params": {}, "detail": "No LLM is configured", "checked_at": s["checked_at"]}
    es = client.get("/api/tutor/status", headers={"Accept-Language": "es-ES,es;q=0.9"}).get_json()
    assert es["detail"] == "No hay ningún LLM configurado"


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
    assert s["code"] == "tutor.unreachable" and s["detail"] == "Cannot reach the LLM"
    es = client.get("/api/tutor/status", headers={"Accept-Language": "es-ES,es;q=0.9"}).get_json()
    assert "No se puede conectar" in es["detail"]


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
    assert s["ok"] is False and s["code"] == "tutor.wrong_model"
    assert "does not serve the model" in s["detail"]
    monkeypatch.setattr(tutor, "_probe_cache", None)


def test_invented_moves_are_caught():
    from cube.tutor import invented_moves
    allowed = ["R", "U", "R'", "U'", "F2"]
    assert invented_moves("Haz R U R' U' y ya está.", allowed) == []
    assert invented_moves("Si hicieras F2 volverías atrás.", allowed) == []   # a neighbour: fair
    assert invented_moves("Ahora gira D2 para colocar la esquina.", allowed) == ["D2"]
    assert invented_moves("Gira R’ y luego U.", allowed) == []                # typographic prime
    assert invented_moves("Mira la cara U y el plan B.", allowed) == []       # names, not turns
    assert invented_moves("Sin contexto no se comprueba nada: D2.", []) == []


def test_tutor_reply_reports_invented_moves(client, monkeypatch):
    from cube import tutor
    monkeypatch.setattr(tutor, "ask", lambda q, c, h, **kw: "Gira L2 y después R.")
    res = client.post("/api/tutor", json={"question": "¿qué hago?",
                                          "context": {"giros_posibles": ["R", "U"]}})
    assert res.get_json() == {"answer": "Gira L2 y después R.", "invented": ["L2"]}


def test_language_is_negotiated():
    from cube.i18n import negotiate
    assert negotiate(None, None, "es-ES,es;q=0.9,en;q=0.8") == "es"
    assert negotiate(None, None, "de-DE,de;q=0.9,en;q=0.8") == "en"   # first one we speak
    assert negotiate(None, None, "fr-FR") == "en"                     # none: English
    assert negotiate(None, "es", "en-US") == "es"                     # the user's choice wins
    assert negotiate("en", "es", "es-ES") == "en"                     # ...unless asked in the URL
    assert negotiate(None, None, "en;q=0.5,es;q=0.9") == "es"         # weights count


def test_errors_speak_the_users_language(client):
    f = list(SOLVED)
    f[8], f[9] = f[9], f[8]
    body = {"facelets": "".join(f)}
    en = client.post("/api/validate", json=body).get_json()
    es = client.post("/api/validate", json=body, headers={"Accept-Language": "es-ES,es;q=0.9"}).get_json()
    assert en["code"] == es["code"] == "cube.corner_order"
    assert en["error"].startswith("Corner URF") and es["error"].startswith("La esquina URF")
    client.set_cookie("lang", "es")                       # what the language switch sets
    assert client.post("/api/validate", json=body).get_json()["error"].startswith("La esquina")

