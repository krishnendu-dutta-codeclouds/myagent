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

async function uploadFiles(path, files, projectId = null) {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  if (projectId) {
    formData.append('project_id', projectId);
  }
  
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
  train: (url, projectId = null) =>
    request('/train', {
      method: 'POST',
      body: JSON.stringify({ url, project_id: projectId }),
    }),
  trainDocuments: (files, projectId = null) => uploadFiles('/train-documents', files, projectId),
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
  getDocuments: (projectId = null) =>
    request(`/documents${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),
  deleteDocument: (filename) =>
    request(`/documents/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),
  getLinks: (projectId = null) =>
    request(`/links${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`),
  deleteLink: (url) =>
    request(`/links?url=${encodeURIComponent(url)}`, {
      method: 'DELETE',
    }),
  clearAll: () =>
    request('/clear-all', {
      method: 'POST',
    }),
  
  // Project Space CRUD APIs
  getProjects: () => request('/projects'),
  createProject: (name, description = '') =>
    request('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  deleteProject: (projectId) =>
    request(`/projects/${projectId}`, {
      method: 'DELETE',
    }),
  getProjectDocuments: (projectId) => request(`/projects/${projectId}/documents`),
  getProjectLinks: (projectId) => request(`/projects/${projectId}/links`),

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
  chat: (question, images = [], attachedText = null, attachedName = null, ragMode = 'hybrid', projectId = null) =>
    request('/chat', {
      method: 'POST',
      body: JSON.stringify({
        question,
        images,
        attached_text: attachedText,
        attached_name: attachedName,
        rag_mode: ragMode,
        project_id: projectId,
      }),
    }),
  chatStream: async (question, images = [], attachedText = null, attachedName = null, ragMode = 'hybrid', projectId = null, onChunk) => {
    const response = await fetch(`${BASE}/chat-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question,
        images,
        attached_text: attachedText,
        attached_name: attachedName,
        rag_mode: ragMode,
        project_id: projectId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || 'Stream request failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          onChunk(parsed);
        } catch (e) {
          console.error('Failed to parse stream line:', trimmed, e);
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        onChunk(parsed);
      } catch (e) {
        console.error('Failed to parse trailing buffer:', buffer, e);
      }
    }
  },
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
  getGuardrailConfig: () => request('/guardrails/config'),
  setGuardrailConfig: (config) =>
    request('/guardrails/config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  getUsageStats: () => request('/usage/stats'),
  resetUsageStats: () =>
    request('/usage/reset', {
      method: 'POST',
    }),
  sendFeedback: (question, answer, liked, projectId = null) =>
    request('/feedback', {
      method: 'POST',
      body: JSON.stringify({ question, answer, liked, project_id: projectId }),
    }),
  generateImage: (prompt) =>
    request('/multimodal/image', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  generateVector: (text) =>
    request('/multimodal/vector', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  generateVideo: (prompt) =>
    request('/multimodal/video', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
  transcribeAudio: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/multimodal/transcribe', {
      method: 'POST',
      body: formData,
    }).then(async (res) => {
      let data;
      try { data = await res.json(); } catch { data = { detail: 'Invalid response' }; }
      if (!res.ok) throw new Error(data?.detail || `Transcription failed with ${res.status}`);
      return data;
    });
  },
};
