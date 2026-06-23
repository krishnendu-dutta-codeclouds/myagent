import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const REFUSAL =
  "I can only answer questions related to this website's products or services.";

const SUGGESTIONS = [
  'Summarize the products and services',
  'What are the pricing options?',
  'Who is the target audience?',
  'What are the key features?',
];

let msgIdCounter = 0;
const nextId = () => `m-${++msgIdCounter}`;

export default function ChatPanel({ conversation, onUpdate, onTrain }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const disabled = false;
  const isEmpty = conversation.messages.length === 0;

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation.messages, loading]);

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
    if (!question || loading || disabled) return;

    const userMsg = { id: nextId(), role: 'user', text: question };
    const baseMessages = [...conversation.messages, userMsg];
    onUpdate({
      messages: baseMessages,
      title:
        !conversation.title || conversation.title === 'New chat'
          ? question.slice(0, 50)
          : conversation.title,
    });
    setInput('');
    setLoading(true);

    try {
      const { answer } = await api.chat(question);
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
    <div className="chat-container">
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
        <form onSubmit={submit} className="input-form">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Train on a website to start chatting…'
                : 'Message Website Chat Agent…'
            }
            disabled={disabled || loading}
            rows={1}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={disabled || loading || !input.trim()}
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
            <div className="message-text">{message.text}</div>
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
      <h1 className="welcome-title">How can I help you today?</h1>
      <p className="welcome-sub" style={{ marginBottom: '16px' }}>
        Ask a general question, or train the agent with website URLs and files to search within them.
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
