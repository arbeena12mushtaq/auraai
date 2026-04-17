import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken } from '../utils/api';
import { Avatar } from '../components/UI';

// AI randomly picks how to respond: mostly text, sometimes voice, rarely video
function pickResponseType(simliAvail) {
  const r = Math.random() * 100;
  if (simliAvail && r < 10) return 'video';   // 10% video (if simli available)
  if (r < 35) return 'voice';                  // 25% voice
  return 'text';                                // 65% text
}

// Simple emoji picker data
const EMOJI_LIST = ['😊','😂','❤️','🔥','😍','🥺','😭','😏','👀','💀','✨','🥰','😘','🤔','😅','🙃','💕','👍','🎉','😎','🤗','💫','🙈','😇','💜','🫶','😢','🤩','💋','🌸'];

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoad, setInitLoad] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [simliAvail, setSimliAvail] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [videoCallActive, setVideoCallActive] = useState(false);
  const [simliSession, setSimliSession] = useState(null);
  const chatRef = useRef();
  const mediaRef = useRef();
  const chunksRef = useRef([]);
  const timerRef = useRef();
  const fileRef = useRef();

  useEffect(() => {
    if (!companion) return;
    setInitLoad(true);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages || [])).catch(() => {}).finally(() => setInitLoad(false));
    api('/voice/simli-config').then(d => setSimliAvail(d.available)).catch(() => {});
  }, [companion?.id]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (showEmoji && !e.target.closest('.wa-emoji-picker') && !e.target.closest('.wa-emoji-btn')) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showEmoji]);

  if (!companion) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div><h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
    </div>
  );

  // ===== Send text message =====
  const sendText = async (to) => {
    const t = (to || input).trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    setMessages(p => [...p, { role: 'user', type: 'text', content: t, created_at: new Date().toISOString() }]);
    if (!to) setInput('');
    setShowEmoji(false);
    setLoading(true);

    try {
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: t } });
      const aiText = d.message.content;
      refreshUser();

      // AI picks response type randomly
      const responseType = pickResponseType(simliAvail);

      if (responseType === 'voice') {
        // Try to generate voice note
        try {
          const vd = await api('/voice/tts', { method: 'POST', body: { text: aiText, voice: companion.voice } });
          if (vd.audio_url) {
            setMessages(p => [...p, {
              role: 'assistant', type: 'vn', content: aiText, audio_url: vd.audio_url,
              created_at: new Date().toISOString()
            }]);
          } else {
            // Fallback to text
            setMessages(p => [...p, { role: 'assistant', type: 'text', content: aiText, created_at: d.message.created_at }]);
          }
        } catch {
          setMessages(p => [...p, { role: 'assistant', type: 'text', content: aiText, created_at: d.message.created_at }]);
        }
      } else if (responseType === 'video') {
        // Try video message
        try {
          const vd = await api('/voice/video-message', {
            method: 'POST',
            body: { text: aiText, voice: companion.voice, companionId: companion.id, avatarUrl: companion.avatar_url },
          });
          if (vd.video_url) {
            setMessages(p => [...p, {
              role: 'assistant', type: 'video', content: aiText, video_url: vd.video_url,
              created_at: new Date().toISOString()
            }]);
          } else if (vd.audio_url) {
            // Video failed, got audio fallback
            setMessages(p => [...p, {
              role: 'assistant', type: 'vn', content: aiText, audio_url: vd.audio_url,
              created_at: new Date().toISOString()
            }]);
          } else {
            setMessages(p => [...p, { role: 'assistant', type: 'text', content: aiText, created_at: d.message.created_at }]);
          }
        } catch {
          setMessages(p => [...p, { role: 'assistant', type: 'text', content: aiText, created_at: d.message.created_at }]);
        }
      } else {
        // Plain text message
        setMessages(p => [...p, { role: 'assistant', type: 'text', content: aiText, created_at: d.message.created_at }]);
      }
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(p => [...p, { role: 'assistant', type: 'text', content: err.error || "hey 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // ===== Send image =====
  const handleImageSend = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setMessages(p => [...p, {
        role: 'user', type: 'image', image_url: ev.target.result,
        content: '📷 Photo', created_at: new Date().toISOString()
      }]);
      // Also send as text to get AI response
      sendText('*sent a photo* 📷');
    };
    reader.readAsDataURL(file);
  };

  // ===== Voice recording =====
  const startRec = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(s);
      chunksRef.current = [];
      r.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      r.onstop = () => {
        s.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        const b = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (b.size > 500) handleVN(b);
      };
      mediaRef.current = r;
      r.start();
      setRecording(true);
      setRecTime(0);
      timerRef.current = setInterval(() => setRecTime(t => t + 1), 1000);
    } catch { alert('Microphone access needed'); }
  };
  const stopRec = () => { if (mediaRef.current && recording) { mediaRef.current.stop(); setRecording(false); } };
  const cancelRec = () => {
    if (mediaRef.current) try { mediaRef.current.stop(); } catch {}
    setRecording(false);
    clearInterval(timerRef.current);
    chunksRef.current = [];
  };

  const handleVN = async (blob) => {
    const u = URL.createObjectURL(blob);
    setMessages(p => [...p, { role: 'user', type: 'vn', audio_url: u, created_at: new Date().toISOString() }]);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      const r = await fetch('/api/voice/stt', { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: fd });
      const s = await r.json();
      if (s.text?.trim()) await sendText(s.text);
      else {
        setMessages(p => [...p, { role: 'assistant', type: 'text', content: "couldn't hear you clearly 🎤 try again?", created_at: new Date().toISOString() }]);
        setLoading(false);
      }
    } catch {
      setMessages(p => [...p, { role: 'assistant', type: 'text', content: "hmm something went wrong 😅 try typing instead?", created_at: new Date().toISOString() }]);
      setLoading(false);
    }
  };

  // ===== Video call =====
  const startVideoCall = async () => {
    try {
      setVideoCallActive(true);
      const d = await api('/voice/simli-start', {
        method: 'POST',
        body: { companionId: companion.id, avatarUrl: companion.avatar_url },
      });
      if (d.available) setSimliSession(d);
    } catch (e) {
      console.log('Video call failed:', e);
    }
  };

  const ft = s => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="chat-container wa-container">

      {/* ====== HEADER (WhatsApp style) ====== */}
      <div className="wa-header">
        <button className="wa-hdr-btn" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div className="wa-hdr-info">
          <div className="wa-hdr-name">{companion.name}</div>
          <div className="wa-hdr-status">{loading ? 'typing...' : 'online'}</div>
        </div>
        <div className="wa-hdr-actions">
          {simliAvail && (
            <button className="wa-hdr-btn" onClick={startVideoCall} title="Video call">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </button>
          )}
          <button className="wa-hdr-btn" title="Voice call">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          </button>
          <button className="wa-hdr-btn" onClick={() => onToggleSave?.(companion.id)}
            style={{ color: isSaved ? '#ff6b9d' : undefined }}>
            {isSaved ? '♥' : '♡'}
          </button>
        </div>
      </div>

      {/* ====== VIDEO CALL OVERLAY ====== */}
      {videoCallActive && (
        <div className="wa-videocall-overlay">
          <div className="wa-videocall-content">
            <div className="wa-videocall-avatar">
              {companion.avatar_url ? (
                <img src={companion.avatar_url} alt={companion.name} />
              ) : (
                <div className="wa-videocall-avatar-placeholder">{companion.name.charAt(0)}</div>
              )}
            </div>
            <h3>{companion.name}</h3>
            <p>{simliSession ? 'Video call active' : 'Connecting...'}</p>
            <button className="wa-endcall-btn" onClick={() => { setVideoCallActive(false); setSimliSession(null); }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="none"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ====== MESSAGES ====== */}
      <div className="wa-messages" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            <div className="wa-date-pill"><span>Today</span></div>

            {messages.length === 0 && (
              <div className="wa-system-msg">
                Messages are end-to-end encrypted. Say hi to {companion.name} 💬
              </div>
            )}

            {messages.map((m, i) => {
              const isUser = m.role === 'user';
              return (
                <div key={i} className={`wa-msg ${isUser ? 'wa-msg-out' : 'wa-msg-in'}`}>
                  <div className={`wa-bubble ${isUser ? 'wa-bubble-out' : 'wa-bubble-in'}`}>

                    {/* Text */}
                    {(m.type === 'text' || (!m.type && !m.audio_url && !m.video_url && !m.image_url)) && (
                      <span className="wa-bubble-text">{m.content}</span>
                    )}

                    {/* Image */}
                    {m.type === 'image' && m.image_url && (
                      <img src={m.image_url} alt="photo" className="wa-bubble-img" />
                    )}

                    {/* Voice Note */}
                    {m.type === 'vn' && m.audio_url && (
                      <div className="wa-vn">
                        {!isUser && (
                          <div className="wa-vn-pic">
                            <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                          </div>
                        )}
                        <audio src={m.audio_url} controls preload="none" />
                      </div>
                    )}

                    {/* Video */}
                    {m.type === 'video' && m.video_url && (
                      <video src={m.video_url} controls preload="metadata" className="wa-bubble-video"
                        poster={companion.avatar_url || undefined} />
                    )}

                    <span className="wa-bubble-meta">
                      <span className="wa-bubble-time">{fts(m.created_at)}</span>
                      {isUser && <span className="wa-bubble-ticks">✓✓</span>}
                    </span>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="wa-msg wa-msg-in">
                <div className="wa-bubble wa-bubble-in">
                  <div className="typing-dots">
                    <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ====== EMOJI PICKER ====== */}
      {showEmoji && (
        <div className="wa-emoji-picker">
          {EMOJI_LIST.map((e, i) => (
            <button key={i} className="wa-emoji-item" onClick={() => setInput(prev => prev + e)}>{e}</button>
          ))}
        </div>
      )}

      {/* ====== INPUT BAR ====== */}
      <div className="wa-input-bar">
        {recording ? (
          /* Recording state */
          <div className="wa-rec-bar">
            <button className="wa-rec-cancel" onClick={cancelRec}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef5350" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
            <div className="wa-rec-indicator">
              <span className="wa-rec-dot" />
              <span className="wa-rec-time">{ft(recTime)}</span>
            </div>
            <button className="wa-send-btn" onClick={stopRec}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        ) : (
          /* Normal input state */
          <>
            <div className="wa-input-left">
              {/* Emoji button */}
              <button className="wa-icon-btn wa-emoji-btn" onClick={() => setShowEmoji(!showEmoji)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>

              {/* Text input */}
              <input
                className="wa-text-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
                placeholder="Type a message"
                disabled={loading}
              />

              {/* Attach file */}
              <button className="wa-icon-btn" onClick={() => fileRef.current?.click()}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImageSend} />

              {/* Camera */}
              <button className="wa-icon-btn" onClick={() => fileRef.current?.click()}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </button>
            </div>

            {/* Send or Mic button */}
            {input.trim() ? (
              <button className="wa-send-btn" onClick={() => sendText()} disabled={loading}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            ) : (
              <button className="wa-mic-btn" onClick={startRec}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
            )}
          </>
        )}
      </div>

      {/* ====== STYLES ====== */}
      <style>{`
        .wa-container {
          background: #0b141a;
          position: relative;
        }

        /* === HEADER === */
        .wa-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          background: #1f2c34;
          flex-shrink: 0;
        }
        .wa-hdr-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.7); padding: 6px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 50%;
        }
        .wa-hdr-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .wa-hdr-info { flex: 1; min-width: 0; }
        .wa-hdr-name { font-weight: 600; font-size: 15px; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wa-hdr-status { font-size: 12px; color: rgba(255,255,255,0.55); }
        .wa-hdr-actions { display: flex; gap: 2px; }

        /* === MESSAGES AREA === */
        .wa-messages {
          flex: 1;
          overflow-y: auto;
          padding: 10px 50px 10px 60px;
          background: #0b141a;
          background-image: url("data:image/svg+xml,%3Csvg width='400' height='400' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' width='40' height='40' patternUnits='userSpaceOnUse'%3E%3Cpath d='M20 5 Q25 10 20 15 Q15 10 20 5z' fill='rgba(255,255,255,0.008)'/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill='url(%23p)' width='400' height='400'/%3E%3C/svg%3E");
        }

        .wa-date-pill {
          text-align: center;
          margin: 8px 0 12px;
        }
        .wa-date-pill span {
          display: inline-block;
          background: #182229;
          color: rgba(255,255,255,0.55);
          font-size: 11.5px;
          padding: 5px 12px;
          border-radius: 7px;
          box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
        }

        .wa-system-msg {
          text-align: center;
          margin: 4px 0 12px;
          font-size: 12px;
          color: rgba(255,255,255,0.45);
          background: rgba(255,255,255,0.04);
          padding: 6px 14px;
          border-radius: 7px;
          max-width: 360px;
          margin-left: auto;
          margin-right: auto;
        }

        /* === MESSAGE ROWS === */
        .wa-msg {
          display: flex;
          margin-bottom: 2px;
        }
        .wa-msg-out { justify-content: flex-end; }
        .wa-msg-in { justify-content: flex-start; }

        /* === BUBBLES === */
        .wa-bubble {
          max-width: 65%;
          min-width: 80px;
          padding: 6px 7px 8px 9px;
          border-radius: 7.5px;
          position: relative;
          box-shadow: 0 1px 0.5px rgba(0,0,0,0.13);
          word-wrap: break-word;
        }
        .wa-bubble-out {
          background: #005c4b;
          border-top-right-radius: 0;
          color: #e9edef;
        }
        .wa-bubble-in {
          background: #1f2c34;
          border-top-left-radius: 0;
          color: #e9edef;
        }

        .wa-bubble-text {
          font-size: 14.2px;
          line-height: 1.38;
          white-space: pre-wrap;
        }

        .wa-bubble-img {
          max-width: 280px;
          width: 100%;
          border-radius: 6px;
          display: block;
          margin-bottom: 4px;
        }

        .wa-bubble-video {
          max-width: 280px;
          width: 100%;
          border-radius: 6px;
          display: block;
          margin-bottom: 4px;
        }

        .wa-bubble-meta {
          float: right;
          margin: 0 0 -5px 12px;
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .wa-bubble-time {
          font-size: 11px;
          color: rgba(255,255,255,0.45);
        }
        .wa-bubble-ticks {
          font-size: 14px;
          color: #53bdeb;
          margin-left: 1px;
        }

        /* Voice note */
        .wa-vn {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 240px;
        }
        .wa-vn-pic { flex-shrink: 0; }
        .wa-vn audio {
          height: 36px;
          flex: 1;
          min-width: 0;
          filter: invert(1) hue-rotate(180deg);
        }

        /* === EMOJI PICKER === */
        .wa-emoji-picker {
          background: #1f2c34;
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 10px 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 2px;
          max-height: 160px;
          overflow-y: auto;
          flex-shrink: 0;
        }
        .wa-emoji-item {
          width: 38px; height: 38px;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px;
          background: none; border: none; cursor: pointer;
          border-radius: 8px;
          transition: background 0.1s;
        }
        .wa-emoji-item:hover { background: rgba(255,255,255,0.08); }

        /* === INPUT BAR === */
        .wa-input-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          background: #1f2c34;
          flex-shrink: 0;
        }

        .wa-input-left {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 2px;
          background: #2a3942;
          border-radius: 24px;
          padding: 4px 8px;
          min-width: 0;
        }

        .wa-icon-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.5);
          padding: 6px;
          display: flex; align-items: center; justify-content: center;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .wa-icon-btn:hover { color: rgba(255,255,255,0.8); }

        .wa-text-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          color: #e9edef;
          font-size: 15px;
          padding: 8px 4px;
          min-width: 0;
          font-family: inherit;
        }
        .wa-text-input::placeholder { color: rgba(255,255,255,0.35); }

        .wa-send-btn {
          width: 42px; height: 42px;
          border-radius: 50%;
          background: #00a884;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .wa-send-btn:hover { background: #06cf9c; }
        .wa-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .wa-mic-btn {
          width: 42px; height: 42px;
          border-radius: 50%;
          background: #00a884;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: background 0.15s;
        }
        .wa-mic-btn:hover { background: #06cf9c; }

        /* Recording bar */
        .wa-rec-bar {
          display: flex; align-items: center; gap: 10px;
          flex: 1;
        }
        .wa-rec-cancel {
          background: none; border: none; cursor: pointer; padding: 6px;
          display: flex; align-items: center;
        }
        .wa-rec-indicator {
          flex: 1;
          display: flex; align-items: center; gap: 8px;
        }
        .wa-rec-dot {
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #ef5350;
          animation: recPulse 1s infinite;
        }
        .wa-rec-time {
          font-size: 15px;
          color: #fff;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }

        /* Video call overlay */
        .wa-videocall-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.95);
          display: flex; align-items: center; justify-content: center;
        }
        .wa-videocall-content {
          text-align: center; color: rgba(255,255,255,0.8);
        }
        .wa-videocall-avatar {
          width: 110px; height: 110px; border-radius: 50%; overflow: hidden;
          margin: 0 auto 20px;
          border: 3px solid #00a884;
          box-shadow: 0 0 30px rgba(0,168,132,0.2);
        }
        .wa-videocall-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .wa-videocall-avatar-placeholder {
          width: 100%; height: 100%;
          background: linear-gradient(135deg, #00a884, #005c4b);
          display: flex; align-items: center; justify-content: center;
          font-size: 40px; font-weight: 800; color: #fff;
        }
        .wa-videocall-content h3 { font-size: 22px; margin-bottom: 4px; }
        .wa-videocall-content p { font-size: 13px; color: rgba(255,255,255,0.5); margin-bottom: 28px; }
        .wa-endcall-btn {
          width: 56px; height: 56px; border-radius: 50%;
          background: #ef5350; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto;
          transition: background 0.15s;
        }
        .wa-endcall-btn:hover { background: #e53935; }

        @keyframes recPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>
    </div>
  );
}
