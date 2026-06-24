import { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function ResearchProjects({
  activeProjectId,
  setActiveProjectId,
  onViewChange,
  backendOk,
}) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [projectDesc, setProjectDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Scoped project items
  const [projectDocs, setProjectDocs] = useState([]);
  const [projectLinks, setProjectLinks] = useState([]);
  
  // Form states
  const [urlToTrain, setUrlToTrain] = useState('');
  const [trainingUrl, setTrainingUrl] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (backendOk) {
      fetchProjects();
    }
  }, [backendOk]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectItems(selectedProjectId);
    }
  }, [selectedProjectId]);

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const data = await api.getProjects();
      setProjects(data);
      setError(null);
    } catch (err) {
      setError('Failed to load projects: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchProjectItems = async (projectId) => {
    try {
      const docs = await api.getDocuments(projectId);
      const links = await api.getLinks(projectId);
      setProjectDocs(docs);
      setProjectLinks(links);
    } catch (err) {
      console.error('Failed to fetch project items:', err);
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    setLoading(true);
    try {
      const newProj = await api.createProject(projectName, projectDesc);
      setProjects((prev) => [...prev, newProj]);
      setProjectName('');
      setProjectDesc('');
      setSelectedProjectId(newProj.id); // Open it immediately
    } catch (err) {
      setError('Failed to create project: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProject = async (projectId, e) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this project? All associated uploaded documents and links will be permanently removed.')) {
      return;
    }
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
      }
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    } catch (err) {
      alert('Failed to delete project: ' + err.message);
    }
  };

  const uploadFilesList = async (files) => {
    if (files.length === 0) return;
    setUploadingFiles(true);
    try {
      await api.trainDocuments(files, selectedProjectId);
      await fetchProjectItems(selectedProjectId);
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleUploadFiles = async (e) => {
    const files = Array.from(e.target.files);
    await uploadFilesList(files);
    e.target.value = ''; // Reset input
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

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    
    // Filter by supported extensions
    const allowedTypes = ['.pdf', '.docx', '.txt', '.md', '.markdown', '.rst', '.csv', '.xlsx', '.xls', '.json', '.zip'];
    const validFiles = files.filter(file => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      return allowedTypes.includes(ext);
    });
    
    if (validFiles.length !== files.length) {
      alert('Some files were skipped. Supported formats: PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON, ZIP');
    }
    
    if (validFiles.length > 0) {
      await uploadFilesList(validFiles);
    }
  };

  const handleTrainWebsite = async (e) => {
    e.preventDefault();
    if (!urlToTrain.trim()) return;
    const urls = urlToTrain.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return;
    
    setTrainingUrl(true);
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    try {
      // Index multiple URLs in parallel
      await Promise.all(urls.map(async (url) => {
        try {
          await api.train(url, selectedProjectId);
          successCount++;
        } catch (err) {
          failCount++;
          errors.push(`${url}: ${err.message}`);
        }
      }));
      
      setUrlToTrain('');
      await fetchProjectItems(selectedProjectId);
      
      if (failCount > 0) {
        alert(`Scraping complete with some issues:\n- Successfully indexed: ${successCount}\n- Failed: ${failCount}\n\nErrors:\n${errors.join('\n')}`);
      } else {
        alert(`Successfully indexed all ${successCount} website links!`);
      }
    } catch (err) {
      alert('Web scraping failed: ' + err.message);
    } finally {
      setTrainingUrl(false);
    }
  };

  const handleDeleteDoc = async (filename) => {
    try {
      await api.deleteDocument(filename);
      await fetchProjectItems(selectedProjectId);
    } catch (err) {
      alert('Failed to delete document: ' + err.message);
    }
  };

  const handleDeleteLink = async (url) => {
    try {
      await api.deleteLink(url);
      await fetchProjectItems(selectedProjectId);
    } catch (err) {
      alert('Failed to delete link: ' + err.message);
    }
  };

  const startProjectChat = (projectId) => {
    setActiveProjectId(projectId);
    onViewChange('chat');
  };

  const activeProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="projects-container">
      {selectedProjectId && activeProject ? (
        // Project Detail View
        <div className="project-detail-view">
          <div className="project-detail-header">
            <button className="back-btn" onClick={() => setSelectedProjectId(null)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              Back to Projects
            </button>
            <div className="project-actions-row">
              <button
                className={`btn btn-primary start-chat-btn ${activeProjectId === selectedProjectId ? 'active' : ''}`}
                onClick={() => startProjectChat(selectedProjectId)}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                {activeProjectId === selectedProjectId ? 'Active Scoped Chat' : 'Start Scoped Chat'}
              </button>
              <button
                className="btn btn-danger-outline"
                onClick={(e) => handleDeleteProject(selectedProjectId, e)}
              >
                Delete Project
              </button>
            </div>
          </div>

          <div className="project-meta-card">
            <div className="project-folder-badge">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
            </div>
            <div className="project-meta-info">
              <h1>{activeProject.name}</h1>
              <p className="project-desc">{activeProject.description || 'No description provided.'}</p>
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="project-grid">
            {/* Upload Block */}
            <div className="project-card upload-section-card">
              <h3>Upload & Index Documents</h3>
              <p className="card-subtitle">Supported formats: PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON, ZIP. Select or drag-and-drop multiple files to train your project space.</p>
              
              <div
                className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragEnter={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  multiple
                  id="project-file-upload"
                  accept=".pdf,.docx,.txt,.md,.markdown,.rst,.csv,.xlsx,.xls,.json,.zip"
                  onChange={handleUploadFiles}
                  disabled={uploadingFiles}
                  style={{ display: 'none' }}
                />
                <label htmlFor="project-file-upload" className="dropzone-label">
                  {uploadingFiles ? (
                    <div className="spinner-small"></div>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="17 8 12 3 7 8"></polyline>
                      <line x1="12" y1="3" x2="12" y2="15"></line>
                    </svg>
                  )}
                  <span>{uploadingFiles ? 'Uploading & Indexing...' : (isDragging ? 'Drop files now!' : 'Click to select or drag files here')}</span>
                </label>
              </div>

              <div className="web-scraping-box" style={{ marginTop: '24px' }}>
                <h4>Index Website Links</h4>
                <form onSubmit={handleTrainWebsite} className="scraping-form" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <textarea
                    placeholder="https://example.com/docs&#10;https://example.com/about&#10;(Enter one URL per line or separate by commas)"
                    value={urlToTrain}
                    onChange={(e) => setUrlToTrain(e.target.value)}
                    required
                    disabled={trainingUrl}
                    rows={3}
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
                  <button type="submit" className="btn btn-secondary" style={{ alignSelf: 'flex-end' }} disabled={trainingUrl}>
                    {trainingUrl ? 'Scraping Links...' : 'Index Website Links'}
                  </button>
                </form>
              </div>
            </div>

            {/* Project Content / Files List */}
            <div className="project-card content-list-card">
              <h3>Project Knowledge Base</h3>
              
              <div className="knowledge-tabs">
                <div className="knowledge-section">
                  <h4>Documents ({projectDocs.length})</h4>
                  {projectDocs.length === 0 ? (
                    <p className="empty-list-text">No documents in this project.</p>
                  ) : (
                    <div className="items-list">
                      {projectDocs.map((doc) => (
                        <div key={doc.filename} className="knowledge-item">
                          <div className="item-details">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            <span className="item-name" title={doc.filename}>{doc.filename}</span>
                          </div>
                          <button className="delete-item-btn" onClick={() => handleDeleteDoc(doc.filename)} title="Delete document">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="knowledge-section" style={{ marginTop: '20px' }}>
                  <h4>Links ({projectLinks.length})</h4>
                  {projectLinks.length === 0 ? (
                    <p className="empty-list-text">No links indexed in this project.</p>
                  ) : (
                    <div className="items-list">
                      {projectLinks.map((link) => (
                        <div key={link.url} className="knowledge-item">
                          <div className="item-details">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                            <span className="item-name text-truncate" title={link.url}>{link.url}</span>
                          </div>
                          <button className="delete-item-btn" onClick={() => handleDeleteLink(link.url)} title="Delete link">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // Projects List View
        <div className="projects-list-view">
          <div className="projects-list-header">
            <div>
              <h1>Research Project Spaces</h1>
              <p className="subtitle">Create isolated workspace folders to upload documents/links and run focused AI research. General Chat is unrestricted.</p>
            </div>
            {activeProjectId && (
              <button className="btn btn-secondary-outline" onClick={() => setActiveProjectId(null)}>
                Clear Active Project Scope
              </button>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="projects-grid-layout">
            {/* Create Project Card */}
            <div className="project-card create-project-card">
              <h3>Create New Project Space</h3>
              <form onSubmit={handleCreateProject} className="create-project-form">
                <div className="form-group">
                  <label htmlFor="proj-name">Project Name</label>
                  <input
                    type="text"
                    id="proj-name"
                    placeholder="e.g., Q3 Competitor Analysis"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="proj-desc">Description</label>
                  <textarea
                    id="proj-desc"
                    placeholder="Brief description of the research scope..."
                    value={projectDesc}
                    onChange={(e) => setProjectDesc(e.target.value)}
                    rows={3}
                  />
                </div>
                <button type="submit" className="btn btn-primary w-100" disabled={loading}>
                  {loading ? 'Creating...' : 'Create & Open Project'}
                </button>
              </form>
            </div>

            {/* List of projects */}
            {loading && projects.length === 0 ? (
              <div className="loading-projects">
                <div className="spinner"></div>
                <p>Loading your project spaces...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="project-card empty-projects-card">
                <div className="empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <h3>No Projects Yet</h3>
                <p>Create your first project space to upload documents/links and start scoped research.</p>
              </div>
            ) : (
              projects.map((proj) => (
                <div
                  key={proj.id}
                  className={`project-card project-item-card ${activeProjectId === proj.id ? 'active' : ''}`}
                  onClick={() => setSelectedProjectId(proj.id)}
                >
                  <div className="project-card-header">
                    <div className="project-folder-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      </svg>
                    </div>
                    {activeProjectId === proj.id && (
                      <span className="active-scope-badge">Active Scope</span>
                    )}
                  </div>
                  <div className="project-card-body">
                    <h3>{proj.name}</h3>
                    <p>{proj.description || 'No description provided.'}</p>
                  </div>
                  <div className="project-card-footer" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-secondary-outline btn-sm" onClick={() => startProjectChat(proj.id)}>
                      Open Scoped Chat
                    </button>
                    <button className="delete-proj-btn" onClick={(e) => handleDeleteProject(proj.id, e)} title="Delete project">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
