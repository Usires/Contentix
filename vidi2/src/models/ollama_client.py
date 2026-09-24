"""
ollama_client.py — Ollama API Wrapper für Vidi 2.0 Discovery Pipeline.

Bietet:
  - chat_json(model, messages, ...) — JSON-mode completion
  - chat_text(model, messages, ...) — Plain-text completion
  - list_models() — Cache-aware (5s TTL)
  - health_check() — Server reachable?

Unified interface to Ollama's HTTP API. Used by classifier.py
and reasoner.py.
"""

import os
import json
import httpx
import time
from typing import List, Dict, Optional, Any


OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:12434")
DEFAULT_TIMEOUT = 60.0  # generous for qwen3.5 / gemma4
DEFAULT_KEEP_ALIVE = "5m"  # model stays loaded for 5 min after last use


# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────

class OllamaError(Exception):
    pass


def _format_messages(messages: List[Dict]) -> List[Dict]:
    """Pass-through + minimal sanity check."""
    if not isinstance(messages, list):
        raise OllamaError("messages must be a list")
    out = []
    for m in messages:
        if not isinstance(m, dict) or "role" not in m or "content" not in m:
            raise OllamaError(f"bad message: {m!r}")
        out.append({"role": m["role"], "content": m["content"]})
    return out


# ────────────────────────────────────────────────────────────
# Chat completion
# ────────────────────────────────────────────────────────────

def chat_text(
    model: str,
    messages: List[Dict],
    *,
    temperature: float = 0.4,
    max_tokens: Optional[int] = None,
    timeout: float = DEFAULT_TIMEOUT,
    keep_alive: str = DEFAULT_KEEP_ALIVE,
) -> str:
    """
    Plain-text completion. Returns the model's content string.
    Raises OllamaError on transport / parse failures.
    """
    payload = {
        "model": model,
        "messages": _format_messages(messages),
        "stream": False,
        "options": {
            "temperature": temperature,
            "keep_alive": keep_alive,
        },
    }
    if max_tokens:
        payload["options"]["num_predict"] = max_tokens
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        if r.status_code != 200:
            raise OllamaError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
        return (data.get("message") or {}).get("content", "")
    except httpx.TimeoutException as e:
        raise OllamaError(f"timeout: {e}") from e
    except httpx.HTTPError as e:
        raise OllamaError(f"http error: {e}") from e


def chat_json(
    model: str,
    messages: List[Dict],
    *,
    temperature: float = 0.2,
    max_tokens: Optional[int] = None,
    timeout: float = DEFAULT_TIMEOUT,
    keep_alive: str = DEFAULT_KEEP_ALIVE,
) -> Any:
    """
    JSON-mode completion. Ollama uses 'format: "json"' to force JSON output.
    Returns parsed JSON object (or list, etc.).

    For models with the 'thinking' capability (qwen3.5, ornith-1.5, ...),
    we explicitly set `think: false` so the model doesn't burn the entire
    token budget on internal reasoning before producing the JSON content.
    Without this flag, classifier output would be empty and reasoning-
    only models would always fail structured-output calls.
    """
    payload = {
        "model": model,
        "messages": _format_messages(messages),
        "stream": False,
        "format": "json",
        "think": False,
        "options": {
            "temperature": temperature,
            "keep_alive": keep_alive,
        },
    }
    if max_tokens:
        payload["options"]["num_predict"] = max_tokens
    try:
        with httpx.Client(timeout=timeout) as client:
            r = client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        if r.status_code != 200:
            raise OllamaError(f"Ollama HTTP {r.status_code}: {r.text[:300]}")
        data = r.json()
        content = (data.get("message") or {}).get("content", "")
        if not content:
            return None
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            # Sometimes models wrap JSON in ```json ... ``` even with format=json.
            cleaned = content.strip()
            if cleaned.startswith("```"):
                cleaned = "\n".join(cleaned.split("\n")[1:])
                if cleaned.endswith("```"):
                    cleaned = cleaned[:-3]
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                raise OllamaError(f"bad JSON: {content[:200]!r}") from e
    except httpx.HTTPError as e:
        raise OllamaError(f"http error: {e}") from e


# ────────────────────────────────────────────────────────────
# Server health + model discovery
# ────────────────────────────────────────────────────────────

def health_check() -> bool:
    """Returns True if Ollama is reachable, False otherwise."""
    try:
        with httpx.Client(timeout=3) as client:
            r = client.get(f"{OLLAMA_URL}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


# Cached model list. We don't want to refresh this every call.
_model_cache: Dict[str, Any] = {"ts": 0.0, "models": []}
_MODEL_TTL = 5.0


def list_models(force_refresh: bool = False) -> List[str]:
    """
    Return list of Ollama model names. Caches for 5s. Force-refresh
    via force_refresh=True.
    """
    now = time.time()
    if not force_refresh and (now - _model_cache["ts"]) < _MODEL_TTL:
        return _model_cache["models"]
    try:
        with httpx.Client(timeout=5) as client:
            r = client.get(f"{OLLAMA_URL}/api/tags")
        if r.status_code != 200:
            return _model_cache.get("models", [])
        data = r.json()
        names = [m.get("name") for m in data.get("models", []) if m.get("name")]
        _model_cache.update({"ts": now, "models": names})
        return names
    except Exception:
        return _model_cache.get("models", [])


def model_available(model: str) -> bool:
    return model in list_models()


# ────────────────────────────────────────────────────────────
# Smoke-test
# ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=== ollama_client.py smoke test ===")
    if not health_check():
        print("Ollama not reachable at", OLLAMA_URL)
        exit(1)
    models = list_models(force_refresh=True)
    print(f"Available models ({len(models)}): {models[:6]}{'...' if len(models) > 6 else ''}")
    if "qwen3.5:latest" in models:
        reply = chat_text(
            "qwen3.5:latest",
            [{"role": "user", "content": "Antworte nur mit: OK"}],
            max_tokens=20,
        )
        print(f"qwen3.5 reply: {reply.strip()!r}")
