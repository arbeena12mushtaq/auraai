import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken, TOKEN_COSTS, canUseFeature, getUserTokens } from '../utils/api';
import { Avatar } from '../components/UI';

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoad, setInitLoad] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(null); // 'image' | 'video' | null
  const [mediaProgress, setMediaProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chatRef = useRef();

  useEffect(() => {
    if (!companion) return;
    setInitLoad(true);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages || [])).catch(() => {}).finally(() => setInitLoad(false));
  }, [companion?.id]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading, mediaLoading]);

  if (!companion) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div><h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
    </div>
  );

  // ===== Send text message =====
  const sendText = async () => {
    const t = input.trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    setMessages(p => [...p, { role: 'user', type: 'text', content: t, created_at: new Date().toISOString() }]);
    setInput('');
    setLoading(true);

    try {
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: t } });
      setMessages(p => [...p, {
        role: 'assistant', type: 'text', content: d.message.content,
        created_at: d.message.created_at,
      }]);
      refreshUser();
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(p => [...p, { role: 'assistant', type: 'text', content: err.error || "hey 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // ===== Voice Recording (WhatsApp style) =====
  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const userAudioUrl = URL.createObjectURL(blob);

        // Show user's audio message immediately (like WhatsApp voice note)
        setMessages(prev => [...prev, { role: 'user', content: '🎤 Voice message', type: 'audio', media_url: userAudioUrl }]);
        setLoading(true);

        try {
          // Step 1: Transcribe audio (STT) silently — don't show text
          const formData = new FormData();
          formData.append('audio', blob, 'voice.webm');
          const sttRes = await fetch('/api/voice/stt', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: formData,
          });
          const sttData = await sttRes.json();
          const transcribedText = sttData.text || 'Hello';

          // Step 2: Send transcribed text to chat AI (text stays hidden)
          const data = await api(`/chat/${companion.id}`, { method: 'POST', body: { message: transcribedText } });

          if (data.reply) {
            // Step 3: Convert reply to audio (TTS)
            try {
              const ttsRes = await fetch('/api/voice/tts', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('token')}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: data.reply, voice: companion.voice }),
              });
              if (ttsRes.ok) {
                const audioBlob = await ttsRes.blob();
                const replyAudioUrl = URL.createObjectURL(audioBlob);
                // Show companion's voice reply (audio bubble)
                setMessages(prev => [...prev, { role: 'assistant', content: '🔊 Voice reply', type: 'audio', media_url: replyAudioUrl }]);
              } else {
                // TTS failed — show text reply instead
                setMessages(prev => [...prev, { role: 'assistant', content: data.reply, type: 'text' }]);
              }
            } catch {
              setMessages(prev => [...prev, { role: 'assistant', content: data.reply, type: 'text' }]);
            }
          }
        } catch (err) {
          console.error('Voice error:', err);
        }
        setLoading(false);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error('Mic error:', err);
      alert('Microphone access denied.');
    }
  };

  // ===== Generate Image =====
  const handleGenerateImage = async () => {
    if (!canUseFeature(user, 'image') && !user?.is_admin) {
      onNavigate('pricing');
      return;
    }

    setMediaLoading('image');
    setMediaProgress(0);

    // Fake progress
    const interval = setInterval(() => {
      setMediaProgress(p => Math.min(p + Math.random() * 15, 90));
    }, 500);

    try {
      const d = await api('/image/generate-scene', {
        method: 'POST',
        body: {
          companionId: companion.id,
          context: messages.slice(-4).map(m => m.content).join(' '),
        },
      });

      clearInterval(interval);
      setMediaProgress(100);

      if (d.image_url) {
        setMessages(p => [...p, {
          role: 'assistant', type: 'image', content: d.caption || '📸',
          media_url: d.image_url, created_at: new Date().toISOString(),
        }]);
        refreshUser(); // Update token count
      }
    } catch (err) {
      clearInterval(interval);
      if (err.code === 'NO_TOKENS') onNavigate('pricing');
      else alert(err.error || 'Image generation failed');
    }

    setMediaLoading(null);
    setMediaProgress(0);
  };

  // ===== Generate Video =====
  const handleGenerateVideo = async () => {
    if (!canUseFeature(user, 'video') && !user?.is_admin) {
      onNavigate('pricing');
      return;
    }

    setMediaLoading('video');
    setMediaProgress(0);

    const interval = setInterval(() => {
      setMediaProgress(p => Math.min(p + Math.random() * 8, 85));
    }, 800);

    try {
      const d = await api('/image/generate-video', {
        method: 'POST',
        body: {
          companionId: companion.id,
          context: messages.slice(-4).map(m => m.content).join(' '),
        },
      });

      clearInterval(interval);
      setMediaProgress(100);

      if (d.video_url) {
        setMessages(p => [...p, {
          role: 'assistant', type: 'video', content: d.caption || '🎬',
          media_url: d.video_url, created_at: new Date().toISOString(),
        }]);
        refreshUser();
      } else if (d.image_url) {
        // Fallback to image if video generation not available
        setMessages(p => [...p, {
          role: 'assistant', type: 'image', content: d.caption || '📸',
          media_url: d.image_url, created_at: new Date().toISOString(),
        }]);
        refreshUser();
      }
    } catch (err) {
      clearInterval(interval);
      if (err.code === 'NO_TOKENS') onNavigate('pricing');
      else alert(err.error || 'Video generation failed');
    }

    setMediaLoading(null);
    setMediaProgress(0);
  };

  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="chat-container candy-chat">
      {/* ====== HEADER ====== */}
      <div className="candy-header">
        <button className="candy-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="candy-header-avatar">
          {companion.avatar_url ? (
            <img src={companion.avatar_url} alt={companion.name} />
          ) : (
            <Avatar name={companion.name} size="sm" />
          )}
          <span className="candy-online-dot" />
        </div>
        <div className="candy-header-info">
          <div className="candy-header-name">{companion.name}</div>
          <div className="candy-header-status">{loading ? 'typing...' : 'Online'}</div>
        </div>
        <div className="candy-header-actions">
          <button className="candy-hdr-btn" onClick={() => onToggleSave?.(companion.id)}
            style={{ color: isSaved ? '#ff6b9d' : undefined }}>
            {isSaved ? '♥' : '♡'}
          </button>
        </div>
      </div>

      {/* ====== MESSAGES ====== */}
      <div className="candy-messages" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="candy-system-msg">Start chatting with {companion.name}</div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div key={i} className={`candy-msg ${isUser ? 'candy-msg-user' : 'candy-msg-ai'}`}>
                  {!isUser && (
                    <div className="candy-msg-avatar">
                      {companion.avatar_url ? (
                        <img src={companion.avatar_url} alt="" />
                      ) : (
                        <Avatar name={companion.name} size="xs" />
                      )}
                    </div>
                  )}
                  <div className="candy-bubble-area">
                    <div className={`candy-bubble ${isUser ? 'candy-bubble-user' : 'candy-bubble-ai'}`}>
                      {/* Image message */}
                      {m.type === 'image' && m.media_url && (
                        <img src={m.media_url} alt="Generated" className="candy-media-img" />
                      )}

                      {/* Video message */}
                      {m.type === 'video' && m.media_url && (
                        <video src={m.media_url} controls preload="metadata" className="candy-media-video"
                          poster={companion.avatar_url || undefined} />
                      )}

                      {/* Voice note */}
                      {m.type === 'vn' && m.media_url && (
                        <audio src={m.media_url} controls preload="none" style={{ width: '100%', maxWidth: 260 }} />
                      )}

                      {/* Text (always show if content exists, unless it's just emoji caption for media) */}
                      {m.content && !(m.type === 'image' && m.content === '📸') && !(m.type === 'video' && m.content === '🎬') && (
                        <div className="candy-bubble-text">{m.content}</div>
                      )}
                    </div>
                    <div className="candy-bubble-time">{fts(m.created_at)}</div>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {loading && (
              <div className="candy-msg candy-msg-ai">
                <div className="candy-msg-avatar">
                  {companion.avatar_url ? (
                    <img src={companion.avatar_url} alt="" />
                  ) : (
                    <Avatar name={companion.name} size="xs" />
                  )}
                </div>
                <div className="candy-bubble-area">
                  <div className="candy-bubble candy-bubble-ai">
                    <div className="typing-dots">
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Media generation loading */}
            {mediaLoading && (
              <div className="candy-msg candy-msg-ai">
                <div className="candy-msg-avatar">
                  {companion.avatar_url ? (
                    <img src={companion.avatar_url} alt="" />
                  ) : (
                    <Avatar name={companion.name} size="xs" />
                  )}
                </div>
                <div className="candy-bubble-area">
                  <div className="candy-media-loading">
                    <div className="candy-media-loading-icon">
                      {mediaLoading === 'image' ? '📸' : '🎬'}
                    </div>
                    <div className="candy-media-loading-text">
                      {companion.name} is sending a {mediaLoading === 'image' ? 'photo' : 'video'}...
                    </div>
                    <div className="candy-media-progress-bar">
                      <div className="candy-media-progress-fill" style={{ width: `${mediaProgress}%` }} />
                    </div>
                    <div className="candy-media-progress-pct">{Math.round(mediaProgress)}% • This might take a few seconds</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ====== INPUT BAR ====== */}
      <div className="candy-input-bar">
        <div className="candy-input-row">
          <input
            className="candy-text-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
            placeholder="Write a message..."
            disabled={loading || !!mediaLoading}
          />
          <button className={`candy-mic-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording}
            disabled={loading || !!mediaLoading}>
            {recording ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            )}
          </button>
          <button className="candy-send-btn" onClick={sendText}
            disabled={loading || !!mediaLoading || !input.trim()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <div className="candy-action-row">
          <span className="candy-action-label">Show me the scene:</span>
          <button className="candy-action-btn" onClick={handleGenerateImage}
            disabled={loading || !!mediaLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Image</span>
            <span className="candy-token-cost">{TOKEN_COSTS.image} tokens</span>
          </button>
          <button className="candy-action-btn" onClick={handleGenerateVideo}
            disabled={loading || !!mediaLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>
            <span>Video</span>
            <span className="candy-token-cost">{TOKEN_COSTS.video} tokens</span>
          </button>
        </div>
        {user && (
          <div className="candy-tokens-display">
            🪙 {getUserTokens(user)} tokens remaining
          </div>
        )}
      </div>

      {/* ====== STYLES ====== */}
      <style>{`
        .candy-chat { background: #0d0d0d; }

        .candy-header {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; background: #161616;
          border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .candy-back {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.6); padding: 4px;
          display: flex; align-items: center;
        }
        .candy-back:hover { color: #fff; }
        .candy-header-avatar {
          position: relative; width: 40px; height: 40px; flex-shrink: 0;
        }
        .candy-header-avatar img {
          width: 40px; height: 40px; border-radius: 50%; object-fit: cover;
        }
        .candy-online-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 10px; height: 10px; border-radius: 50%;
          background: #22c55e; border: 2px solid #161616;
        }
        .candy-header-info { flex: 1; }
        .candy-header-name { font-weight: 600; font-size: 15px; color: #fff; }
        .candy-header-status { font-size: 12px; color: rgba(255,255,255,0.45); }
        .candy-header-actions { display: flex; gap: 4px; }
        .candy-hdr-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.5); font-size: 20px; padding: 6px;
        }
        .candy-hdr-btn:hover { color: #fff; }

        /* Messages area */
        .candy-messages {
          flex: 1; overflow-y: auto; padding: 16px 20px;
          background: #0d0d0d;
        }
        .candy-system-msg {
          text-align: center; font-size: 12px; color: rgba(255,255,255,0.3);
          margin: 20px 0;
        }

        /* Message rows */
        .candy-msg {
          display: flex; gap: 8px; margin-bottom: 12px;
          max-width: 75%; animation: msgIn 0.2s ease;
        }
        .candy-msg-user { margin-left: auto; flex-direction: row-reverse; }
        .candy-msg-ai { margin-right: auto; }

        .candy-msg-avatar {
          flex-shrink: 0; width: 32px; height: 32px;
          align-self: flex-end;
        }
        .candy-msg-avatar img {
          width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
        }

        .candy-bubble-area { max-width: 100%; min-width: 0; }

        .candy-bubble {
          padding: 10px 14px; border-radius: 18px;
          word-wrap: break-word; overflow: hidden;
        }
        .candy-bubble-user {
          background: #7c3aed; color: #fff;
          border-bottom-right-radius: 4px;
        }
        .candy-bubble-ai {
          background: #1e1e1e; color: #e5e5e5;
          border: 1px solid rgba(255,255,255,0.06);
          border-bottom-left-radius: 4px;
        }
        .candy-bubble-text { font-size: 14px; line-height: 1.5; }
        .candy-bubble-time {
          font-size: 10px; color: rgba(255,255,255,0.3);
          margin-top: 3px; padding: 0 4px;
        }
        .candy-msg-user .candy-bubble-time { text-align: right; }

        /* Media */
        .candy-media-img {
          max-width: 280px; width: 100%; border-radius: 12px;
          display: block; margin-bottom: 6px;
        }
        .candy-media-video {
          max-width: 280px; width: 100%; border-radius: 12px;
          display: block; margin-bottom: 6px;
        }

        /* Media loading state */
        .candy-media-loading {
          background: #1e1e1e; border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.06);
          padding: 16px 20px; min-width: 240px;
        }
        .candy-media-loading-icon {
          font-size: 28px; margin-bottom: 8px;
        }
        .candy-media-loading-text {
          font-size: 13px; color: #e5e5e5; margin-bottom: 10px;
        }
        .candy-media-progress-bar {
          height: 4px; background: rgba(255,255,255,0.08);
          border-radius: 2px; overflow: hidden; margin-bottom: 6px;
        }
        .candy-media-progress-fill {
          height: 100%; background: linear-gradient(90deg, #7c3aed, #a855f7);
          border-radius: 2px; transition: width 0.3s;
        }
        .candy-media-progress-pct {
          font-size: 11px; color: rgba(255,255,255,0.4);
        }

        /* Input bar */
        .candy-input-bar {
          background: #161616; border-top: 1px solid rgba(255,255,255,0.06);
          padding: 10px 16px; flex-shrink: 0;
        }
        .candy-input-row {
          display: flex; gap: 8px; margin-bottom: 8px;
        }
        .candy-text-input {
          flex: 1; background: #0d0d0d; border: 1px solid rgba(255,255,255,0.08);
          border-radius: 24px; padding: 10px 18px; color: #e5e5e5;
          font-size: 14px; outline: none; font-family: inherit; min-width: 0;
        }
        .candy-text-input::placeholder { color: rgba(255,255,255,0.3); }
        .candy-text-input:focus { border-color: rgba(124,58,237,0.5); }

        .candy-send-btn {
          width: 40px; height: 40px; border-radius: 50%;
          background: #7c3aed; border: none; cursor: pointer;
          color: #fff; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: all 0.15s;
        }
        .candy-send-btn:hover:not(:disabled) { background: #6d28d9; }
        .candy-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .candy-mic-btn {
          width: 40px; height: 40px; border-radius: 50%; border: none;
          background: rgba(255,255,255,0.08); color: #ccc; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .candy-mic-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); color: #fff; }
        .candy-mic-btn.recording { background: #ef4444; color: #fff; animation: pulse 1s infinite; }
        .candy-mic-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }

        .candy-action-row {
          display: flex; align-items: center; gap: 8px;
        }
        .candy-action-label {
          font-size: 12px; color: rgba(255,255,255,0.35);
        }
        .candy-action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; padding: 6px 12px; cursor: pointer;
          color: rgba(255,255,255,0.7); font-size: 12px; font-family: inherit;
          transition: all 0.15s;
        }
        .candy-action-btn:hover:not(:disabled) {
          background: rgba(124,58,237,0.15); border-color: rgba(124,58,237,0.3);
          color: #a855f7;
        }
        .candy-action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .candy-token-cost {
          font-size: 10px; color: rgba(255,255,255,0.3);
          margin-left: 2px;
        }

        .candy-tokens-display {
          font-size: 11px; color: rgba(255,255,255,0.3);
          margin-top: 6px; text-align: center;
        }

        @keyframes msgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

        /* Mobile responsive */
        @media (max-width: 768px) {
          .candy-messages { padding: 10px 12px; }
          .candy-msg { max-width: 88%; }
          .candy-bubble { padding: 8px 12px; }
          .candy-bubble-text { font-size: 13px; }
          .candy-media-img, .candy-media-video { max-width: 220px; }
          .candy-header { padding: 8px 10px; gap: 8px; }
          .candy-header-name { font-size: 14px; }
          .candy-input-bar { padding: 8px 10px; }
          .candy-action-row { flex-wrap: wrap; gap: 6px; }
          .candy-action-label { font-size: 11px; width: 100%; }
          .candy-action-btn { font-size: 11px; padding: 5px 10px; }
          .candy-media-loading { min-width: 200px; padding: 12px 16px; }
          .candy-msg-avatar { width: 26px; height: 26px; }
          .candy-msg-avatar img { width: 26px; height: 26px; }
        }
      `}</style>
    </div>
  );
}
