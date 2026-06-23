"""ChromaDB-backed local vector store for website chunks."""
from __future__ import annotations

from typing import List
import uuid

import chromadb

from .embeddings import embed_text


# Persistent local storage under the project's `chroma/` folder.
client = chromadb.PersistentClient(path="./chroma")

# One shared collection for indexed website content. Reset per training run.
COLLECTION_NAME = "website_data"


def get_collection(reset: bool = False):
    """Return (and optionally reset) the website_data collection."""
    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
        except Exception:
            # Collection may not exist yet — safe to ignore.
            pass
    return client.get_or_create_collection(name=COLLECTION_NAME)


def store_chunks(chunks: List[str], metadata: dict | None = None) -> int:
    """Embed and store a list of text chunks.

    Returns the number of chunks stored.
    """
    collection = get_collection(reset=False)
    if not chunks:
        return 0

    ids = [str(uuid.uuid4()) for _ in range(len(chunks))]
    embeddings = [embed_text(chunk) for chunk in chunks]
    
    metadatas = [metadata] * len(chunks) if metadata else None

    collection.add(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
    )
    return len(chunks)


def query_chunks(question: str, n_results: int = 3) -> List[str]:
    """Retrieve the top-N most relevant chunks for a question."""
    collection = get_collection()
    if collection.count() == 0:
        return []

    embedding = embed_text(question)
    results = collection.query(
        query_embeddings=[embedding],
        n_results=n_results,
    )
    documents = results.get("documents", [[]])[0]
    return documents
