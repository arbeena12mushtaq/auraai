import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft } from '../utils/api';
import { Avatar } from '../components/UI';

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [avatarVideo, setAvatarVideo] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const chatRef = useRef();
  const mediaRef = useRef();
  const chunksRef = useRef([]);

  useEffect(() => {
    if (!companion) return;
    setInitLoading(true);
    setAvatarVideo(null);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages || [])).catch(() => {}).finally(() => setInitLoading(false));
  }, [companion?.id]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  if (!companion) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
      <h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
    </div>
  );

  // ---- Voice generation ----
  const playTTS = async (text) => {
    try {
      const d = await api('/voice/tts', { method: 'POST', body: { text, voice: companion.voice } });
      if (d.audio_url) {
        // Add as VN message
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant' && last.content === text) {
            last.audio_url = d.audio_url;
          }
          return [...updated];
        });
      }
    } catch {}
  };

  const generateAvatar = async (text) => {
    setAvatarLoading(true);
    try {
      const d = await api('/voice/talking-avatar', {
        method: 'POST',
        body: { text, image_url: companion.avatar_url, voice: companion.voice },
      });
      if (d.video_url) {
        setAvatarVideo(d.video_url);
      }
    } catch {
      // Fallback handled — TTS already plays
    }
    setAvatarLoading(false);
  };

  // ---- Send text message ----
  const sendMessage = async (textOverride) => {
    const text = (textOverride || input).trim();
    if (!text || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    if (!textOverride) setInput('');
    setLoading(true);

    try {
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: text } });
      setMessages(prev => [...prev, d.message]);
      refreshUser();

      if (voiceOn && d.message?.content) {
        playTTS(d.message.content);
        generateAvatar(d.message.content);
      }
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(prev => [...prev, { role: 'assistant', content: err.error || "hey, what's on your mind? 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // ---- Voice recording (user sends VN) ----
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        // Show user's VN in chat
        const audioUrl = URL.createObjectURL(blob);
        setMessages(prev => [...prev, { role: 'user', content: '🎤 Voice message', audio_url: audioUrl, created_at: new Date().toISOString() }]);

        // Transcribe with Whisper
        setLoading(true);
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = reader.result.split(',')[1];
            try {
              const sttData = await api('/voice/stt', { method: 'POST', body: { audio_data: base64 } });
              if (sttData.text) {
                // Send transcribed text as chat message
                await sendMessage(sttData.text);
              }
            } catch {
              setLoading(false);
            }
          };
          reader.readAsDataURL(blob);
        } catch {
          setLoading(false);
        }
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      alert('Microphone access denied. Please allow microphone access to send voice notes.');
    }
  };

  const stopRecording = () => {
    if (mediaRef.current && recording) {
      mediaRef.current.stop();
      setRecording(false);
    }
  };

  const fmt = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="chat-container">
      {/* ---- Header ---- */}
      <div className="chat-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ fontSize: 18, padding: '4px 8px' }}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{companion.name}</div>
          <div style={{ fontSize: 10, color: 'var(--green)' }}>● Online</div>
        </div>
        <button className={`btn btn-sm ${voiceOn ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setVoiceOn(!voiceOn)} style={{ padding: '4px 8px', fontSize: 14 }}>
          {voiceOn ? '🔊' : '🔇'}
        </button>
        <button className="btn btn-ghost" onClick={() => onToggleSave?.(companion.id)}
          style={{ color: isSaved ? 'var(--pink2)' : 'var(--text2)', fontSize: 18, padding: 4 }}>
          {isSaved ? '♥' : '♡'}
        </button>
      </div>

      {/* ---- Talking Avatar Video ---- */}
      {(avatarVideo || avatarLoading) && (
        <div style={{
          padding: 12, borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.4)',
          display: 'flex', justifyContent: 'center', flexShrink: 0,
        }}>
          {avatarVideo ? (
            <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', maxWidth: 260 }}>
              <video src={avatarVideo} autoPlay playsInline
                onEnded={() => setAvatarVideo(null)}
                style={{ width: '100%', borderRadius: 16, display: 'block' }} />
              <button onClick={() => setAvatarVideo(null)}
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12, padding: 6 }}>
              <div style={{ width: 14, height: 14, border: '2px solid var(--border)', borderTopColor: 'var(--pink)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              {companion.name} is preparing a video response...
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
        </div>
      )}

      {/* ---- Messages ---- */}
      <div className="chat-messages" ref={chatRef}>
        {initLoading ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text2)' }}>
                <Avatar name={companion.name} src={companion.avatar_url} size="xl" style={{ margin: '0 auto 14px' }} />
                <h3 style={{ color: 'var(--text)', marginBottom: 4 }}>{companion.name}</h3>
                <p style={{ fontSize: 12 }}>{companion.tagline || companion.personality}</p>
                <p style={{ fontSize: 11, marginTop: 8 }}>
                  Send a message or hold the 🎤 to send a voice note!
                  {voiceOn && ' Voice replies are ON 🔊'}
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                {msg.role !== 'user' && <Avatar name={companion.name} src={companion.avatar_url} size="xs" />}
                <div style={{ maxWidth: '100%' }}>
                  {/* Text bubble */}
                  <div className="message-bubble">{msg.content}</div>

                  {/* Audio player (VN bubble) */}
                  {msg.audio_url && (
                    <div style={{
                      marginTop: 4, padding: '6px 10px', borderRadius: 12,
                      background: msg.role === 'user' ? 'rgba(232,67,126,0.15)' : 'rgba(255,255,255,0.04)',
                      border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <span style={{ fontSize: 14 }}>🎤</span>
                      <audio src={msg.audio_url} controls preload="none"
                        style={{ height: 32, flex: 1, maxWidth: 220 }} />
                    </div>
                  )}

                  {/* Time + play button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, padding: '0 4px' }}>
                    <span style={{ fontSize: 9, color: 'var(--text3)' }}>{fmt(msg.created_at)}</span>
                    {msg.role === 'assistant' && !msg.audio_url && voiceOn && (
                      <button onClick={() => playTTS(msg.content)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text2)', padding: 0 }}>
                        🔊
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="message ai">
                <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                <div className="typing-dots">
                  <span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ---- Input Area ---- */}
      <div className="chat-input-area">
        {/* Voice record button */}
        <button
          className={`btn ${recording ? 'btn-primary' : 'btn-secondary'}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          style={{ padding: '8px 12px', fontSize: 18, flexShrink: 0 }}
          title={recording ? 'Release to send' : 'Hold to record'}
        >
          {recording ? '⏹' : '🎤'}
        </button>

        <input className="input" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder={recording ? 'Recording...' : `Message ${companion.name}...`}
          style={{ flex: 1 }} disabled={loading || recording} />

        <button className="btn btn-primary" onClick={() => sendMessage()} disabled={loading || !input.trim() || recording}>
          Send
        </button>
      </div>

      {/* Recording indicator */}
      {recording && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--red)', color: '#fff', padding: '8px 20px', borderRadius: 20,
          fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 20px rgba(214,56,100,0.4)', zIndex: 100,
          animation: 'pulse4 1s infinite',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'pulse4 1s infinite' }} />
          Recording — release to send
          <style>{`@keyframes pulse4{0%,100%{opacity:1;}50%{opacity:0.6;}}`}</style>
        </div>
      )}
    </div>
  );
}
