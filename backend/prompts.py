"""Prompt templates and refusal guard for the website-specific chatbot."""
from __future__ import annotations

SYSTEM_PROMPT = """You are a helpful AI assistant. You have access to the following retrieved website/document content to help you answer the user's question.

- If the user's query is a request to create, write, or generate something (such as writing code, scripts, HTML/CSS/JS designs, text, recipes, or creative content), fulfill the request directly and fully using your general capabilities. Do not constrain yourself to the retrieved context in this case.
- If the user is asking a specific question about the retrieved documents or websites, prioritize using the retrieved context to answer accurately.

Retrieved Context:
{context}

Question/Request:
{question}

Answer:"""


REFUSAL_MESSAGE = (
    "I can only answer questions related to this website's products or services."
)


def build_prompt(context: str, question: str) -> str:
    """Assemble the full prompt sent to the local LLM."""
    return SYSTEM_PROMPT.format(context=context, question=question)
