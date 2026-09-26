"""LLM tutor: explains the current step in plain Spanish.

The solver never depends on it; if the endpoint is down the app keeps
working with its built-in explanations.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time

import requests

log = logging.getLogger("rubik.tutor")

VLLM_URL = os.environ.get("VLLM_ENDPOINT", "").rstrip("/")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "qwen32b")
VLLM_API_KEY = os.environ.get("VLLM_API_KEY", "")
TIMEOUT = float(os.environ.get("VLLM_TIMEOUT", "60"))

SYSTEM = """Eres un tutor paciente que enseña a resolver el cubo de Rubik usando teoría de grafos.
Respondes SIEMPRE en {language}, en 2-6 frases claras, sin fórmulas complicadas salvo que te las pidan.

Ideas que puedes usar:
- Cada posición del cubo es un vértice de un grafo enorme (unos 43 trillones de vértices) y cada giro de cara es una arista (18 por vértice). Es el grafo de Cayley del grupo del cubo. Resolver = encontrar un camino hasta el vértice "resuelto". Su diámetro es 20 (el número de Dios).
- Otro grafo más pequeño: los 54 adhesivos son vértices y cada giro mueve los adhesivos por anillos (ciclos de la permutación). Eso es lo que se ve en el "grafo de pegatinas".
- Modo aprendizaje: cada fase del método por capas mira solo unas piezas, así el grafo es pequeño (p. ej. la cruz: 190.080 vértices). Se calcula con BFS (búsqueda en anchura) la distancia exacta de cada vértice a la meta, y cada paso sigue una arista que baja la distancia en 1: un camino más corto. Las aristas pueden ser algoritmos enteros (macro-operadores).
- Modo rápido (Kociemba, dos fases): fase 1 busca en el grafo cociente G/H hasta entrar en el subgrupo H=<U,D,R2,L2,F2,B2>; fase 2 resuelve dentro de H. Usa IDA* con cotas inferiores (bases de datos de patrones), que nunca sobreestiman la distancia.
Si el usuario parece perdido con el cubo físico, dale consejos prácticos (cómo sujetar el cubo, qué significa la notación: R = cara derecha en sentido horario mirándola de frente, R' antihorario, R2 media vuelta).

Cuidado con estas confusiones:
- R, U, F, D, L y B son SIEMPRE giros de una cara, nunca nombres de piezas. "U" significa girar la cara de arriba, no una arista llamada U.
- En el modo aprendizaje la primera capa se construye ABAJO (la cara D), así que "la cruz de la base" son las cuatro aristas de la cara de abajo, no las de arriba.
- La "distancia" que te pasa el contexto es la distancia en el grafo de esa fase, contando aristas (a veces cada arista es un algoritmo entero), no el número de giros.
No inventes movimientos distintos de los que da la aplicación y, si el contexto no te dice algo, dilo en vez de suponerlo."""


PROBE_TTL = float(os.environ.get("VLLM_PROBE_TTL", "30"))
PROBE_TIMEOUT = float(os.environ.get("VLLM_PROBE_TIMEOUT", "6"))

_probe_lock = threading.Lock()
_probe_cache: dict | None = None


def enabled() -> bool:
    return bool(VLLM_URL)


def probe(force: bool = False) -> dict:
    """Is the LLM answering right now?  Cached briefly so a reload is cheap.

    The result says what happened as a message key and its values (`code`,
    `params`), so it can be told in whichever language asks; see describe().
    """
    global _probe_cache
    if not enabled():
        return {"enabled": False, "ok": False, "model": VLLM_MODEL,
                "code": "tutor.not_configured", "params": {}, "checked_at": time.time()}
    with _probe_lock:
        cached = _probe_cache
        if cached and not force and time.time() - cached["checked_at"] < PROBE_TTL:
            return cached
    headers = {"Authorization": f"Bearer {VLLM_API_KEY}"} if VLLM_API_KEY else {}
    started = time.monotonic()
    result = {"enabled": True, "ok": False, "model": VLLM_MODEL, "checked_at": time.time(), "params": {}}
    try:
        resp = requests.get(f"{VLLM_URL}/models", headers=headers, timeout=PROBE_TIMEOUT)
        result["latency_ms"] = int((time.monotonic() - started) * 1000)
        if resp.status_code == 401 or resp.status_code == 403:
            result["code"] = "tutor.bad_key"
        elif not resp.ok:
            result["code"], result["params"] = "tutor.http_error", {"status": resp.status_code}
        else:
            names = [m.get("id") for m in resp.json().get("data", [])]
            if names and VLLM_MODEL not in names:
                result["code"], result["params"] = "tutor.wrong_model", {"model": VLLM_MODEL}
            else:
                result["ok"] = True
                result["code"], result["params"] = "tutor.ok", {"model": VLLM_MODEL}
    except requests.Timeout:
        result["code"] = "tutor.timeout"
    except requests.RequestException:
        result["code"] = "tutor.unreachable"
    except ValueError:
        result["code"] = "tutor.garbled"
    if not result["ok"]:
        log.warning("tutor no disponible: %s", result["code"])
    with _probe_lock:
        _probe_cache = result
    return result


def describe(result: dict, lang: str) -> dict:
    """The probe result with its `detail` written in `lang`."""
    from .i18n import tr
    return {**result, "detail": tr(lang, result["code"], **result.get("params", {}))}


def invalidate_probe():
    """Forget the cached probe, e.g. after a failed answer."""
    global _probe_cache
    with _probe_lock:
        _probe_cache = None


def ask(question: str, context: dict, history: list, lang: str = "es") -> str | None:
    if not enabled():
        return None
    from .i18n import LANGUAGE_NAME
    ctx = json.dumps(context, ensure_ascii=False)[:4000]
    system = SYSTEM.format(language=LANGUAGE_NAME.get(lang, LANGUAGE_NAME["es"]))
    messages = [{"role": "system", "content": system}]
    for turn in history[-6:]:
        if turn.get("role") in ("user", "assistant") and isinstance(turn.get("content"), str):
            messages.append({"role": turn["role"], "content": turn["content"][:2000]})
    messages.append({
        "role": "user",
        "content": f"Contexto actual de la aplicación (JSON):\n{ctx}\n\nPregunta: {question}",
    })
    headers = {"Authorization": f"Bearer {VLLM_API_KEY}"} if VLLM_API_KEY else {}
    try:
        resp = requests.post(
            f"{VLLM_URL}/chat/completions",
            headers=headers,
            json={
                "model": VLLM_MODEL,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 600,
                "chat_template_kwargs": {"enable_thinking": False},
            },
            timeout=TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except (requests.RequestException, KeyError, ValueError) as e:
        log.warning("tutor unavailable: %s", e)
        invalidate_probe()
        return None


# A turn written in the notation: one face letter, then nothing, a prime or a 2,
# standing on its own (not inside a word, not in lower case, which would be
# another notation altogether).
_MOVE = re.compile(r"(?<![\wÀ-ÿ])([URFDLB])(['’′]|2)?(?![\wÀ-ÿ'’′])")
# "la cara U" names a face and "el plan B" is a figure of speech: neither asks
# for a turn. The same in English ("the U face" is covered by the face letter
# being followed by "face", which is not a turn either way).
_FACE_NAMED = re.compile(
    r"\b(?:cara|capa|centro|plan|opción|opcion|tipo|face|layer|centre|center|option|type)\s+$",
    re.IGNORECASE)
# ...and English puts the word after it: "the U face", "the D layer"
_FACE_AFTER = re.compile(r"\s+(?:face|layer|centre|center|side)\b", re.IGNORECASE)


def invented_moves(answer: str, allowed: list[str]) -> list[str]:
    """Turns the reply mentions that are nowhere in this step or its neighbours.

    The LLM kept telling people to make turns that were not in the plan, which
    its instructions already forbid. Mentioning a neighbour ("si hicieras R'
    volverías atrás") is fair; a turn that is neither in this step nor among
    the edges leaving it was made up. Returns them in order, without repeats.
    """
    if not allowed:
        return []
    ok = {m.replace("’", "'").replace("′", "'") for m in allowed}
    found = []
    for match in _MOVE.finditer(answer):
        if _FACE_NAMED.search(answer[:match.start()]) or _FACE_AFTER.match(answer, match.end()):
            continue
        move = match.group(1) + ("'" if match.group(2) in ("'", "’", "′") else (match.group(2) or ""))
        if move not in ok and move not in found:
            found.append(move)
    return found
