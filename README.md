# Local Website-Specific AI Chatbot Agent (Ollama + TinyLlama)

A fully-local chatbot that answers **only** from a given website's content.
Built with **Ollama**, **TinyLlama**, **nomic-embed-text**, **FastAPI**, and **ChromaDB**.

## Features

- 100% offline on macOS (no cloud APIs)
- Uses free open-source Ollama models
- Trains on any website URL
- Strict refusal of out-of-scope questions
- Prevents hallucinations by grounding every answer in retrieved chunks

## Tech Stack

| Layer       | Technology             |
|-------------|------------------------|
| LLM         | TinyLlama (Ollama)     |
| Embeddings  | nomic-embed-text       |
| Backend     | FastAPI (Python)       |
| Scraping    | requests, BeautifulSoup|
| Vector DB   | ChromaDB (local)       |
| Platform    | macOS                  |

## Project Structure

```
website-chat-agent/
├── backend/
│   ├── __init__.py
│   ├── scraper.py        # Download + clean website text
│   ├── chunker.py        # Split text into overlapping chunks
│   ├── embeddings.py     # nomic-embed-text via Ollama CLI
│   ├── vector_store.py   # ChromaDB persistence + retrieval
│   ├── prompts.py        # System prompt + refusal guard
│   ├── llm.py            # TinyLlama wrapper
│   └── rag.py            # End-to-end train + answer pipeline
├── main.py               # FastAPI app (/train, /chat)
├── requirements.txt
└── README.md
```

## 1. Install Ollama and pull the models

```bash
brew install ollama
ollama pull tinyllama
ollama pull nomic-embed-text
ollama serve          # keep this running in a separate terminal
```

## 2. Set up the Python environment

```bash
cd website-chat-agent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## 3. Run the API

```bash
uvicorn main:app --reload
```

The server starts on `http://127.0.0.1:8000`.

## 4. Train on a website

```bash
curl -X POST http://127.0.0.1:8000/train \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}'
```

## 5. Ask a question

```bash
curl -X POST http://127.0.0.1:8000/chat \
     -H "Content-Type: application/json" \
     -d '{"question": "What products do you offer?"}'
```

If the question is unrelated to the indexed website, the API returns:

> I can only answer questions related to this website's products or services.

## License

MIT
