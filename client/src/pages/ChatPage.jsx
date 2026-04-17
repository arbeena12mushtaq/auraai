import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken } from '../utils/api';
import { Avatar } from '../components/UI';

// Response type weights: text most common, voice sometimes, video rare
const RESPONSE_TYPES = [
  { type: 'text', weight: 50 },
  { type: 'voice', weight: 35 },
  { type: 'video', weight: 15 },
];

function pickResponseType() {
  const total = RESPONSE_TYPES.reduce((s, r) => s + r.weight, 0);
  let rand = Math.random() * total;
  for (const r of RESPONSE_TYPES) {
    rand -= r.weight;
    if (rand <= 0) return r.type;
  }
  return 'text';
}

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoad, setInitLoad] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [simliAvail, setSimliAvail] = useState(false);
  const [videoCallActive, setVideoCallActive] = useState(false);
  const [simliSession, setSimliSession] = useState(null);
  const chatRef = useRef();
  const mediaRef = useRef();
  const chunksRef = useRef([]);
  const timerRef = useRef();
  const audioRef = useRef();

  useEffect(() => {
    if (!companion) return;
    setInitLoad(true);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages || [])).catch(() => {}).finally(() => setInitLoad(false));
    api('/voice/simli-config').then(d => setSimliAvail(d.available)).catch(() => {});
  }, [companion?.id]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  if (!companion) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div><h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
    </div>
  );

  // ===== Simli Video Call (full screen live call) =====
  const startVideoCall = async () => {
    try {
      setVideoCallActive(true);
      const d = await api('/voice/simli-start', {
        method: 'POST',
        body: {
          companionId: companion.id,
          avatarUrl: companion.avatar_url, // Pass avatar for Simli face
        },
      });
      if (d.available) {
        setSimliSession(d);
      } else {
        console.log('Simli not available:', d.error);
      }
    } catch (e) {
      console.log('Video call failed:', e);
    }
  };

  // ===== Generate voice note from text =====
  const generateVoiceNote = async (text) => {
    try {
      const d = await api('/voice/tts', { method: 'POST', body: { text, voice: companion.voice } });
      if (d.audio_url) return d.audio_url;
    } catch {}
    return null;
  };

  // ===== Generate video message from text =====
  const generateVideoMessage = async (text) => {
    try {
      const d = await api('/voice/video-message', {
        method: 'POST',
        body: {
          text,
          voice: companion.voice,
          companionId: companion.id,
          avatarUrl: companion.avatar_url,
        },
      });
      if (d.video_url) return d.video_url;
      if (d.audio_url) return { fallbackAudio: d.audio_url }; // Fallback to voice if video fails
    } catch {}
    return null;
  };

  // ===== Play audio =====
  const playAudio = (url) => {
    setSpeaking(true);
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setSpeaking(false);
    a.onerror = () => setSpeaking(false);
    a.play().catch(() => setSpeaking(false));
  };

  // ===== Send text message =====
  const sendText = async (to) => {
    const t = (to || input).trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    setMessages(p => [...p, { role: 'user', type: 'text', content: t, created_at: new Date().toISOString() }]);
    if (!to) setInput('');
    setLoading(true);

    try {
      // Get AI text response
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: t } });
      const aiText = d.message.content;
      refreshUser();

      // Pick response type randomly
      let responseType = pickResponseType();

      // If Simli not available, downgrade video to voice
      if (responseType === 'video' && !simliAvail) responseType = 'voice';

      if (responseType === 'text') {
        // Pure text message
        setMessages(p => [...p, {
          role: 'assistant', type: 'text', content: aiText,
          created_at: d.message.created_at
        }]);
      } else if (responseType === 'voice') {
        // Voice note
        const audioUrl = await generateVoiceNote(aiText);
        if (audioUrl) {
          setMessages(p => [...p, {
            role: 'assistant', type: 'vn', content: aiText, audio_url: audioUrl,
            created_at: new Date().toISOString()
          }]);
          playAudio(audioUrl);
        } else {
          // Fallback to text
          setMessages(p => [...p, {
            role: 'assistant', type: 'text', content: aiText,
            created_at: d.message.created_at
          }]);
        }
      } else if (responseType === 'video') {
        // Video message
        const videoResult = await generateVideoMessage(aiText);
        if (videoResult && typeof videoResult === 'string') {
          setMessages(p => [...p, {
            role: 'assistant', type: 'video', content: aiText, video_url: videoResult,
            created_at: new Date().toISOString()
          }]);
        } else if (videoResult?.fallbackAudio) {
          // Video failed, got audio instead
          setMessages(p => [...p, {
            role: 'assistant', type: 'vn', content: aiText, audio_url: videoResult.fallbackAudio,
            created_at: new Date().toISOString()
          }]);
          playAudio(videoResult.fallbackAudio);
        } else {
          // Full fallback to text
          setMessages(p => [...p, {
            role: 'assistant', type: 'text', content: aiText,
            created_at: d.message.created_at
          }]);
        }
      }
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(p => [...p, { role: 'assistant', type: 'text', content: err.error || "hey 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
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
        setMessages(p => [...p, { role: 'assistant', type: 'text', content: "couldn't hear you 🎤", created_at: new Date().toISOString() }]);
        setLoading(false);
      }
    } catch {
      setMessages(p => [...p, { role: 'assistant', type: 'text', content: "try typing 💬", created_at: new Date().toISOString() }]);
      setLoading(false);
    }
  };

  const ft = s => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  // ===== WhatsApp-style message bubble rendering =====
  const renderMessage = (m, i) => {
    const isUser = m.role === 'user';
    const time = fts(m.created_at);

    return (
      <div key={i} className={`wa-message ${isUser ? 'wa-sent' : 'wa-received'}`}>
        {!isUser && (
          <div className="wa-avatar-col">
            <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
          </div>
        )}
        <div className="wa-bubble-wrap">
          <div className={`wa-bubble ${isUser ? 'wa-bubble-sent' : 'wa-bubble-received'}`}>
            {/* Text message */}
            {(m.type === 'text' || (!m.type && !m.audio_url && !m.video_url)) && (
              <div className="wa-text">{m.content}</div>
            )}

            {/* Voice note */}
            {m.type === 'vn' && m.audio_url && (
              <div className="wa-voice-note">
                <div className="wa-vn-row">
                  {!isUser && (
                    <div className="wa-vn-avatar">
                      <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                    </div>
                  )}
                  <audio src={m.audio_url} controls preload="none" style={{ height: 36, flex: 1, minWidth: 0 }} />
                </div>
              </div>
            )}

            {/* Video message */}
            {m.type === 'video' && m.video_url && (
              <div className="wa-video-msg">
                <video src={m.video_url} controls preload="metadata"
                  style={{ width: '100%', maxWidth: 280, borderRadius: 8 }}
                  poster={companion.avatar_url || undefined} />
              </div>
            )}

            <div className="wa-meta">
              <span className="wa-time">{time}</span>
              {isUser && <span className="wa-ticks">✓✓</span>}
            </div>
          </div>

          {/* Play voice / Watch video buttons for AI messages */}
          {!isUser && m.type === 'text' && m.content && (
            <div className="wa-actions">
              <button onClick={async () => {
                const url = await generateVoiceNote(m.content);
                if (url) playAudio(url);
              }} className="wa-action-btn">🎤 Listen</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-container">
      {/* WhatsApp-style Header */}
      <div className="wa-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ fontSize: 18, padding: '4px 6px', color: '#fff' }}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>{companion.name}</div>
          <div style={{ fontSize: 11, color: speaking ? '#4fc3f7' : 'rgba(255,255,255,0.7)' }}>
            {speaking ? 'speaking...' : loading ? 'typing...' : 'online'}
          </div>
        </div>
        {/* Video call button */}
        {simliAvail && (
          <button className="wa-icon-btn" onClick={startVideoCall} title="Video call">
            📹
          </button>
        )}
        <button className="wa-icon-btn" onClick={() => onToggleSave?.(companion.id)}
          style={{ color: isSaved ? '#ff6b9d' : 'rgba(255,255,255,0.7)' }}>
          {isSaved ? '♥' : '♡'}
        </button>
      </div>

      {/* Simli Video Call overlay */}
      {videoCallActive && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.95)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ textAlign: 'center', color: 'var(--text2)', padding: 20 }}>
            <div style={{
              width: 120, height: 120, borderRadius: '50%', overflow: 'hidden',
              margin: '0 auto 16px', border: '3px solid var(--pink)',
              boxShadow: '0 0 30px rgba(232,67,126,0.3)',
            }}>
              {companion.avatar_url ? (
                <img src={companion.avatar_url} alt={companion.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{
                  width: '100%', height: '100%', background: 'linear-gradient(135deg,var(--pink),var(--red))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 40, fontWeight: 800, color: '#fff'
                }}>{companion.name.charAt(0)}</div>
              )}
            </div>
            <h3 style={{ marginBottom: 8 }}>{companion.name}</h3>
            {simliSession ? (
              <p style={{ fontSize: 13, marginBottom: 4 }}>Video call active</p>
            ) : (
              <p style={{ fontSize: 13, marginBottom: 4 }}>Connecting...</p>
            )}
            <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 20 }}>
              {simliSession ? 'Simli video stream running' : 'Starting Simli session...'}
            </p>
            <button className="btn btn-primary" onClick={() => { setVideoCallActive(false); setSimliSession(null); }}
              style={{ background: '#e53935' }}>
              End Call
            </button>
          </div>
        </div>
      )}

      {/* WhatsApp-style chat background + messages */}
      <div className="wa-chat-area" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {/* Date divider */}
            <div className="wa-date-divider">
              <span>Today</span>
            </div>

            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '20px 16px', color: 'var(--text2)', fontSize: 12 }}>
                Say hi to {companion.name} 💬
              </div>
            )}

            {messages.map((m, i) => renderMessage(m, i))}

            {loading && (
              <div className="wa-message wa-received">
                <div className="wa-avatar-col">
                  <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                </div>
                <div className="wa-bubble-wrap">
                  <div className="wa-bubble wa-bubble-received">
                    <div className="typing-dots">
                      <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* WhatsApp-style Input */}
      <div className="wa-input-area">
        {recording ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e53935', animation: 'recPulse 1s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: '#e53935', fontWeight: 600, flex: 1 }}>Recording {ft(recTime)}</span>
            <button className="btn btn-secondary btn-sm" onClick={cancelRec}>✕</button>
            <button className="wa-send-btn" onClick={stopRec}>✓</button>
          </div>
        ) : (
          <>
            <button className="wa-attach-btn" onClick={startRec} title="Send voice message">🎤</button>
            <input className="wa-input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
              placeholder={`Message ${companion.name}...`} disabled={loading} />
            <button className="wa-send-btn" onClick={() => sendText()} disabled={loading || !input.trim()}>
              ➤
            </button>
          </>
        )}
      </div>

      <style>{`
        /* ===== WhatsApp-style overrides ===== */
        .wa-header {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 12px; background: #1f2c33;
          border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .wa-icon-btn {
          background: none; border: none; cursor: pointer;
          font-size: 18px; padding: 6px; color: rgba(255,255,255,0.7);
        }
        .wa-icon-btn:hover { color: #fff; }

        .wa-chat-area {
          flex: 1; overflow-y: auto; padding: 12px 16px;
          background: #0b141a;
          background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M15 30 Q30 15 45 30 Q30 45 15 30' fill='none' stroke='rgba(255,255,255,0.015)' stroke-width='0.5'/%3E%3C/svg%3E");
        }

        .wa-date-divider {
          text-align: center; margin: 8px 0 16px;
        }
        .wa-date-divider span {
          background: #1d2b33; color: rgba(255,255,255,0.5);
          font-size: 11px; padding: 4px 12px; border-radius: 6px;
        }

        .wa-message {
          display: flex; gap: 6px; margin-bottom: 4px;
          max-width: 85%;
        }
        .wa-sent { margin-left: auto; flex-direction: row-reverse; }
        .wa-received { margin-right: auto; }

        .wa-avatar-col { flex-shrink: 0; margin-top: auto; margin-bottom: 4px; }

        .wa-bubble-wrap { max-width: 100%; min-width: 0; }

        .wa-bubble {
          padding: 6px 8px; border-radius: 8px;
          position: relative; word-wrap: break-word;
          max-width: 100%;
        }
        .wa-bubble-sent {
          background: #005c4b; border-top-right-radius: 0;
          color: #e9edef;
        }
        .wa-bubble-received {
          background: #1f2c33; border-top-left-radius: 0;
          color: #e9edef;
        }

        .wa-text { font-size: 14px; line-height: 1.4; padding-right: 50px; }

        .wa-meta {
          display: flex; align-items: center; gap: 4px;
          justify-content: flex-end; margin-top: 2px;
        }
        .wa-time { font-size: 10px; color: rgba(255,255,255,0.45); }
        .wa-ticks { font-size: 12px; color: #53bdeb; }

        .wa-voice-note { min-width: 200px; }
        .wa-vn-row { display: flex; align-items: center; gap: 8px; }
        .wa-vn-avatar { flex-shrink: 0; }

        .wa-video-msg { }
        .wa-video-msg video { display: block; }

        .wa-actions {
          display: flex; gap: 6px; margin-top: 3px; padding-left: 4px;
        }
        .wa-action-btn {
          background: none; border: none; cursor: pointer;
          font-size: 11px; color: rgba(255,255,255,0.4); padding: 2px 4px;
        }
        .wa-action-btn:hover { color: rgba(255,255,255,0.8); }

        .wa-input-area {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 10px; background: #1f2c33;
          border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
        }
        .wa-attach-btn {
          background: none; border: none; cursor: pointer;
          font-size: 20px; padding: 6px; color: rgba(255,255,255,0.5); flex-shrink: 0;
        }
        .wa-attach-btn:hover { color: rgba(255,255,255,0.8); }

        .wa-input {
          flex: 1; padding: 10px 14px; border-radius: 20px;
          border: none; outline: none; font-size: 14px;
          background: #2a3942; color: #e9edef;
          min-width: 0;
        }
        .wa-input::placeholder { color: rgba(255,255,255,0.35); }

        .wa-send-btn {
          width: 40px; height: 40px; border-radius: 50%;
          background: #00a884; border: none; cursor: pointer;
          color: #fff; font-size: 18px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          transition: background 0.2s;
        }
        .wa-send-btn:hover { background: #06cf9c; }
        .wa-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        @keyframes recPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>
    </div>
  );
}
