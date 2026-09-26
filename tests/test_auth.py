"""The login gate: tests reload the modules with credentials in the environment."""

import importlib

import pytest


@pytest.fixture()
def secured(monkeypatch):
    from werkzeug.security import generate_password_hash
    monkeypatch.setenv("AUTH_USER", "marta")
    monkeypatch.setenv("AUTH_PASSWORD_HASH", generate_password_hash("secreta"))
    monkeypatch.setenv("COOKIE_SECURE", "0")
    import auth
    import app as app_module
    importlib.reload(auth)
    app_module = importlib.reload(app_module)
    yield app_module.app.test_client()
    monkeypatch.undo()
    importlib.reload(auth)
    importlib.reload(app_module)


def test_pages_redirect_to_login(secured):
    r = secured.get("/")
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_api_returns_401_not_a_redirect(secured):
    r = secured.post("/api/validate", json={"facelets": "U" * 54})
    assert r.status_code == 401 and r.get_json()["error"]


def test_healthz_stays_open(secured):
    assert secured.get("/healthz").status_code == 200


def test_login_and_logout(secured):
    assert secured.post("/login", data={"username": "marta", "password": "mala"}).status_code == 401
    r = secured.post("/login", data={"username": "marta", "password": "secreta"})
    assert r.status_code == 302
    assert secured.get("/").status_code == 200
    secured.get("/logout")
    assert secured.get("/").status_code == 302


def test_login_keeps_the_requested_page(secured):
    r = secured.get("/api/meta", follow_redirects=False)
    assert r.status_code == 401
    r = secured.get("/", follow_redirects=False)
    assert "next=%2F" in r.headers["Location"] or "next=/" in r.headers["Location"]


def test_open_redirects_are_refused(secured):
    secured.post("/login", data={"username": "marta", "password": "secreta"})
    r = secured.get("/login?next=https://evil.example.com/")
    assert r.headers["Location"] == "/"


def test_lockout_after_repeated_failures(secured):
    for _ in range(9):
        secured.post("/login", data={"username": "marta", "password": "mala"})
    r = secured.post("/login", data={"username": "marta", "password": "secreta"})
    assert r.status_code == 401 and "Too many attempts" in r.get_data(as_text=True)


def test_without_password_the_app_is_open():
    import app as app_module
    assert app_module.app.test_client().get("/").status_code == 200


@pytest.fixture()
def two_users(monkeypatch):
    from werkzeug.security import generate_password_hash
    monkeypatch.setenv("AUTH_USER", "marta")
    monkeypatch.setenv("AUTH_PASSWORD_HASH", generate_password_hash("secreta"))
    monkeypatch.setenv("AUTH_USERS", f"pablo:{generate_password_hash('otra')}, ana:enclaro")
    monkeypatch.setenv("COOKIE_SECURE", "0")
    import auth
    import app as app_module
    importlib.reload(auth)
    app_module = importlib.reload(app_module)
    yield app_module.app.test_client()
    monkeypatch.undo()
    importlib.reload(auth)
    importlib.reload(app_module)


@pytest.mark.parametrize("user,password", [("marta", "secreta"), ("pablo", "otra"), ("ana", "enclaro")])
def test_every_account_can_log_in(two_users, user, password):
    assert two_users.post("/login", data={"username": user, "password": password}).status_code == 302
    assert two_users.get("/").status_code == 200


@pytest.mark.parametrize("user,password", [
    ("marta", "otra"),        # right user, another account's password
    ("pablo", "secreta"),
    ("pepe", "secreta"),     # unknown user
    ("", "secreta"),         # no user at all
])
def test_wrong_combinations_are_refused(two_users, user, password):
    assert two_users.post("/login", data={"username": user, "password": password}).status_code == 401
    assert two_users.get("/").status_code == 302


def test_the_header_shows_who_is_logged_in(two_users):
    two_users.post("/login", data={"username": "pablo", "password": "otra"})
    assert "pablo" in two_users.get("/").get_data(as_text=True)


def test_malformed_entries_are_ignored(monkeypatch):
    monkeypatch.setenv("AUTH_USERS", "sinseparador, :sinnombre, ana:vale")
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASSWORD_HASH", raising=False)
    import auth
    importlib.reload(auth)
    assert sorted(auth._accounts()) == ["ana"]
    monkeypatch.undo()
    importlib.reload(auth)


def test_login_page_speaks_the_browsers_language(secured):
    en = secured.get("/login", headers={"Accept-Language": "en-GB,en;q=0.9"}).get_data(as_text=True)
    es = secured.get("/login", headers={"Accept-Language": "es-ES,es;q=0.9"}).get_data(as_text=True)
    assert '<html lang="en">' in en and "Sign in" in en and "Contraseña" not in en
    assert '<html lang="es">' in es and "Contraseña" in es and "Password" not in es
    # both switches are there, the current one marked
    assert 'aria-current="true" title="English"' in en and "ESP" in en and "ENG" in en


def test_choosing_on_the_login_page_is_remembered(secured):
    r = secured.get("/login?lang=es", headers={"Accept-Language": "en-US"})
    assert "Contraseña" in r.get_data(as_text=True)
    assert "lang=es" in r.headers.get("Set-Cookie", "")
    again = secured.get("/login", headers={"Accept-Language": "en-US"})   # cookie now sent back
    assert "Contraseña" in again.get_data(as_text=True)
