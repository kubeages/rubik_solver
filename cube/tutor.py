"""LLM tutor: explains the current step in plain Spanish.

The solver never depends on it; if the endpoint is down the app keeps
working with its built-in explanations.
"""

from __future__ import annotations

import json
import logging
import os

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
No inventes movimientos distintos de los que da la aplicación."""


def enabled() -> bool:
    return bool(VLLM_URL)


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
        return None
