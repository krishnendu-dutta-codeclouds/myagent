"""Split long text into smaller chunks for embedding and retrieval."""
from __future__ import annotations

from typing import List


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping word-based chunks.

    Args:
        text: The full text to split.
        chunk_size: Number of words per chunk.
        overlap: Number of overlapping words between consecutive chunks.

    Returns:
        A list of text chunks.
    """
    words = text.split()
    if not words:
        return []

    chunks: List[str] = []
    step = max(chunk_size - overlap, 1)
    for start in range(0, len(words), step):
        chunk_words = words[start : start + chunk_size]
        if not chunk_words:
            break
        chunks.append(" ".join(chunk_words))
        if start + chunk_size >= len(words):
            break
    return chunks
