"""Thin wrapper around LLM inference.

Supports:
- Cloud LLMs: Groq (high performance, free tier) and OpenAI.
- Local LLMs: Ollama (HTTP API) and local GGUF models (via llama-cpp-python).

The active model name is stored in memory and can be changed at runtime
via the /model-config API endpoint.
"""
from __future__ import annotations

import os
import requests

from .local_inference import list_gguf_models, ask_local_gguf, download_default_model

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")

LOCAL_GGUF_PREFIX = "local-gguf:"
GROQ_PREFIX = "groq:"
OPENAI_PREFIX = "openai:"


def _pick_default_model() -> str:
    """Choose the best default model at startup.

    Priority: env var > Groq > OpenAI > first local GGUF > Ollama.
    """
    env_model = os.getenv("OLLAMA_MODEL")
    if env_model:
        return env_model

    # 1. Groq (Recommended default)
    if os.getenv("GROQ_API_KEY"):
        return "groq:llama-3.1-8b-instant"

    # 2. OpenAI
    if os.getenv("OPENAI_API_KEY"):
        return "openai:gpt-4o-mini"

    # 3. If we have downloaded GGUF models, use the first one
    gguf = list_gguf_models()
    if gguf:
        return f"{LOCAL_GGUF_PREFIX}{gguf[0]}"

    # 4. Check if Ollama is reachable
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=2)
        if resp.ok:
            return "tinyllama"
    except Exception:
        pass

    # 5. Fallback to downloadable placeholder
    return f"{LOCAL_GGUF_PREFIX}tinyllama-1.1b (auto-download)"


# Active model — mutable at runtime via set_active_model()
_active_model: str = _pick_default_model()


def get_active_model() -> str:
    """Return the currently configured model name."""
    return _active_model


def set_active_model(model: str) -> None:
    """Persist the chosen model in module-level state."""
    global _active_model
    _active_model = model.strip()


def _is_ollama_online() -> bool:
    """Quick check whether the Ollama daemon is reachable."""
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=2)
        return resp.ok
    except Exception:
        return False


def _list_ollama_completion_models() -> list[str]:
    """Return Ollama completion model names (excludes embedding-only models)."""
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3)
        resp.raise_for_status()
        data = resp.json()
        models = data.get("models", [])

        completion_models = []
        for m in models:
            name = m.get("name", "")
            capabilities = m.get("capabilities")
            if capabilities is not None:
                if "completion" in capabilities:
                    completion_models.append(name)
            else:
                if "embed" not in name.lower():
                    completion_models.append(name)
        return completion_models
    except Exception:
        return []


def list_local_models() -> list[str]:
    """Return a combined list of all available models (Cloud APIs + GGUF + Ollama)."""
    models = []

    # 1. Cloud Models (Always list so the user knows they are supported)
    models.append("groq:llama-3.1-8b-instant")
    models.append("groq:llama-3.3-70b-versatile")
    models.append("openai:gpt-4o-mini")
    models.append("openai:gpt-4o")

    # 2. Local GGUF models
    gguf_models = [f"{LOCAL_GGUF_PREFIX}{f}" for f in list_gguf_models()]
    if not gguf_models:
        gguf_models = [f"{LOCAL_GGUF_PREFIX}tinyllama-1.1b (auto-download)"]
    models.extend(gguf_models)

    # 3. Ollama models
    ollama_models = _list_ollama_completion_models()
    models.extend(ollama_models)

    return models


def _get_fallback_models(exclude_model: str) -> list[str]:
    """Return ordered fallback models."""
    all_models = list_local_models()

    cloud_fallbacks = []
    gguf_fallbacks = []
    ollama_local = []

    for name in all_models:
        if name == exclude_model:
            continue
        if "(auto-download)" in name:
            continue
            
        if name.startswith(GROQ_PREFIX) or name.startswith(OPENAI_PREFIX):
            # Only fall back to cloud if their respective API key is set
            if name.startswith(GROQ_PREFIX) and os.getenv("GROQ_API_KEY"):
                cloud_fallbacks.append(name)
            elif name.startswith(OPENAI_PREFIX) and os.getenv("OPENAI_API_KEY"):
                cloud_fallbacks.append(name)
        elif name.startswith(LOCAL_GGUF_PREFIX):
            gguf_fallbacks.append(name)
        else:
            ollama_local.append(name)

    return cloud_fallbacks + gguf_fallbacks + ollama_local


def _ask_groq(prompt: str, model: str, images: list[str] | None = None) -> str:
    """Query the Groq Cloud API for chat completion using HTTP requests."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set. "
            "Please configure it in your Vercel/local environment variables to use Groq."
        )

    # Extract the real model name from the prefix (e.g. "groq:llama-3.1-8b-instant" -> "llama-3.1-8b-instant")
    real_model = model[len(GROQ_PREFIX):] if model.startswith(GROQ_PREFIX) else model
    
    # Auto-override to Groq vision model if images are provided and active model lacks vision
    if images and "vision" not in real_model.lower():
        real_model = "llama-3.2-11b-vision-preview"

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    if images:
        content = [{"type": "text", "text": prompt}]
        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {"url": img}
            })
        messages = [{"role": "user", "content": content}]
    else:
        messages = [{"role": "user", "content": prompt}]

    payload = {
        "model": real_model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2048
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=45)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        raise RuntimeError(f"Groq API call failed: {exc}") from exc


def _ask_openai(prompt: str, model: str, images: list[str] | None = None) -> str:
    """Query the OpenAI Cloud API for chat completion using HTTP requests."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. "
            "Please configure it in your Vercel/local environment variables to use OpenAI."
        )

    # Extract the real model name from the prefix (e.g. "openai:gpt-4o-mini" -> "gpt-4o-mini")
    real_model = model[len(OPENAI_PREFIX):] if model.startswith(OPENAI_PREFIX) else model

    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    if images:
        content = [{"type": "text", "text": prompt}]
        for img in images:
            content.append({
                "type": "image_url",
                "image_url": {"url": img}
            })
        messages = [{"role": "user", "content": content}]
    else:
        messages = [{"role": "user", "content": prompt}]

    payload = {
        "model": real_model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2048
    }

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=45)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        raise RuntimeError(f"OpenAI API call failed: {exc}") from exc


def _ask_ollama(prompt: str, model: str, images: list[str] | None = None) -> str:
    """Send a prompt to the Ollama HTTP API and return the response text."""
    payload = {"model": model, "prompt": prompt, "stream": False}
    if images:
        payload["images"] = images

    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json=payload,
            timeout=120,
        )
    except requests.exceptions.ConnectionError as exc:
        raise RuntimeError(
            f"Cannot connect to Ollama at {OLLAMA_HOST}. "
            "Make sure Ollama is running (`ollama serve`), or switch to a Cloud/GGUF model."
        ) from exc
    except requests.exceptions.Timeout as exc:
        raise RuntimeError(
            f"Ollama request timed out after 120 s (model: {model})."
        ) from exc
    except requests.exceptions.RequestException as exc:
        raise RuntimeError(f"Ollama request failed: {exc}") from exc

    if not resp.ok:
        try:
            err_body = resp.json()
            detail = err_body.get("error") or str(err_body)
        except Exception:
            detail = resp.text[:300] or f"HTTP {resp.status_code}"
        raise RuntimeError(
            f"Ollama model '{model}' failed with HTTP {resp.status_code}: {detail}"
        )

    try:
        data = resp.json()
    except ValueError as exc:
        raise RuntimeError(
            f"Ollama returned non-JSON response (model: {model})."
        ) from exc

    if "response" not in data:
        raise RuntimeError(
            f"Ollama response missing 'response' key (model: {model})."
        )

    return data["response"].strip()


LOCAL_PROVIDER_URL = "http://127.0.0.1:8001"


def _is_local_provider_online() -> bool:
    """Check if the standalone GGUF model provider on port 8001 is reachable."""
    try:
        resp = requests.get(f"{LOCAL_PROVIDER_URL}/v1/models", timeout=1)
        return resp.ok
    except Exception:
        return False


def _ask_local_gguf_with_provider_fallback(prompt: str, target: str) -> str:
    """Query standalone model provider on port 8001 if online, else fall back to in-process."""
    gguf_filename = target[len(LOCAL_GGUF_PREFIX):]

    if _is_local_provider_online():
        try:
            payload = {
                "model": target,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 2048,
            }
            resp = requests.post(
                f"{LOCAL_PROVIDER_URL}/v1/chat/completions",
                json=payload,
                timeout=120,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip()
        except Exception as exc:
            print(f"[llm] Local provider microservice failed, falling back to in-process: {exc}")

    return ask_local_gguf(prompt, model_filename=gguf_filename)


def ask_llm(prompt: str, model: str | None = None, images: list[str] | None = None) -> str:
    """Run a prompt through the appropriate backend and return the model's text.

    Routes:
    - Models starting with 'groq:' query Groq Cloud.
    - Models starting with 'openai:' query OpenAI Cloud.
    - Models starting with 'local-gguf:' use the local llama-cpp inference.
    - All other models are sent to local Ollama.

    If the primary model fails, the system automatically tries fallback models.
    """
    import time
    from .usage_tracker import log_request

    target = model or _active_model
    primary_error = ""

    # ── Route to Groq ────────────────────────────────────────────────
    if target.startswith(GROQ_PREFIX):
        try:
            t0 = time.perf_counter()
            res = _ask_groq(prompt, target, images=images)
            log_request(target, prompt, res, time.perf_counter() - t0)
            return res
        except Exception as exc:
            primary_error = str(exc)

    # ── Route to OpenAI ──────────────────────────────────────────────
    elif target.startswith(OPENAI_PREFIX):
        try:
            t0 = time.perf_counter()
            res = _ask_openai(prompt, target, images=images)
            log_request(target, prompt, res, time.perf_counter() - t0)
            return res
        except Exception as exc:
            primary_error = str(exc)

    # ── Route to local GGUF ──────────────────────────────────────────
    elif target.startswith(LOCAL_GGUF_PREFIX):
        gguf_filename = target[len(LOCAL_GGUF_PREFIX):]

        # Handle auto-download placeholder
        if "auto-download" in gguf_filename.lower():
            try:
                real_filename = download_default_model()
                gguf_filename = real_filename
                set_active_model(f"{LOCAL_GGUF_PREFIX}{real_filename}")
                target = f"{LOCAL_GGUF_PREFIX}{real_filename}"
            except Exception as exc:
                raise RuntimeError(f"Failed to auto-download model: {exc}") from exc

        try:
            t0 = time.perf_counter()
            res = _ask_local_gguf_with_provider_fallback(prompt, target)
            log_request(target, prompt, res, time.perf_counter() - t0)
            return res
        except Exception as exc:
            primary_error = str(exc)

    # ── Route to Ollama ──────────────────────────────────────────────
    else:
        try:
            t0 = time.perf_counter()
            res = _ask_ollama(prompt, target, images=images)
            log_request(target, prompt, res, time.perf_counter() - t0)
            return res
        except Exception as exc:
            primary_error = str(exc)

    # ── Self-healing fallback ────────────────────────────────────────
    fallbacks = _get_fallback_models(exclude_model=target)

    errors = [f"{target}: {primary_error}"]
    for fallback in fallbacks:
        try:
            t0 = time.perf_counter()
            if fallback.startswith(GROQ_PREFIX):
                fallback_res = _ask_groq(prompt, fallback, images=images)
            elif fallback.startswith(OPENAI_PREFIX):
                fallback_res = _ask_openai(prompt, fallback, images=images)
            elif fallback.startswith(LOCAL_GGUF_PREFIX):
                fallback_res = _ask_local_gguf_with_provider_fallback(prompt, fallback)
            else:
                fallback_res = _ask_ollama(prompt, fallback, images=images)

            log_request(fallback, prompt, fallback_res, time.perf_counter() - t0)
            # Success — switch active model
            set_active_model(fallback)
            return (
                f"⚠️ Automatically switched active model to **{fallback}** because **{target}** "
                f"returned an error.\n\n{fallback_res}"
            )
        except Exception as retry_exc:
            errors.append(f"{fallback}: {retry_exc}")

    # All failed
    raise RuntimeError(
        f"All models failed. Errors: {'; '.join(errors)}"
    )


def _run_stream_for_model(target: str, prompt: str, images: list[str] | None = None):
    """Internal generator to stream completions for a single specific model target.
    Raises exceptions on errors so the caller can trigger fallbacks.
    """
    import json
    import time

    # ── Route to Groq ────────────────────────────────────────────────
    if target.startswith(GROQ_PREFIX):
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY is not set.")

        real_model = target[len(GROQ_PREFIX):]
        if images and "vision" not in real_model.lower():
            real_model = "llama-3.2-11b-vision-preview"

        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        messages = [{"role": "user", "content": prompt}]
        if images:
            content = [{"type": "text", "text": prompt}]
            for img in images:
                content.append({"type": "image_url", "image_url": {"url": img}})
            messages = [{"role": "user", "content": content}]

        payload = {
            "model": real_model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 2048,
            "stream": True
        }

        resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=45)
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            line_str = line.decode("utf-8").strip()
            if line_str.startswith("data: "):
                data_body = line_str[6:]
                if data_body == "[DONE]":
                    break
                try:
                    chunk_json = json.loads(data_body)
                    choices = chunk_json.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        content_chunk = delta.get("content", "")
                        if content_chunk:
                            yield content_chunk
                except Exception:
                    pass

    # ── Route to OpenAI ──────────────────────────────────────────────
    elif target.startswith(OPENAI_PREFIX):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY is not set.")

        real_model = target[len(OPENAI_PREFIX):]
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        messages = [{"role": "user", "content": prompt}]
        if images:
            content = [{"type": "text", "text": prompt}]
            for img in images:
                content.append({"type": "image_url", "image_url": {"url": img}})
            messages = [{"role": "user", "content": content}]

        payload = {
            "model": real_model,
            "messages": messages,
            "temperature": 0.7,
            "max_tokens": 2048,
            "stream": True
        }

        resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=45)
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            line_str = line.decode("utf-8").strip()
            if line_str.startswith("data: "):
                data_body = line_str[6:]
                if data_body == "[DONE]":
                    break
                try:
                    chunk_json = json.loads(data_body)
                    choices = chunk_json.get("choices", [])
                    if choices:
                        delta = choices[0].get("delta", {})
                        content_chunk = delta.get("content", "")
                        if content_chunk:
                            yield content_chunk
                except Exception:
                    pass

    # ── Route to Ollama ──────────────────────────────────────────────
    elif not target.startswith(LOCAL_GGUF_PREFIX):
        url = f"{OLLAMA_HOST}/api/chat"
        payload = {
            "model": target,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True
        }
        resp = requests.post(url, json=payload, stream=True, timeout=30)
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            try:
                chunk_json = json.loads(line.decode("utf-8"))
                msg = chunk_json.get("message", {})
                content_chunk = msg.get("content", "")
                if content_chunk:
                    yield content_chunk
            except Exception:
                pass

    # ── Synchronous / Simulated Stream Fallback ──────────────────────
    else:
        # For local GGUF
        gguf_filename = target[len(LOCAL_GGUF_PREFIX):]
        if "auto-download" in gguf_filename.lower():
            real_filename = download_default_model()
            target = f"{LOCAL_GGUF_PREFIX}{real_filename}"
            set_active_model(target)
        
        full_res = _ask_local_gguf_with_provider_fallback(prompt, target)
        words = full_res.split(" ")
        for i, word in enumerate(words):
            yield (word + " ") if i < len(words) - 1 else word
            time.sleep(0.005)


def ask_llm_stream(prompt: str, model: str | None = None, images: list[str] | None = None):
    """Run a prompt through the appropriate backend and yield text chunks in real-time.
    
    If the primary model fails, the system automatically switches to a working fallback.
    """
    target = model or _active_model
    primary_error = ""

    # Try the primary model
    try:
        generator = _run_stream_for_model(target, prompt, images)
        # Check if the generator yields anything (to catch errors immediately)
        first_chunk = next(generator)
        yield first_chunk
        for chunk in generator:
            yield chunk
        return
    except Exception as exc:
        primary_error = str(exc)

    # Self-healing fallback
    fallbacks = _get_fallback_models(exclude_model=target)
    errors = [f"{target}: {primary_error}"]

    for fallback in fallbacks:
        try:
            # Alert user of fallback switch
            yield f"⚠️ Automatically switched active model to **{fallback}** because **{target}** returned an error.\n\n"
            
            generator = _run_stream_for_model(fallback, prompt, images)
            first_chunk = next(generator)
            yield first_chunk
            for chunk in generator:
                yield chunk

            # Success — switch active model
            set_active_model(fallback)
            return
        except Exception as retry_exc:
            errors.append(f"{fallback}: {retry_exc}")

    # All failed
    yield f"⚠️ All models failed. Errors: {'; '.join(errors)}"


def route_and_activate_model(question: str) -> str:
    """Return the currently selected active model without switching based on prompt content."""
    return get_active_model()
