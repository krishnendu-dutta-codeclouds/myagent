"""Module to track, persist, and retrieve LLM usage statistics (requests, tokens, latency)."""
from __future__ import annotations

import json
import os
from typing import Dict, Any

STATS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "usage_stats.json")

DEFAULT_STATS = {
    "total_requests": 0,
    "total_tokens": 0,
    "total_latency": 0.0,
    "model_breakdown": {}
}

_stats = dict(DEFAULT_STATS)


def load_stats() -> dict:
    """Load usage statistics from disk."""
    global _stats
    if os.path.exists(STATS_FILE):
        try:
            with open(STATS_FILE, "r") as f:
                saved = json.load(f)
                # Merge with defaults
                for k, v in DEFAULT_STATS.items():
                    if k not in saved:
                        saved[k] = v
                _stats = saved
        except Exception as exc:
            print(f"[usage_tracker] Failed to load stats: {exc}")
    return _stats


def save_stats() -> dict:
    """Write current statistics to disk."""
    try:
        with open(STATS_FILE, "w") as f:
            json.dump(_stats, f, indent=2)
    except Exception as exc:
        print(f"[usage_tracker] Failed to save stats: {exc}")
    return _stats


# Load stats on startup
load_stats()


def estimate_tokens(text: str) -> int:
    """Estimate token count based on standard word-to-token heuristic (1 word ≈ 1.33 tokens)."""
    if not text:
        return 0
    words = len(text.split())
    return int(words * 1.33) + 1


def log_request(model: str, prompt: str, response: str, latency: float) -> dict:
    """
    Records an LLM request, estimates token usage, and updates cumulative statistics.
    Returns the updated stats dictionary.
    """
    global _stats
    # Clean up model name (remove prefixes for cleaner UI representation)
    model_name = model.strip()

    # Calculate tokens
    prompt_tokens = estimate_tokens(prompt)
    response_tokens = estimate_tokens(response)
    estimated_total = prompt_tokens + response_tokens

    # Update global stats
    _stats["total_requests"] += 1
    _stats["total_tokens"] += estimated_total
    _stats["total_latency"] += latency

    # Update model breakdown
    breakdown = _stats.get("model_breakdown", {})
    if model_name not in breakdown:
        breakdown[model_name] = {
            "requests": 0,
            "tokens": 0,
            "latency": 0.0
        }

    breakdown[model_name]["requests"] += 1
    breakdown[model_name]["tokens"] += estimated_total
    breakdown[model_name]["latency"] += latency

    _stats["model_breakdown"] = breakdown

    # Persist stats
    save_stats()
    return _stats


def get_stats() -> dict:
    """Get the active usage statistics."""
    return _stats


def reset_stats() -> dict:
    """Clear all usage statistics and reset to defaults."""
    global _stats
    _stats = {
        "total_requests": 0,
        "total_tokens": 0,
        "total_latency": 0.0,
        "model_breakdown": {}
    }
    save_stats()
    return _stats
