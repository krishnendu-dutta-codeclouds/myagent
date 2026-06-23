#!/bin/bash

# Trap Ctrl+C (SIGINT) and exit signals to kill all background processes started by this script
trap "echo -e '\nStopping all services...'; kill 0" EXIT

echo "=================================================="
echo "🚀 Starting Website Chat Agent Services..."
echo "=================================================="

# 1. Start GGUF Local LLM Provider on port 8001
echo "Starting local LLM provider on port 8001..."
venv/bin/uvicorn backend.local_provider:app --host 127.0.0.1 --port 8001 &

# 2. Start Main Backend Server on port 8000
echo "Starting main backend server on port 8000..."
venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 &

# 3. Start Frontend Vite Dev Server
echo "Starting frontend dev server..."
(cd frontend && npm run dev) &

echo "=================================================="
echo "✨ All services started! Press Ctrl+C to stop all."
echo "=================================================="

# Wait for all background processes to finish
wait
