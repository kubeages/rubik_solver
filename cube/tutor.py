"""LLM tutor: explains the current step in plain Spanish.

The solver never depends on it; if the endpoint is down the app keeps
working with its built-in explanations.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time

import requests

log = logging.getLogger("rubik.tutor")

VLLM_URL = os.environ.get("VLLM_ENDPOINT", "").rstrip("/")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "qwen32b")
VLLM_API_KEY = os.environ.get("VLLM_API_KEY", "")
TIMEOUT = float(os.environ.get("VLLM_TIMEOUT", "60"))

SYSTEM = """Eres un tutor paciente que enseña a resolver el cubo de Rubik usando teoría de grafos.
Respondes SIEMPRE en español, en 2-6 frases claras, sin fórmulas complicadas salvo que te las pidan.

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
    """Is the LLM answering right now?  Cached briefly so a reload is cheap."""
    global _probe_cache
    if not enabled():
        return {"enabled": False, "ok": False, "model": VLLM_MODEL,
                "detail": "No hay ningún LLM configurado", "checked_at": time.time()}
    with _probe_lock:
        cached = _probe_cache
        if cached and not force and time.time() - cached["checked_at"] < PROBE_TTL:
            return cached
    headers = {"Authorization": f"Bearer {VLLM_API_KEY}"} if VLLM_API_KEY else {}
    started = time.monotonic()
    result = {"enabled": True, "ok": False, "model": VLLM_MODEL, "checked_at": time.time()}
    try:
        resp = requests.get(f"{VLLM_URL}/models", headers=headers, timeout=PROBE_TIMEOUT)
        result["latency_ms"] = int((time.monotonic() - started) * 1000)
        if resp.status_code == 401 or resp.status_code == 403:
            result["detail"] = "El LLM rechaza la clave de acceso"
        elif not resp.ok:
            result["detail"] = f"El LLM responde con error {resp.status_code}"
        else:
            names = [m.get("id") for m in resp.json().get("data", [])]
            if names and VLLM_MODEL not in names:
                result["detail"] = f"El LLM responde, pero no sirve el modelo {VLLM_MODEL}"
            else:
                result["ok"] = True
                result["detail"] = f"Conectado · {VLLM_MODEL}"
    except requests.Timeout:
        result["detail"] = "El LLM no responde (tiempo agotado)"
    except requests.RequestException:
        result["detail"] = "No se puede conectar con el LLM"
    except ValueError:
        result["detail"] = "El LLM devuelve una respuesta que no se entiende"
    if not result["ok"]:
        log.warning("tutor no disponible: %s", result["detail"])
    with _probe_lock:
        _probe_cache = result
    return result


def invalidate_probe():
    """Forget the cached probe, e.g. after a failed answer."""
    global _probe_cache
    with _probe_lock:
        _probe_cache = None


def ask(question: str, context: dict, history: list) -> str | None:
    if not enabled():
        return None
    ctx = json.dumps(context, ensure_ascii=False)[:4000]
    messages = [{"role": "system", "content": SYSTEM}]
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
