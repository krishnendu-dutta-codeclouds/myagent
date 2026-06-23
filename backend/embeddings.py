"""Local embedding generation via the Ollama HTTP API.

Uses the `nomic-embed-text` model running locally in Ollama.
"""
from __future__ import annotations

import json
import os
import requests
from typing import List

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")


def embed_text(text: str) -> List[float]:
    """Generate an embedding vector for a single text string.

    Sends the text to Ollama's `nomic-embed-text` model via HTTP API
    and parses the JSON output for the `embedding` field.
    """
    resp = requests.post(
        f"{OLLAMA_HOST}/api/embeddings",
        json={"model": "nomic-embed-text", "prompt": text},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a list of texts."""
    return [embed_text(t) for t in texts]
