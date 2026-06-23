"""FastAPI app exposing the local website-specific chatbot endpoints."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import List

from backend.rag import answer_question, train_on_website, train_on_documents, list_documents, delete_document, clear_all_data
from backend.llm import get_active_model, set_active_model, list_local_models

app = FastAPI(
    title="Local Website Chat Agent",
    description="A fully-local chatbot that answers ONLY from a single website.",
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


@app.post("/chat")
def chat(payload: ChatRequest) -> dict:
    """Answer a question strictly from the indexed website data."""
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question must not be empty")
    answer = answer_question(payload.question.strip())
    return {"answer": answer}


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
    """Return a list of locally available Ollama models."""
    return {"models": list_local_models()}
