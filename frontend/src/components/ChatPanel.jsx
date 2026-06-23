import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import MarkdownRenderer from './MarkdownRenderer.jsx';

const REFUSAL =
  "The model returned an empty response. Please try again or switch to a different model.";

const SUGGESTIONS = [
  'Create an HTML/CSS landing page design',
  'Explain how React Context works',
  'Research modern UI/UX trends',
  'Write a Node.js API with Express',
];

let msgIdCounter = 0;
const nextId = () => `m-${++msgIdCounter}`;

export default function ChatPanel({ conversation, onUpdate, onTrain, onModelChanged }) {
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const disabled = false;
  const isEmpty = conversation.messages.length === 0;

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const isImage = file.type.startsWith('image/');

    if (isImage) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({
          name: file.name,
          base64: reader.result,
        });
      };
      reader.readAsDataURL(file);
      setAttachedDoc(null);
    } else {
      setSelectedImage(null);
      setAttachedDoc({
        name: file.name,
        text: '',
        loading: true,
      });
      try {
        const result = await api.parseFile(file);
        setAttachedDoc({
          name: file.name,
          text: result.text,
          loading: false,
        });
      } catch (err) {
        alert(`Failed to parse document: ${err.message}`);
        setAttachedDoc(null);
      }
    }
    e.target.value = '';
  };

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation.messages, loading]);

  // Auto-focus the textarea when switching conversations (e.g., clicking New Chat)
  useEffect(() => {
    if (textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 10);
    }
  }, [conversation.id]);

  const handlePanelClick = (e) => {
    if (window.getSelection()?.toString()) return;
    const target = e.target;
    if (
      target.closest?.('button') ||
      target.closest?.('a') ||
      target.closest?.('textarea') ||
      target.closest?.('input') ||
      target.closest?.('.message-text') ||
      target.closest?.('.welcome-actions')
    ) {
      return;
    }
    textareaRef.current?.focus();
  };

  // Auto-resize textarea.
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const submit = async (e) => {
    e?.preventDefault();
    const question = input.trim();
    if ((!question && !selectedImage && !attachedDoc) || loading || disabled) return;

    const userMsg = {
      id: nextId(),
      role: 'user',
      text: question,
      image: selectedImage?.base64 || null,
      docName: attachedDoc?.name || null,
    };
    const baseMessages = [...conversation.messages, userMsg];
    onUpdate({
      messages: baseMessages,
      title:
        (!conversation.title || conversation.title === 'New chat') && question
          ? question.slice(0, 50)
          : conversation.title,
    });
    
    const cleanImage = selectedImage ? selectedImage.base64.split(',')[1] : null;
    const docText = attachedDoc ? attachedDoc.text : null;
    const docName = attachedDoc ? attachedDoc.name : null;

    setSelectedImage(null);
    setAttachedDoc(null);
    setInput('');
    setLoading(true);

    try {
      const { answer, active_model } = await api.chat(
        question,
        cleanImage ? [cleanImage] : [],
        docText,
        docName
      );
      if (active_model && onModelChanged) {
        onModelChanged(active_model);
      }
      const botMsg = {
        id: nextId(),
        role: 'bot',
        text: (answer || '').trim() || REFUSAL,
      };
      onUpdate({ messages: [...baseMessages, botMsg] });
    } catch (err) {
      const botMsg = {
        id: nextId(),
        role: 'bot',
        text: `⚠️ ${err.message}`,
      };
      onUpdate({ messages: [...baseMessages, botMsg] });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-container" onClick={handlePanelClick}>
      <div className="chat-scroll" ref={scrollRef}>
        {isEmpty ? (
          <WelcomeScreen
            disabled={disabled}
            onPromptClick={setInput}
            onTrain={onTrain}
          />
        ) : (
          <div className="messages">
            {conversation.messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {loading && <Message key="loading" loading />}
          </div>
        )}
      </div>

      <div className="input-area">
        {(selectedImage || attachedDoc) && (
          <div className="preview-wrapper">
            {selectedImage && (
              <div className="image-preview-bar">
                <img src={selectedImage.base64} alt="Upload preview" className="image-preview-thumb" />
                <span className="image-preview-name">{selectedImage.name}</span>
                <button className="image-preview-clear" onClick={() => setSelectedImage(null)} title="Remove image">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
            {attachedDoc && (
              <div className="image-preview-bar">
                {attachedDoc.loading ? (
                  <div className="typing" style={{ padding: '0 4px', marginRight: '8px', display: 'flex', alignItems: 'center' }}>
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                <span className="image-preview-name">
                  {attachedDoc.loading ? `Parsing ${attachedDoc.name}...` : attachedDoc.name}
                </span>
                {!attachedDoc.loading && (
                  <button className="image-preview-clear" onClick={() => setAttachedDoc(null)} title="Remove document">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <form onSubmit={submit} className="input-form">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Train on a website to start chatting…'
                : 'Message Agent UXKD…'
            }
            disabled={disabled || loading}
            rows={1}
          />
          <div className="input-actions-group">
            <label className="attach-btn" title="Attach file">
              <input
                type="file"
                accept="image/*,.pdf,.docx,.doc,.txt,.md,.json,.js,.css,.html,.xml,.py,.c,.cpp,.h,.java,.go,.rs,.sh"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                disabled={disabled || loading}
              />
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </label>
            <button
              type="submit"
              className="send-btn"
              disabled={disabled || loading || attachedDoc?.loading || (!input.trim() && !selectedImage && !attachedDoc)}
              title="Send"
              aria-label="Send"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </form>
        <p className="input-disclaimer">
          AI-generated responses may contain inaccuracies. Verify important
          info.
        </p>
      </div>
    </div>
  );
}

function Message({ message, loading }) {
  const isUser = !loading && message.role === 'user';
  return (
    <div className={`message ${isUser ? 'user' : 'bot'}`}>
      <div className="message-row">
        {!isUser && (
          <div className="message-avatar">
            <div className="avatar bot-avatar" aria-hidden>
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
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
          </div>
        )}
        <div className="message-content">
          {loading ? (
            <div className="typing" aria-label="Assistant is typing">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <div className="message-text">
              {message.image && (
                <div className="message-image-container">
                  <img src={message.image} alt="User attachment" className="message-image" />
                </div>
              )}
              {message.docName && (
                <div className="message-doc-badge">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>{message.docName}</span>
                </div>
              )}
              {isUser ? message.text : <MarkdownRenderer text={message.text} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WelcomeScreen({ disabled, onPromptClick, onTrain }) {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <svg
          width="56"
          height="56"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <h1 className="welcome-title">I'm your Coding & Design Assistant</h1>
      <p className="welcome-sub" style={{ marginBottom: '16px' }}>
        Ready to help with code generation, UI/UX design, and JS frameworks.
      </p>
      
      <div className="welcome-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '24px', flexWrap: 'wrap' }}>
        <button className="welcome-cta" onClick={() => onTrain('url')} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'none' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span>Train on Website</span>
        </button>
        <button className="welcome-cta" onClick={() => onTrain('documents')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Upload Documents</span>
        </button>
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            className="suggestion"
            onClick={() => onPromptClick(s)}
          >
            <span className="suggestion-text">{s}</span>
            <svg
              className="suggestion-arrow"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
