import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

/**
 * Compact model-switcher that lives in the topbar.
 * – Shows the currently active model name.
 * – Opens a popover listing local models + a free-text input.
 * – Saves the chosen model via POST /model-config.
 */
export default function ModelSwitcher({ activeModel, setActiveModel, backendOk }) {
  const [open, setOpen] = useState(false);
  const [localModels, setLocalModels] = useState([]);
  const [customInput, setCustomInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'ok'|'err', text }
  const popoverRef = useRef(null);

  // Load current model + list whenever backend is ready
  useEffect(() => {
    if (!backendOk) return;
    Promise.all([api.getModelConfig(), api.getLocalModels()])
      .then(([cfg, mods]) => {
        setActiveModel(cfg.model || '');
        setLocalModels(mods.models || []);
        setCustomInput(cfg.model || '');
      })
      .catch(() => {});
  }, [backendOk, setActiveModel]);

  // Keep customInput synced if activeModel changes (e.g. from fallback)
  useEffect(() => {
    setCustomInput(activeModel);
  }, [activeModel]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
        setStatus(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const saveModel = async (modelName) => {
    const name = (modelName || customInput).trim();
    if (!name) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await api.setModelConfig(name);
      setActiveModel(result.model);
      setCustomInput(result.model);
      setStatus({ type: 'ok', text: `Switched to ${result.model}` });
      setTimeout(() => {
        setOpen(false);
        setStatus(null);
      }, 1200);
    } catch (err) {
      setStatus({ type: 'err', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (!backendOk) return null;

  return (
    <div className="model-switcher" ref={popoverRef}>
      <button
        className="model-switcher-btn"
        onClick={() => setOpen((o) => !o)}
        title="Switch Ollama model"
        aria-label="Switch model"
        aria-expanded={open}
      >
        {/* chip icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M19 9h3M2 15h3M19 15h3" />
        </svg>
        <span className="model-switcher-label">
          {activeModel || 'No model'}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="model-switcher-popover">
          <div className="ms-popover-title">Ollama Model</div>

          {/* Local models list */}
          {localModels.length > 0 && (
            <div className="ms-model-list">
              {localModels.map((m) => (
                <button
                  key={m}
                  className={`ms-model-item ${m === activeModel ? 'active' : ''}`}
                  onClick={() => { setCustomInput(m); saveModel(m); }}
                  disabled={saving}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="6" height="6" />
                    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M19 9h3M2 15h3M19 15h3" />
                  </svg>
                  <span>{m}</span>
                  {m === activeModel && (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', color: 'var(--accent)' }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {localModels.length === 0 && (
            <p className="ms-no-models">No local models found.<br />Run <code>ollama pull &lt;model&gt;</code> first.</p>
          )}

          {/* Custom input */}
          <div className="ms-custom-row">
            <input
              className="ms-custom-input"
              type="text"
              placeholder="Custom model name…"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveModel(); }}
              disabled={saving}
            />
            <button
              className="ms-save-btn"
              onClick={() => saveModel()}
              disabled={saving || !customInput.trim()}
            >
              {saving ? '…' : 'Set'}
            </button>
          </div>

          {status && (
            <div className={`ms-status ms-status--${status.type}`}>
              {status.type === 'ok' ? '✓' : '⚠'} {status.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
