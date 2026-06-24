"""Module to interface with Hugging Face Serverless API and Groq for multimodal generation."""
from __future__ import annotations

import base64
import os
import requests
import time
from typing import List, Dict, Any, Tuple

HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


def get_hf_headers() -> dict:
    """Return Hugging Face authorization headers if token is present."""
    headers = {}
    if HF_API_TOKEN:
        headers["Authorization"] = f"Bearer {HF_API_TOKEN}"
    return headers


def generate_image(prompt: str) -> str:
    """
    Generate an image from text using Hugging Face's FLUX.1-schnell model.
    Returns the image as a base64 data URI string.
    """
    model_id = "black-forest-labs/FLUX.1-schnell"
    url = f"https://router.huggingface.co/hf-inference/models/{model_id}"
    
    headers = get_hf_headers()
    payload = {"inputs": prompt}
    
    # Try the request (with retry if model is loading)
    for attempt in range(3):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=60)
            if resp.status_code == 200:
                # Success! Encode bytes to base64
                img_b64 = base64.b64encode(resp.content).decode("utf-8")
                return f"data:image/jpeg;base64,{img_b64}"
            elif resp.status_code == 503:
                # Model is loading
                data = resp.json()
                est_time = data.get("estimated_time", 10)
                print(f"[multimodal] Model {model_id} is loading, waiting {est_time}s...")
                time.sleep(min(est_time, 15))
            else:
                try:
                    err_msg = resp.json().get("error", resp.text)
                except Exception:
                    err_msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                
                if "permissions to call Inference Providers" in err_msg:
                    raise RuntimeError(
                        "Hugging Face API permission error: Your Hugging Face token lacks the 'Make calls to Inference Providers' permission. "
                        "Please go to https://huggingface.co/settings/tokens, edit your active token, and enable the "
                        "'Make calls to Inference Providers' scope under Inference. Alternatively, create and use a new Classic token."
                    )
                raise RuntimeError(f"Hugging Face API error: {err_msg}")
        except requests.exceptions.Timeout:
            raise RuntimeError("Hugging Face API request timed out. Please try again.")
        except Exception as exc:
            if attempt == 2:
                raise exc
            time.sleep(2)
            
    raise RuntimeError(f"Failed to generate image: Model {model_id} took too long to load.")


def generate_vector(text: str) -> Tuple[List[float], Dict[str, Any]]:
    """
    Generate vector embeddings from text using Hugging Face's BGE-Large model.
    Returns the vector array and metadata.
    """
    model_id = "BAAI/bge-large-en-v1.5"
    url = f"https://router.huggingface.co/hf-inference/models/{model_id}"
    
    headers = get_hf_headers()
    payload = {"inputs": text}
    
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        resp.raise_for_status()
        vector = resp.json()
        
        # Sometimes the API returns a nested list
        if isinstance(vector, list) and len(vector) > 0 and isinstance(vector[0], list):
            vector = vector[0]
            
        return vector, {
            "model": model_id,
            "dimensions": len(vector),
            "text_preview": text[:60]
        }
    except Exception as exc:
        err_str = str(exc)
        if "permissions to call Inference Providers" in err_str:
            raise RuntimeError(
                "Hugging Face API permission error: Your Hugging Face token lacks the 'Make calls to Inference Providers' permission. "
                "Please go to https://huggingface.co/settings/tokens, edit your active token, and enable the "
                "'Make calls to Inference Providers' scope under Inference. Alternatively, create and use a new Classic token."
            )
        raise RuntimeError(f"Failed to generate vector: {exc}")


def generate_video_sequence(prompt: str) -> Dict[str, Any]:
    """
    Generates an animated multi-frame cinematic sequence from text.
    Stitches together 3 narrative frames using FLUX.1-schnell with pan/zoom storyboards
    to deliver a beautiful, reliable, high-fidelity visual sequence.
    """
    # Create 3 narrative storyboard frame prompts based on the core prompt
    storyboard_prompts = [
        f"{prompt}, wide opening shot, establishing scene, cinematic lighting, 4k",
        f"{prompt}, medium close-up, dramatic focus, high detail, masterpiece",
        f"{prompt}, slow panning motion, climax scene, epic color grading, photorealistic"
    ]
    
    frames = []
    errors = []
    
    # Generate the 3 frames
    for i, frame_prompt in enumerate(storyboard_prompts):
        try:
            print(f"[multimodal] Generating storyboard frame {i+1}/3...")
            img_uri = generate_image(frame_prompt)
            frames.append({
                "frame_index": i,
                "prompt": frame_prompt,
                "image_uri": img_uri
            })
        except Exception as exc:
            print(f"[multimodal] Failed to generate frame {i+1}: {exc}")
            errors.append(str(exc))
            
    if not frames:
        raise RuntimeError(f"Failed to generate any cinematic frames. Errors: {'; '.join(errors)}")
        
    return {
        "prompt": prompt,
        "frames_count": len(frames),
        "frames": frames,
        "message": "Cinematic sequence frames generated successfully. Playback via frontend Ken Burns rendering engine."
    }


def transcribe_audio(file_bytes: bytes, filename: str) -> str:
    """
    Transcribe recorded microphone audio using Groq's Whisper-large-v3 API.
    Returns the transcribed text.
    """
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not set. Please configure it in your .env file to use voice transcription.")
        
    url = "https://api.groq.com/openai/v1/audio/transcriptions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}"
    }
    
    # Map typical recorder extensions to clean filenames
    safe_filename = filename
    if not safe_filename:
        safe_filename = "mic_input.wav"
        
    files = {
        "file": (safe_filename, file_bytes, "audio/wav")
    }
    data = {
        "model": "whisper-large-v3",
        "response_format": "json"
    }
    
    try:
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=45)
        resp.raise_for_status()
        result = resp.json()
        return result.get("text", "").strip()
    except Exception as exc:
        raise RuntimeError(f"Groq Whisper transcription failed: {exc}")
