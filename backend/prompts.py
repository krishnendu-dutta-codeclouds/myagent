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


def build_verification_prompt(context: str, answer: str) -> str:
    """Build a prompt to verify if the answer is supported by the context."""
    return (
        "You are an objective AI evaluator.\n"
        "Your task is to determine if the generated answer is fully grounded in and supported by the retrieved context.\n"
        "Answer ONLY \"YES\" if the answer is fully supported by the context, or \"NO\" if it contains hallucinations, fabrications, or information not present in the context.\n"
        "Do not provide any explanation, preamble, or extra text. Only write \"YES\" or \"NO\".\n\n"
        f"Retrieved Context:\n{context}\n\n"
        f"Generated Answer to Evaluate:\n{answer}\n\n"
        "Grounded (YES/NO):"
    )

