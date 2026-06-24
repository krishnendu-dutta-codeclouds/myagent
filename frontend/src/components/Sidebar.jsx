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
  links = [],
  onDeleteLink,
  onOpenProfile,
  activeView = 'chat',
  onViewChange,
  activeProjectId = null,
  setActiveProjectId,
  projects = [],
}) {
  const activeProject = projects.find(p => p.id === activeProjectId);

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
        {/* Primary View Navigation */}
        <div className="primary-nav-group" style={{ padding: '12px 12px 6px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button
            className={`nav-view-btn ${activeView === 'chat' ? 'active' : ''}`}
            onClick={() => onViewChange('chat')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: activeView === 'chat' ? 'var(--bg-hover)' : 'transparent',
              color: activeView === 'chat' ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.2s, color 0.2s'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Chat Interface
          </button>
          
          <button
            className={`nav-view-btn ${activeView === 'projects' ? 'active' : ''}`}
            onClick={() => onViewChange('projects')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: activeView === 'projects' ? 'var(--bg-hover)' : 'transparent',
              color: activeView === 'projects' ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.2s, color 0.2s'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            Research Projects
          </button>

          <button
            className={`nav-view-btn ${activeView === 'lab' ? 'active' : ''}`}
            onClick={() => onViewChange('lab')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: activeView === 'lab' ? 'var(--bg-hover)' : 'transparent',
              color: activeView === 'lab' ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.2s, color 0.2s'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            AI Multimodal Lab
          </button>
        </div>

        {/* Active Project Scope Indicator */}
        {activeProjectId && activeProject && (
          <div className="sidebar-active-project" style={{
            padding: '10px 12px',
            margin: '6px 12px 12px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-active-project, rgba(79, 70, 229, 0.1))',
            border: '1px solid var(--border-active-project, rgba(79, 70, 229, 0.2))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            boxShadow: 'var(--shadow-sm)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={activeProject.name}>
                {activeProject.name}
              </span>
            </div>
            <button
              onClick={() => setActiveProjectId(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '50%',
                flexShrink: 0
              }}
              title="Exit project scope"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

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
      </div>

      <div className="sidebar-footer">
        <div className="user-row" onClick={onOpenProfile} title="Profile & Settings" role="button" tabIndex={0} style={{ cursor: 'pointer', width: '100%' }}>
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
