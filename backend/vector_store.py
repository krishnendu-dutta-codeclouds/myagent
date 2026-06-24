"""Pinecone-backed cloud vector store with a robust SQLite local fallback."""
from __future__ import annotations

import json
import math
import os
import sqlite3
from typing import List
import uuid

from .embeddings import embed_text

# Pinecone initialization
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.getenv("PINECONE_INDEX", "website-chat-agent")

pc = None
index = None
use_pinecone = False

if PINECONE_API_KEY:
    try:
        from pinecone import Pinecone, ServerlessSpec
        pc = Pinecone(api_key=PINECONE_API_KEY)
        
        # Ensure index exists
        existing_indexes = [idx.name for idx in pc.list_indexes()]
        if PINECONE_INDEX_NAME not in existing_indexes:
            print(f"[vector_store] Creating Pinecone index '{PINECONE_INDEX_NAME}'...")
            pc.create_index(
                name=PINECONE_INDEX_NAME,
                dimension=768,
                metric="cosine",
                spec=ServerlessSpec(
                    cloud="aws",
                    region="us-east-1"
                )
            )
        index = pc.Index(PINECONE_INDEX_NAME)
        use_pinecone = True
        print(f"[vector_store] Connected to Pinecone index '{PINECONE_INDEX_NAME}' successfully.")
    except Exception as exc:
        print(f"[vector_store] Pinecone initialization failed: {exc}. Falling back to SQLite local database.")
        use_pinecone = False
else:
    print("[vector_store] PINECONE_API_KEY not found. Using SQLite local database.")

# SQLite fallback path
DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "chroma")
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "local_store.db")

def init_sqlite_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS vectors (
            id TEXT PRIMARY KEY,
            text TEXT,
            embedding TEXT,
            metadata TEXT
        )
    """)
    conn.commit()
    conn.close()

# Initialize the local SQLite database at startup
init_sqlite_db()


class VectorCollectionWrapper:
    """Wrapper that mimics the ChromaDB collection API for seamless compatibility in RAG."""
    
    def count(self) -> int:
        if use_pinecone and index is not None:
            try:
                stats = index.describe_index_stats()
                return stats.get("total_vector_count", 0)
            except Exception as exc:
                print(f"[vector_store] Pinecone count failed: {exc}")
                return 0
        else:
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("SELECT COUNT(*) FROM vectors")
                count = cursor.fetchone()[0]
                conn.close()
                return count
            except Exception as exc:
                print(f"[vector_store] SQLite count failed: {exc}")
                return 0

    def delete(self, where: dict | None = None) -> None:
        if use_pinecone and index is not None:
            try:
                if where:
                    index.delete(filter=where)
                else:
                    index.delete(delete_all=True)
                print(f"[vector_store] Pinecone deleted vectors matching: {where}")
            except Exception as exc:
                print(f"[vector_store] Pinecone delete failed: {exc}")
        else:
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                if not where:
                    cursor.execute("DELETE FROM vectors")
                else:
                    # Filter matching rows in Python for absolute correctness across SQLite variants
                    cursor.execute("SELECT id, metadata FROM vectors")
                    to_delete = []
                    for row_id, meta_str in cursor.fetchall():
                        meta = json.loads(meta_str) if meta_str else {}
                        match = True
                        for k, v in where.items():
                            if meta.get(k) != v:
                                match = False
                                break
                        if match:
                            to_delete.append(row_id)
                    if to_delete:
                        cursor.executemany("DELETE FROM vectors WHERE id = ?", [(rid,) for rid in to_delete])
                conn.commit()
                conn.close()
                print(f"[vector_store] SQLite deleted vectors matching: {where}")
            except Exception as exc:
                print(f"[vector_store] SQLite delete failed: {exc}")

    def get(self, where: dict | None = None, include: list | None = None) -> dict:
        if use_pinecone and index is not None:
            try:
                # Query with dummy zero vector to fetch all matching vectors in Pinecone
                dummy_vector = [0.0] * 768
                resp = index.query(
                    vector=dummy_vector,
                    top_k=10000,
                    filter=where,
                    include_metadata=True
                )
                matches = resp.get("matches", [])
                metadatas = [m.get("metadata", {}) for m in matches if m.get("metadata")]
                return {"metadatas": metadatas}
            except Exception as exc:
                print(f"[vector_store] Pinecone get failed: {exc}")
                return {"metadatas": []}
        else:
            try:
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("SELECT metadata FROM vectors")
                metadatas = []
                for (meta_str,) in cursor.fetchall():
                    meta = json.loads(meta_str) if meta_str else {}
                    if where:
                        match = True
                        for k, v in where.items():
                            if meta.get(k) != v:
                                match = False
                                break
                        if match:
                            metadatas.append(meta)
                    else:
                        metadatas.append(meta)
                conn.close()
                return {"metadatas": metadatas}
            except Exception as exc:
                print(f"[vector_store] SQLite get failed: {exc}")
                return {"metadatas": []}


def get_collection(reset: bool = False) -> VectorCollectionWrapper:
    """Return the website_data collection wrapper, resetting it if requested."""
    wrapper = VectorCollectionWrapper()
    if reset:
        wrapper.delete()
    return wrapper


def store_chunks(chunks: List[str], metadata: dict | None = None) -> int:
    """Embed and store a list of text chunks.

    Returns the number of chunks stored.
    """
    if not chunks:
        return 0

    ids = [str(uuid.uuid4()) for _ in range(len(chunks))]
    embeddings = [embed_text(chunk) for chunk in chunks]
    meta_base = metadata.copy() if metadata else {}

    if use_pinecone and index is not None:
        try:
            vectors = []
            for i, chunk in enumerate(chunks):
                # Ensure metadata is flat and contains the text chunk
                meta = meta_base.copy()
                meta["text"] = chunk
                vectors.append({
                    "id": ids[i],
                    "values": embeddings[i],
                    "metadata": meta
                })
            
            # Upsert in batches of 100
            batch_size = 100
            for idx in range(0, len(vectors), batch_size):
                index.upsert(vectors=vectors[idx:idx+batch_size])
            return len(chunks)
        except Exception as exc:
            print(f"[vector_store] Pinecone store failed: {exc}. Falling back to SQLite for this operation.")

    # SQLite write
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        data = []
        for i, chunk in enumerate(chunks):
            data.append((
                ids[i],
                chunk,
                json.dumps(embeddings[i]),
                json.dumps(meta_base)
            ))
        cursor.executemany("INSERT OR REPLACE INTO vectors (id, text, embedding, metadata) VALUES (?, ?, ?, ?)", data)
        conn.commit()
        conn.close()
        return len(chunks)
    except Exception as exc:
        print(f"[vector_store] SQLite store failed: {exc}")
        return 0


def query_chunks(question: str, n_results: int = 3) -> List[str]:
    """Retrieve the top-N most relevant chunks for a question."""
    embedding = embed_text(question)

    if use_pinecone and index is not None:
        try:
            resp = index.query(
                vector=embedding,
                top_k=n_results,
                include_metadata=True
            )
            matches = resp.get("matches", [])
            return [m.get("metadata", {}).get("text", "") for m in matches if m.get("metadata", {}).get("text")]
        except Exception as exc:
            print(f"[vector_store] Pinecone query failed: {exc}. Falling back to SQLite for this operation.")

    # SQLite query
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT text, embedding FROM vectors")
        rows = cursor.fetchall()
        conn.close()

        if not rows:
            return []

        # Cosine similarity calculation in Python
        scored_chunks = []
        for text, emb_str in rows:
            try:
                emb = json.loads(emb_str)
                # Compute dot product and magnitudes
                dot_prod = sum(a * b for a, b in zip(embedding, emb))
                mag1 = math.sqrt(sum(a * a for a in embedding))
                mag2 = math.sqrt(sum(b * b for b in emb))
                score = dot_prod / (mag1 * mag2) if mag1 > 0 and mag2 > 0 else 0.0
                scored_chunks.append((score, text))
            except Exception:
                continue

        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        return [text for _, text in scored_chunks[:n_results]]
    except Exception as exc:
        print(f"[vector_store] SQLite query failed: {exc}")
        return []


def query_chunks_with_metadata(question: str, n_results: int = 3, project_id: str | None = None) -> List[dict]:
    """Retrieve the top-N most relevant chunks for a question, along with their metadata.
    
    Returns a list of dicts: [{"text": str, "metadata": dict}]
    """
    embedding = embed_text(question)

    if use_pinecone and index is not None:
        try:
            # Pinecone filter
            p_filter = {}
            if project_id:
                p_filter["project_id"] = project_id
                
            resp = index.query(
                vector=embedding,
                top_k=n_results,
                filter=p_filter if p_filter else None,
                include_metadata=True
            )
            matches = resp.get("matches", [])
            results = []
            for m in matches:
                meta = m.get("metadata", {})
                text = meta.pop("text", "")
                results.append({"text": text, "metadata": meta})
            return results
        except Exception as exc:
            print(f"[vector_store] Pinecone query failed: {exc}. Falling back to SQLite for this operation.")

    # SQLite query
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT text, embedding, metadata FROM vectors")
        rows = cursor.fetchall()
        conn.close()

        if not rows:
            return []

        scored_chunks = []
        for text, emb_str, meta_str in rows:
            try:
                meta = json.loads(meta_str) if meta_str else {}
                # Filter by project_id in SQLite fallback
                if project_id and meta.get("project_id") != project_id:
                    continue
                    
                emb = json.loads(emb_str)
                dot_prod = sum(a * b for a, b in zip(embedding, emb))
                mag1 = math.sqrt(sum(a * a for a in embedding))
                mag2 = math.sqrt(sum(b * b for b in emb))
                score = dot_prod / (mag1 * mag2) if mag1 > 0 and mag2 > 0 else 0.0
                scored_chunks.append((score, text, meta))
            except Exception:
                continue

        scored_chunks.sort(key=lambda x: x[0], reverse=True)
        return [{"text": text, "metadata": meta} for _, text, meta in scored_chunks[:n_results]]
    except Exception as exc:
        print(f"[vector_store] SQLite query failed: {exc}")
        return []
