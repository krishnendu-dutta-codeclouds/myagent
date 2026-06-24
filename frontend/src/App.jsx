import { useEffect, useState } from 'react';
import { api } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import TrainModal from './components/TrainModal.jsx';
import ProfileModal from './components/ProfileModal.jsx';
import ModelSwitcher from './components/ModelSwitcher.jsx';
import MultimodalLab from './components/MultimodalLab.jsx';
import ResearchProjects from './components/ResearchProjects.jsx';

const STORAGE_KEY = 'wca.state.v1';
const THEME_KEY = 'wca.theme';

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  if (
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function createNewConv() {
  return {
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`,
    title: 'New chat',
    messages: [],
    indexedUrl: null,
    chunkCount: null,
    createdAt: Date.now(),
  };
}

function loadState() {
  const fresh = createNewConv();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.conversations?.length) {
        const active = parsed.conversations.find(
          (c) => c.id === parsed.activeId
        )
          ? parsed.activeId
          : parsed.conversations[0].id;
        return { conversations: parsed.conversations, activeId: active };
      }
    }
  } catch {
    /* ignore */
  }
  return { conversations: [fresh], activeId: fresh.id };
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function App() {
  const initial = loadState();
  const [conversations, setConversations] = useState(initial.conversations);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [activeView, setActiveView] = useState('chat');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [trainModalOpen, setTrainModalOpen] = useState(false);
  const [trainModalTab, setTrainModalTab] = useState('url');

  const openTrainModal = (tab = 'url') => {
    setTrainModalTab(tab);
    setTrainModalOpen(true);
  };
  const [backendOk, setBackendOk] = useState(null);
  const [theme, setTheme] = useState(getInitialTheme);
  const [documents, setDocuments] = useState([]);
  const [links, setLinks] = useState([]);
  const [activeModel, setActiveModel] = useState('');

  // Projects State
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);

  const fetchProjects = async () => {
    try {
      const projs = await api.getProjects();
      setProjects(projs);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  };

  const fetchDocuments = async () => {
    try {
      const docs = await api.getDocuments(activeProjectId);
      setDocuments(docs);
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    }
  };

  const fetchLinks = async () => {
    try {
      const lks = await api.getLinks(activeProjectId);
      setLinks(lks);
    } catch (err) {
      console.error('Failed to fetch links:', err);
    }
  };

  // Sync documents and links when active project ID changes
  useEffect(() => {
    if (backendOk === true) {
      fetchDocuments();
      fetchLinks();
    } else {
      setDocuments([]);
      setLinks([]);
    }
  }, [activeProjectId, backendOk]);

  // Sync projects and model config on backend ready
  useEffect(() => {
    if (backendOk === true) {
      fetchProjects();
      api.getModelConfig()
        .then((cfg) => setActiveModel(cfg.model || ''))
        .catch(() => {});
    }
  }, [backendOk]);


  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ conversations, activeId })
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, [conversations, activeId]);

  useEffect(() => {
    api
      .health()
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  const activeConv =
    conversations.find((c) => c.id === activeId) || conversations[0];

  const updateConv = (id, updates) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const newChat = () => {
    const conv = createNewConv();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  };

  const branchChat = (parentMessageId, messages) => {
    const msgIdx = messages.findIndex((m) => m.id === parentMessageId);
    if (msgIdx < 0) return;
    
    // Slice and deep clone messages
    const branchedMessages = JSON.parse(JSON.stringify(messages.slice(0, msgIdx + 1)));
    
    // Find the first user message text to set as the title
    const firstUserMsg = branchedMessages.find((m) => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.text.slice(0, 50) : 'Branched chat';
    
    const newConv = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      title: title,
      messages: branchedMessages,
      indexedUrl: activeConv?.indexedUrl || null,
      chunkCount: activeConv?.chunkCount || null,
      createdAt: Date.now()
    };
    
    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newConv.id);
    setActiveView('chat');
  };

  const deleteConv = (id) => {
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (filtered.length === 0) {
        const fresh = createNewConv();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });
  };

  const handleDeleteDocument = async (filename) => {
    try {
      await api.deleteDocument(filename);
      fetchDocuments();
    } catch (err) {
      alert(`Failed to delete document: ${err.message}`);
    }
  };

  const handleDeleteLink = async (url) => {
    try {
      await api.deleteLink(url);
      fetchLinks();
    } catch (err) {
      alert(`Failed to delete link: ${err.message}`);
    }
  };

  const [profileModalOpen, setProfileModalOpen] = useState(false);

  const handleClearAll = async () => {
    // Reset React state
    const fresh = createNewConv();
    setConversations([fresh]);
    setActiveId(fresh.id);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    setDocuments([]);
    setLinks([]);
  };

  const handleTrained = (result) => {
    if (result.files_processed) {
      fetchDocuments();
    } else {
      fetchLinks();
      updateConv(activeId, {
        indexedUrl: result.url,
        chunkCount: result.chunks_indexed,
      });
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setActiveView('chat'); }}
        onNew={() => { newChat(); setActiveView('chat'); }}
        onDelete={deleteConv}
        onTrain={() => openTrainModal('url')}
        open={sidebarOpen}
        backendOk={backendOk}
        documents={documents}
        onDeleteDocument={handleDeleteDocument}
        links={links}
        onDeleteLink={handleDeleteLink}
        onOpenProfile={() => setProfileModalOpen(true)}
        activeView={activeView}
        onViewChange={setActiveView}
        activeProjectId={activeProjectId}
        setActiveProjectId={setActiveProjectId}
        projects={projects}
      />
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <main className="main">
        <header className="topbar">
          <button
            className="icon-btn topbar-toggle"
            onClick={() => setSidebarOpen((s) => !s)}
            title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={sidebarOpen}
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
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="topbar-title">
            <span className={`model-dot ${backendOk ? 'ok' : 'bad'}`} />
            <span>Agent UXKD</span>
            {activeProjectId && projects.find(p => p.id === activeProjectId) && (
              <span className="project-badge" style={{
                marginLeft: '8px',
                background: 'var(--bg-active-project, rgba(79, 70, 229, 0.1))',
                color: 'var(--accent)',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid var(--border-active-project, rgba(79, 70, 229, 0.2))'
              }}>
                Scope: {projects.find(p => p.id === activeProjectId).name}
              </span>
            )}
            {activeConv?.indexedUrl && (
              <span className="model-url">
                · {hostnameOf(activeConv.indexedUrl)}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            <ModelSwitcher
              activeModel={activeModel}
              setActiveModel={setActiveModel}
              backendOk={backendOk}
            />
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              title={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
              aria-label={
                theme === 'dark'
                  ? 'Switch to light mode'
                  : 'Switch to dark mode'
              }
            >
              <svg
                className="sun"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="4" />
                <line x1="12" y1="2" x2="12" y2="4" />
                <line x1="12" y1="20" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
                <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="4" y2="12" />
                <line x1="20" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
                <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
              </svg>
              <svg
                className="moon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            </button>
            {backendOk === false && (
              <span className="topbar-warning">Backend offline</span>
            )}
          </div>
        </header>
        {activeView === 'chat' && (
          <ChatPanel
            key={activeConv.id}
            conversation={activeConv}
            onUpdate={(updates) => updateConv(activeConv.id, updates)}
            onTrain={openTrainModal}
            onModelChanged={setActiveModel}
            activeProjectId={activeProjectId}
            setActiveProjectId={setActiveProjectId}
            projects={projects}
            onBranchChat={branchChat}
          />
        )}
        {activeView === 'projects' && (
          <ResearchProjects
            activeProjectId={activeProjectId}
            setActiveProjectId={setActiveProjectId}
            onViewChange={setActiveView}
            backendOk={backendOk}
          />
        )}
        {activeView === 'lab' && (
          <MultimodalLab />
        )}
      </main>
      <TrainModal
        open={trainModalOpen}
        onClose={() => setTrainModalOpen(false)}
        onTrained={handleTrained}
        initialTab={trainModalTab}
        projectId={activeProjectId}
      />
      <ProfileModal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        conversations={conversations}
        backendOk={backendOk}
        onClearAll={handleClearAll}
      />
    </div>
  );
}
