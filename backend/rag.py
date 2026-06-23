"""High-level Retrieval-Augmented Generation pipeline."""
from __future__ import annotations

import os
from typing import List

from .chunker import chunk_text
from .document_processor import process_uploaded_file, parse_chatgpt_export, chunk_text as doc_chunk_text
from .llm import ask_llm
from .prompts import REFUSAL_MESSAGE, build_prompt
from .scraper import scrape_website, web_search
from .vector_store import query_chunks, store_chunks, get_collection

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")


def train_on_website(url: str) -> dict:
    """Scrape a website, chunk it, and index the chunks in the vector store."""
    text = scrape_website(url)
    chunks = chunk_text(text)
    
    # Delete old chunks for this specific URL if any
    collection = get_collection()
    try:
        collection.delete(where={"url": url})
    except Exception:
        pass
        
    stored = store_chunks(chunks, metadata={"source": "website", "url": url})
    return {
        "status": "Website indexed successfully",
        "url": url,
        "chunks_indexed": stored,
    }


def train_on_chatgpt_export(filename: str, file_bytes: bytes) -> dict:
    """Parse a ChatGPT export file and index the conversations for RAG."""
    conversations = parse_chatgpt_export(file_bytes, filename)

    # Delete old ChatGPT training data if any
    collection = get_collection()
    try:
        collection.delete(where={"source": "chatgpt-export"})
    except Exception:
        pass

    total_chunks = 0
    for conv_text in conversations:
        chunks = chunk_text(conv_text)
        if chunks:
            stored = store_chunks(chunks, metadata={"source": "chatgpt-export", "filename": filename})
            total_chunks += stored

    return {
        "status": "ChatGPT export indexed successfully",
        "conversations_found": len(conversations),
        "chunks_indexed": total_chunks,
    }


def train_on_documents(files: List[tuple[str, bytes]]) -> dict:
    """Process uploaded documents, save them to disk, chunk them, and index in the vector store."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    processed_files = []
    total_chunks = 0
    
    for filename, file_bytes in files:
        try:
            safe_filename = os.path.basename(filename)
            file_path = os.path.join(UPLOAD_DIR, safe_filename)
            
            with open(file_path, "wb") as f:
                f.write(file_bytes)
                
            chunks = process_uploaded_file(safe_filename, file_bytes)
            
            # Delete old chunks for this file if any
            collection = get_collection()
            try:
                collection.delete(where={"filename": safe_filename})
            except Exception:
                pass
                
            if chunks:
                stored = store_chunks(chunks, metadata={"source": "document", "filename": safe_filename})
                total_chunks += stored
                
            processed_files.append(safe_filename)
        except Exception as exc:
            raise RuntimeError(f"Failed to process {filename}: {exc}") from exc
            
    return {
        "status": "Documents indexed successfully",
        "files_processed": processed_files,
        "chunks_indexed": total_chunks,
    }


def list_documents() -> List[dict]:
    """List all uploaded documents."""
    if not os.path.exists(UPLOAD_DIR):
        return []
    docs = []
    for filename in os.listdir(UPLOAD_DIR):
        file_path = os.path.join(UPLOAD_DIR, filename)
        if os.path.isfile(file_path):
            stat = os.stat(file_path)
            docs.append({
                "filename": filename,
                "size": stat.st_size,
            })
    return docs


def delete_document(filename: str) -> bool:
    """Delete an uploaded document from disk and ChromaDB."""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    
    if os.path.exists(file_path):
        os.remove(file_path)
        
    collection = get_collection()
    try:
        collection.delete(where={"filename": safe_filename})
    except Exception:
        pass
        
    return True


def list_links() -> List[dict]:
    """Retrieve all trained website links from ChromaDB."""
    collection = get_collection()
    if collection.count() == 0:
        return []
    try:
        results = collection.get(where={"source": "website"}, include=["metadatas"])
        metadatas = results.get("metadatas", [])
        url_counts = {}
        for meta in metadatas:
            if not meta:
                continue
            url = meta.get("url")
            if url:
                url_counts[url] = url_counts.get(url, 0) + 1
        return [{"url": url, "chunks": count} for url, count in url_counts.items()]
    except Exception:
        return []


def delete_link(url: str) -> bool:
    """Delete a trained website from ChromaDB by its URL."""
    collection = get_collection()
    try:
        collection.delete(where={"url": url})
        return True
    except Exception as exc:
        raise RuntimeError(f"Failed to delete link {url}: {exc}") from exc


def clear_all_data() -> bool:
    """Wipe the ChromaDB collection and delete all files in UPLOAD_DIR."""
    # 1. Reset collection
    try:
        get_collection(reset=True)
    except Exception:
        pass

    # 2. Delete all uploaded files
    if os.path.exists(UPLOAD_DIR):
        for filename in os.listdir(UPLOAD_DIR):
            file_path = os.path.join(UPLOAD_DIR, filename)
            try:
                if os.path.isfile(file_path):
                    os.remove(file_path)
            except Exception:
                pass
    return True


def _is_answer_grounded(answer: str, context: str, question: str) -> bool:
    """
    Heuristic check: does the answer appear to be grounded in the context?
    Returns True if the answer seems to use the context, False if it hallucinates.
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
    if len(answer) < 20:
        return False

    # Check if answer contains any meaningful words from the context
    # (excluding common stop words)
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
        if pattern in answer_lower:
            return False

    return True


def answer_question(
    question: str,
    n_results: int = 2,
    images: list[str] | None = None,
    attached_text: str | None = None,
    attached_name: str | None = None,
) -> str:
    """Retrieve context for a question and generate an answer via the LLM."""
    # Identity override checks
    q_clean = question.lower().strip().rstrip("?").strip()
    
    role_job_queries = ["role", "job", "work", "profession", "position", "career", "company"]
    name_queries = ["who are you", "what is your name", "whats your name", "who you are", "<im_end>", "your name"]

    if any(q in q_clean for q in role_job_queries):
        if any(q in q_clean for q in name_queries) or "you" in q_clean or "your" in q_clean:
            return (
                "Hello! I am **Krishnendu Dutta**, a Senior Frontend Developer currently working "
                "at **Codeclouds IT Solution Private Limited**.\n\n"
                "I specialize in crafting premium, performant, and highly interactive user interfaces. "
                "How can I help you today?"
            )
            
    if any(q in q_clean for q in name_queries):
        return "Krishnendu Dutta"

    # Prioritize document directly attached to this query if present
    if attached_text:
        context_str = f"Attached Document Content (File: {attached_name}):\n{attached_text}"
        prompt = (
            "You are a helpful AI assistant. The user has attached a text document.\n"
            "Use the document content below to help answer or fulfill the user's request.\n\n"
            f"{context_str}\n\n"
            f"Question/Request: {question}\n"
            "Answer:"
        )
        return ask_llm(prompt, images=images)

    # Check if this is a coding/design generation request to bypass RAG distraction
    q_lower = question.lower()
    coding_keywords = ["code", "html", "css", "js", "javascript", "script", "program", "develop", "design", "gsap", "tailwind", "animate", "website"]
    is_creation = any(word in q_lower for word in ["create", "generate", "write", "build", "make"])
    is_coding = any(word in q_lower for word in coding_keywords)

    if is_creation and is_coding:
        prompt = (
            "You are a helpful AI assistant. The user wants you to generate code, text, or a design.\n"
            "Please fulfill the request directly and fully, providing complete code blocks (such as HTML, CSS, JS, or animations using libraries like GSAP) as requested.\n\n"
            f"Request: {question}\n"
            "Answer:"
        )
        return ask_llm(prompt, images=images)

    collection = get_collection()
    
    # 1. Fetch Local Context from ChromaDB
    local_context = ""
    if collection.count() > 0:
        try:
            context_chunks: List[str] = query_chunks(question, n_results=n_results)
            if context_chunks:
                local_context = "\n\n".join(context_chunks)
        except Exception:
            pass

    lower_q = question.lower()
    coding_keywords = ['code', 'script', 'html', 'css', 'javascript', 'python', 'react', 'tailwind', 'gsap', 'component', 'function', 'app']
    action_keywords = ['create', 'write', 'generate', 'build', 'make', 'design']
    
    is_coding_request = any(k in lower_q for k in action_keywords) and any(k in lower_q for k in coding_keywords)

    # 2. Fetch Live Web Search Context
    search_context_items = []
    web_results = web_search(question)[:2]
    for res in web_results:
        search_context_items.append(
            f"Title: {res['title']}\nURL: {res['url']}\nSnippet: {res['snippet']}"
        )
    web_context = "\n\n".join(search_context_items) if search_context_items else ""

    # 3. Assemble Merged Context
    merged_context = ""
    if local_context:
        merged_context += f"--- Local Documents/Websites Context ---\n{local_context}\n\n"
    if web_context:
        merged_context += f"--- Live Web Search Context ---\n{web_context}\n\n"
        
    # Enforce safe character limit to fit inside model's context window
    if len(merged_context) > 3000:
        merged_context = merged_context[:3000] + "\n... [Context truncated to stay within local token limits] ..."
        
    if not merged_context:
        merged_context = "(No matching document or web search context found)"

    # 4. Build Dynamic Thinking Process with Real Citations
    thinking_lines = []
    thinking_lines.append("**Query Analysis:**")
    thinking_lines.append(f"- Analyzing request: \"{question}\"")
    
    local_count = 0
    if collection.count() > 0:
        if local_context:
            local_count = len(local_context.split("\n\n"))
            thinking_lines.append(f"- **Local Database Search:** Queried vector store. Found {local_count} relevant information segments.")
        else:
            thinking_lines.append("- **Local Database Search:** Checked local trained documents and websites. No matching segments found.")
    else:
        thinking_lines.append("- **Local Database Search:** Local store is empty (no uploaded documents or trained links).")

    if web_results:
        thinking_lines.append(f"- **Web Search & Fact-Checking:** Queried DuckDuckGo for \"{question}\". Retrieved {len(web_results)} results:")
        for res in web_results[:3]:
            title = res.get("title", "Web Page")
            url = res.get("url", "#")
            snippet = res.get("snippet", "")
            thinking_lines.append(f"  - [{title}]({url}): {snippet[:120]}...")
    else:
        thinking_lines.append("- **Web Search & Fact-Checking:** Searched the web, but no results were returned.")

    if is_coding_request:
        thinking_lines.append("- **Architecture & Design:** Formulating high-level reasoning, best practices, and implementation steps for code generation.")
    else:
        thinking_lines.append("- **Synthesis & Logic Reasoning:** Formulating a tailored, fact-based response combining the above inputs.")
    
    thinking_block = (
        "<details><summary>Thinking Process</summary>\n\n"
        + "\n".join(thinking_lines) +
        "\n\n</details>\n\n"
    )

    prompt = (
        "You are an expert Software Engineer, UI/UX Designer, and Technical Researcher. "
        "Your expertise includes high-level system design, JavaScript frameworks, libraries, and advanced UI/UX principles.\n"
        "You have access to local documents context and live web search context below to help answer the user's question.\n"
        "IMPORTANT INSTRUCTIONS:\n"
        "1. You MUST write and output the complete working code blocks (e.g., ```html, ```css, ```js).\n"
        "2. Do NOT write sentences describing what you 'would' do. Actually generate the code.\n"
        "3. Provide a brief high-level reasoning explanation first, then immediately output the code.\n"
        "4. Do NOT include any <details> or <summary> tags in your answer.\n"
        "5. DO NOT repeat the same code line or import statement multiple times. Write clean, DRY, production-ready code.\n"
        "6. Use proper, semantic, and highly descriptive class names in your HTML/CSS/Tailwind code to ensure maintainability.\n\n"
        f"Context:\n{merged_context}\n\n"
        f"Question/Request: {question}\n"
        "Answer:"
    )
    answer = ask_llm(prompt, images=images)
    
    return thinking_block + answer if thinking_block else answer
