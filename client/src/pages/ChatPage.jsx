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
  const [mediaLoading, setMediaLoading] = useState(null);
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

        // Show user's audio message immediately
        setMessages(prev => [...prev, { role: 'user', content: '🎤 Voice message', type: 'audio', media_url: userAudioUrl, created_at: new Date().toISOString() }]);
        setLoading(true);

        try {
          // Step 1: Transcribe audio (STT)
          const formData = new FormData();
          formData.append('audio', blob, 'voice.webm');
          const token = getToken();
          const sttRes = await fetch('/api/voice/stt', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
          });
          const sttData = await sttRes.json();
          const transcribedText = sttData.text || 'Hello';

          // Step 2: Send transcribed text to chat AI — FIXED: use 'content' not 'message'
          const data = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: transcribedText } });

          if (data.message?.content) {
            // Step 3: Convert reply to audio (TTS)
            try {
              const ttsRes = await fetch('/api/voice/tts', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: data.message.content, voice: companion.voice }),
              });
              if (ttsRes.ok) {
                const ttsData = await ttsRes.json();
                if (ttsData.audio_url) {
                  // TTS returns a URL path — use it directly
                  setMessages(prev => [...prev, {
                    role: 'assistant', content: data.message.content,
                    type: 'audio', media_url: ttsData.audio_url,
                    created_at: new Date().toISOString()
                  }]);
                } else {
                  // Fallback: show text
                  setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]);
                }
              } else {
                setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]);
              }
            } catch {
              setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]);
            }
          }
          refreshUser();
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

  const recoverLatestMediaMessage = async (expectedType, attempts = 8, delayMs = 1500) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const d = await api(`/chat/${companion.id}`);
        const latest = [...(d.messages || [])]
          .reverse()
          .find(m => m.role === 'assistant' && m.type === expectedType && m.media_url);
        if (latest) {
          setMessages(d.messages || []);
          return latest;
        }
      } catch (err) {
        console.warn(`recoverLatestMediaMessage attempt ${i + 1} failed`, err);
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    return null;
  };

  // ===== Poll a job until completion =====
  const pollJob = async (jobId, type, maxMs = 660000) => {
    const started = Date.now();
    const delayMs = 3000;
    while (Date.now() - started < maxMs) {
      try {
        const d = await api(`/image/job/${jobId}`);
        if (d.status === 'completed') return d;
        if (d.status === 'failed') throw { error: d.error || `${type} generation failed` };
        // Update progress based on elapsed time
        const elapsed = d.elapsed || (Date.now() - started);
        const estimatedTotal = type === 'video' ? 180000 : 90000;
        setMediaProgress(Math.min(90, (elapsed / estimatedTotal) * 90));
      } catch (err) {
        if (err.status === 404) {
          // Job expired or not found — try recovering from chat history
          return null;
        }
        throw err;
      }
      await new Promise(r => setTimeout(r, delayMs));
    }
    return null; // Timed out, will try recovery
  };

  // ===== Generate Image =====
  const handleGenerateImage = async () => {
    if (!canUseFeature(user, 'image') && !user?.is_admin) {
      onNavigate('pricing');
      return;
    }

    setMediaLoading('image');
    setMediaProgress(0);

    try {
      // Step 1: Start the job (returns immediately)
      const startRes = await api('/image/generate-scene', {
        method: 'POST',
        body: {
          companionId: companion.id,
          context: messages.slice(-4).map(m => m.content).join(' '),
        },
      });

      if (!startRes.jobId) {
        // Fallback: old-style direct response (shouldn't happen with new backend)
        const imageUrl = startRes.image_url || startRes.imageUrl || startRes.media_url;
        if (imageUrl) {
          setMessages(p => [...p, {
            role: 'assistant', type: 'image', content: startRes.caption || '📸',
            media_url: imageUrl, created_at: new Date().toISOString(),
          }]);
          refreshUser();
        }
        setMediaLoading(null);
        setMediaProgress(0);
        return;
      }

      // Step 2: Poll for completion
      const result = await pollJob(startRes.jobId, 'image');
      setMediaProgress(100);

      if (result) {
        const imageUrl = result.image_url || result.imageUrl;
        if (imageUrl) {
          setMessages(p => [...p, {
            role: 'assistant', type: 'image', content: result.caption || '📸',
            media_url: imageUrl, created_at: new Date().toISOString(),
          }]);
          refreshUser();
        } else {
          throw { error: 'Image generated but no URL was returned' };
        }
      } else {
        // Poll timed out — try recovering from DB
        const recovered = await recoverLatestMediaMessage('image', 15, 3000);
        if (!recovered) {
          alert('Image is still generating. Refresh the chat in a moment to see it.');
        }
      }
    } catch (err) {
      if (err.code === 'NO_TOKENS') {
        onNavigate('pricing');
      } else {
        const recovered = await recoverLatestMediaMessage('image', 10, 2500);
        if (!recovered) {
          alert(err.error || 'Image generation failed. Please try again.');
        }
      }
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

    try {
      // Step 1: Start the job
      const startRes = await api('/image/generate-video', {
        method: 'POST',
        body: {
          companionId: companion.id,
          context: messages.slice(-4).map(m => m.content).join(' '),
        },
      });

      if (!startRes.jobId) {
        // Fallback: old-style direct response
        const videoUrl = startRes.video_url || startRes.videoUrl;
        const imageUrl = startRes.image_url || startRes.imageUrl;
        if (videoUrl) {
          setMessages(p => [...p, {
            role: 'assistant', type: 'video', content: startRes.caption || '🎬',
            media_url: videoUrl, created_at: new Date().toISOString(),
          }]);
          refreshUser();
        } else if (imageUrl) {
          setMessages(p => [...p, {
            role: 'assistant', type: 'image', content: startRes.caption || '📸',
            media_url: imageUrl, created_at: new Date().toISOString(),
          }]);
          refreshUser();
        }
        setMediaLoading(null);
        setMediaProgress(0);
        return;
      }

      // Step 2: Poll for completion (videos take longer)
      const result = await pollJob(startRes.jobId, 'video', 480000);
      setMediaProgress(100);

      if (result) {
        const videoUrl = result.video_url || result.videoUrl;
        if (videoUrl) {
          setMessages(p => [...p, {
            role: 'assistant', type: 'video', content: result.caption || '🎬',
            media_url: videoUrl, created_at: new Date().toISOString(),
          }]);
          refreshUser();
        } else {
          throw { error: 'Video generated but no URL was returned' };
        }
      } else {
        const recoveredVideo = await recoverLatestMediaMessage('video', 15, 3000);
        const recoveredImage = recoveredVideo ? null : await recoverLatestMediaMessage('image', 5, 2000);
        if (!recoveredVideo && !recoveredImage) {
          alert('Video is still generating. Refresh the chat in a moment to see it.');
        }
      }
    } catch (err) {
      if (err.code === 'NO_TOKENS') onNavigate('pricing');
      else {
        const recoveredVideo = await recoverLatestMediaMessage('video');
        const recoveredImage = recoveredVideo ? null : await recoverLatestMediaMessage('image');
        if (!recoveredVideo && !recoveredImage) {
          alert(err.error || 'Video generation failed. Please try again.');
        }
      }
    }

    setMediaLoading(null);
    setMediaProgress(0);
  };

  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="aura-chat-page">
      {/* ====== HEADER ====== */}
      <div className="aura-chat-header">
        <button className="aura-chat-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="aura-chat-header-avatar">
          {companion.avatar_url ? (
            <img src={companion.avatar_url} alt={companion.name} />
          ) : (
            <Avatar name={companion.name} size="sm" />
          )}
          <span className="aura-chat-online-dot" />
        </div>
        <div className="aura-chat-header-info">
          <div className="aura-chat-header-name">{companion.name}</div>
          <div className="aura-chat-header-status">{loading ? 'typing...' : 'Online'}</div>
        </div>
        <div className="aura-chat-header-actions">
          <button className="aura-chat-hdr-btn" onClick={() => onToggleSave?.(companion.id)}
            style={{ color: isSaved ? '#ff6b9d' : undefined }}>
            {isSaved ? '♥' : '♡'}
          </button>
        </div>
      </div>

      {/* ====== MESSAGES ====== */}
      <div className="aura-chat-messages" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="aura-chat-system-msg">Start chatting with {companion.name}</div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div key={i} className={`aura-chat-msg ${isUser ? 'aura-chat-msg-user' : 'aura-chat-msg-ai'}`}>
                  {!isUser && (
                    <div className="aura-chat-msg-avatar">
                      {companion.avatar_url ? (
                        <img src={companion.avatar_url} alt="" />
                      ) : (
                        <Avatar name={companion.name} size="xs" />
                      )}
                    </div>
                  )}
                  <div className="aura-chat-bubble-area">
                    <div className={`aura-chat-bubble ${isUser ? 'aura-chat-bubble-user' : 'aura-chat-bubble-ai'}`}>
                      {/* Image message */}
                      {m.type === 'image' && m.media_url && (
                        <img
                          src={m.media_url}
                          alt="Generated"
                          className="aura-chat-media-img"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.textContent = '📸 Image expired — tap to regenerate';
                            fallback.style.cssText = 'padding:12px;color:#a855f7;font-size:12px;text-align:center;';
                            e.target.parentNode.insertBefore(fallback, e.target.nextSibling);
                          }}
                        />
                      )}

                      {/* Video message */}
                      {m.type === 'video' && m.media_url && (
                        <video
                          src={m.media_url}
                          controls
                          playsInline
                          preload="metadata"
                          className="aura-chat-media-video"
                          poster={companion.avatar_url || undefined}
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.textContent = '🎬 Video expired — tap to regenerate';
                            fallback.style.cssText = 'padding:12px;color:#a855f7;font-size:12px;text-align:center;';
                            e.target.parentNode.insertBefore(fallback, e.target.nextSibling);
                          }}
                        />
                      )}

                      {/* Audio / Voice note — handles both 'audio' and 'vn' types */}
                      {(m.type === 'audio' || m.type === 'vn') && m.media_url && (
                        <div className="aura-chat-audio-wrapper">
                          <audio src={m.media_url} controls preload="none" />
                        </div>
                      )}

                      {/* Text — hide emoji-only captions for media types */}
                      {m.content
                        && !(m.type === 'image' && m.content === '📸')
                        && !(m.type === 'video' && m.content === '🎬')
                        && !((m.type === 'audio' || m.type === 'vn') && (m.content === '🎤 Voice message' || m.content === '🔊 Voice reply'))
                        && (
                        <div className="aura-chat-bubble-text">{m.content}</div>
                      )}
                    </div>
                    <div className="aura-chat-bubble-time">{fts(m.created_at)}</div>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {loading && (
              <div className="aura-chat-msg aura-chat-msg-ai">
                <div className="aura-chat-msg-avatar">
                  {companion.avatar_url ? (
                    <img src={companion.avatar_url} alt="" />
                  ) : (
                    <Avatar name={companion.name} size="xs" />
                  )}
                </div>
                <div className="aura-chat-bubble-area">
                  <div className="aura-chat-bubble aura-chat-bubble-ai">
                    <div className="typing-dots">
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Media generation loading */}
            {mediaLoading && (
              <div className="aura-chat-msg aura-chat-msg-ai">
                <div className="aura-chat-msg-avatar">
                  {companion.avatar_url ? (
                    <img src={companion.avatar_url} alt="" />
                  ) : (
                    <Avatar name={companion.name} size="xs" />
                  )}
                </div>
                <div className="aura-chat-bubble-area">
                  <div className="aura-chat-media-loading">
                    <div className="aura-chat-media-loading-icon">
                      {mediaLoading === 'image' ? '📸' : '🎬'}
                    </div>
                    <div className="aura-chat-media-loading-text">
                      {companion.name} is sending a {mediaLoading === 'image' ? 'photo' : 'video'}...
                    </div>
                    <div className="aura-chat-media-progress-bar">
                      <div className="aura-chat-media-progress-fill" style={{ width: `${mediaProgress}%` }} />
                    </div>
                    <div className="aura-chat-media-progress-pct">
                      {Math.round(mediaProgress)}% • {mediaLoading === 'video' ? 'This may take 2-5 minutes' : 'This might take a minute'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ====== INPUT BAR ====== */}
      <div className="aura-chat-input-bar">
        <div className="aura-chat-input-row">
          <input
            className="aura-chat-text-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
            placeholder="Write a message..."
            disabled={loading || !!mediaLoading}
          />
          <button className={`aura-chat-mic-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording}
            disabled={loading || !!mediaLoading}>
            {recording ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            )}
          </button>
          <button className="aura-chat-send-btn" onClick={sendText}
            disabled={loading || !!mediaLoading || !input.trim()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <div className="aura-chat-action-row">
          <span className="aura-chat-action-label">Show me the scene:</span>
          <button className="aura-chat-action-btn" onClick={handleGenerateImage}
            disabled={loading || !!mediaLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Image</span>
            <span className="aura-chat-token-cost">{TOKEN_COSTS.image} tokens</span>
          </button>
          <button className="aura-chat-action-btn" onClick={handleGenerateVideo}
            disabled={loading || !!mediaLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>
            <span>Video</span>
            <span className="aura-chat-token-cost">{TOKEN_COSTS.video} tokens</span>
          </button>
        </div>
        {user && (
          <div className="aura-chat-tokens-display">
            🪙 {getUserTokens(user)} tokens remaining
          </div>
        )}
      </div>

      {/* ====== STYLES ====== */}
      <style>{`
        /* ===== CHAT PAGE — FULL VIEWPORT LAYOUT ===== */
        .aura-chat-page {
          display: flex;
          flex-direction: column;
          height: calc(100vh - var(--topbar-h));
          background: #0d0d0d;
          overflow: hidden;
        }

        /* === HEADER === */
        .aura-chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: #161616;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0;
          min-height: 56px;
        }
        .aura-chat-back {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.6); padding: 4px;
          display: flex; align-items: center;
        }
        .aura-chat-back:hover { color: #fff; }
        .aura-chat-header-avatar {
          position: relative; width: 40px; height: 40px; flex-shrink: 0;
        }
        .aura-chat-header-avatar img {
          width: 40px; height: 40px; border-radius: 50%; object-fit: cover;
        }
        .aura-chat-online-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 10px; height: 10px; border-radius: 50%;
          background: #22c55e; border: 2px solid #161616;
        }
        .aura-chat-header-info { flex: 1; min-width: 0; }
        .aura-chat-header-name {
          font-weight: 600; font-size: 15px; color: #fff;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .aura-chat-header-status { font-size: 12px; color: rgba(255,255,255,0.45); }
        .aura-chat-header-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .aura-chat-hdr-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.5); font-size: 20px; padding: 6px;
        }
        .aura-chat-hdr-btn:hover { color: #fff; }

        /* === MESSAGES AREA === */
        .aura-chat-messages {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 16px 20px;
          background: #0d0d0d;
          -webkit-overflow-scrolling: touch;
        }
        .aura-chat-system-msg {
          text-align: center; font-size: 12px; color: rgba(255,255,255,0.3);
          margin: 20px 0;
        }

        /* === MESSAGE ROWS === */
        .aura-chat-msg {
          display: flex; gap: 8px; margin-bottom: 12px;
          max-width: 75%; animation: auraMsgIn 0.2s ease;
        }
        .aura-chat-msg-user { margin-left: auto; flex-direction: row-reverse; }
        .aura-chat-msg-ai { margin-right: auto; }

        .aura-chat-msg-avatar {
          flex-shrink: 0; width: 32px; height: 32px;
          align-self: flex-end;
        }
        .aura-chat-msg-avatar img {
          width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
        }

        .aura-chat-bubble-area {
          max-width: 100%; min-width: 0; overflow: hidden;
        }

        .aura-chat-bubble {
          padding: 10px 14px; border-radius: 18px;
          word-wrap: break-word; overflow-wrap: break-word; overflow: hidden;
        }
        .aura-chat-bubble-user {
          background: #7c3aed; color: #fff;
          border-bottom-right-radius: 4px;
        }
        .aura-chat-bubble-ai {
          background: #1e1e1e; color: #e5e5e5;
          border: 1px solid rgba(255,255,255,0.06);
          border-bottom-left-radius: 4px;
        }
        .aura-chat-bubble-text { font-size: 14px; line-height: 1.5; }
        .aura-chat-bubble-time {
          font-size: 10px; color: rgba(255,255,255,0.3);
          margin-top: 3px; padding: 0 4px;
        }
        .aura-chat-msg-user .aura-chat-bubble-time { text-align: right; }

        /* === MEDIA === */
        .aura-chat-media-img {
          max-width: 100%;
          width: 280px;
          border-radius: 12px;
          display: block;
          margin-bottom: 6px;
          height: auto;
        }
        .aura-chat-media-video {
          max-width: 100%;
          width: 280px;
          border-radius: 12px;
          display: block;
          margin-bottom: 6px;
          height: auto;
        }

        /* === AUDIO === */
        .aura-chat-audio-wrapper {
          width: 100%;
          min-width: 180px;
          max-width: 280px;
        }
        .aura-chat-audio-wrapper audio {
          width: 100%;
          height: 40px;
          border-radius: 20px;
          outline: none;
        }

        /* === MEDIA LOADING STATE === */
        .aura-chat-media-loading {
          background: #1e1e1e; border-radius: 18px;
          border: 1px solid rgba(255,255,255,0.06);
          padding: 16px 20px; min-width: 220px; max-width: 100%;
        }
        .aura-chat-media-loading-icon { font-size: 28px; margin-bottom: 8px; }
        .aura-chat-media-loading-text { font-size: 13px; color: #e5e5e5; margin-bottom: 10px; }
        .aura-chat-media-progress-bar {
          height: 4px; background: rgba(255,255,255,0.08);
          border-radius: 2px; overflow: hidden; margin-bottom: 6px;
        }
        .aura-chat-media-progress-fill {
          height: 100%; background: linear-gradient(90deg, #7c3aed, #a855f7);
          border-radius: 2px; transition: width 0.3s;
        }
        .aura-chat-media-progress-pct { font-size: 11px; color: rgba(255,255,255,0.4); }

        /* === INPUT BAR === */
        .aura-chat-input-bar {
          background: #161616;
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 10px 16px;
          flex-shrink: 0;
        }
        .aura-chat-input-row {
          display: flex; gap: 8px; margin-bottom: 8px; align-items: center;
        }
        .aura-chat-text-input {
          flex: 1; background: #0d0d0d;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 24px; padding: 10px 18px; color: #e5e5e5;
          font-size: 14px; outline: none; font-family: inherit;
          min-width: 0;
        }
        .aura-chat-text-input::placeholder { color: rgba(255,255,255,0.3); }
        .aura-chat-text-input:focus { border-color: rgba(124,58,237,0.5); }

        .aura-chat-send-btn {
          width: 40px; height: 40px; border-radius: 50%;
          background: #7c3aed; border: none; cursor: pointer;
          color: #fff; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: all 0.15s;
        }
        .aura-chat-send-btn:hover:not(:disabled) { background: #6d28d9; }
        .aura-chat-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .aura-chat-mic-btn {
          width: 40px; height: 40px; border-radius: 50%; border: none;
          background: rgba(255,255,255,0.08); color: #ccc; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: all 0.2s;
        }
        .aura-chat-mic-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); color: #fff; }
        .aura-chat-mic-btn.recording { background: #ef4444; color: #fff; animation: auraPulse 1s infinite; }
        .aura-chat-mic-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .aura-chat-action-row {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .aura-chat-action-label { font-size: 12px; color: rgba(255,255,255,0.35); }
        .aura-chat-action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; padding: 6px 12px; cursor: pointer;
          color: rgba(255,255,255,0.7); font-size: 12px; font-family: inherit;
          transition: all 0.15s; white-space: nowrap;
        }
        .aura-chat-action-btn:hover:not(:disabled) {
          background: rgba(124,58,237,0.15);
          border-color: rgba(124,58,237,0.3);
          color: #a855f7;
        }
        .aura-chat-action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .aura-chat-token-cost { font-size: 10px; color: rgba(255,255,255,0.3); margin-left: 2px; }

        .aura-chat-tokens-display {
          font-size: 11px; color: rgba(255,255,255,0.3);
          margin-top: 6px; text-align: center;
        }

        /* === TYPING DOTS === */
        .typing-dots { display: flex; gap: 4px; padding: 4px 0; }
        .typing-dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: rgba(255,255,255,0.4);
          animation: auraBounce 1.4s infinite ease-in-out both;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }

        @keyframes auraBounce { 0%,80%,100%{ transform:scale(0); opacity:.4; } 40%{ transform:scale(1); opacity:1; } }
        @keyframes auraMsgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes auraPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.1); } }

        /* ========== MOBILE: FULL SCREEN TAKEOVER ========== */
        @media (max-width: 768px) {
          .aura-chat-page {
            position: fixed;
            inset: 0;
            z-index: 60;
            height: 100vh;
            height: 100dvh;
            padding-top: 0;
          }

          .aura-chat-header {
            padding: 8px 10px; gap: 8px;
            min-height: 48px;
            padding-top: max(8px, env(safe-area-inset-top));
          }
          .aura-chat-header-avatar { width: 36px; height: 36px; }
          .aura-chat-header-avatar img { width: 36px; height: 36px; }
          .aura-chat-header-name { font-size: 14px; }
          .aura-chat-header-status { font-size: 11px; }

          .aura-chat-messages { padding: 10px 10px; }
          .aura-chat-msg { max-width: 85%; }
          .aura-chat-bubble { padding: 8px 12px; border-radius: 14px; }
          .aura-chat-bubble-text { font-size: 13px; }

          .aura-chat-media-img,
          .aura-chat-media-video {
            width: 100%;
            max-width: 100%;
            border-radius: 10px;
          }

          .aura-chat-audio-wrapper {
            min-width: 150px;
            max-width: 220px;
          }

          .aura-chat-msg-avatar { width: 26px; height: 26px; }
          .aura-chat-msg-avatar img { width: 26px; height: 26px; }

          .aura-chat-input-bar {
            padding: 6px 8px;
            padding-bottom: max(6px, env(safe-area-inset-bottom));
          }
          .aura-chat-input-row { gap: 6px; }
          .aura-chat-text-input { padding: 8px 14px; font-size: 14px; }
          .aura-chat-send-btn,
          .aura-chat-mic-btn { width: 36px; height: 36px; }
          .aura-chat-send-btn svg,
          .aura-chat-mic-btn svg { width: 18px; height: 18px; }

          .aura-chat-action-row { gap: 4px; }
          .aura-chat-action-label { font-size: 10px; }
          .aura-chat-action-btn { font-size: 11px; padding: 5px 8px; }
          .aura-chat-token-cost { font-size: 9px; }

          .aura-chat-media-loading { min-width: 180px; padding: 12px 14px; }
          .aura-chat-media-loading-icon { font-size: 24px; }
          .aura-chat-media-loading-text { font-size: 12px; }
          .aura-chat-media-progress-pct { font-size: 10px; }

          .aura-chat-tokens-display { font-size: 10px; margin-top: 4px; }
        }

        /* ========== VERY SMALL PHONES ========== */
        @media (max-width: 380px) {
          .aura-chat-header { padding: 6px 8px; gap: 6px; }
          .aura-chat-header-avatar { width: 32px; height: 32px; }
          .aura-chat-header-avatar img { width: 32px; height: 32px; }
          .aura-chat-header-name { font-size: 13px; }

          .aura-chat-messages { padding: 8px; }
          .aura-chat-msg { max-width: 92%; }
          .aura-chat-bubble { padding: 7px 10px; }
          .aura-chat-bubble-text { font-size: 12px; }

          .aura-chat-media-img,
          .aura-chat-media-video { max-width: 100%; }

          .aura-chat-input-bar { padding: 4px 6px; }
          .aura-chat-text-input { padding: 7px 12px; font-size: 13px; }
          .aura-chat-send-btn,
          .aura-chat-mic-btn { width: 32px; height: 32px; }

          .aura-chat-action-label { display: none; }
          .aura-chat-action-btn { font-size: 10px; padding: 4px 6px; }
        }

        /* ========== TABLET / LARGE SCREENS ========== */
        @media (min-width: 769px) and (max-width: 1024px) {
          .aura-chat-msg { max-width: 70%; }
          .aura-chat-media-img,
          .aura-chat-media-video { width: 280px; }
        }

        @media (min-width: 1025px) {
          .aura-chat-msg { max-width: 60%; }
          .aura-chat-media-img,
          .aura-chat-media-video { width: 320px; }
        }
      `}</style>
    </div>
  );
}
