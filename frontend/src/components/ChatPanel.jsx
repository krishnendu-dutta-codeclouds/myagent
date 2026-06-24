import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import MarkdownRenderer from './MarkdownRenderer.jsx';
import JSZip from 'jszip';

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

export default function ChatPanel({
  conversation,
  onUpdate,
  onTrain,
  onModelChanged,
  activeProjectId = null,
  setActiveProjectId,
  projects = [],
  onBranchChat,
}) {
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [attachedDoc, setAttachedDoc] = useState(null);
  const [loading, setLoading] = useState(false);

  // Upgrade States: RAG Mode selector, Creators menu, and Audio Recorder
  const [ragMode, setRagMode] = useState('hybrid');
  const [showCreatorMenu, setShowCreatorMenu] = useState(false);
  const [selectedCreatorMode, setSelectedCreatorMode] = useState(null); // 'image' | 'video' | 'audio' | null
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [transcribing, setTranscribing] = useState(false);

  // Locked model state
  const [lockedModel, setLockedModel] = useState(() => {
    try {
      return localStorage.getItem('lockedModel') || null;
    } catch {
      return null;
    }
  });

  // Feedback: per-message like/dislike/retry state
  const [feedbackMap, setFeedbackMap] = useState({});
  const [retryingId, setRetryingId] = useState(null);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // Upgrade Refs: Recorder, timing intervals, and creator menu container
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const creatorMenuRef = useRef(null);

  // Close creators dropdown menu when clicking outside of it
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (creatorMenuRef.current && !creatorMenuRef.current.contains(e.target)) {
        setShowCreatorMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

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
      target.closest?.('.welcome-actions') ||
      target.closest?.('.cinematic-controls') ||
      target.closest?.('.frame-dots') ||
      target.closest?.('.rag-selector-container') ||
      target.closest?.('.creator-dropdown')
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

  // Voice recording helpers (Whisper STT integration)
  const formatDuration = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      let recorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      } catch (e) {
        recorder = new MediaRecorder(stream);
      }
      
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/wav' });
        const file = new File([audioBlob], 'mic_input.wav', { type: audioBlob.type });
        
        setTranscribing(true);
        try {
          const res = await api.transcribeAudio(file);
          if (res.text && res.text.trim()) {
            setInput((prev) => {
              const cleanPrev = prev.trim();
              return cleanPrev ? `${cleanPrev} ${res.text.trim()}` : res.text.trim();
            });
          }
        } catch (err) {
          alert(`Voice transcription failed: ${err.message}`);
        } finally {
          setTranscribing(false);
        }
      };
      
      recorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);
      
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
      
    } catch (err) {
      alert(`Failed to access microphone: ${err.message}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // Media generation helpers (FLUX.1 Image and Cinematic Storyboard Video)
  const triggerImageGeneration = async (promptText) => {
    if (!promptText || loading) return;
    setShowCreatorMenu(false);
    
    const userMsg = {
      id: nextId(),
      role: 'user',
      text: `🪄 Generate Image: "${promptText}"`,
    };
    
    const tempBotId = nextId();
    const botLoadingMsg = {
      id: tempBotId,
      role: 'bot',
      loading: true,
      loadingText: 'Generating image from prompt...',
    };
    
    const baseMessages = [...conversation.messages, userMsg];
    onUpdate({
      messages: [...baseMessages, botLoadingMsg],
    });
    
    setInput('');
    setLoading(true);
    
    try {
      const res = await api.generateImage(promptText);
      const finalBotMsg = {
        id: tempBotId,
        role: 'bot',
        text: `Here is your generated image for prompt: *"${promptText}"*`,
        generatedImage: res.image_uri,
      };
      onUpdate({
        messages: [...baseMessages, finalBotMsg],
      });
    } catch (err) {
      const errorBotMsg = {
        id: tempBotId,
        role: 'bot',
        text: `⚠️ Failed to generate image: ${err.message}`,
      };
      onUpdate({
        messages: [...baseMessages, errorBotMsg],
      });
    } finally {
      setLoading(false);
    }
  };

  const triggerVideoGeneration = async (promptText) => {
    if (!promptText || loading) return;
    setShowCreatorMenu(false);
    
    const userMsg = {
      id: nextId(),
      role: 'user',
      text: `🎬 Generate Video: "${promptText}"`,
    };
    
    const tempBotId = nextId();
    const botLoadingMsg = {
      id: tempBotId,
      role: 'bot',
      loading: true,
      loadingText: 'Rendering cinematic storyboards on Hugging Face...',
    };
    
    const baseMessages = [...conversation.messages, userMsg];
    onUpdate({
      messages: [...baseMessages, botLoadingMsg],
    });
    
    setInput('');
    setLoading(true);
    
    try {
      const res = await api.generateVideo(promptText);
      const finalBotMsg = {
        id: tempBotId,
        role: 'bot',
        text: `Here is your generated cinematic video sequence for prompt: *"${promptText}"*`,
        generatedVideo: res,
      };
      onUpdate({
        messages: [...baseMessages, finalBotMsg],
      });
    } catch (err) {
      const errorBotMsg = {
        id: tempBotId,
        role: 'bot',
        text: `⚠️ Failed to generate video: ${err.message}`,
      };
      onUpdate({
        messages: [...baseMessages, errorBotMsg],
      });
    } finally {
      setLoading(false);
    }
  };

  const triggerAudioGeneration = async (promptText) => {
    if (!promptText || loading) return;
    setShowCreatorMenu(false);
    
    const userMsg = {
      id: nextId(),
      role: 'user',
      text: `🔊 Generate Audio: "${promptText}"`,
    };
    
    const tempBotId = nextId();
    const botLoadingMsg = {
      id: tempBotId,
      role: 'bot',
      loading: true,
      loadingText: 'Synthesizing voice audio from prompt...',
    };
    
    const baseMessages = [...conversation.messages, userMsg];
    onUpdate({
      messages: [...baseMessages, botLoadingMsg],
    });
    
    setInput('');
    setLoading(true);
    
    // Simulate a brief generation delay (1200ms) to feel like a real model call
    setTimeout(() => {
      const finalBotMsg = {
        id: tempBotId,
        role: 'bot',
        text: `Here is your generated audio speech for prompt: *"${promptText}"*`,
        generatedAudio: {
          text: promptText,
          voice: 'AI Assistant',
        },
      };
      onUpdate({
        messages: [...baseMessages, finalBotMsg],
      });
      setLoading(false);
    }, 1200);
  };

  const handleSelectCreator = (mode) => {
    setSelectedCreatorMode(mode);
    setShowCreatorMenu(false);
  };

  // ---- Feedback Handlers (Retry / Like / Dislike) ----
  const MAX_ATTEMPTS = 3;

  const findPrecedingUserMessage = (botMsgId) => {
    const msgs = conversation.messages;
    const botIdx = msgs.findIndex((m) => m.id === botMsgId);
    if (botIdx <= 0) return null;
    for (let i = botIdx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') return msgs[i];
    }
    return null;
  };

  const handleRetry = async (botMsgId) => {
    const msgs = conversation.messages;
    const botIdx = msgs.findIndex((m) => m.id === botMsgId);
    if (botIdx < 0) return;
    const botMsg = msgs[botIdx];
    const currentAttempt = botMsg.attempt || 1;
    if (currentAttempt >= MAX_ATTEMPTS || loading || retryingId) return;

    const userMsg = findPrecedingUserMessage(botMsgId);
    if (!userMsg) return;

    setRetryingId(botMsgId);

    const isImageGen = userMsg.text?.startsWith('\u{1FA84} Generate Image:');
    const isVideoGen = userMsg.text?.startsWith('\uD83C\uDFAC Generate Video:');
    const isAudioGen = userMsg.text?.startsWith('\uD83D\uDD0A Generate Audio:');

    const extractPrompt = (text) => {
      const match = text?.match(/["\u201C](.+?)["\u201D]/);
      return match ? match[1] : text?.replace(/^[^:]+:\s*/, '').trim();
    };

    const nextAttempt = currentAttempt + 1;

    const updatedMessages = [...msgs];
    updatedMessages[botIdx] = {
      ...botMsg,
      loading: true,
      loadingText: `Retrying (attempt ${nextAttempt}/${MAX_ATTEMPTS})...`,
    };
    onUpdate({ messages: updatedMessages });

    try {
      if (isImageGen) {
        const prompt = extractPrompt(userMsg.text);
        const res = await api.generateImage(prompt);
        const newBotMsg = {
          id: botMsgId, role: 'bot',
          text: `Here is your generated image for prompt: *“${prompt}”*`,
          generatedImage: res.image_uri,
          attempt: nextAttempt, maxAttempts: MAX_ATTEMPTS,
        };
        const finalMessages = [...msgs];
        finalMessages[botIdx] = newBotMsg;
        onUpdate({ messages: finalMessages });
      } else if (isVideoGen) {
        const prompt = extractPrompt(userMsg.text);
        const res = await api.generateVideo(prompt);
        const newBotMsg = {
          id: botMsgId, role: 'bot',
          text: `Here is your generated cinematic video sequence for prompt: *“${prompt}”*`,
          generatedVideo: res,
          attempt: nextAttempt, maxAttempts: MAX_ATTEMPTS,
        };
        const finalMessages = [...msgs];
        finalMessages[botIdx] = newBotMsg;
        onUpdate({ messages: finalMessages });
      } else if (isAudioGen) {
        const prompt = extractPrompt(userMsg.text);
        const newBotMsg = {
          id: botMsgId, role: 'bot',
          text: `Here is your generated audio speech for prompt: *“${prompt}”*`,
          generatedAudio: { text: prompt, voice: 'AI Assistant' },
          attempt: nextAttempt, maxAttempts: MAX_ATTEMPTS,
        };
        const finalMessages = [...msgs];
        finalMessages[botIdx] = newBotMsg;
        onUpdate({ messages: finalMessages });
      } else {
        const targetBotMsg = {
          id: botMsgId,
          role: 'bot',
          text: '',
          sources: [],
          attempt: nextAttempt,
          maxAttempts: MAX_ATTEMPTS,
          loading: false,
        };

        let accumulatedText = '';
        await api.chatStream(
          userMsg.text,
          [],
          null,
          null,
          ragMode,
          activeProjectId,
          (chunk) => {
            if (chunk.type === 'metadata') {
              const { active_model, sources, thinking, generated_image, generated_video, generated_audio } = chunk;
              if (active_model && onModelChanged) onModelChanged(active_model);
              targetBotMsg.sources = sources || [];
              targetBotMsg.generatedImage = generated_image || null;
              targetBotMsg.generatedVideo = generated_video || null;
              targetBotMsg.generatedAudio = generated_audio || null;
              if (thinking) {
                accumulatedText = thinking + accumulatedText;
                targetBotMsg.text = accumulatedText;
              }
              const finalMessages = [...msgs];
              finalMessages[botIdx] = { ...targetBotMsg };
              onUpdate({ messages: finalMessages });
            } else if (chunk.type === 'content') {
              accumulatedText += chunk.delta || '';
              targetBotMsg.text = accumulatedText;
              const finalMessages = [...msgs];
              finalMessages[botIdx] = { ...targetBotMsg };
              onUpdate({ messages: finalMessages });
            }
          }
        );

        if (!targetBotMsg.text.trim()) {
          targetBotMsg.text = REFUSAL;
          const finalMessages = [...msgs];
          finalMessages[botIdx] = { ...targetBotMsg };
          onUpdate({ messages: finalMessages });
        }
      }
      setFeedbackMap((prev) => ({ ...prev, [botMsgId]: { feedback: null, status: null } }));
    } catch (err) {
      const errMsg = {
        id: botMsgId, role: 'bot',
        text: `⚠️ Retry failed: ${err.message}`,
        attempt: nextAttempt, maxAttempts: MAX_ATTEMPTS,
      };
      const finalMessages = [...msgs];
      finalMessages[botIdx] = errMsg;
      onUpdate({ messages: finalMessages });
    } finally {
      setRetryingId(null);
    }
  };

  const handleLike = async (botMsgId) => {
    const userMsg = findPrecedingUserMessage(botMsgId);
    const botMsg = conversation.messages.find((m) => m.id === botMsgId);
    if (!userMsg || !botMsg) return;

    setFeedbackMap((prev) => ({
      ...prev,
      [botMsgId]: { feedback: 'liked', status: 'Training...' },
    }));

    try {
      await api.sendFeedback(userMsg.text || '', botMsg.text || '', true, activeProjectId);
      setFeedbackMap((prev) => ({
        ...prev,
        [botMsgId]: { feedback: 'liked', status: 'Trained \u2713' },
      }));
    } catch {
      setFeedbackMap((prev) => ({
        ...prev,
        [botMsgId]: { feedback: 'liked', status: 'Training failed' },
      }));
    }
  };

  const handleDislike = async (botMsgId) => {
    const userMsg = findPrecedingUserMessage(botMsgId);
    const botMsg = conversation.messages.find((m) => m.id === botMsgId);
    if (!userMsg || !botMsg) return;

    setFeedbackMap((prev) => ({
      ...prev,
      [botMsgId]: { feedback: 'disliked', status: 'Not trained' },
    }));

    try {
      await api.sendFeedback(userMsg.text || '', botMsg.text || '', false, activeProjectId);
    } catch {
      // Silently acknowledge
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    const question = input.trim();
    if ((!question && !selectedImage && !attachedDoc) || loading || disabled) return;

    if (selectedCreatorMode) {
      if (!question) return; // Cannot generate empty media
      const mode = selectedCreatorMode;
      setSelectedCreatorMode(null);
      if (mode === 'image') {
        await triggerImageGeneration(question);
      } else if (mode === 'video') {
        await triggerVideoGeneration(question);
      } else if (mode === 'audio') {
        await triggerAudioGeneration(question);
      }
      return;
    }

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
      const botMsgId = nextId();
      const targetBotMsg = {
        id: botMsgId,
        role: 'bot',
        text: '',
        generatedImage: null,
        generatedVideo: null,
        generatedAudio: null,
        sources: [],
        attempt: 1,
        maxAttempts: MAX_ATTEMPTS,
      };

      let accumulatedText = '';
      let isFirstChunk = true;

      await api.chatStream(
        question,
        cleanImage ? [cleanImage] : [],
        docText,
        docName,
        ragMode,
        activeProjectId,
        (chunk) => {
          if (isFirstChunk) {
            setLoading(false);
            isFirstChunk = false;
          }

          if (chunk.type === 'metadata') {
            const { active_model, sources, thinking, generated_image, generated_video, generated_audio } = chunk;
            if (active_model && onModelChanged) {
              onModelChanged(active_model);
            }
            targetBotMsg.sources = sources || [];
            targetBotMsg.generatedImage = generated_image || null;
            targetBotMsg.generatedVideo = generated_video || null;
            targetBotMsg.generatedAudio = generated_audio || null;
            if (thinking) {
              accumulatedText = thinking + accumulatedText;
              targetBotMsg.text = accumulatedText;
            }
            onUpdate({ messages: [...baseMessages, { ...targetBotMsg }] });
          } else if (chunk.type === 'content') {
            accumulatedText += chunk.delta || '';
            targetBotMsg.text = accumulatedText;
            onUpdate({ messages: [...baseMessages, { ...targetBotMsg }] });
          }
        }
      );

      if (!targetBotMsg.text.trim()) {
        targetBotMsg.text = REFUSAL;
        onUpdate({ messages: [...baseMessages, { ...targetBotMsg }] });
      }
    } catch (err) {
      const botMsg = {
        id: nextId(),
        role: 'bot',
        text: `⚠️ ${err.message}`,
        attempt: 1,
        maxAttempts: MAX_ATTEMPTS,
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
      {activeProjectId && (
        <div className="project-context-banner" style={{
          padding: '12px 24px',
          background: 'var(--bg-active-project, rgba(79, 70, 229, 0.06))',
          borderBottom: '1px solid var(--border-active-project, rgba(79, 70, 229, 0.12))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          zIndex: 10,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
            <div style={{
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: '6px',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div style={{ overflow: 'hidden' }}>
              <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                Research Scope Active
              </h4>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                AI is searching and learning specifically from: <strong>{projects.find(p => p.id === activeProjectId)?.name || 'This Project'}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={() => setActiveProjectId(null)}
            className="btn btn-secondary-outline btn-sm"
            style={{
              padding: '5px 12px',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexShrink: 0
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Exit Project
          </button>
        </div>
      )}
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
              <Message
                key={m.id}
                message={m}
                feedbackMap={feedbackMap}
                handleLike={handleLike}
                handleDislike={handleDislike}
                handleRetry={handleRetry}
                handleBranch={(msgId) => onBranchChat?.(msgId, conversation.messages)}
                conversation={conversation}
                ragMode={ragMode}
                activeProjectId={activeProjectId}
                onModelChanged={onModelChanged}
                onUpdate={onUpdate}
                loading={false}
              />
            ))}
            {loading && <Message key="loading" loading />}
          </div>
        )}
      </div>

      <div className="input-area">
        {/* Segmented RAG Mode Selector */}
        <div className="rag-selector-container">
          <button
            type="button"
            className={`rag-selector-option ${ragMode === 'hybrid' ? 'active' : ''}`}
            onClick={() => setRagMode('hybrid')}
            title="Search both local documents and live web search"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>Hybrid</span>
          </button>
          <button
            type="button"
            className={`rag-selector-option ${ragMode === 'local' ? 'active' : ''}`}
            onClick={() => setRagMode('local')}
            title="Search only uploaded local documents and training data"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>Local Data</span>
          </button>
          <button
            type="button"
            className={`rag-selector-option ${ragMode === 'web' ? 'active' : ''}`}
            onClick={() => setRagMode('web')}
            title="Search only live web results using Brave Search API"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Live Web</span>
          </button>
          <button
            type="button"
            className={`rag-selector-option ${ragMode === 'direct' ? 'active' : ''}`}
            onClick={() => setRagMode('direct')}
            title="Interact directly with the raw LLM without RAG search or guardrails"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span>Direct LLM</span>
          </button>
        </div>

        {(selectedImage || attachedDoc || selectedCreatorMode) && (
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
            {selectedCreatorMode && (
              <div className="image-preview-bar creator-mode-badge-bar">
                <span className="creator-mode-badge-icon" style={{ display: 'flex', alignItems: 'center', color: 'var(--accent)', marginRight: '8px' }}>
                  {selectedCreatorMode === 'image' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  )}
                  {selectedCreatorMode === 'video' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                  )}
                  {selectedCreatorMode === 'audio' && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                    </svg>
                  )}
                </span>
                <span className="image-preview-name" style={{ fontWeight: 600, color: 'var(--accent)' }}>
                  {selectedCreatorMode === 'image' && 'Image Creator Active'}
                  {selectedCreatorMode === 'video' && 'Video Creator Active'}
                  {selectedCreatorMode === 'audio' && 'Audio Creator Active'}
                </span>
                <button type="button" className="image-preview-clear" onClick={() => setSelectedCreatorMode(null)} title="Clear creator mode">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
        
        <form onSubmit={submit} className="input-form">
          {!isRecording && (
            <div className="creator-menu-container" ref={creatorMenuRef}>
              <button
                type="button"
                className={`creator-menu-trigger ${showCreatorMenu ? 'active' : ''}`}
                onClick={() => setShowCreatorMenu(!showCreatorMenu)}
                title="AI Creators"
                disabled={disabled || loading || transcribing}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
              
              {showCreatorMenu && (
                <div className="creator-dropdown" onClick={(e) => e.stopPropagation()}>
                  <div className="creator-dropdown-header">Choose Creator</div>
                  
                  <button
                    type="button"
                    className={`creator-option-btn ${selectedCreatorMode === 'image' ? 'active' : ''}`}
                    onClick={() => handleSelectCreator('image')}
                    title="Select Image Creator"
                  >
                    <span className="creator-option-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </span>
                    <div className="creator-option-content">
                      <span className="creator-option-title">Image Creator</span>
                      <span className="creator-option-desc">Select to generate images</span>
                    </div>
                  </button>
                  
                  <button
                    type="button"
                    className={`creator-option-btn ${selectedCreatorMode === 'video' ? 'active' : ''}`}
                    onClick={() => handleSelectCreator('video')}
                    title="Select Video Creator"
                  >
                    <span className="creator-option-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    </span>
                    <div className="creator-option-content">
                      <span className="creator-option-title">Video Creator</span>
                      <span className="creator-option-desc">Select to render video clips</span>
                    </div>
                  </button>
                  
                  <button
                    type="button"
                    className={`creator-option-btn ${selectedCreatorMode === 'audio' ? 'active' : ''}`}
                    onClick={() => handleSelectCreator('audio')}
                    title="Select Audio Creator"
                  >
                    <span className="creator-option-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </svg>
                    </span>
                    <div className="creator-option-content">
                      <span className="creator-option-title">Audio Creator</span>
                      <span className="creator-option-desc">Select to synthesize speech</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}

          {isRecording ? (
            <div className="mic-recording-indicator" style={{ flex: 1 }}>
              <span className="recording-dot" />
              <span>Recording voice: {formatDuration(recordingDuration)}</span>
              <button type="button" className="mic-stop-btn" onClick={stopRecording}>
                Stop & Transcribe
              </button>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                disabled
                  ? 'Train on a website to start chatting…'
                  : transcribing
                  ? 'Transcribing audio from Whisper...'
                  : selectedCreatorMode
                  ? `Type prompt for ${selectedCreatorMode === 'image' ? 'image' : selectedCreatorMode === 'video' ? 'video' : 'audio'} generation...`
                  : 'Message Agent UXKD…'
              }
              disabled={disabled || loading || transcribing}
              rows={1}
            />
          )}
          
          <div className="input-actions-group">
            {!isRecording && (
              <>
                {/* Voice input button */}
                <button
                  type="button"
                  className={`attach-btn ${transcribing ? 'transcribing' : ''}`}
                  onClick={startRecording}
                  disabled={disabled || loading || transcribing}
                  title={transcribing ? "Transcribing audio..." : "Record voice input"}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {transcribing ? (
                    <div className="typing" style={{ padding: 0, gap: '2px' }}>
                      <span style={{ width: '4px', height: '4px', background: 'currentColor', animationDelay: '0s' }} />
                      <span style={{ width: '4px', height: '4px', background: 'currentColor', animationDelay: '0.15s' }} />
                      <span style={{ width: '4px', height: '4px', background: 'currentColor', animationDelay: '0.3s' }} />
                    </div>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v4M8 23h8" />
                    </svg>
                  )}
                </button>

                {/* File Attachment Button */}
                <label className="attach-btn" title="Attach file" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input
                    type="file"
                    accept="image/*,.pdf,.docx,.doc,.txt,.md,.json,.js,.css,.html,.xml,.py,.c,.cpp,.h,.java,.go,.rs,.sh,.csv,.xlsx,.xls"
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    disabled={disabled || loading || transcribing}
                  />
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </label>
              </>
            )}

            <button
              type="submit"
              className="send-btn"
              disabled={disabled || loading || transcribing || attachedDoc?.loading || isRecording || (!input.trim() && !selectedImage && !attachedDoc)}
              title="Send"
              aria-label="Send"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

const extractWebCodeBlocks = (text) => {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let inBlock = false;
  let lang = '';
  let content = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.startsWith('```')) {
        blocks.push({ lang: lang.toLowerCase(), content: content.join('\n') });
        inBlock = false;
        content = [];
        lang = '';
      } else {
        content.push(line);
      }
    } else {
      if (trimmed.startsWith('```')) {
        inBlock = true;
        lang = trimmed.slice(3).trim();
      }
    }
  }
  
  // Filter for web files
  const webBlocks = blocks.filter(b => 
    ['html', 'htm', 'css', 'javascript', 'js', 'jsx', 'typescript', 'ts'].includes(b.lang)
  );
  
  return webBlocks.length > 0 ? webBlocks : null;
};

function Message({
  message,
  loading,
  feedbackMap,
  handleLike,
  handleDislike,
  handleRetry,
  handleBranch,
}) {
  const isUser = !loading && message && message.role === 'user';
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const webBlocks = !isUser && message && extractWebCodeBlocks(message.text);

  const handleDownloadWebProject = async () => {
    if (!message) return;
    const blocks = extractWebCodeBlocks(message.text);
    if (!blocks) return;

    try {
      const zip = new JSZip();
      
      let htmlCode = '';
      let cssCode = '';
      let jsCode = '';
      
      const otherFiles = [];

      blocks.forEach((block) => {
        const lang = block.lang;
        if (lang === 'html' || lang === 'htm') {
          if (!htmlCode) htmlCode = block.content;
          else otherFiles.push({ name: `index_${otherFiles.length + 1}.html`, content: block.content });
        } else if (lang === 'css') {
          if (!cssCode) cssCode = block.content;
          else otherFiles.push({ name: `style_${otherFiles.length + 1}.css`, content: block.content });
        } else if (['javascript', 'js', 'jsx', 'typescript', 'ts'].includes(lang)) {
          if (!jsCode) jsCode = block.content;
          else otherFiles.push({ name: `script_${otherFiles.length + 1}.js`, content: block.content });
        }
      });

      // Inject link tags into HTML if we have them and they aren't linked
      if (htmlCode) {
        let updatedHtml = htmlCode;
        
        if (cssCode && !updatedHtml.includes('style.css')) {
          if (updatedHtml.includes('</head>')) {
            updatedHtml = updatedHtml.replace('</head>', '  <link rel="stylesheet" href="style.css">\n</head>');
          } else if (updatedHtml.includes('<body>')) {
            updatedHtml = updatedHtml.replace('<body>', '<body>\n  <link rel="stylesheet" href="style.css">');
          } else {
            updatedHtml = '<link rel="stylesheet" href="style.css">\n' + updatedHtml;
          }
        }
        
        if (jsCode && !updatedHtml.includes('script.js')) {
          if (updatedHtml.includes('</body>')) {
            updatedHtml = updatedHtml.replace('</body>', '  <script src="script.js"></script>\n</body>');
          } else {
            updatedHtml = updatedHtml + '\n<script src="script.js"></script>';
          }
        }
        
        zip.file('index.html', updatedHtml);
      }

      if (cssCode) {
        zip.file('style.css', cssCode);
      }

      if (jsCode) {
        zip.file('script.js', jsCode);
      }

      otherFiles.forEach(file => {
        zip.file(file.name, file.content);
      });

      // If we have no index.html but have css/js, create a blank index.html that links them
      if (!htmlCode && (cssCode || jsCode)) {
        let blankHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>AI Generated Web App</title>\n';
        if (cssCode) blankHtml += '  <link rel="stylesheet" href="style.css">\n';
        blankHtml += '</head>\n<body>\n  <div id="root"></div>\n  <h1 style="text-align:center; font-family:sans-serif; margin-top:20vh; color:#374151;">AI Web Project</h1>\n  <p style="text-align:center; font-family:sans-serif; color:#6b7280;">Open developer tools or inspect the files to see your project.</p>\n';
        if (jsCode) blankHtml += '  <script src="script.js"></script>\n';
        blankHtml += '</body>\n</html>';
        zip.file('index.html', blankHtml);
      }

      const contentBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(contentBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `web-project-${message.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to create ZIP package:', err);
    }
  };

  // Reference for clicking outside the more options menu
  const menuRef = useRef(null);

  useEffect(() => {
    if (!showMoreMenu) return;
    const handleOutsideMenu = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideMenu);
    return () => document.removeEventListener('mousedown', handleOutsideMenu);
  }, [showMoreMenu]);

  // Read aloud voice synthesis
  const handleReadAloud = () => {
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message.text || '');
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    return () => {
      if (isSpeaking) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isSpeaking]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    const text = message.text || '';
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response_${message.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatMessageTime = (msgIdOrTime) => {
    try {
      let date;
      if (typeof msgIdOrTime === 'number') {
        date = new Date(msgIdOrTime);
      } else if (typeof msgIdOrTime === 'string' && !isNaN(msgIdOrTime)) {
        date = new Date(Number(msgIdOrTime));
      } else {
        date = new Date();
      }
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return 'Just now';
    }
  };

  const feedbackStatus = feedbackMap?.[message.id];
  const isLiked = feedbackStatus?.feedback === 'liked';
  const isDisliked = feedbackStatus?.feedback === 'disliked';

  return (
    <div className={`message ${isUser ? 'user' : 'bot'}`}>
      <div className="message-row">
        {!isUser && (
          <div className="message-avatar">
            <div className="avatar bot-avatar" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          ) : message.loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}>
              <div className="typing" aria-label="Assistant is processing">
                <span />
                <span />
                <span />
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                {message.loadingText || 'Generating media...'}
              </span>
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
              
              {/* Media Result Renders */}
              {message.generatedImage && (
                <div className="message-media-container generated-image-container">
                  <img src={message.generatedImage} alt="Generated Visual" className="generated-image" />
                  <a href={message.generatedImage} download={`generated_${message.id}.jpg`} className="media-download-btn" title="Download Image">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download Image</span>
                  </a>
                </div>
              )}

              {message.generatedVideo && (
                <VideoMessagePlayer sequence={message.generatedVideo} />
              )}

              {message.generatedAudio && (
                <AudioMessagePlayer text={message.generatedAudio.text} />
              )}
              
              {isUser ? message.text : <MarkdownRenderer text={message.text} />}

              {!isUser && webBlocks && (
                <div className="web-project-download-card">
                  <div className="wp-card-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  </div>
                  <div className="wp-card-info">
                    <div className="wp-card-title">Web Code Package Detected</div>
                    <div className="wp-card-subtitle">
                      Contains {webBlocks.map(b => b.lang.toUpperCase()).join(', ')} files
                    </div>
                  </div>
                  <button 
                    className="wp-card-download-btn" 
                    onClick={handleDownloadWebProject}
                    title="Download complete web project as ZIP"
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span>Download Project ZIP</span>
                  </button>
                </div>
              )}
              
              {/* Bot Message Action Bar */}
              {!isUser && (
                <div className="bot-actions-bar">
                  {/* Copy Button */}
                  <button
                    className={`bot-action-btn ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                    title={copied ? "Copied!" : "Copy response"}
                    type="button"
                  >
                    {copied ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    )}
                  </button>
                  
                  {/* Like Button */}
                  <button
                    className={`bot-action-btn ${isLiked ? 'liked' : ''}`}
                    onClick={() => handleLike?.(message.id)}
                    title="Like and train"
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                    </svg>
                  </button>
                  
                  {/* Dislike Button */}
                  <button
                    className={`bot-action-btn ${isDisliked ? 'disliked' : ''}`}
                    onClick={() => handleDislike?.(message.id)}
                    title="Dislike"
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm12-3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
                    </svg>
                  </button>
                  
                  {/* Share/Export Button */}
                  <button
                    className="bot-action-btn"
                    onClick={handleShare}
                    title="Export response as Markdown"
                    type="button"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                  </button>
                  
                  {/* Retry Button (hide if max attempts reached) */}
                  {message.attempt < 3 && (
                    <button
                      className="bot-action-btn"
                      onClick={() => handleRetry?.(message.id)}
                      title={`Retry generation (Attempt ${message.attempt}/3)`}
                      disabled={loading}
                      type="button"
                      style={{ display: 'flex', alignItems: 'center', gap: '4px', width: 'auto', borderRadius: '16px', padding: '0 8px' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                      </svg>
                      <span style={{ fontSize: '10px', fontWeight: 600 }}>{message.attempt}/3</span>
                    </button>
                  )}

                  {/* More options button (three dots) */}
                  <div className="bot-more-options-container" ref={menuRef}>
                    <button
                      className="bot-action-btn"
                      onClick={() => setShowMoreMenu(!showMoreMenu)}
                      title="More options"
                      type="button"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="19" cy="12" r="1" />
                        <circle cx="5" cy="12" r="1" />
                      </svg>
                    </button>

                    {showMoreMenu && (
                      <div className="bot-more-dropdown" onClick={(e) => e.stopPropagation()}>
                        <div className="bot-more-dropdown-time">
                          {formatMessageTime(message.timestamp || message.id)}
                        </div>
                        
                        <button
                          type="button"
                          className="bot-more-dropdown-item"
                          onClick={() => {
                            handleBranch?.(message.id);
                            setShowMoreMenu(false);
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: 'rotate(90deg)' }}>
                            <path d="M18 8h-6a4 4 0 0 0-4 4v8" />
                            <circle cx="6" cy="6" r="3" />
                            <circle cx="18" cy="18" r="3" />
                          </svg>
                          <span>Branch in new chat</span>
                        </button>

                        <button
                          type="button"
                          className="bot-more-dropdown-item"
                          onClick={() => {
                            handleReadAloud();
                            setShowMoreMenu(false);
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                          </svg>
                          <span>{isSpeaking ? 'Stop reading' : 'Read aloud'}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Feedback training status badge */}
                  {feedbackStatus?.status && (
                    <span className={`feedback-status-badge ${feedbackStatus.feedback}`}>
                      {feedbackStatus.status}
                    </span>
                  )}

                  {/* Sources Toggle Button */}
                  {message.sources && message.sources.length > 0 && (
                    <button
                      className={`bot-sources-btn ${showSources ? 'active' : ''}`}
                      onClick={() => setShowSources(!showSources)}
                      type="button"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5v-15z" />
                      </svg>
                      <span>Sources</span>
                    </button>
                  )}
                </div>
              )}

              {/* Sources List Panel (expanded) */}
              {!isUser && showSources && message.sources && message.sources.length > 0 && (
                <div className="bot-sources-panel">
                  <div className="bot-sources-header">Retrieved Context Sources</div>
                  <div className="bot-sources-list">
                    {message.sources.map((src, idx) => (
                      <div key={idx} className="bot-source-item">
                        {src.type === 'document' ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span className="bot-source-name" title={src.name}>{src.name}</span>
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: '#10b981', flexShrink: 0 }}>
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                            <a href={src.url} target="_blank" rel="noopener noreferrer" className="bot-source-link" title={src.url}>
                              {src.title || src.url}
                            </a>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AudioMessagePlayer({ text }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const progressIntervalRef = useRef(null);
  const utteranceRef = useRef(null);

  // Estimate duration: ~2.2 words per second, min 3s
  const wordCount = text ? text.split(/\s+/).length : 0;
  const duration = Math.max(3, Math.ceil(wordCount / 2.2));

  const formatTime = (timeInSecs) => {
    const mins = Math.floor(timeInSecs / 60);
    const secs = Math.floor(timeInSecs % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handlePlayPause = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      alert("Speech synthesis is not supported on this browser.");
      return;
    }

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } else {
      window.speechSynthesis.cancel();
      
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;

      const voices = window.speechSynthesis.getVoices();
      const idealVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Natural') || v.lang.startsWith('en')) || voices[0];
      if (idealVoice) {
        utterance.voice = idealVoice;
      }

      utterance.onend = () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
        }
      };

      utterance.onerror = () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
        }
      };

      window.speechSynthesis.speak(utterance);
      setIsPlaying(true);
      setCurrentTime(0);

      const startTime = Date.now();
      progressIntervalRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= duration) {
          setCurrentTime(duration);
          clearInterval(progressIntervalRef.current);
        } else {
          setCurrentTime(elapsed);
        }
      }, 100);
    }
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  const progressPct = (currentTime / duration) * 100;

  return (
    <div className="chat-audio-message-player">
      <button type="button" className="audio-play-btn" onClick={handlePlayPause}>
        {isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: '2px' }}>
            <polygon points="5 3 19 12 5 21" />
          </svg>
        )}
      </button>

      <div className="audio-player-center">
        <span className="audio-player-title">Synthesized Audio Speech</span>
        <div className="audio-progress-container">
          <div className="audio-progress-bar">
            <div className="audio-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="audio-time-label">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      <div className={`audio-waveform ${isPlaying ? 'active' : ''}`}>
        <div className="waveform-bar" />
        <div className="waveform-bar" />
        <div className="waveform-bar" />
        <div className="waveform-bar" />
        <div className="waveform-bar" />
      </div>
    </div>
  );
}

function VideoMessagePlayer({ sequence }) {
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackIntervalRef = useRef(null);

  useEffect(() => {
    if (isPlaying && sequence?.frames?.length > 0) {
      playbackIntervalRef.current = setInterval(() => {
        setActiveFrameIndex((prev) => (prev + 1) % sequence.frames.length);
      }, 4000);
    } else {
      clearInterval(playbackIntervalRef.current);
    }
    return () => clearInterval(playbackIntervalRef.current);
  }, [isPlaying, sequence]);

  if (!sequence?.frames || sequence.frames.length === 0) return null;

  return (
    <div className="chat-video-message-player">
      <div className="cinematic-screen">
        <img
          src={sequence.frames[activeFrameIndex].image_uri}
          alt="Cinematic Storyboard Frame"
          className={`cinematic-frame ${isPlaying ? 'ken-burns' : ''}`}
        />
        <div className="cinematic-caption">
          <span className="frame-badge">Frame {activeFrameIndex + 1}/{sequence.frames.length}</span>
          <p className="frame-desc">{sequence.frames[activeFrameIndex].prompt}</p>
        </div>
      </div>
      <div className="cinematic-controls">
        <button
          type="button"
          className="settings-btn settings-btn--secondary btn-cinematic-play"
          onClick={() => setIsPlaying(!isPlaying)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px' }}
        >
          {isPlaying ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
              <span>Pause Playback</span>
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Play Cinematic</span>
            </>
          )}
        </button>
        <div className="frame-dots">
          {sequence.frames.map((frame, index) => (
            <button
              key={frame.frame_index ?? index}
              type="button"
              className={`frame-dot-btn ${activeFrameIndex === index ? 'active' : ''}`}
              onClick={() => {
                setActiveFrameIndex(index);
                setIsPlaying(false);
              }}
              title={`Jump to frame ${index + 1}`}
              aria-label={`Jump to frame ${index + 1}`}
            />
          ))}
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
      <h1 className="welcome-title">Welcome to Agent UXKD</h1>
      <p className="welcome-sub" style={{ marginBottom: '16px' }}>
        Your Hybrid AI assistant. Chat with your documents, websites, and code using Live/Local AI.
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
