"""Local embedding generation via the Ollama HTTP API with local fallback.

Uses the `nomic-embed-text` model running locally in Ollama.
Falls back to a pure-Python feature hashing embedding if Ollama is offline.
"""
from __future__ import annotations

import hashlib
import os
import re
import requests
from typing import List

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")


def local_fallback_embedding(text: str, dimension: int = 768) -> List[float]:
    """Generate a deterministic 768-dimensional normalized text vector in pure Python.
    
    Uses character trigrams and word-level tokens hashed deterministically.
    """
    vector = [0.0] * dimension
    text_clean = text.lower().strip()
    
    # 1. Word-level tokens
    words = re.findall(r"\b\w+\b", text_clean)
    
    # 2. Character trigrams to capture sub-word overlap
    trigrams = [text_clean[i : i + 3] for i in range(len(text_clean) - 2)]
    
    tokens = words + trigrams
    if not tokens:
        return vector

    for token in tokens:
        # Deterministic hashing using MD5
        h = hashlib.md5(token.encode("utf-8")).digest()
        # First 4 bytes for index
        idx = int.from_bytes(h[:4], "big") % dimension
        # 5th byte for sign (+1 or -1) to minimize collisions (standard hashing trick)
        sign = 1 if h[4] % 2 == 0 else -1
        vector[idx] += sign

    # L2 Normalize the vector to ensure dot product equals cosine similarity
    magnitude = sum(x * x for x in vector) ** 0.5
    if magnitude > 0:
        vector = [x / magnitude for x in vector]

    return vector


def embed_text(text: str) -> List[float]:
    """Generate an embedding vector for a single text string.

    Sends the text to Ollama's `nomic-embed-text` model via HTTP API.
    If Ollama is unreachable/offline, falls back to local pure-Python vector.
    """
    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/embeddings",
            json={"model": "nomic-embed-text", "prompt": text},
            timeout=3,  # Fast timeout to fallback quickly
        )
        if resp.ok:
            return resp.json()["embedding"]
    except Exception as exc:
        print(f"[embeddings] Ollama failed/offline: {exc}. Using local pure-Python fallback.")

    return local_fallback_embedding(text)


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Generate embeddings for a list of texts."""
    return [embed_text(t) for t in texts]
