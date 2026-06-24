import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';

export default function MultimodalLab() {
  const [activeTab, setActiveTab] = useState('image');
  const [feedback, setFeedback] = useState(null);

  /* ==========================================
     🎨 IMAGE STUDIO (Hugging Face FLUX)
     ========================================== */
  const [imagePrompt, setImagePrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);

  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) return;
    setImageLoading(true);
    setGeneratedImage(null);
    setFeedback(null);
    try {
      const res = await api.generateImage(imagePrompt.trim());
      setGeneratedImage(res.image_uri);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setImageLoading(false);
    }
  };

  /* ==========================================
     🎙️ AUDIO & VOICE CENTER (Whisper & TTS)
     ========================================== */
  // 1. Text-to-Speech (TTS) State
  const [ttsText, setTtsText] = useState('Hello! Welcome to the AI Multimodal Lab. Experience unlimited, fast generation.');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [pitch, setPitch] = useState(1);
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);

  // Load SpeechSynthesis Voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    
    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      setVoices(allVoices);
      if (allVoices.length > 0) {
        // Pick a good default English voice if available
        const defaultVoice = allVoices.find(v => v.lang.startsWith('en') && v.name.includes('Google')) 
          || allVoices.find(v => v.lang.startsWith('en')) 
          || allVoices[0];
        setSelectedVoice(defaultVoice.name);
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const handleSpeak = () => {
    if (!ttsText.trim() || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // Stop anything currently playing

    const utterance = new SpeechSynthesisUtterance(ttsText);
    const voice = voices.find(v => v.name === selectedVoice);
    if (voice) utterance.voice = voice;
    utterance.pitch = pitch;
    utterance.rate = rate;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const handleStopSpeaking = () => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  // 2. Speech-to-Text (STT - Whisper) State
  const [recording, setRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const startRecording = async () => {
    audioChunksRef.current = [];
    setFeedback(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const file = new File([audioBlob], 'mic_recording.wav', { type: 'audio/wav' });
        
        // Call Whisper API
        setTranscribing(true);
        setTranscription('');
        try {
          const res = await api.transcribeAudio(file);
          setTranscription(res.text);
        } catch (err) {
          setFeedback({ type: 'error', text: `Transcription failed: ${err.message}` });
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      setFeedback({ type: 'error', text: `Microphone access denied: ${err.message}` });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      // Stop all tracks on the stream
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setRecording(false);
    }
  };

  /* ==========================================
     🎬 VIDEO THEATER (Stitched Cinematic Slideshow)
     ========================================== */
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoSequence, setVideoSequence] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const playbackIntervalRef = useRef(null);

  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim()) return;
    setVideoLoading(true);
    setVideoSequence(null);
    setActiveFrameIndex(0);
    setFeedback(null);
    setIsPlayingVideo(false);
    try {
      const res = await api.generateVideo(videoPrompt.trim());
      setVideoSequence(res);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setVideoLoading(false);
    }
  };

  // Handle cinematic frame rotation
  useEffect(() => {
    if (isPlayingVideo && videoSequence?.frames?.length > 0) {
      playbackIntervalRef.current = setInterval(() => {
        setActiveFrameIndex((prev) => (prev + 1) % videoSequence.frames.length);
      }, 4000); // 4 seconds per storyboard frame
    } else {
      clearInterval(playbackIntervalRef.current);
    }
    return () => clearInterval(playbackIntervalRef.current);
  }, [isPlayingVideo, videoSequence]);

  /* ==========================================
     📊 VECTOR EXPLORER (Hugging Face Embedding)
     ========================================== */
  const [vectorText, setVectorText] = useState('');
  const [generatedVector, setGeneratedVector] = useState(null);
  const [vectorMetadata, setVectorMetadata] = useState(null);
  const [vectorLoading, setVectorLoading] = useState(false);

  const handleGenerateVector = async () => {
    if (!vectorText.trim()) return;
    setVectorLoading(true);
    setGeneratedVector(null);
    setVectorMetadata(null);
    setFeedback(null);
    try {
      const res = await api.generateVector(vectorText.trim());
      setGeneratedVector(res.vector);
      setVectorMetadata(res.metadata);
    } catch (err) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setVectorLoading(false);
    }
  };

  return (
    <div className="lab-panel">
      <header className="lab-header">
        <div className="lab-header-title-group">
          <svg className="lab-glow-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <h2>AI Multimodal Generation Lab</h2>
        </div>
        <p className="lab-header-desc">
          Test text, image, audio, video, and vector models powered by Groq &amp; Hugging Face free APIs.
        </p>
      </header>

      {/* Lab Navigation Tabs */}
      <nav className="lab-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'image'}
          className={`lab-tab-btn ${activeTab === 'image' ? 'active' : ''}`}
          onClick={() => { setActiveTab('image'); setFeedback(null); }}
        >
          🎨 Image Studio
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'audio'}
          className={`lab-tab-btn ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => { setActiveTab('audio'); setFeedback(null); }}
        >
          🎙️ Audio &amp; Voice
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'video'}
          className={`lab-tab-btn ${activeTab === 'video' ? 'active' : ''}`}
          onClick={() => { setActiveTab('video'); setFeedback(null); }}
        >
          🎬 Video Theater
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'vector'}
          className={`lab-tab-btn ${activeTab === 'vector' ? 'active' : ''}`}
          onClick={() => { setActiveTab('vector'); setFeedback(null); }}
        >
          📊 Vector Explorer
        </button>
      </nav>

      {/* Main Lab Content Area */}
      <div className="lab-content">
        
        {/* ==========================================
           🎨 IMAGE STUDIO TAB
           ========================================== */}
        {activeTab === 'image' && (
          <div className="lab-tab-content">
            <div className="lab-inputs-panel">
              <div className="lab-section-title">Hugging Face Text-to-Image</div>
              <p className="lab-section-desc">Generate premium graphics instantly via <strong>FLUX.1-schnell</strong>.</p>
              
              <div className="lab-form-group">
                <textarea
                  className="lab-textarea"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Describe the image you want to generate (e.g. 'A futuristic cyberpunk laboratory with neon lights, highly detailed, photorealistic, 8k resolution')..."
                  rows={4}
                  disabled={imageLoading}
                />
              </div>

              <div className="lab-actions-row">
                <button
                  className="settings-btn lab-btn-glow"
                  onClick={handleGenerateImage}
                  disabled={imageLoading || !imagePrompt.trim()}
                >
                  {imageLoading ? 'Generating Image…' : 'Generate Graphic'}
                </button>
              </div>
            </div>

            <div className="lab-preview-panel">
              <div className="lab-preview-box">
                {imageLoading ? (
                  <div className="lab-loader-container">
                    <div className="lab-spinner" />
                    <span>Inference active on Hugging Face...</span>
                  </div>
                ) : generatedImage ? (
                  <div className="lab-image-container">
                    <img src={generatedImage} alt="AI Generated Graphic" className="lab-generated-img" />
                    <a
                      href={generatedImage}
                      download={`ai-graphic-${Date.now()}.jpg`}
                      className="settings-btn settings-btn--secondary lab-download-btn"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                      Download Image
                    </a>
                  </div>
                ) : (
                  <div className="lab-empty-preview">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>Your generated graphic will appear here.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==========================================
           🎙️ AUDIO & VOICE CENTER TAB
           ========================================== */}
        {activeTab === 'audio' && (
          <div className="lab-tab-content lab-tab-content--split">
            {/* Left: Text-to-Speech */}
            <div className="lab-audio-box">
              <div className="lab-section-title">Text-to-Speech (TTS)</div>
              <p className="lab-section-desc">Generate offline voice synthesizer responses using browser speech engine.</p>
              
              <div className="lab-form-group">
                <textarea
                  className="lab-textarea"
                  value={ttsText}
                  onChange={(e) => setTtsText(e.target.value)}
                  placeholder="Enter text to convert to voice..."
                  rows={4}
                  disabled={speaking}
                />
              </div>

              <div className="voice-controls-grid">
                <div className="voice-control-item">
                  <label className="voice-control-label" htmlFor="voice-select">Voice</label>
                  <select
                    id="voice-select"
                    className="model-select voice-select-dropdown"
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    disabled={speaking}
                  >
                    {voices.map(v => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="voice-sliders-row">
                  <div className="voice-slider-item">
                    <label className="voice-control-label" htmlFor="rate-slider">Speed: {rate}x</label>
                    <input
                      id="rate-slider"
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={rate}
                      onChange={(e) => setRate(parseFloat(e.target.value))}
                      disabled={speaking}
                    />
                  </div>

                  <div className="voice-slider-item">
                    <label className="voice-control-label" htmlFor="pitch-slider">Pitch: {pitch}</label>
                    <input
                      id="pitch-slider"
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={pitch}
                      onChange={(e) => setPitch(parseFloat(e.target.value))}
                      disabled={speaking}
                    />
                  </div>
                </div>
              </div>

              <div className="lab-actions-row">
                {speaking ? (
                  <button className="settings-btn settings-btn--danger" onClick={handleStopSpeaking}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
                    </svg>
                    Stop Playing
                  </button>
                ) : (
                  <button className="settings-btn lab-btn-glow" onClick={handleSpeak} disabled={!ttsText.trim()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                    Synthesize Speech
                  </button>
                )}
              </div>
            </div>

            {/* Right: Speech-to-Text */}
            <div className="lab-audio-box">
              <div className="lab-section-title">Speech-to-Text (Groq Whisper)</div>
              <p className="lab-section-desc">Record your voice to transcribe using Groq's high-speed <strong>Whisper-large-v3</strong>.</p>

              <div className="mic-record-container">
                {recording ? (
                  <div className="recording-wave-box" onClick={stopRecording}>
                    <div className="wave-bar pulse-1" />
                    <div className="wave-bar pulse-2" />
                    <div className="wave-bar pulse-3" />
                    <div className="wave-bar pulse-4" />
                    <div className="wave-bar pulse-5" />
                    <span className="rec-text">Recording active. Click to transcribe.</span>
                  </div>
                ) : (
                  <button className="settings-btn settings-btn--danger mic-record-btn" onClick={startRecording}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                    </svg>
                    Start Voice Capture
                  </button>
                )}
              </div>

              <div className="transcription-result-box">
                <div className="transcription-header">
                  <span>Transcription Output</span>
                  {transcribing && <span className="transcribing-dot">Transcribing…</span>}
                </div>
                <div className="transcription-text">
                  {transcribing ? (
                    <div className="lab-loader-container">
                      <div className="lab-spinner" />
                      <span>Groq transcribing audio file...</span>
                    </div>
                  ) : transcription ? (
                    <p>{transcription}</p>
                  ) : (
                    <span className="empty-txt">Recorded speech transcription will appear here.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==========================================
           🎬 VIDEO THEATER TAB
           ========================================== */}
        {activeTab === 'video' && (
          <div className="lab-tab-content">
            <div className="lab-inputs-panel">
              <div className="lab-section-title">Hugging Face Text-to-Video</div>
              <p className="lab-section-desc">Generate an animated multi-frame cinematic slideshow sequence.</p>
              
              <div className="lab-form-group">
                <textarea
                  className="lab-textarea"
                  value={videoPrompt}
                  onChange={(e) => setVideoPrompt(e.target.value)}
                  placeholder="Describe a cinematic scene (e.g. 'Astronaut discovering glowing crystals inside a cave on Mars, cinematic, slow motion')..."
                  rows={4}
                  disabled={videoLoading}
                />
              </div>

              <div className="lab-actions-row">
                <button
                  className="settings-btn lab-btn-glow"
                  onClick={handleGenerateVideo}
                  disabled={videoLoading || !videoPrompt.trim()}
                >
                  {videoLoading ? 'Generating Storyboards…' : 'Generate Cinematic'}
                </button>
              </div>
            </div>

            <div className="lab-preview-panel">
              <div className="lab-preview-box">
                {videoLoading ? (
                  <div className="lab-loader-container">
                    <div className="lab-spinner" />
                    <span>Rendering storyboard frames on Hugging Face...</span>
                  </div>
                ) : videoSequence ? (
                  <div className="lab-video-player">
                    {/* Ken Burns Animated Image Frame */}
                    <div className="cinematic-screen">
                      <img
                        src={videoSequence.frames[activeFrameIndex].image_uri}
                        alt="Cinematic Storyboard Frame"
                        className={`cinematic-frame ${isPlayingVideo ? 'ken-burns' : ''}`}
                      />
                      
                      <div className="cinematic-caption">
                        <span className="frame-badge">Frame {activeFrameIndex + 1}/3</span>
                        <p className="frame-desc">{videoSequence.frames[activeFrameIndex].prompt}</p>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="cinematic-controls">
                      <button
                        className="settings-btn settings-btn--secondary btn-cinematic-play"
                        onClick={() => setIsPlayingVideo(!isPlayingVideo)}
                      >
                        {isPlayingVideo ? (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="6" y="4" width="4" height="16" />
                              <rect x="14" y="4" width="4" height="16" />
                            </svg>
                            Pause Playback
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Play Cinematic
                          </>
                        )}
                      </button>

                      {/* Frame Selectors */}
                      <div className="frame-dots">
                        {videoSequence.frames.map((frame, index) => (
                          <button
                            key={frame.frame_index}
                            className={`frame-dot-btn ${activeFrameIndex === index ? 'active' : ''}`}
                            onClick={() => { setActiveFrameIndex(index); setIsPlayingVideo(false); }}
                            title={`Jump to frame ${index+1}`}
                            aria-label={`Jump to frame ${index+1}`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="lab-empty-preview">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    <span>Your cinematic video playback will appear here.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==========================================
           📊 VECTOR EXPLORER TAB
           ========================================== */}
        {activeTab === 'vector' && (
          <div className="lab-tab-content">
            <div className="lab-inputs-panel">
              <div className="lab-section-title">Hugging Face Text-to-Vector</div>
              <p className="lab-section-desc">Generate mathematical text embedding vectors using <strong>BGE-Large</strong>.</p>
              
              <div className="lab-form-group">
                <textarea
                  className="lab-textarea"
                  value={vectorText}
                  onChange={(e) => setVectorText(e.target.value)}
                  placeholder="Type a word or sentence to vectorize..."
                  rows={4}
                  disabled={vectorLoading}
                />
              </div>

              <div className="lab-actions-row">
                <button
                  className="settings-btn lab-btn-glow"
                  onClick={handleGenerateVector}
                  disabled={vectorLoading || !vectorText.trim()}
                >
                  {vectorLoading ? 'Vectorizing…' : 'Generate Vector'}
                </button>
              </div>
            </div>

            <div className="lab-preview-panel">
              <div className="lab-preview-box">
                {vectorLoading ? (
                  <div className="lab-loader-container">
                    <div className="lab-spinner" />
                    <span>Generating embeddings float array...</span>
                  </div>
                ) : generatedVector ? (
                  <div className="vector-results-container">
                    <div className="vector-results-header">
                      <div className="vector-results-title">
                        <span>Float Array ({vectorMetadata.dimensions} dimensions)</span>
                      </div>
                      <span className="vector-model-badge">{vectorMetadata.model}</span>
                    </div>

                    <div className="vector-array-box">
                      {/* Interactive scrolling vector list */}
                      {generatedVector.map((val, idx) => (
                        <div key={idx} className="vector-cell" title={`Dimension ${idx}: ${val}`}>
                          <span className="vector-idx">{idx}</span>
                          <span className="vector-val">{val.toFixed(6)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="lab-empty-preview">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 3v18h18" />
                      <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                    </svg>
                    <span>Your text embeddings float array will appear here.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Global Feedback Banner */}
      {feedback && (
        <div className={`settings-feedback settings-feedback--${feedback.type} lab-feedback`}>
          {feedback.type === 'ok' ? '✓' : '⚠️'} {feedback.text}
        </div>
      )}
    </div>
  );
}
