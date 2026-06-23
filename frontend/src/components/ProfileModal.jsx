import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function ProfileModal({ open, onClose, conversations, backendOk, onClearAll }) {
  const [clearing, setClearing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Model config state
  const [modelInput, setModelInput] = useState('tinyllama');
  const [localModels, setLocalModels] = useState([]);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [catalogModels, setCatalogModels] = useState([]);

  // Reset on open / close
  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      setFeedback(null);
    }
  }, [open]);

  // Fetch current model + available models + catalog when modal opens
  useEffect(() => {
    if (!open || !backendOk) return;
    setModelLoading(true);
    Promise.all([api.getModelConfig(), api.getLocalModels(), api.getModelCatalog()])
      .then(([cfg, mods, cat]) => {
        setModelInput(cfg.model || 'tinyllama');
        setLocalModels(mods.models || []);
        setCatalogModels(cat.models || []);
      })
      .catch(() => {})
      .finally(() => setModelLoading(false));
  }, [open, backendOk]);

  // Poll model catalog if a model is currently downloading
  useEffect(() => {
    let timer;
    const isDownloading = catalogModels.some(
      (m) => m.download_status?.status === 'downloading'
    );
    if (isDownloading && open && backendOk) {
      timer = setInterval(() => {
        api.getModelCatalog()
          .then((data) => {
            setCatalogModels(data.models || []);
            // Also refresh local models to see if it completed
            return api.getLocalModels();
          })
          .then((mods) => {
            if (mods) setLocalModels(mods.models || []);
          })
          .catch(() => {});
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [catalogModels, open, backendOk]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const totalMessages = conversations.reduce((sum, c) => sum + c.messages.length, 0);

  /* ---- Export ---- */
  const handleExport = () => {
    setExporting(true);
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        conversations: conversations.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          indexedUrl: c.indexedUrl || null,
          messages: c.messages,
        })),
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ type: 'ok', text: 'Export downloaded successfully.' });
    } catch (err) {
      setFeedback({ type: 'error', text: `Export failed: ${err.message}` });
    } finally {
      setExporting(false);
    }
  };

  /* ---- Clear All ---- */
  const handleConfirmDelete = async () => {
    setClearing(true);
    setFeedback(null);
    try {
      await api.clearAll();
      onClearAll();
      setFeedback({ type: 'ok', text: 'All data cleared successfully.' });
      setConfirmClear(false);
    } catch (err) {
      setFeedback({ type: 'error', text: `Clear failed: ${err.message}` });
    } finally {
      setClearing(false);
    }
  };

  /* ---- Model save ---- */
  const handleSaveModel = async () => {
    if (!modelInput.trim()) return;
    setModelSaving(true);
    setFeedback(null);
    try {
      const result = await api.setModelConfig(modelInput.trim());
      setModelInput(result.model);
      setFeedback({ type: 'ok', text: `Model set to "${result.model}".` });
    } catch (err) {
      setFeedback({ type: 'error', text: `Failed to save model: ${err.message}` });
    } finally {
      setModelSaving(false);
    }
  };

  /* ---- Model Download & Delete ---- */
  const handleDownloadModel = async (modelId) => {
    setFeedback(null);
    // Optimistically update to show downloading state immediately
    setCatalogModels((prev) =>
      prev.map((m) =>
        m.id === modelId
          ? {
              ...m,
              download_status: { status: 'downloading', progress: 0, total: 100, error: null },
            }
          : m
      )
    );

    try {
      await api.downloadModel(modelId);
      setFeedback({ type: 'ok', text: `Started downloading model "${modelId}".` });
      const cat = await api.getModelCatalog();
      setCatalogModels(cat.models || []);
      const mods = await api.getLocalModels();
      setLocalModels(mods.models || []);
    } catch (err) {
      setFeedback({ type: 'error', text: `Failed to download: ${err.message}` });
      const cat = await api.getModelCatalog();
      setCatalogModels(cat.models || []);
    }
  };

  const handleDeleteModel = async (filename) => {
    if (!window.confirm(`Are you sure you want to delete model file "${filename}"?`)) return;
    setFeedback(null);
    try {
      await api.deleteModel(filename);
      setFeedback({ type: 'ok', text: `Model file "${filename}" deleted successfully.` });
      const [cat, mods] = await Promise.all([api.getModelCatalog(), api.getLocalModels()]);
      setCatalogModels(cat.models || []);
      setLocalModels(mods.models || []);

      const cfg = await api.getModelConfig();
      setModelInput(cfg.model || '');
    } catch (err) {
      setFeedback({ type: 'error', text: `Failed to delete model: ${err.message}` });
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal profile-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
      >
        {/* Header */}
        <div className="modal-header">
          <h3 id="profile-modal-title">Profile &amp; Settings</h3>
          <button className="icon-btn modal-close" onClick={onClose} title="Close" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* User info card */}
        <div className="profile-user-card">
          <div className="profile-avatar">U</div>
          <div className="profile-user-info">
            <div className="profile-user-name">You</div>
            <div className="profile-user-meta">
              <span className={`status-dot ${backendOk ? 'ok' : 'bad'}`} />
              <span className="profile-status-text">
                {backendOk === null && 'Connecting…'}
                {backendOk === true && 'Backend connected'}
                {backendOk === false && 'Backend offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="profile-stats">
          <div className="profile-stat">
            <span className="profile-stat-value">{conversations.length}</span>
            <span className="profile-stat-label">Conversations</span>
          </div>
          <div className="profile-stat-divider" />
          <div className="profile-stat">
            <span className="profile-stat-value">{totalMessages}</span>
            <span className="profile-stat-label">Messages</span>
          </div>
        </div>

        {/* ===== Model Configuration ===== */}
        <div className="profile-section-title">Ollama Model</div>

        <div className="settings-row settings-row--col">
          <div className="settings-info">
            <div className="settings-label">Active Model</div>
            <div className="settings-desc">
              Type a model name or pick one from your locally pulled models.
            </div>
          </div>

          <div className="model-input-group">
            {/* Text input */}
            <input
              className="model-text-input"
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              placeholder="e.g. tinyllama, llama3, mistral"
              disabled={modelSaving || modelLoading}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveModel(); }}
            />

            {/* Dropdown of locally available models */}
            {localModels.length > 0 && (
              <select
                className="model-select"
                value={localModels.includes(modelInput) ? modelInput : ''}
                onChange={(e) => setModelInput(e.target.value)}
                disabled={modelSaving || modelLoading}
                title="Pick a local model"
                aria-label="Pick a local model"
              >
                <option value="" disabled>Pick local model</option>
                {localModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            )}

            <button
              className="settings-btn"
              onClick={handleSaveModel}
              disabled={modelSaving || !modelInput.trim()}
            >
              {modelSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* ===== Local GGUF Model Manager ===== */}
        <div className="profile-section-title">Local GGUF Models (Hugging Face)</div>
        <div className="gguf-catalog-container">
          {catalogModels.length === 0 ? (
            <p className="gguf-empty-msg">No models in catalog or backend offline.</p>
          ) : (
            <div className="gguf-catalog-list">
              {catalogModels.map((m) => {
                const isDownloading = m.download_status?.status === 'downloading';
                const isError = m.download_status?.status === 'error';
                const progress = m.download_status?.progress || 0;
                const total = m.download_status?.total || 1;
                const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

                return (
                  <div key={m.id} className="gguf-catalog-card">
                    <div className="gguf-card-header">
                      <div className="gguf-card-title-group">
                        <strong className="gguf-card-name">{m.name}</strong>
                        <span className="gguf-card-badge">{m.params} • {m.quantization}</span>
                      </div>

                      <div className="gguf-card-actions">
                        {m.downloaded ? (
                          <button
                            className="gguf-btn gguf-btn--delete"
                            onClick={() => handleDeleteModel(m.filename)}
                            title="Delete model file"
                            aria-label={`Delete ${m.name}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        ) : isDownloading ? (
                          <span className="gguf-downloading-spinner">
                            Downloading…
                          </span>
                        ) : (
                          <button
                            className="gguf-btn gguf-btn--download"
                            onClick={() => handleDownloadModel(m.id)}
                            title="Download model"
                            aria-label={`Download ${m.name}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                            </svg>
                            Download ({Math.round(m.size_mb)} MB)
                          </button>
                        )}
                      </div>
                    </div>

                    <p className="gguf-card-desc">{m.description}</p>

                    {isDownloading && (
                      <div className="gguf-progress-container">
                        <div className="gguf-progress-bar" style={{ width: `${percent}%` }} />
                        <span className="gguf-progress-text">{percent}% ({(progress / (1024 * 1024)).toFixed(1)} / {(total / (1024 * 1024)).toFixed(1)} MB)</span>
                      </div>
                    )}
                    {isError && (
                      <div className="gguf-card-error">
                        ⚠️ Error: {m.download_status.error}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===== Data Management ===== */}
        <div className="profile-section-title">Data Management</div>

        {/* Export Data */}
        <div className="settings-row">
          <div className="settings-info">
            <div className="settings-label">Export Data</div>
            <div className="settings-desc">Download all conversations as a JSON file.</div>
          </div>
          <button
            className="settings-btn"
            onClick={handleExport}
            disabled={exporting || conversations.length === 0}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>

        {/* Clear All Data */}
        <div className="settings-row">
          <div className="settings-info">
            <div className="settings-label settings-label--danger">Clear All Data</div>
            <div className="settings-desc">
              Permanently delete all uploaded files, ChromaDB index, and conversation history.
            </div>
          </div>
          {!confirmClear && (
            <button
              className="settings-btn settings-btn--danger"
              onClick={() => setConfirmClear(true)}
              disabled={clearing}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
              Clear All
            </button>
          )}
        </div>

        {/* Confirmation panel — shown below after clicking "Clear All" */}
        {confirmClear && (
          <div className="clear-confirm-panel">
            <div className="clear-confirm-warning">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: 'var(--warn)' }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>
                <strong>This action is irreversible.</strong> All uploaded files, vector embeddings, and conversation history will be permanently deleted.
              </span>
            </div>
            <div className="clear-confirm-actions">
              <button
                className="settings-btn"
                onClick={() => setConfirmClear(false)}
                disabled={clearing}
              >
                Cancel
              </button>
              <button
                className="settings-btn settings-btn--danger settings-btn--delete"
                onClick={handleConfirmDelete}
                disabled={clearing}
              >
                {clearing ? (
                  'Deleting…'
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                    Delete Everything
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div className={`settings-feedback settings-feedback--${feedback.type}`}>
            {feedback.type === 'ok' ? '✓' : '⚠️'} {feedback.text}
          </div>
        )}
      </div>
    </div>
  );
}
