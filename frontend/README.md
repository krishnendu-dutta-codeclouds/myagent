# Website Chat Agent — Frontend

A React + Vite SPA for the local Ollama chatbot. It lets you:

1. Paste any URL and click **Train** to scrape + index it via the FastAPI backend.
2. Chat with the assistant, which answers strictly from the indexed content.

## Prerequisites

- Node.js 18+
- The FastAPI backend running on `http://127.0.0.1:8000`
- Ollama running with `tinyllama` and `nomic-embed-text` pulled

## Install & run

```bash
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api/*` to the FastAPI backend, so
no CORS configuration is needed in development.

## Build for production

```bash
npm run build
npm run preview
```

## Project layout

```
frontend/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx          # React entry point
    ├── App.jsx           # Top-level layout + backend health check
    ├── api.js            # Fetch wrapper for /train and /chat
    ├── styles.css
    └── components/
        ├── TrainPanel.jsx # URL form + training action
        └── ChatPanel.jsx  # Message list + question form
```
