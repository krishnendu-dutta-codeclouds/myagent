"""Thin wrapper around LLM inference — supports both Ollama (HTTP API) and
local GGUF models (via llama-cpp-python).

The active model name is stored in memory and can be changed at runtime
via the /model-config API endpoint.

Models prefixed with "local-gguf:" are routed to the local GGUF inference
engine. All other model names are sent to the Ollama HTTP API.
"""
from __future__ import annotations

import os
import requests

from .local_inference import list_gguf_models, ask_local_gguf, download_default_model

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")

LOCAL_GGUF_PREFIX = "local-gguf:"


def _pick_default_model() -> str:
    """Choose the best default model at startup.

    Priority: env var > first local GGUF > Ollama tinyllama.
    """
    env_model = os.getenv("OLLAMA_MODEL")
    if env_model:
        return env_model

    # If we have downloaded GGUF models, use the first one
    gguf = list_gguf_models()
    if gguf:
        return f"{LOCAL_GGUF_PREFIX}{gguf[0]}"

    # Check if Ollama is reachable
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3)
        if resp.ok:
            return "tinyllama"
    except Exception:
        pass

    # Ollama offline, no GGUF — offer auto-download placeholder
    return f"{LOCAL_GGUF_PREFIX}tinyllama-1.1b (auto-download)"


# Active model — mutable at runtime via set_active_model()
_active_model: str = _pick_default_model()


def get_active_model() -> str:
    """Return the currently configured model name."""
    return _active_model


def set_active_model(model: str) -> None:
    """Persist the chosen model in module-level state."""
    global _active_model
    _active_model = model.strip()


def _is_ollama_online() -> bool:
    """Quick check whether the Ollama daemon is reachable."""
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3)
        return resp.ok
    except Exception:
        return False


def _list_ollama_completion_models() -> list[str]:
    """Return Ollama completion model names (excludes embedding-only models)."""
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        models = data.get("models", [])

        completion_models = []
        for m in models:
            name = m.get("name", "")
            capabilities = m.get("capabilities")
            if capabilities is not None:
                if "completion" in capabilities:
                    completion_models.append(name)
            else:
                if "embed" not in name.lower():
                    completion_models.append(name)
        return completion_models
    except Exception:
        return []


def list_local_models() -> list[str]:
    """Return a combined list of available models (GGUF + Ollama).

    GGUF models are prefixed with 'local-gguf:' and listed first.
    """
    # Local GGUF models
    gguf_models = [f"{LOCAL_GGUF_PREFIX}{f}" for f in list_gguf_models()]

    # If no GGUF models downloaded yet, offer a downloadable default
    if not gguf_models:
        gguf_models = [f"{LOCAL_GGUF_PREFIX}tinyllama-1.1b (auto-download)"]

    # Ollama models
    ollama_models = _list_ollama_completion_models()

    return gguf_models + ollama_models


def _get_fallback_models(exclude_model: str) -> list[str]:
    """Return ordered fallback models: local GGUF first, then Ollama local, then Ollama remote."""
    all_models = list_local_models()

    gguf_fallbacks = []
    ollama_local = []
    ollama_remote = []

    for name in all_models:
        if name == exclude_model:
            continue
        # Skip the auto-download placeholder for fallbacks
        if "(auto-download)" in name:
            continue
        if name.startswith(LOCAL_GGUF_PREFIX):
            gguf_fallbacks.append(name)
        elif name.endswith(":cloud"):
            ollama_remote.append(name)
        else:
            ollama_local.append(name)

    return gguf_fallbacks + ollama_local + ollama_remote


def _ask_ollama(prompt: str, model: str, images: list[str] | None = None) -> str:
    """Send a prompt to the Ollama HTTP API and return the response text."""
    payload = {"model": model, "prompt": prompt, "stream": False}
    if images:
        payload["images"] = images

    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json=payload,
            timeout=120,
        )
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Cannot connect to Ollama at {OLLAMA_HOST}. "
            "Make sure Ollama is running (`ollama serve`), or switch to a local-gguf model."
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Ollama request timed out after 120 s (model: {model})."
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc

    if not resp.ok:
        try:
            err_body = resp.json()
            detail = err_body.get("error") or str(err_body)
        except Exception:
            detail = resp.text[:300] or f"HTTP {resp.status_code}"
        raise RuntimeError(
            f"Ollama model '{model}' failed with HTTP {resp.status_code}: {detail}"
        )

    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError(
            f"Ollama returned non-JSON response (model: {model})."
        ) from exc

    if "response" not in data:
        raise RuntimeError(
            f"Ollama response missing 'response' key (model: {model})."
        )

    return data["response"].strip()


LOCAL_PROVIDER_URL = "http://127.0.0.1:8001"


def _is_local_provider_online() -> bool:
    """Check if the standalone GGUF model provider on port 8001 is reachable."""
    try:
        resp = requests.get(f"{LOCAL_PROVIDER_URL}/v1/models", timeout=1)
        return resp.ok
    except Exception:
        return False


def _ask_local_gguf_with_provider_fallback(prompt: str, target: str) -> str:
    """Query standalone model provider on port 8001 if online, else fall back to in-process."""
    gguf_filename = target[len(LOCAL_GGUF_PREFIX):]

    if _is_local_provider_online():
        try:
            payload = {
                "model": target,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 2048,
            }
            resp = requests.post(
                f"{LOCAL_PROVIDER_URL}/v1/chat/completions",
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            print(f"[llm] Local provider microservice failed, falling back to in-process: {exc}")

    return ask_local_gguf(prompt, model_filename=gguf_filename)


def ask_llm(prompt: str, model: str | None = None, images: list[str] | None = None) -> str:
    """Run a prompt through the appropriate backend and return the model's text.

    - Models prefixed with 'local-gguf:' use the local llama-cpp inference.
    - All other models are sent to Ollama.

    If the primary model fails, the system automatically tries fallback models
    (prioritizing local GGUF > Ollama local > Ollama remote).
    """
    target = model or _active_model

    # ── Route to local GGUF ──────────────────────────────────────────
    if target.startswith(LOCAL_GGUF_PREFIX):
        gguf_filename = target[len(LOCAL_GGUF_PREFIX):]

        # Handle auto-download placeholder
        if "auto-download" in gguf_filename.lower():
            try:
                real_filename = download_default_model()
                gguf_filename = real_filename
                # Update the active model to the real filename
                set_active_model(f"{LOCAL_GGUF_PREFIX}{real_filename}")
                target = f"{LOCAL_GGUF_PREFIX}{real_filename}"
            except Exception as exc:
                raise RuntimeError(f"Failed to auto-download model: {exc}") from exc

        try:
            return _ask_local_gguf_with_provider_fallback(prompt, target)
        except Exception as exc:
            primary_error = str(exc)
            # Fall through to fallback logic below

    # ── Route to Ollama ──────────────────────────────────────────────
    else:
        try:
            return _ask_ollama(prompt, target, images=images)
        except Exception as exc:
            primary_error = str(exc)
            # Fall through to fallback logic below

    # ── Self-healing fallback ────────────────────────────────────────
    fallbacks = _get_fallback_models(exclude_model=target)

    errors = [f"{target}: {primary_error}"]
    for fallback in fallbacks:
        try:
            if fallback.startswith(LOCAL_GGUF_PREFIX):
                fallback_res = _ask_local_gguf_with_provider_fallback(prompt, fallback)
            else:
                fallback_res = _ask_ollama(prompt, fallback, images=images)

            # Success — switch active model
            set_active_model(fallback)
            return (
                f"⚠️ Automatically switched active model to **{fallback}** because **{target}** "
                f"returned an error.\n\n{fallback_res}"
            )
        except Exception as retry_exc:
            errors.append(f"{fallback}: {retry_exc}")

    # All failed
    raise RuntimeError(
        f"All models failed. Errors: {'; '.join(errors)}"
    )


