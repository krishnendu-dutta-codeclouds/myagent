"""Prompt templates and refusal guard for the website-specific chatbot."""
from __future__ import annotations

SYSTEM_PROMPT = """You are a website-specific assistant. You MUST answer using ONLY the provided website content.

If the answer is not found in the website data, you MUST output EXACTLY:
I can only answer questions related to this website's products or services.

No extra text. No explanation. No formatting.

Website Content:
{context}

Question:
{question}

Answer:"""


REFUSAL_MESSAGE = (
    "I can only answer questions related to this website's products or services."
)


def build_prompt(context: str, question: str) -> str:
    """Assemble the full prompt sent to the local LLM."""
    return SYSTEM_PROMPT.format(context=context, question=question)
