"""High-level Retrieval-Augmented Generation pipeline."""
from __future__ import annotations

import os
from typing import List

from .chunker import chunk_text
from .document_processor import process_uploaded_file
from .llm import ask_llm
from .prompts import REFUSAL_MESSAGE, build_prompt
from .scraper import scrape_website
from .vector_store import query_chunks, store_chunks, get_collection

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")


def train_on_website(url: str) -> dict:
    """Scrape a website, chunk it, and index the chunks in the vector store."""
    text = scrape_website(url)
    chunks = chunk_text(text)
    
    # Delete old website chunks
    collection = get_collection()
    try:
        collection.delete(where={"source": "website"})
    except Exception:
        pass
        
    stored = store_chunks(chunks, metadata={"source": "website", "url": url})
    return {
        "status": "Website indexed successfully",
        "url": url,
        "chunks_indexed": stored,
    }


def train_on_documents(files: List[tuple[str, bytes]]) -> dict:
    """Process uploaded documents, save them to disk, chunk them, and index in the vector store."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    processed_files = []
    total_chunks = 0
    
    for filename, file_bytes in files:
        try:
            safe_filename = os.path.basename(filename)
            file_path = os.path.join(UPLOAD_DIR, safe_filename)
            
            with open(file_path, "wb") as f:
                f.write(file_bytes)
                
            chunks = process_uploaded_file(safe_filename, file_bytes)
            
            # Delete old chunks for this file if any
            collection = get_collection()
            try:
                collection.delete(where={"filename": safe_filename})
            except Exception:
                pass
                
            if chunks:
                stored = store_chunks(chunks, metadata={"source": "document", "filename": safe_filename})
                total_chunks += stored
                
            processed_files.append(safe_filename)
        except Exception as exc:
            raise RuntimeError(f"Failed to process {filename}: {exc}") from exc
            
    return {
        "status": "Documents indexed successfully",
        "files_processed": processed_files,
        "chunks_indexed": total_chunks,
    }


def list_documents() -> List[dict]:
    """List all uploaded documents."""
    if not os.path.exists(UPLOAD_DIR):
        return []
    docs = []
    for filename in os.listdir(UPLOAD_DIR):
        file_path = os.path.join(UPLOAD_DIR, filename)
        if os.path.isfile(file_path):
            stat = os.stat(file_path)
            docs.append({
                "filename": filename,
                "size": stat.st_size,
            })
    return docs


def delete_document(filename: str) -> bool:
    """Delete an uploaded document from disk and ChromaDB."""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    
    if os.path.exists(file_path):
        os.remove(file_path)
        
    collection = get_collection()
    try:
        collection.delete(where={"filename": safe_filename})
    except Exception:
        pass
        
    return True


def clear_all_data() -> bool:
    """Wipe the ChromaDB collection and delete all files in UPLOAD_DIR."""
    # 1. Reset collection
    try:
        get_collection(reset=True)
    except Exception:
        pass

    # 2. Delete all uploaded files
    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            file_path = os.path.join(UPLOAD_DIR, filename)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
            except Exception:
                pass
    return True


def _is_answer_grounded(answer: str, context: str, question: str) -> bool:
    """
    Heuristic check: does the answer appear to be grounded in the context?
    Returns True if the answer seems to use the context, False if it hallucinates.
    """
    answer_lower = answer.lower().strip()
    context_lower = context.lower()

    # If the answer is the exact refusal message, it's valid
    if answer_lower == REFUSAL_MESSAGE.lower():
        return True

    # If the model is echoing the prompt template structure, it is invalid
    if "website content:" in answer_lower or "question:" in answer_lower:
        return False

    # If answer is very short and doesn't contain any context words, likely hallucination
    if len(answer) < 20:
        return False

    # Check if answer contains any meaningful words from the context
    # (excluding common stop words)
    context_words = set(
        w for w in context_lower.split()
        if len(w) > 4 and w.isalpha()
    )
    answer_words = set(
        w for w in answer_lower.split()
        if len(w) > 4 and w.isalpha()
    )

    # If there's no overlap between answer words and context words, it's likely hallucinated
    if context_words and answer_words:
        overlap = context_words & answer_words
        if len(overlap) == 0:
            return False

    # Check for common hallucination patterns
    hallucination_patterns = [
        "the weather",
        "today is",
        "temperature",
        "sunny",
        "rainy",
        "cloudy",
        "degrees",
        "celsius",
        "fahrenheit",
    ]
    for pattern in hallucination_patterns:
        if pattern in answer_lower:
            return False

    return True


def answer_question(question: str, n_results: int = 3) -> str:
    """Retrieve context for a question and generate an answer via the LLM."""
    collection = get_collection()
    
    # If database is empty, answer general questions as a helpful assistant
    if collection.count() == 0:
        prompt = f"You are a helpful assistant. Please answer the user's question.\n\nQuestion: {question}\nAnswer:"
        return ask_llm(prompt)

    context_chunks: List[str] = query_chunks(question, n_results=n_results)
    if not context_chunks:
        return REFUSAL_MESSAGE

    context = "\n\n".join(context_chunks)
    prompt = build_prompt(context=context, question=question)
    answer = ask_llm(prompt)

    # Post-processing guard: if answer doesn't appear grounded in context, refuse
    if not _is_answer_grounded(answer, context, question):
        return REFUSAL_MESSAGE

    return answer
