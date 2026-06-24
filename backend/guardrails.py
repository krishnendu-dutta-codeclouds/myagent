"""Configurable AI guardrails for input safety, topic restriction, and RAG groundedness."""
from __future__ import annotations

import json
import os
import re
from typing import Tuple

# Load refusal message from prompts to keep it consistent
from .prompts import REFUSAL_MESSAGE, build_verification_prompt

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guardrail_config.json")

# Default Configuration
DEFAULT_CONFIG = {
    "input_safety_enabled": True,
    "groundedness_check_enabled": True,
    "topic_restriction_enabled": True,
    "guardrail_mode": "balanced",  # "strict", "balanced", "off"
    "llm_verification_enabled": False,
}

_config = dict(DEFAULT_CONFIG)


def load_config() -> dict:
    """Load guardrail configuration from disk."""
    global _config
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                saved = json.load(f)
                # Merge with defaults to ensure all keys exist
                for k, v in DEFAULT_CONFIG.items():
                    if k not in saved:
                        saved[k] = v
                _config = saved
        except Exception as exc:
            print(f"[guardrails] Failed to load config: {exc}")
    return _config


def save_config(new_config: dict) -> dict:
    """Save and apply new guardrail configuration."""
    global _config
    # Sanitize and validate
    sanitized = {}
    for k, v in DEFAULT_CONFIG.items():
        if k in new_config:
            # Type casting / validation
            if isinstance(v, bool):
                sanitized[k] = bool(new_config[k])
            elif k == "guardrail_mode":
                val = str(new_config[k]).lower()
                if val in ["strict", "balanced", "off"]:
                    sanitized[k] = val
                else:
                    sanitized[k] = "balanced"
            else:
                sanitized[k] = new_config[k]
        else:
            sanitized[k] = _config.get(k, v)

    _config = sanitized
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(_config, f, indent=2)
    except Exception as exc:
        print(f"[guardrails] Failed to save config: {exc}")
    return _config


# Initialize config at startup
load_config()


def get_guardrail_config() -> dict:
    """Get the active guardrail configuration."""
    return _config


def check_input_safety(prompt: str) -> Tuple[bool, str | None]:
    """
    Scans user input for potential prompt injection, jailbreak attempts, or toxic content.
    Returns (is_safe, refusal_message).
    """
    if not _config.get("input_safety_enabled", True):
        return True, None

    prompt_lower = prompt.lower().strip()

    # Jailbreak and system override patterns
    jailbreak_patterns = [
        r"ignore (all )?prior instructions",
        r"system override",
        r"you are now a helpful",
        r"dan mode",
        r"act as (a|an) unrestricted",
        r"bypass safety",
        r"ignore (the )?rules",
        r"do anything now",
        r"developer mode",
        r"new instructions",
        r"disregard safety guidelines",
        r"forget your constraints",
        r"ignore system prompt",
    ]

    for pattern in jailbreak_patterns:
        if re.search(pattern, prompt_lower):
            return False, "I cannot fulfill this request as it violates input safety policies."

    return True, None


def check_topic_relevance(question: str, context: str, is_coding_request: bool, has_project: bool = False) -> Tuple[bool, str | None]:
    """
    Verifies if the question is related to the indexed documents, website context, or is a creative/generation request.
    When has_project is False (no active project), the topic guardrail is bypassed entirely
    so the chat works as a general-purpose assistant.
    Returns (is_relevant, refusal_message).
    """
    if not _config.get("topic_restriction_enabled", True):
        return True, None

    # When no project is active, allow all questions (general assistant mode)
    if not has_project:
        return True, None

    # Creative, writing, and generation requests are always allowed as an assistant capability
    if is_coding_request:
        return True, None

    # If context is empty, and it's not a coding request, the user is likely asking general knowledge
    clean_context = context.strip()
    if not clean_context or "(No matching document or web search context" in clean_context:
        # Let's perform a heuristic check on the question to see if it's general banter or off-topic
        q_lower = question.lower().strip().rstrip("?").strip()
        
        # Strip punctuation for cleaner keyword/greeting matching
        q_clean_match = re.sub(r"[^\w\s]", " ", q_lower).strip()
        q_clean_match = re.sub(r"\s+", " ", q_clean_match)  # normalize whitespace
        
        # Allow basic greetings
        greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "how are you", "who are you"]
        if any(q_clean_match == g or q_clean_match.startswith(g + " ") for g in greetings):
            return True, None

        # Allow specific identity questions
        if "krishnendu" in q_lower or "dutta" in q_lower or "your name" in q_lower:
            return True, None

        return False, "I am trained to answer questions specifically about the provided website or documents. Please ask a relevant question."

    return True, None


def _heuristic_groundedness(answer: str, context: str) -> bool:
    """
    Fast, rule-based groundedness evaluation.
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
    if len(answer) < 15:
        return False

    # Check if answer contains any meaningful words from the context (excluding stop words)
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
        if pattern in answer_lower and pattern not in context_lower:
            return False

    return True


def check_output_groundedness(
    answer: str,
    context: str,
    question: str,
    llm_evalulator_fn=None
) -> Tuple[bool, str]:
    """
    Evaluates if the answer is grounded in the retrieved context.
    Returns (is_grounded, final_answer).
    """
    # If guardrails are fully off, everything is grounded
    if _config.get("guardrail_mode") == "off" or not _config.get("groundedness_check_enabled", True):
        return True, answer

    # Fast heuristic check
    heuristic_ok = _heuristic_groundedness(answer, context)
    if not heuristic_ok:
        # Heuristic failed. Apply mode restrictions.
        if _config.get("guardrail_mode") == "strict":
            return False, REFUSAL_MESSAGE
        return False, answer

    # If LLM verification is enabled, run the LLM-based check
    if _config.get("llm_verification_enabled", False) and llm_evalulator_fn:
        try:
            # Query the LLM to verify
            verification_prompt = build_verification_prompt(context, answer)
            eval_response = llm_evalulator_fn(verification_prompt)
            
            # Check if LLM indicates hallucination
            eval_clean = eval_response.strip().upper()
            if "NO" in eval_clean and "YES" not in eval_clean:
                # LLM determined not grounded
                if _config.get("guardrail_mode") == "strict":
                    return False, REFUSAL_MESSAGE
                return False, answer
        except Exception as exc:
            print(f"[guardrails] LLM verification failed: {exc}")

    return True, answer
