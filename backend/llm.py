"""Thin wrapper around the local Ollama model via HTTP API.
The active model name is stored in memory and can be changed at runtime
via the /model-config API endpoint.
"""
from __future__ import annotations

import os
import requests

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")

# Active model — mutable at runtime via set_active_model()
_active_model: str = os.getenv("OLLAMA_MODEL", "tinyllama")


def get_active_model() -> str:
    """Return the currently configured Ollama model name."""
    return _active_model


def set_active_model(model: str) -> None:
    """Persist the chosen model in module-level state."""
    global _active_model
    _active_model = model.strip()


def list_local_models() -> list[str]:
    """Return a list of locally available Ollama model names."""
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        resp.raise_for_status()
        data = resp.json()
        return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def ask_llm(prompt: str, model: str | None = None) -> str:
    """Run a prompt through Ollama HTTP API and return the model's text output."""
    target = model or _active_model
    resp = requests.post(
        f"{OLLAMA_HOST}/api/generate",
        json={"model": target, "prompt": prompt, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()
