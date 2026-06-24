import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

export default function TrainModal({ open, onClose, onTrained, initialTab = 'url', projectId = null }) {
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState([]);
  const [chatgptFile, setChatgptFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isDragging, setIsDragging] = useState(false);
  const urlInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatgptInputRef = useRef(null);

  // Reset state when modal opens and sync to initialTab
  useEffect(() => {
    if (open) {
      setError(null);
      setSuccessMsg(null);
      setActiveTab(initialTab);
      setIsDragging(false);
    }
  }, [open, initialTab]);

  // Auto-focus the relevant input whenever the active tab changes
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (activeTab === 'url') {
        urlInputRef.current?.focus();
      } else if (activeTab === 'documents') {
        fileInputRef.current?.focus();
      }
    }, 60);
    return () => clearTimeout(t);
  }, [open, activeTab]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleUrlSubmit = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    const urls = url.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    try {
      await Promise.all(urls.map(async (u) => {
        try {
          const res = await api.train(u, projectId);
          successCount++;
          return res;
        } catch (err) {
          failCount++;
          errors.push(`${u}: ${err.message}`);
        }
      }));
      
      setUrl('');
      
      if (failCount > 0) {
        setError(`Scraping complete with some issues:\n- Successfully indexed: ${successCount}\n- Failed: ${failCount}\n\nErrors:\n${errors.join('\n')}`);
      } else {
        setSuccessMsg(`✅ Successfully indexed all ${successCount} website links!`);
        if (onTrained) {
          onTrained({ status: 'Website links indexed successfully', urls_count: successCount });
        }
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileSubmit = async (e) => {
    e.preventDefault();
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await api.trainDocuments(files, projectId);
      onTrained(result);
      setFiles([]);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChatGPTSubmit = async (e) => {
    e.preventDefault();
    if (!chatgptFile) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await api.trainChatGPT(chatgptFile);
      setSuccessMsg(
        `✅ Indexed ${result.conversations_found} conversations (${result.chunks_indexed} chunks)`
      );
      onTrained(result);
      setChatgptFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files);
    const allowedTypes = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.rst', '.csv', '.xlsx', '.xls', '.json', '.zip'];
    const validFiles = newFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return allowedTypes.includes(ext);
    });
    if (validFiles.length !== newFiles.length) {
      setError('Some files were skipped. Supported formats: PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON, ZIP');
    }
    setFiles(prev => [...prev, ...validFiles]);
    e.target.value = ''; // Allow re-selecting same file
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const filesFromDrop = Array.from(e.dataTransfer.files);
    if (filesFromDrop.length === 0) return;
    
    const allowedTypes = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.rst', '.csv', '.xlsx', '.xls', '.json', '.zip'];
    const validFiles = filesFromDrop.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return allowedTypes.includes(ext);
    });
    
    if (validFiles.length !== filesFromDrop.length) {
      setError('Some files were skipped. Supported formats: PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON, ZIP');
    }
    
    setFiles(prev => [...prev, ...validFiles]);
  };

  const handleChatGPTFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!['.zip', '.json'].includes(ext)) {
      setError('Please upload a .zip or .json ChatGPT export file');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setChatgptFile(file);
    e.target.value = '';
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="train-modal-title"
      >
        <div className="modal-header">
          <h3 id="train-modal-title">Train on data</h3>
          <button
            className="icon-btn modal-close"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab navigation */}
        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === 'url' ? 'active' : ''}`}
            onClick={() => { setActiveTab('url'); setError(null); setSuccessMsg(null); }}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9c-2.52 0-4.93-.87-6.74-2.36l-1.01 1.01A11 11 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2a10 10 0 0 0-7.74 16.6" />
              <line x1="2" y1="22" x2="22" y2="2" />
            </svg>
            <span>Website URL</span>
          </button>
          <button
            className={`modal-tab ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => { setActiveTab('documents'); setError(null); setSuccessMsg(null); }}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <span>Documents</span>
          </button>
          <button
            className={`modal-tab ${activeTab === 'chatgpt' ? 'active' : ''}`}
            onClick={() => { setActiveTab('chatgpt'); setError(null); setSuccessMsg(null); }}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>ChatGPT Export</span>
          </button>
        </div>

        {activeTab === 'url' && (
          <>
            <p className="modal-desc">
              Paste one or more website URLs (separated by newlines or commas). We'll scrape them in parallel, chunk them, embed them, and store them locally.
            </p>
            <form onSubmit={handleUrlSubmit} className="modal-form" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <textarea
                ref={urlInputRef}
                placeholder="https://example.com/docs&#10;https://example.com/about&#10;(Enter one URL per line or separate by commas)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                disabled={loading}
                rows={4}
                style={{
                  width: '100%',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13.5px',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'var(--font)',
                  boxSizing: 'border-box'
                }}
              />
              <div className="form-row" style={{ justifyContent: 'flex-end', width: '100%' }}>
                <button type="submit" disabled={loading || !url.trim()}>
                  {loading ? 'Indexing Links…' : 'Train on Links'}
                </button>
              </div>
            </form>
          </>
        )}

        {activeTab === 'documents' && (
          <>
            <p className="modal-desc">
              Upload documents (PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON, ZIP). We'll extract text,
              chunk it, embed it, and store locally.
            </p>
            <form onSubmit={handleFileSubmit} className="modal-form">
              <div
                className={`file-drop-zone ${isDragging ? 'dragging' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.md,.markdown,.rst,.csv,.xlsx,.xls,.json,.zip"
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <p>{isDragging ? 'Drop files now!' : 'Click to browse or drop files here'}</p>
                <span className="file-hint">PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON, ZIP</span>
              </div>

              {files.length > 0 && (
                <div className="file-list">
                  {files.map((file, index) => (
                    <div key={index} className="file-item">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="file-name">{file.name}</span>
                      <span className="file-size">
                        {(file.size / 1024).toFixed(1)} KB
                      </span>
                      <button
                        type="button"
                        className="file-remove"
                        onClick={() => removeFile(index)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={loading || files.length === 0}
                >
                  {loading ? 'Indexing…' : 'Train on Documents'}
                </button>
              </div>
            </form>
          </>
        )}

        {activeTab === 'chatgpt' && (
          <>
            <p className="modal-desc">
              Upload your ChatGPT data export (<code>.zip</code> or <code>conversations.json</code>).
              We'll parse all conversations and index them for retrieval.
            </p>
            <div className="chatgpt-howto">
              <strong>How to export:</strong>
              <ol>
                <li>Go to <strong>ChatGPT → Settings → Data Controls</strong></li>
                <li>Click <strong>"Export Data"</strong></li>
                <li>Download the ZIP file from your email</li>
                <li>Upload it here</li>
              </ol>
            </div>
            <form onSubmit={handleChatGPTSubmit} className="modal-form">
              <div
                className="file-drop-zone"
                onClick={() => chatgptInputRef.current?.click()}
              >
                <input
                  ref={chatgptInputRef}
                  type="file"
                  accept=".zip,.json"
                  onChange={handleChatGPTFileChange}
                  style={{ display: 'none' }}
                />
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  <line x1="9" y1="10" x2="15" y2="10" />
                  <line x1="12" y1="7" x2="12" y2="13" />
                </svg>
                <p>Click to select your ChatGPT export file</p>
                <span className="file-hint">ZIP or JSON file</span>
              </div>

              {chatgptFile && (
                <div className="file-list">
                  <div className="file-item">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="file-name">{chatgptFile.name}</span>
                    <span className="file-size">
                      {(chatgptFile.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      className="file-remove"
                      onClick={() => setChatgptFile(null)}
                      aria-label="Remove file"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              <div className="form-row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  disabled={loading || !chatgptFile}
                >
                  {loading ? 'Parsing & Indexing…' : 'Train on ChatGPT Data'}
                </button>
              </div>
            </form>

            {successMsg && (
              <div className="success-msg">{successMsg}</div>
            )}
          </>
        )}

        {error && <div className="error">⚠️ {error}</div>}
      </div>
    </div>
  );
}

