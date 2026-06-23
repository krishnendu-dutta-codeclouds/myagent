import { useState } from 'react';

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onTrain,
  open,
  backendOk,
  documents = [],
  onDeleteDocument,
  onOpenProfile,
}) {
  return (
    <aside className={`sidebar ${open ? '' : 'closed'}`}>
      <div className="sidebar-header">
        <button
          className="new-chat-btn"
          onClick={onNew}
          title="New chat"
          aria-label="New chat"
        >
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
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <span>New chat</span>
        </button>
      </div>

      <div className="sidebar-middle" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Conversations Section */}
        <div className="sidebar-section conversations-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '150px' }}>
          <div className="sidebar-section-header" style={{ padding: '8px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Conversations
          </div>
          <nav className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', padding: '0 12px 8px 12px' }}>
            {conversations.length === 0 && (
              <p className="sidebar-empty">No chats yet</p>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`nav-item ${c.id === activeId ? 'active' : ''}`}
                onClick={() => onSelect(c.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(c.id);
                  }
                }}
              >
                <svg
                  className="nav-item-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span className="nav-item-title">{c.title || 'New chat'}</span>
                <button
                  className="nav-item-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  title="Delete chat"
                  aria-label="Delete chat"
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
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </svg>
                </button>
              </div>
            ))}
          </nav>
        </div>

        {/* Documents Section */}
        <div className="sidebar-section documents-section" style={{ height: '50%', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '150px' }}>
          <div className="sidebar-section-header" style={{ padding: '12px 16px 8px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Uploaded Documents</span>
            <span style={{ fontSize: '10px', background: 'var(--border)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-secondary)', fontWeight: 'bold' }}>
              {documents.length}
            </span>
          </div>
          <div className="sidebar-nav" style={{ flex: 1, overflowY: 'auto', padding: '0 12px 8px 12px' }}>
            {documents.length === 0 ? (
              <p className="sidebar-empty">No documents uploaded</p>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.filename}
                  className="nav-item"
                  style={{ cursor: 'default' }}
                >
                  <svg
                    className="nav-item-icon"
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
                  <span className="nav-item-title" title={doc.filename}>{doc.filename}</span>
                  <button
                    className="nav-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDocument(doc.filename);
                    }}
                    title="Delete document"
                    aria-label="Delete document"
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
                      <path d="M3 6h18" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <button
          className="footer-btn"
          onClick={onTrain}
          title="Train on a website"
        >
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <span>Train on website</span>
        </button>
        <div className="user-row" onClick={onOpenProfile} title="Profile & Settings" role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
          <div className="user-avatar-small">U</div>
          <div className="user-info">
            <div className="user-name">You</div>
            <div className="user-status">
              <span className={`status-dot ${backendOk ? 'ok' : 'bad'}`} />
              {backendOk === null && 'Checking…'}
              {backendOk === true && 'Backend ready'}
              {backendOk === false && 'Backend offline'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
