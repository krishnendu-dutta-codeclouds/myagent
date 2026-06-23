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
    else:
        raise ValueError(f"Unsupported file type: {ext}. Supported: .pdf, .docx, .txt, .md")


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