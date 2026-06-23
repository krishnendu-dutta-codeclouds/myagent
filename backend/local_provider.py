"""Standalone local model provider exposing OpenAI-compatible endpoints."""
from __future__ import annotations

import time
import uuid
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from backend.local_inference import list_gguf_models, ask_local_gguf

app = FastAPI(
    title="Local LLM Provider",
    description="OpenAI-compatible microservice for running GGUF models locally.",
    version="1.0.0",
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 1024
    stream: Optional[bool] = False


def format_chat_prompt(messages: List[ChatMessage], model_id: str) -> str:
    """Format standard chat messages into a model-specific raw prompt template."""
    prompt = ""
    model_id_lower = model_id.lower()

    if "tinyllama" in model_id_lower:
        # TinyLlama format:
        # <|system|>
        # {content}</s>
        # <|user|>
        # {content}</s>
        # <|assistant|>
        for msg in messages:
            if msg.role == "system":
                prompt += f"<|system|>\n{msg.content}</s>\n"
            elif msg.role == "user":
                prompt += f"<|user|>\n{msg.content}</s>\n"
            elif msg.role == "assistant":
                prompt += f"<|assistant|>\n{msg.content}</s>\n"
        prompt += "<|assistant|>\n"
    elif "phi" in model_id_lower:
        # Phi-2 instruct format:
        # Instruct: {user}\nOutput:
        system_content = ""
        for msg in messages:
            if msg.role == "system":
                system_content = msg.content + "\n"
            elif msg.role == "user":
                prompt += f"{system_content}Instruct: {msg.content}\nOutput: "
                system_content = ""
            elif msg.role == "assistant":
                prompt += f"{msg.content}\n"
    else:
        # Default ChatML format (works for Hermes, StableLM, etc.)
        # <|im_start|>system
        # {content}<|im_end|>
        for msg in messages:
            prompt += f"<|im_start|>{msg.role}\n{msg.content}<|im_end|>\n"
        prompt += "<|im_start|>assistant\n"

    return prompt


@app.get("/v1/models")
def get_models() -> dict:
    """List available downloaded GGUF models."""
    models = list_gguf_models()
    return {
        "object": "list",
        "data": [
            {
                "id": f"local-gguf:{m}",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "local",
            }
            for m in models
        ],
    }


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest) -> dict:
    """Perform chat completions using the requested GGUF model."""
    model_name = req.model
    if model_name.startswith("local-gguf:"):
        model_name = model_name[len("local-gguf:") :]

    available_models = list_gguf_models()
    # Check if the requested model exists or is the auto-download placeholder
    if model_name not in available_models and "auto-download" not in model_name.lower():
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_name}' not found. Available models: {available_models}",
        )

    prompt = format_chat_prompt(req.messages, model_name)

    try:
        response_text = ask_local_gguf(
            prompt,
            model_filename=None if "auto-download" in model_name.lower() else model_name,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    prompt_tokens = len(prompt.split())
    completion_tokens = len(response_text.split())

    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response_text,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }
