"""Document processing utilities for PDF, TXT, DOCX, and other formats."""
from __future__ import annotations

import io
import os
from typing import List, Optional

# Optional imports - will be available if packages are installed
try:
    import PyPDF2
    HAS_PYPDF2 = True
except ImportError:
    HAS_PYPDF2 = False

try:
    import docx
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from a PDF file."""
    if not HAS_PYPDF2:
        raise RuntimeError("PyPDF2 not installed. Run: pip install PyPDF2")
    
    reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    text_parts = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            text_parts.append(text)
    return "\n\n".join(text_parts)


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from a DOCX file."""
    if not HAS_DOCX:
        raise RuntimeError("python-docx not installed. Run: pip install python-docx")
    
    doc = docx.Document(io.BytesIO(file_bytes))
    text_parts = []
    for para in doc.paragraphs:
        if para.text.strip():
            text_parts.append(para.text)
    return "\n\n".join(text_parts)


def extract_text_from_txt(file_bytes: bytes) -> str:
    """Extract text from a plain text file."""
    # Try common encodings
    for encoding in ['utf-8', 'latin-1', 'cp1252']:
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    # Fallback: replace undecodable bytes
    return file_bytes.decode('utf-8', errors='replace')


def extract_text_from_file(filename: str, file_bytes: bytes) -> str:
    """Extract text from a file based on its extension."""
    ext = os.path.splitext(filename.lower())[1]
    
    if ext == '.pdf':
        return extract_text_from_pdf(file_bytes)
    elif ext == '.docx':
        return extract_text_from_docx(file_bytes)
    elif ext in ('.txt', '.md', '.markdown', '.rst'):
        return extract_text_from_txt(file_bytes)
    elif ext == '.json':
        return extract_text_from_txt(file_bytes)
    elif ext == '.zip':
        return extract_text_from_txt(file_bytes)  # fallback
    else:
        raise ValueError(f"Unsupported file type: {ext}. Supported: .pdf, .docx, .txt, .md, .json, .zip")


def parse_chatgpt_export(file_bytes: bytes, filename: str) -> List[str]:
    """Parse a ChatGPT export file and return a list of conversation text chunks.

    Supports:
    - ZIP file containing conversations.json (standard ChatGPT export)
    - Direct conversations.json file
    """
    import json
    import zipfile

    conversations_data = None

    ext = os.path.splitext(filename.lower())[1]

    if ext == '.zip':
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                # Look for conversations.json inside the ZIP
                for name in zf.namelist():
                    if name.endswith('conversations.json'):
                        with zf.open(name) as f:
                            conversations_data = json.loads(f.read())
                        break
                if conversations_data is None:
                    raise ValueError(
                        "No conversations.json found in the ZIP file. "
                        "Make sure this is a ChatGPT data export."
                    )
        except zipfile.BadZipFile:
            raise ValueError("Invalid ZIP file. Please upload a valid ChatGPT export ZIP.")
    elif ext == '.json':
        try:
            conversations_data = json.loads(file_bytes)
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON file. Could not parse the file.")
    else:
        raise ValueError(f"Unsupported format: {ext}. Upload a .zip or .json ChatGPT export.")

    if not isinstance(conversations_data, list):
        raise ValueError("Expected a JSON array of conversations.")

    # Extract text from conversations
    text_chunks = []
    for conv in conversations_data:
        title = conv.get("title", "Untitled")
        messages = _extract_messages_from_conversation(conv)
        if messages:
            conv_text = f"Conversation: {title}\n\n" + "\n\n".join(messages)
            text_chunks.append(conv_text)

    if not text_chunks:
        raise ValueError("No conversations found in the export file.")

    return text_chunks


def _get_role_from_message(msg: dict) -> str:
    """Safely extract the role of the message sender."""
    if not isinstance(msg, dict):
        return "unknown"
    
    author = msg.get("author")
    if isinstance(author, dict):
        role = author.get("role")
        if isinstance(role, str):
            return role
    elif isinstance(author, str):
        return author
        
    role = msg.get("role")
    if isinstance(role, str):
        return role
        
    return "unknown"


def _get_text_from_message(msg: dict) -> str:
    """Safely extract the textual content of a message from various formats."""
    if not isinstance(msg, dict):
        return ""
    
    content = msg.get("content")
    if isinstance(content, dict):
        # 1. Try content["parts"] (standard list of strings/dicts)
        parts = content.get("parts")
        if isinstance(parts, list):
            extracted = []
            for p in parts:
                if isinstance(p, str):
                    extracted.append(p)
                elif isinstance(p, dict):
                    # Sometimes parts contain a dictionary like {"text": "..."}
                    text_val = p.get("text") or p.get("content") or ""
                    if isinstance(text_val, str):
                        extracted.append(text_val)
            if extracted:
                return " ".join(extracted)
        
        # 2. Try content["text"] (direct string)
        text_val = content.get("text")
        if isinstance(text_val, str):
            return text_val

    # 3. Try top-level keys
    for key in ["text", "content", "body"]:
        val = msg.get(key)
        if isinstance(val, str):
            return val
            
    return ""


def _extract_messages_from_conversation(conv: dict) -> List[str]:
    """Extract message texts from a single ChatGPT conversation object."""
    if not isinstance(conv, dict):
        return []

    messages = []
    mapping = conv.get("mapping")

    if isinstance(mapping, dict) and mapping:
        # Standard ChatGPT export format with mapping dict
        # Sort nodes safely by create_time, falling back to original order on type errors
        nodes = list(mapping.values())
        try:
            sorted_nodes = sorted(
                nodes,
                key=lambda n: float((n.get("message") or {}).get("create_time") or 0)
            )
        except Exception:
            sorted_nodes = nodes

        for node in sorted_nodes:
            if not isinstance(node, dict):
                continue
            msg = node.get("message")
            if not isinstance(msg, dict):
                continue
            
            role = _get_role_from_message(msg)
            text = _get_text_from_message(msg)
            if text.strip():
                role_label = {"user": "User", "assistant": "Assistant", "system": "System"}.get(role, role)
                messages.append(f"{role_label}: {text.strip()}")
    else:
        # Fallback: try direct messages list
        msg_list = conv.get("messages")
        if isinstance(msg_list, list):
            for msg in msg_list:
                if isinstance(msg, dict):
                    role = _get_role_from_message(msg)
                    text = _get_text_from_message(msg)
                    if text.strip():
                        role_label = {"user": "User", "assistant": "Assistant", "system": "System"}.get(role, role)
                        messages.append(f"{role_label}: {text.strip()}")
                elif isinstance(msg, str) and msg.strip():
                    messages.append(msg.strip())

    return messages


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping chunks."""
    words = text.split()
    if not words:
        return []
    
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk = " ".join(words[start:end])
        chunks.append(chunk)
        if end >= len(words):
            break
        start = end - overlap
    return chunks


def process_uploaded_file(filename: str, file_bytes: bytes, chunk_size: int = 500) -> List[str]:
    """Process an uploaded file: extract text and chunk it."""
    text = extract_text_from_file(filename, file_bytes)
    return chunk_text(text, chunk_size=chunk_size)