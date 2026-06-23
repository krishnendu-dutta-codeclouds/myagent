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
  trainChatGPT: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/train-chatgpt`, {
      method: 'POST',
      body: formData,
    }).then(async (res) => {
      let data;
      try { data = await res.json(); } catch { data = { detail: 'Invalid response' }; }
      if (!res.ok) throw new Error(data?.detail || `Failed with ${res.status}`);
      return data;
    });
  },
  getDocuments: () => request('/documents'),
  deleteDocument: (filename) =>
    request(`/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),
  getLinks: () => request('/links'),
  deleteLink: (url) =>
    request(`/links?url=${encodeURIComponent(url)}`, {
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
  parseFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch(`${BASE}/parse-file`, {
      method: 'POST',
      body: formData,
    }).then(async (res) => {
      let data;
      try {
        data = await res.json();
      } catch {
        data = { detail: 'Invalid JSON response from server' };
      }
      if (!res.ok) {
        throw new Error(data?.detail || `Parsing failed with ${res.status}`);
      }
      return data;
    });
  },
  chat: (question, images = [], attachedText = null, attachedName = null) =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        question,
        images,
        attached_text: attachedText,
        attached_name: attachedName,
      }),
    }),
  getModelCatalog: () => request('/model-catalog'),
  downloadModel: (modelId) =>
    request('/model-catalog/download', {
      method: 'POST',
      body: JSON.stringify({ model_id: modelId }),
    }),
  deleteModel: (filename) =>
    request(`/model-catalog/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),
};
