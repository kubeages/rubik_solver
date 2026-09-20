"""Simple username/password gate, in the style of the other apps on the cluster.

Credentials come from the environment (a Secret on the cluster), never from
the code.  If no password is configured the gate stays open, which is what
you want for local development.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time

from flask import jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

log = logging.getLogger("rubik.auth")

AUTH_USER = os.environ.get("AUTH_USER", "")
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")
AUTH_PASSWORD_HASH = os.environ.get("AUTH_PASSWORD_HASH", "")
# Extra accounts: "ana:<hash>,luis:<hash>" (commas or newlines between them).
# A value that is not a werkzeug hash is taken as a plain password.
AUTH_USERS = os.environ.get("AUTH_USERS", "")
SESSION_DAYS = int(os.environ.get("AUTH_SESSION_DAYS", "30"))

# how many failed attempts an address gets before it has to wait
MAX_FAILURES = 8
LOCKOUT_SECONDS = 300

_failures: dict[str, tuple[int, float]] = {}


def _accounts() -> dict[str, str]:
    """username -> password hash (or plain password), from the environment."""
    users: dict[str, str] = {}
    if AUTH_PASSWORD_HASH or AUTH_PASSWORD:
        users[AUTH_USER] = AUTH_PASSWORD_HASH or AUTH_PASSWORD
    for entry in AUTH_USERS.replace("\n", ",").split(","):
        entry = entry.strip()
        if not entry:
            continue
        name, sep, secret = entry.partition(":")
        if not sep or not name.strip() or not secret.strip():
            log.warning("AUTH_USERS: se ignora una entrada mal formada")
            continue
        users[name.strip()] = secret.strip()
    return users


def enabled() -> bool:
    return bool(_accounts())


def secret_key() -> str:
    """Key used to sign the session cookie.

    Derived from the credentials when SECRET_KEY is unset, so that every
    gunicorn worker signs with the same key (a random one per worker would
    log people out at random).
    """
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    seed = "rubik-solver|" + "|".join(f"{u}={s}" for u, s in sorted(_accounts().items()))
    return hashlib.sha256(seed.encode()).hexdigest()


def _check(user: str, password: str) -> str | None:
    """Return the name of the account that matches, or None."""
    users = _accounts()
    user = user.strip()
    # a single account with an empty name accepts any username (dev shortcut)
    secret = users.get(user)
    if secret is None and list(users) == [""]:
        secret, user = users[""], "user"
    if secret is None:
        # still spend the time of a hash check, so a wrong username is not
        # noticeably faster than a wrong password
        check_password_hash(_DUMMY_HASH, password)
        return None
    if secret.startswith(("scrypt:", "pbkdf2:", "argon2")):
        ok = check_password_hash(secret, password)
    else:
        ok = hmac.compare_digest(password, secret)
    return user if ok else None


_DUMMY_HASH = ("scrypt:32768:8:1$0000000000000000$"
               "0" * 128)


def _client() -> str:
    fwd = request.headers.get("X-Forwarded-For", "")
    return (fwd.split(",")[0].strip() or request.remote_addr or "?")


def _locked_for(ip: str) -> int:
    count, until = _failures.get(ip, (0, 0.0))
    return max(0, int(until - time.time())) if count >= MAX_FAILURES else 0


def _record_failure(ip: str):
    count, until = _failures.get(ip, (0, 0.0))
    if until and until < time.time():
        count = 0
    count += 1
    _failures[ip] = (count, time.time() + LOCKOUT_SECONDS)
    if len(_failures) > 1000:  # keep the table from growing forever
        cutoff = time.time()
        for k, (_, u) in list(_failures.items()):
            if u < cutoff:
                del _failures[k]


def init(app):
    app.secret_key = secret_key()
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "1") == "1",
        PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * SESSION_DAYS,
    )
    if not enabled():
        log.warning("sin contraseña configurada: la aplicación queda abierta")
        return

    open_endpoints = {"login", "logout", "healthz"}

    @app.before_request
    def _gate():
        if request.endpoint in open_endpoints or session.get("user"):
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "Sesión caducada: vuelve a entrar"}), 401
        return redirect(url_for("login", next=request.full_path.rstrip("?")))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        target = request.args.get("next") or url_for("index")
        if not target.startswith("/") or target.startswith("//"):
            target = url_for("index")  # never redirect off-site
        if session.get("user"):
            return redirect(target)
        error = None
        ip = _client()
        wait = _locked_for(ip)
        if request.method == "POST" and not wait:
            who = _check(request.form.get("username", ""), request.form.get("password", ""))
            if who:
                session.permanent = True
                session["user"] = who
                _failures.pop(ip, None)
                log.info("entra %s desde %s", who, ip)
                return redirect(target)
            _record_failure(ip)
            wait = _locked_for(ip)
            error = "Usuario o contraseña incorrectos."
            log.info("login fallido desde %s", ip)
        if wait:
            error = f"Demasiados intentos. Espera {wait // 60 + 1} min."
        return render_template("login.html", error=error, next=target), (401 if error else 200)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login"))
