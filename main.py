"""FastAPI app exposing the local website-specific chatbot endpoints."""
from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from typing import List, Optional
import json, os, uuid

from backend.rag import answer_question, train_on_website, train_on_documents, train_on_chatgpt_export, train_on_feedback, list_documents, delete_document, clear_all_data, list_links, delete_link, answer_question_stream
from backend.llm import get_active_model, set_active_model, list_local_models
from backend.local_inference import get_available_models, download_model_by_id, delete_gguf_model
from backend.document_processor import extract_text_from_file
from backend.guardrails import get_guardrail_config, save_config
from backend.usage_tracker import get_stats, reset_stats
from backend.multimodal import generate_image, generate_vector, generate_video_sequence, transcribe_audio

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


@app.middleware("http")
async def strip_api_prefix(request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/api"):
        new_path = path[4:]
        if not new_path:
            new_path = "/"
        request.scope["path"] = new_path
        
        raw_path = request.scope.get("raw_path", b"")
        if raw_path.startswith(b"/api"):
            new_raw = raw_path[4:]
            if not new_raw:
                new_raw = b"/"
            request.scope["raw_path"] = new_raw
            
    return await call_next(request)


class TrainRequest(BaseModel):
    url: HttpUrl
    project_id: str | None = None


class ChatRequest(BaseModel):
    question: str
    images: List[str] | None = None
    attached_text: str | None = None
    attached_name: str | None = None
    rag_mode: str = "hybrid"
    project_id: str | None = None


@app.get("/")
def root() -> dict:
    return {"status": "ok", "service": "website-chat-agent"}


@app.post("/train")
def train(payload: TrainRequest) -> dict:
    """Scrape and index the given website URL."""
    try:
        return train_on_website(str(payload.url), project_id=payload.project_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/train-documents")
async def train_documents(
    files: List[UploadFile] = File(...),
    project_id: str | None = Form(None),
) -> dict:
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
        
        return train_on_documents(file_data, project_id=project_id)
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
    """Answer a question using RAG context scoped to the active project."""
    if not payload.question.strip() and not payload.images and not payload.attached_text:
        raise HTTPException(status_code=400, detail="Question, image, or attached document must be provided")
    try:
        res_dict = answer_question(
            payload.question.strip(),
            images=payload.images,
            attached_text=payload.attached_text,
            attached_name=payload.attached_name,
            rag_mode=payload.rag_mode,
            project_id=payload.project_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Unexpected error: {exc}") from exc
    return {
        "answer": res_dict["answer"],
        "active_model": get_active_model(),
        "generated_image": res_dict.get("generated_image"),
        "generated_video": res_dict.get("generated_video"),
        "generated_audio": res_dict.get("generated_audio"),
        "sources": res_dict.get("sources", []),
    }


@app.post("/chat-stream")
def chat_stream(payload: ChatRequest):
    """Answer a question using RAG context scoped to the active project, returning a text event stream."""
    from fastapi.responses import StreamingResponse
    
    if not payload.question.strip() and not payload.images and not payload.attached_text:
        raise HTTPException(status_code=400, detail="Question, image, or attached document must be provided")
        
    try:
        generator = answer_question_stream(
            payload.question.strip(),
            images=payload.images,
            attached_text=payload.attached_text,
            attached_name=payload.attached_name,
            rag_mode=payload.rag_mode,
            project_id=payload.project_id,
        )
        return StreamingResponse(generator, media_type="text/event-stream")
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/documents")
def get_documents(project_id: str | None = Query(None)) -> List[dict]:
    """Retrieve uploaded documents, optionally filtered by project."""
    try:
        return list_documents(project_id=project_id)
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
def get_links(project_id: str | None = Query(None)) -> List[dict]:
    """Retrieve trained website links, optionally filtered by project."""
    try:
        return list_links(project_id=project_id)
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


# ---- Project CRUD (JSON file persistence) ----

PROJECTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "projects.json")


def _load_projects() -> list:
    if os.path.exists(PROJECTS_FILE):
        try:
            with open(PROJECTS_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _save_projects(projects: list):
    with open(PROJECTS_FILE, "w") as f:
        json.dump(projects, f, indent=2)


class ProjectCreateRequest(BaseModel):
    name: str
    description: str = ""


@app.get("/projects")
def get_projects() -> list:
    """List all research projects."""
    return _load_projects()


@app.post("/projects")
def create_project(payload: ProjectCreateRequest) -> dict:
    """Create a new research project."""
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Project name must not be empty")
    projects = _load_projects()
    project = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "description": payload.description.strip(),
    }
    projects.append(project)
    _save_projects(projects)
    return project


@app.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    """Delete a research project and all its associated indexed data."""
    projects = _load_projects()
    found = [p for p in projects if p["id"] == project_id]
    if not found:
        raise HTTPException(status_code=404, detail="Project not found")
    projects = [p for p in projects if p["id"] != project_id]
    _save_projects(projects)
    # Clean up vector store data for this project
    from backend.vector_store import get_collection
    try:
        collection = get_collection()
        collection.delete(where={"project_id": project_id})
    except Exception:
        pass
    return {"status": "ok", "project_id": project_id}


@app.get("/projects/{project_id}/documents")
def get_project_documents(project_id: str) -> List[dict]:
    """List documents belonging to a specific project."""
    try:
        return list_documents(project_id=project_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/projects/{project_id}/links")
def get_project_links(project_id: str) -> List[dict]:
    """List links belonging to a specific project."""
    try:
        return list_links(project_id=project_id)
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


class GuardrailConfig(BaseModel):
    input_safety_enabled: bool
    groundedness_check_enabled: bool
    topic_restriction_enabled: bool
    guardrail_mode: str
    llm_verification_enabled: bool


@app.get("/guardrails/config")
def get_guardrails_config_endpoint() -> dict:
    """Retrieve the current guardrail configuration."""
    return get_guardrail_config()


@app.post("/guardrails/config")
def set_guardrails_config_endpoint(payload: GuardrailConfig) -> dict:
    """Update the guardrail configuration."""
    try:
        return save_config(payload.dict())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/usage/stats")
def get_usage_stats_endpoint() -> dict:
    """Retrieve current model usage statistics."""
    return get_stats()


@app.post("/usage/reset")
def reset_usage_stats_endpoint() -> dict:
    """Reset all model usage statistics."""
    return reset_stats()


class PromptRequest(BaseModel):
    prompt: str


class TextRequest(BaseModel):
    text: str


class FeedbackRequest(BaseModel):
    question: str
    answer: str
    liked: bool
    project_id: str | None = None


@app.post("/feedback")
def feedback_endpoint(payload: FeedbackRequest) -> dict:
    """Train on liked Q&A pairs or acknowledge disliked ones."""
    if payload.liked:
        if not payload.question.strip() or not payload.answer.strip():
            raise HTTPException(status_code=400, detail="Question and answer must not be empty for training")
        try:
            result = train_on_feedback(payload.question.strip(), payload.answer.strip(), project_id=payload.project_id)
            return {"status": "trained", **result}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    else:
        return {"status": "acknowledged", "message": "Response marked as disliked. Not trained."}


@app.post("/multimodal/image")
def generate_image_endpoint(payload: PromptRequest) -> dict:
    """Generate an image from text using Hugging Face."""
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty")
    try:
        uri = generate_image(payload.prompt.strip())
        return {"image_uri": uri}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/multimodal/vector")
def generate_vector_endpoint(payload: TextRequest) -> dict:
    """Generate text embeddings using Hugging Face BGE-Large."""
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty")
    try:
        vector, metadata = generate_vector(payload.text.strip())
        return {"vector": vector, "metadata": metadata}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/multimodal/video")
def generate_video_endpoint(payload: PromptRequest) -> dict:
    """Generate an animated multi-frame cinematic sequence using Hugging Face."""
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty")
    try:
        sequence = generate_video_sequence(payload.prompt.strip())
        return sequence
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/multimodal/transcribe")
async def transcribe_endpoint(file: UploadFile = File(...)) -> dict:
    """Transcribe microphone audio using Groq Whisper-large-v3."""
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty audio file")
        text = transcribe_audio(content, file.filename)
        return {"text": text}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc



