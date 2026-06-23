"""Local GGUF model inference using llama-cpp-python.

This module provides a self-contained local LLM backend that loads GGUF
model files directly, eliminating the need for Ollama or any external
runtime. Models are stored in the project-level `models/` directory.
"""
from __future__ import annotations

import os
import threading

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models")

# Default model to auto-download if none are present
DEFAULT_MODEL_URL = (
    "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF"
    "/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
)
DEFAULT_MODEL_FILENAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

# ── Curated model catalog (free, open-source GGUF models from Hugging Face) ──
AVAILABLE_MODELS = [
    {
        "id": "tinyllama-1.1b",
        "name": "TinyLlama 1.1B Chat",
        "params": "1.1B",
        "size_mb": 638,
        "quantization": "Q4_K_M",
        "filename": "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
        "url": "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
        "description": "Ultra-lightweight chat model, very fast on CPU.",
    },
    {
        "id": "phi-2-3b",
        "name": "Phi-2 (2.7B)",
        "params": "2.7B",
        "size_mb": 1600,
        "quantization": "Q4_K_M",
        "filename": "phi-2.Q4_K_M.gguf",
        "url": "https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf",
        "description": "Microsoft's compact reasoning model, good for code and math.",
    },
    {
        "id": "stablelm-zephyr-3b",
        "name": "StableLM Zephyr 3B",
        "params": "3B",
        "size_mb": 1790,
        "quantization": "Q4_K_M",
        "filename": "stablelm-zephyr-3b.Q4_K_M.gguf",
        "url": "https://huggingface.co/TheBloke/stablelm-zephyr-3b-GGUF/resolve/main/stablelm-zephyr-3b.Q4_K_M.gguf",
        "description": "Stability AI's instruction-tuned model, excellent chat quality.",
    },
    {
        "id": "rocket-3b",
        "name": "Rocket 3B",
        "params": "3B",
        "size_mb": 1620,
        "quantization": "Q4_K_M",
        "filename": "rocket-3b.Q4_K_M.gguf",
        "url": "https://huggingface.co/TheBloke/rocket-3B-GGUF/resolve/main/rocket-3b.Q4_K_M.gguf",
        "description": "Fast and capable 3B parameter chat model.",
    },
    {
        "id": "openhermes-mistral-7b",
        "name": "OpenHermes 2.5 Mistral 7B",
        "params": "7B",
        "size_mb": 4370,
        "quantization": "Q4_K_M",
        "filename": "openhermes-2.5-mistral-7b.Q4_K_M.gguf",
        "url": "https://huggingface.co/TheBloke/OpenHermes-2.5-Mistral-7B-GGUF/resolve/main/openhermes-2.5-mistral-7b.Q4_K_M.gguf",
        "description": "Top-tier 7B model, excellent general-purpose chat and coding.",
    },
]

# In-memory cache for the loaded model
_loaded_model = None          # llama_cpp.Llama instance
_loaded_model_name: str = ""  # filename of the currently loaded model
_load_lock = threading.Lock()

# Download state tracking
_download_progress: dict = {}  # model_id -> { "status", "progress", "total", "error" }
_download_lock = threading.Lock()


def get_available_models() -> list[dict]:
    """Return the curated model catalog with download status."""
    downloaded = set(list_gguf_models())
    result = []
    for m in AVAILABLE_MODELS:
        entry = {**m}
        entry["downloaded"] = m["filename"] in downloaded
        with _download_lock:
            if m["id"] in _download_progress:
                entry["download_status"] = _download_progress[m["id"]]
            else:
                entry["download_status"] = None
        result.append(entry)
    return result


def list_gguf_models() -> list[str]:
    """Scan the models/ directory and return available .gguf filenames."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    return sorted(
        f for f in os.listdir(MODELS_DIR)
        if f.lower().endswith(".gguf") and os.path.isfile(os.path.join(MODELS_DIR, f))
    )


def delete_gguf_model(filename: str) -> bool:
    """Delete a downloaded GGUF model file."""
    global _loaded_model, _loaded_model_name
    safe = os.path.basename(filename)
    path = os.path.join(MODELS_DIR, safe)
    if os.path.exists(path):
        # Unload if currently loaded
        with _load_lock:
            if _loaded_model_name == safe:
                del _loaded_model
                _loaded_model = None
                _loaded_model_name = ""
        os.remove(path)
        return True
    return False


def download_model_by_id(model_id: str) -> str:
    """Download a model from the catalog by its ID. Returns the filename."""
    catalog_entry = None
    for m in AVAILABLE_MODELS:
        if m["id"] == model_id:
            catalog_entry = m
            break
    if not catalog_entry:
        raise ValueError(f"Unknown model ID: {model_id}. Available: {[m['id'] for m in AVAILABLE_MODELS]}")

    filename = catalog_entry["filename"]
    url = catalog_entry["url"]
    return _download_gguf(url, filename, model_id)


def _download_gguf(url: str, filename: str, model_id: str = "") -> str:
    """Download a GGUF file from a URL into the models/ directory."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    dest = os.path.join(MODELS_DIR, filename)

    if os.path.exists(dest):
        return filename

    track_id = model_id or filename

    with _download_lock:
        _download_progress[track_id] = {"status": "downloading", "progress": 0, "total": 0, "error": None}

    print(f"[local_inference] Downloading: {filename} from {url}")

    try:
        import requests as req
        resp = req.get(url, stream=True, timeout=600)
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        downloaded = 0

        with _download_lock:
            _download_progress[track_id]["total"] = total

        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                downloaded += len(chunk)
                with _download_lock:
                    _download_progress[track_id]["progress"] = downloaded
                if total:
                    pct = int(downloaded * 100 / total)
                    if pct % 10 == 0:
                        print(f"[local_inference] {filename}: {pct}%")
    except Exception as exc:
        if os.path.exists(dest):
            os.remove(dest)
        with _download_lock:
            _download_progress[track_id] = {"status": "error", "progress": 0, "total": 0, "error": str(exc)}
        raise RuntimeError(f"Failed to download {filename}: {exc}") from exc

    with _download_lock:
        _download_progress[track_id] = {"status": "done", "progress": total, "total": total, "error": None}

    print(f"[local_inference] Download complete: {filename}")
    return filename


def download_default_model(progress_callback=None) -> str:
    """Download the default TinyLlama GGUF model if not already present."""
    return _download_gguf(DEFAULT_MODEL_URL, DEFAULT_MODEL_FILENAME, "tinyllama-1.1b")


def _load_model(model_filename: str):
    """Load a GGUF model into memory (lazy, cached, thread-safe)."""
    global _loaded_model, _loaded_model_name

    with _load_lock:
        # Already loaded
        if _loaded_model is not None and _loaded_model_name == model_filename:
            return _loaded_model

        # Import here so the module doesn't fail if llama-cpp-python isn't installed yet
        try:
            from llama_cpp import Llama
        except ImportError as exc:
            raise RuntimeError(
                "llama-cpp-python is not installed. "
                "Run: pip install llama-cpp-python"
            ) from exc

        model_path = os.path.join(MODELS_DIR, model_filename)
        if not os.path.exists(model_path):
            raise RuntimeError(
                f"Model file not found: {model_path}. "
                f"Available models: {list_gguf_models()}"
            )

        # Free old model
        if _loaded_model is not None:
            del _loaded_model
            _loaded_model = None
            _loaded_model_name = ""

        print(f"[local_inference] Loading model: {model_filename} ...")

        _loaded_model = Llama(
            model_path=model_path,
            n_ctx=4096,       # context window
            n_threads=4,      # CPU threads
            n_gpu_layers=0,   # CPU-only by default
            verbose=False,
        )
        _loaded_model_name = model_filename
        print(f"[local_inference] Model loaded: {model_filename}")
        return _loaded_model


def ask_local_gguf(
    prompt: str,
    model_filename: str | None = None,
    max_tokens: int = 2048,
    temperature: float = 0.7,
) -> str:
    """Run a prompt through a local GGUF model and return the generated text.

    If no model_filename is specified, uses the first available GGUF model
    in the models/ directory, or downloads the default TinyLlama model.
    """
    # Determine which model to use
    if not model_filename:
        available = list_gguf_models()
        if available:
            model_filename = available[0]
        else:
            # Auto-download default
            model_filename = download_default_model()

    llm = _load_model(model_filename)

    try:
        output = llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            repeat_penalty=1.15,
            stop=["</s>", "<|im_end|>", "<|endoftext|>", "\n\nUser:", "\n\nHuman:"],
            echo=False,
        )
    except Exception as exc:
        raise RuntimeError(
            f"Local GGUF inference failed (model: {model_filename}): {exc}"
        ) from exc

    # Extract text from llama-cpp output
    choices = output.get("choices", [])
    if not choices:
        return ""

    return choices[0].get("text", "").strip()
