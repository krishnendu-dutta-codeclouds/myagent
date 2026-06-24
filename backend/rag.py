"""High-level Retrieval-Augmented Generation pipeline."""
from __future__ import annotations

import os
from typing import List

from .chunker import chunk_text
from .document_processor import process_uploaded_file, parse_chatgpt_export, chunk_text as doc_chunk_text
from .llm import ask_llm, route_and_activate_model
from .prompts import REFUSAL_MESSAGE, build_prompt
from .scraper import scrape_website, web_search
from .vector_store import query_chunks, store_chunks, get_collection
from .guardrails import (
    check_input_safety,
    check_topic_relevance,
    check_output_groundedness,
    get_guardrail_config,
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")


def train_on_website(url: str, project_id: str | None = None) -> dict:
    """Scrape a website, chunk it, and index the chunks in the vector store."""
    text = scrape_website(url)
    chunks = chunk_text(text)
    
    # Delete old chunks for this specific URL if any
    collection = get_collection()
    try:
        collection.delete(where={"url": url})
    except Exception:
        pass
    
    meta = {"source": "website", "url": url}
    if project_id:
        meta["project_id"] = project_id
    stored = store_chunks(chunks, metadata=meta)
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


def train_on_documents(files: List[tuple[str, bytes]], project_id: str | None = None) -> dict:
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
            
            meta = {"source": "document", "filename": safe_filename}
            if project_id:
                meta["project_id"] = project_id
            if chunks:
                stored = store_chunks(chunks, metadata=meta)
                total_chunks += stored
                
            processed_files.append(safe_filename)
        except Exception as exc:
            raise RuntimeError(f"Failed to process {filename}: {exc}") from exc
            
    return {
        "status": "Documents indexed successfully",
        "files_processed": processed_files,
        "chunks_indexed": total_chunks,
    }


def train_on_feedback(question: str, answer: str, project_id: str | None = None) -> dict:
    """Index a liked Q&A pair into the vector store as high-quality training data."""
    qa_text = f"Question: {question}\n\nAnswer: {answer}"
    chunks = chunk_text(qa_text)
    if not chunks:
        chunks = [qa_text]

    meta = {"source": "feedback", "type": "liked_qa"}
    if project_id:
        meta["project_id"] = project_id
    stored = store_chunks(chunks, metadata=meta)
    return {
        "status": "Feedback trained successfully",
        "chunks_indexed": stored,
    }


def list_documents(project_id: str | None = None) -> List[dict]:
    """List all uploaded documents, optionally filtered by project_id."""
    if not os.path.exists(UPLOAD_DIR):
        return []
    
    # If project_id provided, get filenames from vector store metadata
    project_filenames = None
    if project_id:
        collection = get_collection()
        try:
            results = collection.get(where={"source": "document", "project_id": project_id}, include=["metadatas"])
            metadatas = results.get("metadatas", [])
            project_filenames = set()
            for meta in metadatas:
                if meta and meta.get("filename"):
                    project_filenames.add(meta["filename"])
        except Exception:
            project_filenames = set()
    
    docs = []
    for filename in os.listdir(UPLOAD_DIR):
        file_path = os.path.join(UPLOAD_DIR, filename)
        if os.path.isfile(file_path):
            if project_filenames is not None and filename not in project_filenames:
                continue
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


def list_links(project_id: str | None = None) -> List[dict]:
    """Retrieve trained website links, optionally filtered by project_id."""
    collection = get_collection()
    if collection.count() == 0:
        return []
    try:
        where_filter = {"source": "website"}
        if project_id:
            where_filter["project_id"] = project_id
        results = collection.get(where=where_filter, include=["metadatas"])
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
    rag_mode: str = "hybrid",
    project_id: str | None = None,
) -> dict:
    """Retrieve context for a question and generate an answer via the LLM with guardrails and RAG mode selectors.
    Supports automatic intent detection for image, video, and audio creation, rendering media directly."""
    # 1. Run Input Safety Guardrail
    is_safe, safety_refusal = check_input_safety(question)
    if not is_safe:
        return {
            "answer": safety_refusal or "I cannot fulfill this request as it violates input safety policies.",
            "generated_image": None,
            "generated_video": None,
            "generated_audio": None
        }

    # Clean query for intent analysis
    q_clean = question.lower().strip().rstrip("?").strip()
    
    # --- 1A. AUTOMATIC INTENT DETECTION & ROUTING FOR MULTIMODAL CREATION ---
    # Trigger lists for image, video, and audio creation
    image_triggers = [
        "generate an image of", "generate a image of", "generate image of", 
        "create an image of", "create a image of", "create image of", 
        "draw an image of", "draw a picture of", "draw a", "draw an", 
        "make an image of", "make a picture of", "show me an image of", 
        "generate a picture of", "create a picture of", "generate image", 
        "create image", "draw picture"
    ]
    
    video_triggers = [
        "generate a video of", "generate video of", "create a video of", 
        "create video of", "make a video of", "make video of", 
        "animate a", "animate", "generate cinematic video of", 
        "generate video", "create video", "cinematic video of"
    ]
    
    audio_triggers = [
        "generate audio of", "generate audio", "create audio of", 
        "create audio", "synthesize speech of", "synthesize speech", 
        "speak the following", "speak", "say the following", "say"
    ]
    
    def extract_generation_prompt(query: str, triggers: List[str]) -> str:
        q = query.strip()
        q_l = q.lower()
        for trigger in triggers:
            if trigger in q_l:
                idx = q_l.find(trigger)
                prompt = q[idx + len(trigger):].strip()
                prompt = prompt.strip(' :\'",.!?')
                if prompt:
                     return prompt
        return q

    # Check intents
    is_video_intent = any(trigger in q_clean for trigger in video_triggers)
    is_image_intent = any(trigger in q_clean for trigger in image_triggers)
    is_audio_intent = any(trigger in q_clean for trigger in audio_triggers)
    
    if is_video_intent:
        from .multimodal import generate_video_sequence
        clean_prompt = extract_generation_prompt(question, video_triggers)
        try:
            sequence = generate_video_sequence(clean_prompt)
            answer = f"I have automatically generated a 3-frame cinematic storyboard video sequence for your prompt: *\"{clean_prompt}\"*."
            return {
                "answer": answer,
                "generated_video": sequence,
                "generated_image": None,
                "generated_audio": None
            }
        except Exception as e:
            return {
                "answer": f"⚠️ Failed to generate video: {str(e)}",
                "generated_video": None,
                "generated_image": None,
                "generated_audio": None
            }
            
    elif is_image_intent:
        from .multimodal import generate_image
        clean_prompt = extract_generation_prompt(question, image_triggers)
        try:
            image_uri = generate_image(clean_prompt)
            answer = f"I have automatically generated an image for your prompt: *\"{clean_prompt}\"*."
            return {
                "answer": answer,
                "generated_image": image_uri,
                "generated_video": None,
                "generated_audio": None
            }
        except Exception as e:
            return {
                "answer": f"⚠️ Failed to generate image: {str(e)}",
                "generated_image": None,
                "generated_video": None,
                "generated_audio": None
            }
            
    elif is_audio_intent:
        clean_prompt = extract_generation_prompt(question, audio_triggers)
        answer = f"I have automatically synthesized a spoken audio speech track for your prompt: *\"{clean_prompt}\"*."
        return {
            "answer": answer,
            "generated_audio": {
                "text": clean_prompt,
                "voice": "AI Assistant"
            },
            "generated_image": None,
            "generated_video": None
        }

    # Identity override checks
    role_job_queries = ["role", "job", "work", "profession", "position", "career", "company"]
    name_queries = ["who are you", "what is your name", "whats your name", "who you are", "<im_end>", "your name"]

    if any(q in q_clean for q in role_job_queries):
        if any(q in q_clean for q in name_queries) or "you" in q_clean or "your" in q_clean:
            return {
                "answer": (
                    "Hello! I am **Krishnendu Dutta**, a Senior Frontend Developer currently working "
                    "at **Codeclouds IT Solution Private Limited**.\n\n"
                    "I specialize in crafting premium, performant, and highly interactive user interfaces. "
                    "How can I help you today?"
                ),
                "generated_image": None,
                "generated_video": None,
                "generated_audio": None
            }
            
    if any(q in q_clean for q in name_queries):
        return {
            "answer": "I am Krishnendu Dutta",
            "generated_image": None,
            "generated_video": None,
            "generated_audio": None
        }

    # Choose and activate model dynamically based on user prompt
    route_and_activate_model(question)

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
        answer = ask_llm(prompt, images=images)
        
        # Run Groundedness Guardrail on attached text
        is_grounded, grounded_answer = check_output_groundedness(
            answer,
            context_str,
            question,
            llm_evalulator_fn=lambda p: ask_llm(p)
        )
        if not is_grounded:
            config = get_guardrail_config()
            if config.get("guardrail_mode") == "balanced":
                strict_prompt = (
                    "You are a helpful AI assistant. You must answer the question STRICTLY using the attached document content.\n"
                    "Do NOT assume, extrapolate, or hallucinate. If the document does not contain the answer, say exactly: "
                    f"\"{REFUSAL_MESSAGE}\"\n\n"
                    f"{context_str}\n\n"
                    f"Question/Request: {question}\n"
                    "Answer:"
                )
                retry_answer = ask_llm(strict_prompt, images=images)
                is_retry_grounded, retry_grounded_answer = check_output_groundedness(
                    retry_answer,
                    context_str,
                    question,
                    llm_evalulator_fn=lambda p: ask_llm(p)
                )
                if is_retry_grounded:
                    answer = retry_grounded_answer
                else:
                    answer = REFUSAL_MESSAGE
            else:
                answer = grounded_answer
        return {
            "answer": answer,
            "generated_image": None,
            "generated_video": None,
            "generated_audio": None
        }

    # Check if this is a creative writing, text generation, coding, or design request to bypass RAG
    creation_verbs = ["create", "generate", "write", "build", "make", "compose", "draft", "explain", "describe", "translate", "summarize", "analyze"]
    is_creation = any(word in q_clean for word in creation_verbs)
    
    coding_keywords = ["code", "html", "css", "js", "javascript", "script", "program", "develop", "design", "gsap", "tailwind", "animate", "website"]
    is_coding = any(word in q_clean for word in coding_keywords)

    if is_creation:
        if is_coding:
            # Coding/design creation request
            prompt = (
                "You are an expert Software Engineer and UI/UX Designer.\n"
                "Please fulfill the user's request to generate code or a design directly and fully, providing complete, working code blocks (e.g., HTML, CSS, JS, Tailwind, GSAP) as requested.\n\n"
                f"Request: {question}\n"
                "Answer:"
            )
        else:
            # General text, creative writing, or explanation request
            prompt = (
                "You are a helpful, highly capable AI assistant.\n"
                "Please fulfill the user's request to create, write, generate, or explain something directly, fully, and creatively using your general capabilities.\n\n"
                f"Request: {question}\n"
                "Answer:"
            )
            
        return {
            "answer": ask_llm(prompt, images=images),
            "generated_image": None,
            "generated_video": None,
            "generated_audio": None
        }

    collection = get_collection()
    
    # 1. Fetch Local Context from ChromaDB (Skip if Web Only or Direct)
    local_context = ""
    sources = []
    if rag_mode in ("hybrid", "local") and collection.count() > 0:
        try:
            from .vector_store import query_chunks_with_metadata
            retrieved = query_chunks_with_metadata(question, n_results=n_results, project_id=project_id)
            if retrieved:
                local_context = "\n\n".join([item["text"] for item in retrieved])
                seen_sources = set()
                for item in retrieved:
                    meta = item.get("metadata", {})
                    source_type = meta.get("source")
                    if source_type == "document":
                        fname = meta.get("filename")
                        if fname and fname not in seen_sources:
                            seen_sources.add(fname)
                            sources.append({"type": "document", "name": fname})
                    elif source_type == "website":
                        url_val = meta.get("url")
                        if url_val and url_val not in seen_sources:
                            seen_sources.add(url_val)
                            sources.append({"type": "website", "url": url_val})
        except Exception:
            pass

    is_coding_request = is_creation

    # 2. Fetch Live Web Search Context (Skip if Local Only or Direct)
    search_context_items = []
    web_results = []
    if rag_mode in ("hybrid", "web"):
        try:
            web_results = web_search(question)[:2]
            for res in web_results:
                search_context_items.append(
                    f"Title: {res['title']}\nURL: {res['url']}\nSnippet: {res['snippet']}"
                )
                sources.append({"type": "web_search", "title": res['title'], "url": res['url']})
        except Exception:
            pass
    web_context = "\n\n".join(search_context_items) if search_context_items else ""

    # 3. Assemble Merged Context
    merged_context = ""
    if local_context:
        merged_context += f"--- Local Documents/Websites Context ---\n{local_context}\n\n"
    if web_context:
        merged_context += f"--- Live Web Search Context ---\n{web_context}\n\n"
        
    if len(merged_context) > 3000:
        merged_context = merged_context[:3000] + "\n... [Context truncated to stay within local token limits] ..."
        
    if not merged_context:
        merged_context = "(No matching document or web search context found)"

    # Run Topic Relevance Guardrail (Skip if Direct mode is selected)
    if rag_mode != "direct":
        is_relevant, topic_refusal = check_topic_relevance(question, merged_context, is_coding_request, has_project=bool(project_id))
        if not is_relevant:
            return {
                "answer": topic_refusal or REFUSAL_MESSAGE,
                "generated_image": None,
                "generated_video": None,
                "generated_audio": None
            }

    # 4. Build Dynamic Thinking Process with Real Citations
    thinking_lines = []
    thinking_lines.append("**Query Analysis:**")
    thinking_lines.append(f"- Analyzing request: \"{question}\"")
    thinking_lines.append(f"- **RAG Configuration Mode:** {rag_mode.upper()}")
    
    if rag_mode in ("hybrid", "local"):
        local_count = 0
        if collection.count() > 0:
            if local_context:
                local_count = len(local_context.split("\n\n"))
                thinking_lines.append(f"- **Local Database Search:** Queried vector store. Found {local_count} relevant segments.")
            else:
                thinking_lines.append("- **Local Database Search:** Checked local database. No matching segments found.")
        else:
            thinking_lines.append("- **Local Database Search:** Local database is empty.")
    else:
        thinking_lines.append("- **Local Database Search:** Bypassed by RAG mode.")

    if rag_mode in ("hybrid", "web"):
        if web_results:
            thinking_lines.append(f"- **Web Search & Fact-Checking:** Queried DuckDuckGo for \"{question}\". Retrieved {len(web_results)} results:")
            for res in web_results[:3]:
                title = res.get("title", "Web Page")
                url = res.get("url", "#")
                snippet = res.get("snippet", "")
                thinking_lines.append(f"  - [{title}]({url}): {snippet[:120]}...")
        else:
            thinking_lines.append("- **Web Search & Fact-Checking:** Searched the web, but no results were returned.")
    else:
        thinking_lines.append("- **Web Search & Fact-Checking:** Bypassed by RAG mode.")

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
    
    # Run Groundedness Guardrail (Skip if Direct mode is selected)
    if rag_mode != "direct":
        is_grounded, grounded_answer = check_output_groundedness(
            answer,
            merged_context,
            question,
            llm_evalulator_fn=lambda p: ask_llm(p)
        )
        
        if not is_grounded:
            config = get_guardrail_config()
            if config.get("guardrail_mode") == "balanced":
                strict_prompt = (
                    "You are a helpful AI assistant. You must answer the question STRICTLY using the retrieved context below.\n"
                    "Do NOT assume, extrapolate, or hallucinate. If the context does not contain the answer, say exactly: "
                    f"\"{REFUSAL_MESSAGE}\"\n\n"
                    f"Context:\n{merged_context}\n\n"
                    f"Question/Request: {question}\n"
                    "Answer:"
                )
                retry_answer = ask_llm(strict_prompt, images=images)
                is_retry_grounded, retry_grounded_answer = check_output_groundedness(
                    retry_answer,
                    merged_context,
                    question,
                    llm_evalulator_fn=lambda p: ask_llm(p)
                )
                if is_retry_grounded:
                    answer = retry_grounded_answer
                else:
                    answer = REFUSAL_MESSAGE
            else:
                answer = grounded_answer

    return {
        "answer": thinking_block + answer if thinking_block else answer,
        "generated_image": None,
        "generated_video": None,
        "generated_audio": None,
        "sources": sources
    }


def answer_question_stream(
    question: str,
    n_results: int = 2,
    images: list[str] | None = None,
    attached_text: str | None = None,
    attached_name: str | None = None,
    rag_mode: str = "hybrid",
    project_id: str | None = None,
):
    """Generator function that yields RAG context, metadata, and LLM text chunks for streaming."""
    import json
    from .llm import get_active_model, ask_llm_stream

    # 1. Run Input Safety Guardrail
    is_safe, safety_refusal = check_input_safety(question)
    if not is_safe:
        yield json.dumps({
            "type": "content",
            "delta": safety_refusal or "I cannot fulfill this request as it violates input safety policies."
        }) + "\n"
        return

    q_clean = question.lower().strip().rstrip("?").strip()

    # --- 1A. MULTIMODAL CREATION ROUTING (Non-streamable, yield single response) ---
    image_triggers = [
        "generate an image of", "generate a image of", "generate image of", 
        "create an image of", "create a image of", "create image of", 
        "draw an image of", "draw a picture of", "draw a", "draw an", 
        "make an image of", "make a picture of", "show me an image of", 
        "generate a picture of", "create a picture of", "generate image", 
        "create image", "draw picture"
    ]
    video_triggers = [
        "generate a video of", "generate video of", "create a video of", 
        "create video of", "make a video of", "make video of", 
        "animate a", "animate", "generate cinematic video of", 
        "generate video", "create video", "cinematic video of"
    ]
    audio_triggers = [
        "generate audio of", "generate audio", "create audio of", 
        "create audio", "synthesize speech of", "synthesize speech", 
        "speak the following", "speak", "say the following", "say"
    ]
    
    def extract_generation_prompt(query: str, triggers: list[str]) -> str:
        q = query.strip()
        q_l = q.lower()
        for trigger in triggers:
            if trigger in q_l:
                idx = q_l.find(trigger)
                prompt = q[idx + len(trigger):].strip()
                prompt = prompt.strip(' :\'",.!?')
                if prompt:
                     return prompt
        return q

    is_video_intent = any(trigger in q_clean for trigger in video_triggers)
    is_image_intent = any(trigger in q_clean for trigger in image_triggers)
    is_audio_intent = any(trigger in q_clean for trigger in audio_triggers)

    if is_video_intent:
        from .multimodal import generate_video_sequence
        clean_prompt = extract_generation_prompt(question, video_triggers)
        try:
            sequence = generate_video_sequence(clean_prompt)
            answer = f"I have automatically generated a 3-frame cinematic storyboard video sequence for your prompt: *\"{clean_prompt}\"*."
            yield json.dumps({
                "type": "metadata",
                "active_model": get_active_model(),
                "sources": [],
                "generated_video": sequence
            }) + "\n"
            yield json.dumps({"type": "content", "delta": answer}) + "\n"
        except Exception as e:
            yield json.dumps({
                "type": "content",
                "delta": f"⚠️ Failed to generate video: {str(e)}"
            }) + "\n"
        return

    elif is_image_intent:
        from .multimodal import generate_image
        clean_prompt = extract_generation_prompt(question, image_triggers)
        try:
            image_uri = generate_image(clean_prompt)
            answer = f"I have automatically generated an image for your prompt: *\"{clean_prompt}\"*."
            yield json.dumps({
                "type": "metadata",
                "active_model": get_active_model(),
                "sources": [],
                "generated_image": image_uri
            }) + "\n"
            yield json.dumps({"type": "content", "delta": answer}) + "\n"
        except Exception as e:
            yield json.dumps({
                "type": "content",
                "delta": f"⚠️ Failed to generate image: {str(e)}"
            }) + "\n"
        return

    elif is_audio_intent:
        clean_prompt = extract_generation_prompt(question, audio_triggers)
        answer = f"I have automatically synthesized a spoken audio speech track for your prompt: *\"{clean_prompt}\"*."
        yield json.dumps({
            "type": "metadata",
            "active_model": get_active_model(),
            "sources": [],
            "generated_audio": {"text": clean_prompt, "voice": "AI Assistant"}
        }) + "\n"
        yield json.dumps({"type": "content", "delta": answer}) + "\n"
        return

    # Identity queries
    role_job_queries = ["role", "job", "work", "profession", "position", "career", "company"]
    name_queries = ["who are you", "what is your name", "whats your name", "who you are", "<im_end>", "your name"]

    if any(q in q_clean for q in role_job_queries):
        if any(q in q_clean for q in name_queries) or "you" in q_clean or "your" in q_clean:
            answer = (
                "Hello! I am **Krishnendu Dutta**, a Senior Frontend Developer currently working "
                "at **Codeclouds IT Solution Private Limited**.\n\n"
                "I specialize in crafting premium, performant, and highly interactive user interfaces. "
                "How can I help you today?"
            )
            yield json.dumps({"type": "metadata", "active_model": get_active_model(), "sources": []}) + "\n"
            yield json.dumps({"type": "content", "delta": answer}) + "\n"
            return
            
    if any(q in q_clean for q in name_queries):
        yield json.dumps({"type": "metadata", "active_model": get_active_model(), "sources": []}) + "\n"
        yield json.dumps({"type": "content", "delta": "Krishnendu Dutta"}) + "\n"
        return

    # Choose and activate model dynamically based on user prompt
    active_model = route_and_activate_model(question)

    # If document is attached directly
    if attached_text:
        context_str = f"Attached Document Content (File: {attached_name}):\n{attached_text}"
        prompt = (
            "You are a helpful AI assistant. The user has attached a text document.\n"
            "Use the document content below to help answer or fulfill the user's request.\n\n"
            f"{context_str}\n\n"
            f"Question/Request: {question}\n"
            "Answer:"
        )
        yield json.dumps({"type": "metadata", "active_model": active_model, "sources": [{"type": "document", "name": attached_name or "Attached File"}]}) + "\n"
        for chunk in ask_llm_stream(prompt, model=active_model, images=images):
            yield json.dumps({"type": "content", "delta": chunk}) + "\n"
        return

    # Check for direct LLM request or RAG bypass
    creation_verbs = ["create", "generate", "write", "build", "make", "compose", "draft", "explain", "describe", "translate", "summarize", "analyze"]
    is_creation = any(word in q_clean for word in creation_verbs)
    coding_keywords = ["code", "html", "css", "js", "javascript", "script", "program", "develop", "design", "gsap", "tailwind", "animate", "website"]
    is_coding = any(word in q_clean for word in coding_keywords)
    is_coding_request = is_creation

    if is_creation:
        if is_coding:
            prompt = (
                "You are an expert Software Engineer and UI/UX Designer.\n"
                "Please fulfill the user's request to generate code or a design directly and fully, providing complete, working code blocks (e.g., HTML, CSS, JS, Tailwind, GSAP) as requested.\n\n"
                f"Request: {question}\n"
                "Answer:"
            )
        else:
            prompt = (
                "You are a helpful assistant.\n"
                "Please generate a complete, detailed, and creative response to the user's request, focusing on readability and flow.\n\n"
                f"Request: {question}\n"
                "Answer:"
            )
        yield json.dumps({"type": "metadata", "active_model": active_model, "sources": []}) + "\n"
        for chunk in ask_llm_stream(prompt, model=active_model, images=images):
            yield json.dumps({"type": "content", "delta": chunk}) + "\n"
        return

    # Normal RAG flow
    collection = get_collection()
    local_context = ""
    sources = []
    
    if rag_mode in ("hybrid", "local") and collection.count() > 0:
        try:
            from .vector_store import query_chunks_with_metadata
            retrieved = query_chunks_with_metadata(question, n_results=n_results, project_id=project_id)
            if retrieved:
                local_context = "\n\n".join([item["text"] for item in retrieved])
                seen_sources = set()
                for item in retrieved:
                    meta = item.get("metadata", {})
                    source_type = meta.get("source")
                    if source_type == "document":
                        fname = meta.get("filename")
                        if fname and fname not in seen_sources:
                            seen_sources.add(fname)
                            sources.append({"type": "document", "name": fname})
                    elif source_type == "website":
                        url_val = meta.get("url")
                        if url_val and url_val not in seen_sources:
                            seen_sources.add(url_val)
                            sources.append({"type": "website", "url": url_val})
        except Exception:
            pass

    search_context_items = []
    web_results = []
    if rag_mode in ("hybrid", "web"):
        try:
            web_results = web_search(question)[:2]
            for res in web_results:
                search_context_items.append(
                    f"Title: {res['title']}\nURL: {res['url']}\nSnippet: {res['snippet']}"
                )
                sources.append({"type": "web_search", "title": res['title'], "url": res['url']})
        except Exception:
            pass
    web_context = "\n\n".join(search_context_items) if search_context_items else ""

    merged_context = ""
    if local_context:
        merged_context += f"--- Local Documents/Websites Context ---\n{local_context}\n\n"
    if web_context:
        merged_context += f"--- Live Web Search Context ---\n{web_context}\n\n"
    if len(merged_context) > 3000:
        merged_context = merged_context[:3000] + "\n... [Context truncated] ..."
    if not merged_context:
        merged_context = "(No matching document or web search context found)"

    if rag_mode != "direct":
        is_relevant, topic_refusal = check_topic_relevance(question, merged_context, is_coding_request, has_project=bool(project_id))
        if not is_relevant:
            yield json.dumps({"type": "metadata", "active_model": active_model, "sources": sources}) + "\n"
            yield json.dumps({"type": "content", "delta": topic_refusal or REFUSAL_MESSAGE}) + "\n"
            return

    # Build Thinking process block
    thinking_lines = []
    thinking_lines.append("**Query Analysis:**")
    thinking_lines.append(f"- Analyzing request: \"{question}\"")
    thinking_lines.append(f"- **RAG Configuration Mode:** {rag_mode.upper()}")
    
    if rag_mode in ("hybrid", "local"):
        if collection.count() > 0:
            if local_context:
                thinking_lines.append(f"- **Local Database Search:** Queried vector store. Found {len(local_context.split(chr(10)+chr(10)))} relevant segments.")
            else:
                thinking_lines.append("- **Local Database Search:** Checked local database. No matching segments found.")
        else:
            thinking_lines.append("- **Local Database Search:** Local database is empty.")
    else:
        thinking_lines.append("- **Local Database Search:** Bypassed by RAG mode.")

    if rag_mode in ("hybrid", "web"):
        if web_results:
            thinking_lines.append(f"- **Web Search & Fact-Checking:** Queried Brave/DuckDuckGo. Retrieved {len(web_results)} results:")
            for res in web_results:
                thinking_lines.append(f"  - [{res['title']}]({res['url']})")
        else:
            thinking_lines.append("- **Web Search & Fact-Checking:** Searched the web, but no results were returned.")
    else:
        thinking_lines.append("- **Web Search & Fact-Checking:** Bypassed by RAG mode.")

    thinking_lines.append("- **Synthesis & Logic Reasoning:** Generating response with citations.")
    thinking_block = (
        "<details><summary>Thinking Process</summary>\n\n"
        + "\n".join(thinking_lines) +
        "\n\n</details>\n\n"
    )

    prompt = (
        "You are an expert Software Engineer, UI/UX Designer, and Technical Researcher.\n"
        "You have access to local documents context and live web search context below to help answer the user's question.\n"
        f"Context:\n{merged_context}\n\n"
        f"Question/Request: {question}\n"
        "Answer:"
    )

    yield json.dumps({
        "type": "metadata",
        "active_model": active_model,
        "sources": sources,
        "thinking": thinking_block
    }) + "\n"

    for chunk in ask_llm_stream(prompt, model=active_model, images=images):
        yield json.dumps({"type": "content", "delta": chunk}) + "\n"
