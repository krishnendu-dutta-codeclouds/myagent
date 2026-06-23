# Local AI Coding & Research Assistant

A fully-local, private AI chatbot and engineering assistant. Designed as an expert Software Engineer, UI/UX Designer, and Technical Researcher. It runs entirely on your local machine using standalone `.gguf` models, avoiding any cloud API costs or data privacy concerns.

## ✨ Features

- **100% Offline AI Inference**: Runs `.gguf` models locally using `llama-cpp-python` and a dedicated local provider microservice.
- **Expert Coding & UI/UX Support**: Generates high-quality code (HTML, CSS, JS, Tailwind, GSAP) with semantic naming and high-level architectural reasoning.
- **Dynamic "Thinking" Process**: Before answering, the AI formulates an architectural design, query analysis, and verification plan.
- **Multi-Source RAG (Retrieval-Augmented Generation)**:
  - **Live Web Search**: Automatically fetches live data via Google (with DuckDuckGo fallback).
  - **URL Training**: Scrapes and indexes content from any URL.
  - **File Training**: Supports PDFs, TXT, DOCX, and CSV files.
  - **ChatGPT Exports**: Indexes your past ChatGPT conversation exports (`.html` files) to learn from your previous chats.
- **Beautiful React Frontend**: Features syntax highlighting, dark mode, animated suggestions, and an integrated chat panel.
- **Automatic Model Management**: Automatically downloads lightweight models like `TinyLlama` if no model is found in your `models/` directory.

## 🛠️ Tech Stack

| Layer       | Technology             |
|-------------|------------------------|
| Frontend    | React, Vite, CSS       |
| Backend     | FastAPI (Python)       |
| LLM Engine  | llama-cpp-python       |
| Embeddings  | nomic-embed-text       |
| Vector DB   | ChromaDB (local)       |
| Web Scraper | requests, BeautifulSoup|

## 🚀 Getting Started

### 1. Prerequisites

- Python 3.10+
- Node.js & npm (for the frontend)
- [Ollama](https://ollama.com) (Optional, for embeddings and fallback models)

If using Ollama for embeddings, ensure you have the `nomic-embed-text` model:
```bash
ollama pull nomic-embed-text
```

### 2. Run the Application

We have provided a unified startup script that installs all dependencies and launches both the backend and frontend simultaneously.

```bash
chmod +x run.sh
./run.sh
```

- **Frontend UI**: `http://localhost:5173`
- **Backend API**: `http://localhost:8000`
- **Local Model Provider API**: `http://localhost:8001`

### 3. Adding Custom Models

By default, the application will auto-download `TinyLlama` if the `models/` directory is empty. 
To use stronger local models, simply download any `.gguf` formatted model from HuggingFace (e.g., LLaMA-3, Mistral, CodeQwen) and drop it inside the `models/` folder. The app will automatically detect it!

## 🧠 System Architecture

```text
website-chat-agent/
├── backend/
│   ├── local_inference.py # Standalone llama-cpp-python integration
│   ├── local_provider.py  # Local inference microservice (Port 8001)
│   ├── rag.py             # Retrieval-Augmented Generation & prompt logic
│   ├── scraper.py         # Google/DDG Search & Web Scraping
│   └── vector_store.py    # ChromaDB database
├── frontend/
│   ├── src/               # React application code
│   └── index.html
├── models/                # Place your .gguf models here
├── run.sh                 # Unified startup script
└── requirements.txt       # Python dependencies
```

## 📝 License

MIT
