// Thin client for the FastAPI backend.
// During development Vite proxies `/api/*` -> `http://127.0.0.1:8000/*`.
const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { detail: 'Invalid JSON response from server' };
  }

  if (!res.ok) {
    const message = data?.detail || `Request failed with ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function uploadFiles(path, files) {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: formData,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { detail: 'Invalid JSON response from server' };
  }

  if (!res.ok) {
    const message = data?.detail || `Request failed with ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export const api = {
  health: () => request('/'),
  train: (url) =>
    request('/train', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  trainDocuments: (files) => uploadFiles('/train-documents', files),
  getDocuments: () => request('/documents'),
  deleteDocument: (filename) =>
    request(`/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),
  clearAll: () =>
    request('/clear-all', {
      method: 'POST',
    }),
  getModelConfig: () => request('/model-config'),
  setModelConfig: (model) =>
    request('/model-config', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),
  getLocalModels: () => request('/model-config/models'),
  chat: (question) =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
};
