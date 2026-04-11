import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft } from '../utils/api';
import { Avatar } from '../components/UI';

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [playingAudio, setPlayingAudio] = useState(false);
  const [avatarVideo, setAvatarVideo] = useState(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const chatRef = useRef();
  const audioRef = useRef();
  const videoRef = useRef();

  useEffect(() => {
    if (!companion) return;
    setInitialLoading(true);
    setAvatarVideo(null);
    api(`/chat/${companion.id}`)
      .then(d => setMessages(d.messages || []))
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, [companion?.id]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  if (!companion) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
        <h2>Select a companion to chat</h2>
        <p style={{ color: 'var(--text2)', marginTop: 8 }}>Go to Discover or My AI to start</p>
        <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
      </div>
    );
  }

  // Generate voice (TTS) for a message
  const generateVoice = async (text) => {
    try {
      const data = await api('/voice/tts', {
        method: 'POST',
        body: { text, voice: companion.voice },
      });
      if (data.audio_url) {
        setPlayingAudio(true);
        const audio = new Audio(data.audio_url);
        audioRef.current = audio;
        audio.onended = () => setPlayingAudio(false);
        audio.onerror = () => setPlayingAudio(false);
        audio.play().catch(() => setPlayingAudio(false));
      }
    } catch (err) {
      console.log('TTS failed:', err);
    }
  };

  // Generate talking avatar video
  const generateTalkingAvatar = async (text) => {
    try {
      setAvatarLoading(true);
      const data = await api('/voice/talking-avatar', {
        method: 'POST',
        body: {
          text,
          image_url: companion.avatar_url,
          voice: companion.voice,
        },
      });
      if (data.video_url) {
        setAvatarVideo(data.video_url);
      } else if (data.fallback === 'tts') {
        await generateVoice(text);
      }
    } catch (err) {
      // Fallback to TTS
      console.log('D-ID failed, falling back to TTS');
      await generateVoice(text);
    }
    setAvatarLoading(false);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const data = await api(`/chat/${companion.id}`, {
        method: 'POST',
        body: { content: text },
      });
      setMessages(prev => [...prev, data.message]);
      refreshUser();

      // Auto-generate voice/avatar for AI response
      if (voiceEnabled && data.message?.content) {
        generateTalkingAvatar(data.message.content);
      }
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') {
        onNavigate('pricing');
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: err.error || "I'm here for you! What's on your mind?",
          created_at: new Date().toISOString()
        }]);
      }
    }
    setLoading(false);
  };

  const stopAudio = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPlayingAudio(false);
    setAvatarVideo(null);
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ fontSize: 18, padding: '4px 8px' }}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{companion.name}</div>
          <div style={{ fontSize: 10, color: 'var(--green)' }}>● Online</div>
        </div>
        {/* Voice toggle */}
        <button
          className={`btn btn-sm ${voiceEnabled ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setVoiceEnabled(!voiceEnabled); stopAudio(); }}
          title={voiceEnabled ? 'Voice ON' : 'Voice OFF'}
          style={{ padding: '5px 10px', fontSize: 14 }}
        >
          {voiceEnabled ? '🔊' : '🔇'}
        </button>
        <button className="btn btn-ghost" onClick={() => onToggleSave?.(companion.id)}
          style={{ color: isSaved ? 'var(--pink2)' : 'var(--text2)', fontSize: 18, padding: 4 }}>
          {isSaved ? '♥' : '♡'}
        </button>
      </div>

      {/* Avatar video / image area */}
      {(avatarVideo || avatarLoading || voiceEnabled) && (
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)', flexShrink: 0,
          minHeight: avatarVideo ? 200 : 'auto',
        }}>
          {avatarVideo ? (
            <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', maxWidth: 280 }}>
              <video
                ref={videoRef}
                src={avatarVideo}
                autoPlay
                playsInline
                onEnded={() => setAvatarVideo(null)}
                style={{ width: '100%', borderRadius: 16 }}
              />
              <button onClick={stopAudio}
                style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', fontSize: 12 }}>
                ✕
              </button>
            </div>
          ) : avatarLoading ? (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text2)', fontSize: 12 }}>
                <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--pink)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                Generating response...
              </div>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          ) : playingAudio ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar name={companion.name} src={companion.avatar_url} size="md"
                style={{ border: '3px solid var(--pink)', boxShadow: '0 0 20px rgba(232,67,126,0.3)', animation: 'pulse3 1.5s infinite' }} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--pink2)', fontWeight: 600 }}>{companion.name} is speaking...</div>
                <button className="btn btn-ghost btn-sm" onClick={stopAudio} style={{ fontSize: 11, marginTop: 2 }}>⏹ Stop</button>
              </div>
              <style>{`@keyframes pulse3{0%,100%{box-shadow:0 0 8px rgba(232,67,126,0.2);}50%{box-shadow:0 0 24px rgba(232,67,126,0.5);}}`}</style>
            </div>
          ) : null}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" ref={chatRef}>
        {initialLoading ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text2)' }}>
                <Avatar name={companion.name} src={companion.avatar_url} size="xl" style={{ margin: '0 auto 14px' }} />
                <h3 style={{ color: 'var(--text)', marginBottom: 4 }}>{companion.name}</h3>
                <p style={{ fontSize: 12 }}>{companion.tagline || companion.personality}</p>
                <p style={{ fontSize: 11, marginTop: 6 }}>Say hello to start chatting! {voiceEnabled ? '🔊 Voice is ON' : ''}</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                {msg.role !== 'user' && <Avatar name={companion.name} src={companion.avatar_url} size="xs" />}
                <div>
                  <div className="message-bubble">{msg.content}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, padding: '0 4px' }}>
                    <span style={{ fontSize: 9, color: 'var(--text3)' }}>{formatTime(msg.created_at)}</span>
                    {msg.role === 'assistant' && voiceEnabled && (
                      <button onClick={() => generateVoice(msg.content)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text2)', padding: 0 }}
                        title="Play voice">
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

      {/* Input */}
      <div className="chat-input-area">
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder={`Message ${companion.name}...`}
          style={{ flex: 1 }}
          disabled={loading}
        />
        <button className="btn btn-primary" onClick={sendMessage} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
