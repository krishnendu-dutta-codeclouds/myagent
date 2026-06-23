"""FastAPI app exposing the local website-specific chatbot endpoints."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import List

from backend.rag import answer_question, train_on_website, train_on_documents, train_on_chatgpt_export, list_documents, delete_document, clear_all_data, list_links, delete_link
from backend.llm import get_active_model, set_active_model, list_local_models
from backend.local_inference import get_available_models, download_model_by_id, delete_gguf_model
from backend.document_processor import extract_text_from_file

app = FastAPI(
    title="Agent UXKD",
    description="Agent UXKD — a fully-local AI assistant powered by Ollama and ChromaDB.",
    version="1.0.0",
)

# Allow a local React/Next.js frontend to call this API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TrainRequest(BaseModel):
    url: HttpUrl


class ChatRequest(BaseModel):
    question: str
    images: List[str] | None = None
    attached_text: str | None = None
    attached_name: str | None = None


@app.get("/")
def root() -> dict:
    return {"status": "ok", "service": "website-chat-agent"}


@app.post("/train")
def train(payload: TrainRequest) -> dict:
    """Scrape and index the given website URL."""
    try:
        return train_on_website(str(payload.url))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/train-documents")
async def train_documents(files: List[UploadFile] = File(...)) -> dict:
    """Upload and index documents (PDF, DOCX, TXT, MD)."""
    try:
        file_data = []
        for file in files:
            content = await file.read()
            if not content:
                continue
            file_data.append((file.filename, content))
        
        if not file_data:
            raise HTTPException(status_code=400, detail="No valid files uploaded")
        
        return train_on_documents(file_data)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/parse-file")
async def parse_file(file: UploadFile = File(...)) -> dict:
    """Extract text from any supported document (PDF, DOCX, TXT, MD) without indexing it."""
    try:
        content = await file.read()
        text = extract_text_from_file(file.filename, content)
        return {"filename": file.filename, "text": text}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/train-chatgpt")
async def train_chatgpt(file: UploadFile = File(...)) -> dict:
    """Upload a ChatGPT export file (ZIP or JSON) and index conversations for RAG."""
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file")
        result = train_on_chatgpt_export(file.filename, content)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.post("/chat")
def chat(payload: ChatRequest) -> dict:
    """Answer a question strictly from the indexed website data."""
    if not payload.question.strip() and not payload.images and not payload.attached_text:
        raise HTTPException(status_code=400, detail="Question, image, or attached document must be provided")
    try:
        answer = answer_question(
            payload.question.strip(),
            images=payload.images,
            attached_text=payload.attached_text,
            attached_name=payload.attached_name
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}") from exc
    return {"answer": answer, "active_model": get_active_model()}


@app.get("/documents")
def get_documents() -> List[dict]:
    """Retrieve all uploaded documents."""
    try:
        return list_documents()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete("/documents/{filename}")
def delete_document_endpoint(filename: str) -> dict:
    """Delete a document by its filename."""
    try:
        delete_document(filename)
        return {"status": "ok", "filename": filename}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/links")
def get_links() -> List[dict]:
    """Retrieve all trained website links."""
    try:
        return list_links()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete("/links")
def delete_link_endpoint(url: str) -> dict:
    """Delete a website link by its URL."""
    try:
        delete_link(url)
        return {"status": "ok", "url": url}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/clear-all")
def clear_all_endpoint() -> dict:
    """Clear all database collections and uploaded files."""
    try:
        clear_all_data()
        return {"status": "ok", "message": "All data cleared successfully"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


class ModelConfig(BaseModel):
    model: str


@app.get("/model-config")
def get_model_config() -> dict:
    """Return the currently active Ollama model name."""
    return {"model": get_active_model()}


@app.post("/model-config")
def set_model_config(payload: ModelConfig) -> dict:
    """Set the active Ollama model name."""
    if not payload.model.strip():
        raise HTTPException(status_code=400, detail="Model name must not be empty")
    set_active_model(payload.model.strip())
    return {"status": "ok", "model": get_active_model()}


@app.get("/model-config/models")
def get_local_models() -> dict:
    """Return a list of locally available models."""
    return {"models": list_local_models()}


@app.get("/model-catalog")
def get_model_catalog() -> dict:
    """Return the curated list of downloadable GGUF models with status."""
    return {"models": get_available_models()}


class DownloadRequest(BaseModel):
    model_id: str


@app.post("/model-catalog/download")
def download_model(payload: DownloadRequest) -> dict:
    """Download a GGUF model from the catalog by ID."""
    try:
        filename = download_model_by_id(payload.model_id)
        return {"status": "ok", "filename": filename, "model_id": payload.model_id}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.delete("/model-catalog/{filename}")
def delete_model(filename: str) -> dict:
    """Delete a downloaded GGUF model."""
    deleted = delete_gguf_model(filename)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Model file not found: {filename}")
    return {"status": "ok", "filename": filename}
