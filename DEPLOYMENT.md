# Vercel Deployment Guide for Agent UXKD

## Prerequisites

1. **GitHub Repository** - Push your code to GitHub
2. **Vercel Account** - Sign up at [vercel.com](https://vercel.com)
3. **External Ollama Host** - Vercel cannot run Ollama locally. You need:
   - A VPS (DigitalOcean, Railway, Render, Fly.io, etc.) running Ollama
   - Or use a managed LLM API (modify backend to use OpenAI/Anthropic)
4. **External Vector Database** (Recommended) - Vercel's filesystem is ephemeral:
   - **Pinecone** (already in requirements)
   - **Chroma Cloud** (managed ChromaDB)
   - **Weaviate Cloud**

---

## Quick Deploy

### 1. Push to GitHub
```bash
git add .
git commit -m "Prepare for Vercel deployment"
git push origin main
```

### 2. Import in Vercel
1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Vercel auto-detects `vercel.json` configuration

### 3. Configure Environment Variables
In Vercel Dashboard → **Settings** → **Environment Variables**, add:

| Variable | Value | Required |
|----------|-------|----------|
| `OLLAMA_HOST` | `http://your-ollama-host:11434` | **Yes** |
| `BRAVE_API_KEY` | `your-brave-search-api-key` | No (for web search) |
| `PINECONE_API_KEY` | `your-pinecone-api-key` | If using Pinecone |
| `PINECONE_INDEX` | `your-index-name` | If using Pinecone |
| `CHROMA_HOST` | `your-chroma-cloud-host` | If using Chroma Cloud |
| `CHROMA_PORT` | `443` | If using Chroma Cloud |
| `CHROMA_TENANT` | `your-tenant` | If using Chroma Cloud |
| `CHROMA_DATABASE` | `your-database` | If using Chroma Cloud |

### 4. Deploy
Click **Deploy** - Vercel will:
- Build frontend: `cd frontend && npm run build` → outputs to `frontend/dist`
- Deploy API: Python function at `api/index.py` with 30s timeout

---

## Architecture for Production

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Vercel    │────▶│  External   │────▶│   Ollama Host    │
│  (Frontend) │     │  (API)      │     │  (LLM Inference) │
└─────────────┘     └──────┬──────┘     └──────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Vector DB  │
                    │ (Pinecone/  │
                    │  Chroma)    │
                    └─────────────┘
```

---

## Required Backend Modifications

### 1. Vector Store (backend/vector_store.py)
Replace local ChromaDB with Pinecone or Chroma Cloud:

```python
# Example: Pinecone integration
import pinecone
from pinecone import Pinecone, ServerlessSpec

pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX"))
```

### 2. File Storage (backend/rag.py)
Replace local `uploads/` with Vercel Blob or AWS S3:

```python
# Example: Vercel Blob
from vercel_blob import put, del_

blob = await put(filename, file_bytes, { access: 'public' })
# Returns { url, pathname, contentType, contentDisposition }
```

### 3. Model Downloads
Remove `models/` directory dependency - use Ollama API to pull models on the external host.

---

## Local Development

```bash
# Frontend
cd frontend && npm run dev

# Backend
python -m uvicorn api.index:app --reload --port 8000

# Or use the run script
./run.sh
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ModuleNotFoundError` | Check `requirements.txt` has all dependencies |
| `ImportError: backend` | Ensure `PYTHONPATH=/var/task` in vercel.json |
| Timeout errors | Increase `maxDuration` in vercel.json (max 60s on Pro) |
| ChromaDB not persisting | Use external vector DB (Pinecone/Chroma Cloud) |
| Ollama connection failed | Verify `OLLAMA_HOST` is accessible from Vercel's network |
| Large bundle size | Check `maxLambdaSize` in vercel.json (15mb limit) |

---

## Vercel Limits (Hobby Plan)

- **Function timeout**: 10 seconds (30s on Pro)
- **Function size**: 50MB (15MB for Python)
- **Bandwidth**: 100GB/month
- **Serverless executions**: 100GB-hours/month

---

## Alternative: Deploy Backend Separately

If Vercel's limits are too restrictive, consider:

1. **Backend on Railway/Render/Fly.io** (supports long-running processes, persistent storage)
2. **Frontend on Vercel** (static hosting + edge network)
3. **Connect via CORS** - Update `CORSMiddleware` in `main.py`

```python
# In main.py - allow your Vercel frontend domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-app.vercel.app", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```