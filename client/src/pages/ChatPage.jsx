import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken } from '../utils/api';
import { Avatar } from '../components/UI';

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoad, setInitLoad] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [avatarVideo, setAvatarVideo] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const chatRef = useRef();
  const mediaRef = useRef();
  const chunksRef = useRef([]);
  const timerRef = useRef();

  useEffect(() => {
    if (!companion) return;
    setInitLoad(true); setAvatarVideo(null);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages || [])).catch(() => {}).finally(() => setInitLoad(false));
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

  // ==== Play TTS for a message ====
  const playTTS = async (text, msgIdx) => {
    try {
      const d = await api('/voice/tts', { method: 'POST', body: { text, voice: companion.voice } });
      if (d.audio_url) {
        setMessages(prev => prev.map((m, i) => i === msgIdx ? { ...m, audio_url: d.audio_url } : m));
      }
    } catch {}
  };

  // ==== Generate D-ID video ====
  const genAvatar = async (text) => {
    setAvatarLoading(true);
    try {
      const d = await api('/voice/talking-avatar', {
        method: 'POST', body: { text, image_url: companion.avatar_url, voice: companion.voice },
      });
      if (d.video_url) setAvatarVideo(d.video_url);
    } catch {}
    setAvatarLoading(false);
  };

  // ==== Send text message ====
  const sendText = async (text) => {
    const t = (text || input).trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    setMessages(prev => [...prev, { role: 'user', content: t, created_at: new Date().toISOString() }]);
    if (!text) setInput('');
    setLoading(true);

    try {
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: t } });
      const aiMsg = { ...d.message };
      setMessages(prev => {
        const updated = [...prev, aiMsg];
        // Auto-gen voice
        if (voiceOn && aiMsg.content) {
          const idx = updated.length - 1;
          playTTS(aiMsg.content, idx);
          genAvatar(aiMsg.content);
        }
        return updated;
      });
      refreshUser();
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(prev => [...prev, { role: 'assistant', content: err.error || "hey what's up? 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // ==== Voice recording ====
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        handleVoiceNote(blob);
      };
      mediaRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecTime(0);
      timerRef.current = setInterval(() => setRecTime(t => t + 1), 1000);
    } catch {
      alert('Please allow microphone access to send voice notes.');
    }
  };

  const stopRec = () => {
    if (mediaRef.current && recording) {
      mediaRef.current.stop();
      setRecording(false);
    }
  };

  const handleVoiceNote = async (blob) => {
    // Show user's VN
    const localUrl = URL.createObjectURL(blob);
    setMessages(prev => [...prev, {
      role: 'user', content: '🎤 Voice note', audio_url: localUrl, created_at: new Date().toISOString(),
    }]);

    setLoading(true);
    try {
      // Upload audio file for STT
      const formData = new FormData();
      formData.append('audio', blob, 'voice.webm');

      const token = getToken();
      const res = await fetch('/api/voice/stt', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const sttData = await res.json();

      if (sttData.text && sttData.text.trim()) {
        // Send transcribed text
        await sendText(sttData.text);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant', content: "I couldn't catch that, could you try again? 🎤",
          created_at: new Date().toISOString(),
        }]);
        setLoading(false);
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant', content: "hmm I couldn't hear you clearly... try typing instead? 💬",
        created_at: new Date().toISOString(),
      }]);
      setLoading(false);
    }
  };

  const fmtTime = s => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  const fmtTs = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ fontSize: 18, padding: '4px 6px' }}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{companion.name}</div>
          <div style={{ fontSize: 10, color: 'var(--green)' }}>● Online</div>
        </div>
        <button className={`btn btn-sm ${voiceOn ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setVoiceOn(!voiceOn)} style={{ padding: '4px 8px', fontSize: 13 }}
          title={voiceOn ? 'Voice & Video ON' : 'Text only'}>
          {voiceOn ? '🔊' : '🔇'}
        </button>
        <button className="btn btn-ghost" onClick={() => onToggleSave?.(companion.id)}
          style={{ color: isSaved ? 'var(--pink2)' : 'var(--text2)', fontSize: 18, padding: 4 }}>
          {isSaved ? '♥' : '♡'}
        </button>
      </div>

      {/* Talking avatar video */}
      {(avatarVideo || avatarLoading) && (
        <div style={{ padding: 10, borderBottom: '1px solid var(--border)', background: '#000', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          {avatarVideo ? (
            <div style={{ position: 'relative', maxWidth: 300, width: '100%' }}>
              <video src={avatarVideo} autoPlay playsInline onEnded={() => setAvatarVideo(null)}
                style={{ width: '100%', borderRadius: 14, display: 'block' }} />
              <button onClick={() => setAvatarVideo(null)}
                style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: 26, height: 26, cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12, padding: 8 }}>
              <div className="spin-loader" />
              {companion.name} is recording a video...
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text2)' }}>
                <Avatar name={companion.name} src={companion.avatar_url} size="xl" style={{ margin: '0 auto 14px' }} />
                <h3 style={{ color: 'var(--text)', marginBottom: 4 }}>{companion.name}</h3>
                <p style={{ fontSize: 12, marginBottom: 8 }}>{companion.tagline || companion.personality}</p>
                <p style={{ fontSize: 11 }}>Type a message or tap 🎤 to send a voice note</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                {msg.role !== 'user' && <Avatar name={companion.name} src={companion.avatar_url} size="xs" />}
                <div style={{ maxWidth: '100%', minWidth: 0 }}>
                  {/* Text */}
                  <div className="message-bubble">{msg.content}</div>

                  {/* VN audio player */}
                  {msg.audio_url && (
                    <div style={{
                      marginTop: 4, borderRadius: 14, overflow: 'hidden',
                      background: msg.role === 'user' ? 'rgba(232,67,126,0.15)' : 'var(--bg4)',
                      border: '1px solid var(--border)', padding: '6px 8px',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ fontSize: 16 }}>🎤</span>
                      <audio src={msg.audio_url} controls preload="none"
                        style={{ height: 28, flex: 1, minWidth: 0, maxWidth: 200 }} />
                    </div>
                  )}

                  {/* Timestamp + replay button */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, padding: '0 4px' }}>
                    <span style={{ fontSize: 9, color: 'var(--text3)' }}>{fmtTs(msg.created_at)}</span>
                    {msg.role === 'assistant' && !msg.audio_url && voiceOn && (
                      <button onClick={() => playTTS(msg.content, i)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--pink2)', padding: 0 }}
                        title="Play voice">🔊 Play</button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="message ai">
                <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                <div className="typing-dots"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input area */}
      <div className="chat-input-area">
        {recording ? (
          /* Recording UI */
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)', animation: 'pulse4 1s infinite' }} />
              <span style={{ fontSize: 13, color: 'var(--red)', fontWeight: 600 }}>Recording {fmtTime(recTime)}</span>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { mediaRef.current?.stop(); setRecording(false); clearInterval(timerRef.current); chunksRef.current = []; }}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={stopRec} style={{ padding: '8px 16px' }}>
              ✓ Send
            </button>
          </div>
        ) : (
          /* Normal input */
          <>
            <button className="btn btn-secondary" onClick={startRec}
              style={{ padding: '8px 12px', fontSize: 16, flexShrink: 0 }} title="Record voice note">
              🎤
            </button>
            <input className="input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
              placeholder={`Message ${companion.name}...`}
              style={{ flex: 1 }} disabled={loading} />
            <button className="btn btn-primary" onClick={() => sendText()} disabled={loading || !input.trim()}>
              Send
            </button>
          </>
        )}
      </div>

      <style>{`
        .spin-loader { width:14px; height:14px; border:2px solid var(--border); border-top-color:var(--pink); border-radius:50%; animation:spin 0.7s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes pulse4 { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
      `}</style>
    </div>
  );
}
