"""The few sentences the server itself writes, in each language it speaks.

Everything the user reads about the plan (stage names, algorithm names,
explanations) is translated in the browser from language-neutral keys, so
switching language never needs the cube solved again. What is left here is
what only the server can say: why a cube cannot exist, the login page, a few
API errors, and the state of the tutor.
"""

from __future__ import annotations

LANGS = ("es", "en")
DEFAULT = "en"          # for browsers in a language we do not speak yet

MESSAGES: dict[str, dict[str, str]] = {
    "es": {
        # why a cube cannot exist
        "cube.bad_length": "El estado debe tener 54 pegatinas con letras URFDLB",
        "cube.centres": "Los centros no coinciden con sus caras",
        "cube.count": "Hay {n} pegatinas del color de la cara {face}; deben ser 9",
        "cube.corner_no_ud": "La esquina {piece} no tiene color de arriba ni de abajo",
        "cube.corner_order": "La esquina {piece} tiene sus colores en un orden imposible: revisa esas tres pegatinas",
        "cube.corner_combo": "La esquina {piece} tiene una combinación de colores imposible",
        "cube.edge_combo": "La arista {piece} tiene una combinación de colores imposible",
        "cube.corners_repeated": "Hay esquinas repetidas: revisa los colores de las esquinas",
        "cube.edges_repeated": "Hay aristas repetidas: revisa los colores de las aristas",
        "cube.corner_twisted": "Una esquina está girada sobre sí misma (el cubo se desmontó o hay un color mal leído)",
        "cube.edge_flipped": "Una arista está volteada (el cubo se desmontó o hay un color mal leído)",
        "cube.swapped": "Hay dos piezas intercambiadas: este estado no se puede alcanzar girando caras",
        # API
        "api.bad_base": "Cara base no válida",
        "api.empty_question": "Pregunta vacía",
        "api.tutor_unavailable": "El tutor no está disponible ahora mismo",
        "api.session_expired": "Sesión caducada: vuelve a entrar",
        # the tutor's state
        "tutor.not_configured": "No hay ningún LLM configurado",
        "tutor.bad_key": "El LLM rechaza la clave de acceso",
        "tutor.http_error": "El LLM responde con error {status}",
        "tutor.wrong_model": "El LLM responde, pero no sirve el modelo {model}",
        "tutor.ok": "Conectado · {model}",
        "tutor.timeout": "El LLM no responde (tiempo agotado)",
        "tutor.unreachable": "No se puede conectar con el LLM",
        "tutor.garbled": "El LLM devuelve una respuesta que no se entiende",
        # login page
        "login.title": "Entrar · Rubik con grafos",
        "login.heading": "Rubik con grafos",
        "login.intro": "Escribe tus credenciales para entrar.",
        "login.user": "Usuario",
        "login.password": "Contraseña",
        "login.submit": "Entrar",
        "login.wrong": "Usuario o contraseña incorrectos.",
        "login.locked": "Demasiados intentos. Espera {minutes} min.",
        "login.footer": "Resuelve tu cubo siguiendo un camino en un grafo.",
    },
    "en": {
        "cube.bad_length": "The state must have 54 stickers with the letters URFDLB",
        "cube.centres": "The centres do not match their faces",
        "cube.count": "There are {n} stickers of the colour of face {face}; there must be 9",
        "cube.corner_no_ud": "Corner {piece} has neither the top nor the bottom colour",
        "cube.corner_order": "Corner {piece} has its colours in an impossible order: check those three stickers",
        "cube.corner_combo": "Corner {piece} has an impossible combination of colours",
        "cube.edge_combo": "Edge {piece} has an impossible combination of colours",
        "cube.corners_repeated": "Some corners appear twice: check the colours of the corners",
        "cube.edges_repeated": "Some edges appear twice: check the colours of the edges",
        "cube.corner_twisted": "A corner is twisted in place (the cube was taken apart or a colour was misread)",
        "cube.edge_flipped": "An edge is flipped (the cube was taken apart or a colour was misread)",
        "cube.swapped": "Two pieces are swapped: this state cannot be reached by turning faces",
        "api.bad_base": "Invalid base face",
        "api.empty_question": "Empty question",
        "api.tutor_unavailable": "The tutor is not available right now",
        "api.session_expired": "Session expired: please sign in again",
        "tutor.not_configured": "No LLM is configured",
        "tutor.bad_key": "The LLM rejects the access key",
        "tutor.http_error": "The LLM answers with error {status}",
        "tutor.wrong_model": "The LLM answers, but does not serve the model {model}",
        "tutor.ok": "Connected · {model}",
        "tutor.timeout": "The LLM does not answer (timed out)",
        "tutor.unreachable": "Cannot reach the LLM",
        "tutor.garbled": "The LLM returns an answer that cannot be understood",
        "login.title": "Sign in · Rubik with graphs",
        "login.heading": "Rubik with graphs",
        "login.intro": "Enter your credentials to sign in.",
        "login.user": "Username",
        "login.password": "Password",
        "login.submit": "Sign in",
        "login.wrong": "Wrong username or password.",
        "login.locked": "Too many attempts. Wait {minutes} min.",
        "login.footer": "Solve your cube by following a path through a graph.",
    },
}

# How the tutor is told which language to answer in.
LANGUAGE_NAME = {"es": "español", "en": "inglés (English)"}


def tr(lang: str, key: str, **params) -> str:
    """The message `key` in `lang`, falling back to English, then to the key."""
    table = MESSAGES.get(lang) or MESSAGES[DEFAULT]
    text = table.get(key) or MESSAGES[DEFAULT].get(key) or key
    return text.format(**params) if params else text


def negotiate(explicit: str | None, cookie: str | None, accept_language: str | None) -> str:
    """Pick the language: asked for in the URL, then remembered in the cookie,
    then the browser's preference, then English."""
    for choice in (explicit, cookie):
        if choice and choice[:2].lower() in LANGS:
            return choice[:2].lower()
    if accept_language:
        ranked = []
        for i, part in enumerate(accept_language.split(",")):
            tag, _, q = part.strip().partition(";q=")
            try:
                weight = float(q) if q else 1.0
            except ValueError:
                weight = 0.0
            ranked.append((-weight, i, tag.strip()[:2].lower()))
        for _, _, code in sorted(ranked):
            if code in LANGS:
                return code
    return DEFAULT
