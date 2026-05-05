import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken, TOKEN_COSTS, canUseFeature, getUserTokens } from '../utils/api';
import { Avatar } from '../components/UI';

// ===== WhatsApp-style Voice Note Bubble =====
function VoiceNoteBubble({ src, isUser, avatarUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onMeta = () => setDuration(a.duration || 0);
    const onTime = () => setCurrentTime(a.currentTime || 0);
    const onEnd = () => { setPlaying(false); setCurrentTime(0); };
    const onErr = () => setPlaying(false);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('ended', onEnd);
    a.addEventListener('error', onErr);
    return () => {
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('error', onErr);
    };
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
  };

  const fmt = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bars = 28;
  const barHeights = useRef(Array.from({ length: bars }, () => 8 + Math.random() * 20)).current;

  return (
    <div className={`vn-bubble ${isUser ? 'vn-user' : 'vn-ai'}`}>
      <audio ref={audioRef} src={src} preload="metadata" />
      {!isUser && avatarUrl && <img src={avatarUrl} alt="" className="vn-avatar" />}
      <button className="vn-play-btn" onClick={toggle}>
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="vn-wave-area">
        <div className="vn-waveform">
          {barHeights.map((h, i) => (
            <div key={i} className="vn-bar" style={{
              height: `${h}px`,
              background: (i / bars) * 100 <= progress
                ? (isUser ? 'rgba(255,255,255,0.9)' : '#a855f7')
                : (isUser ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)'),
            }} />
          ))}
        </div>
        <div className="vn-time">{playing ? fmt(currentTime) : fmt(duration)}</div>
      </div>
    </div>
  );
}

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initLoad, setInitLoad] = useState(true);
  const [mediaLoading, setMediaLoading] = useState(null);
  const [mediaProgress, setMediaProgress] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const recordTimerRef = useRef(null);
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

  // ===== Voice Recording — sends to server for Whisper STT =====
  const toggleRecording = async () => {
    if (recording) {
      if (mediaRecorderRef.current?.stop) mediaRecorderRef.current.stop();
      setRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Voice recording not supported. Try opening in your browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordMime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const recordExt = recordMime.includes('mp4') ? '.mp4' : '.webm';
      const mediaRecorder = new MediaRecorder(stream, recordMime ? { mimeType: recordMime } : {});
      const audioChunks = [];
      mediaRecorderRef.current = mediaRecorder;

      // Timer
      setRecordTime(0);
      recordTimerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);

        const audioBlob = new Blob(audioChunks, { type: recordMime || 'audio/webm' });
        if (audioBlob.size < 500) return; // Too short, discard

        const tempBlobUrl = URL.createObjectURL(audioBlob);

        // Show user's voice note immediately
        setMessages(prev => [...prev, {
          role: 'user', content: '🎤', type: 'vn',
          media_url: tempBlobUrl,
          created_at: new Date().toISOString(),
        }]);
        setLoading(true);

        // Upload audio to server for persistence
        let persistentAudioUrl = null;
        try {
          const token = getToken();
          const uploadForm = new FormData();
          uploadForm.append('audio', audioBlob, `voice-note${recordExt}`);
          const uploadRes = await fetch('/api/voice/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: uploadForm,
          });
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            persistentAudioUrl = uploadData.audio_url;
          }
        } catch (e) { console.warn('Voice upload failed:', e); }

        // ── SERVER-SIDE STT (OpenAI Whisper) ──
        let transcript = '';
        try {
          const token = getToken();
          const sttForm = new FormData();
          sttForm.append('audio', audioBlob, `recording${recordExt}`);
          const sttRes = await fetch('/api/voice/stt', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: sttForm,
          });
          if (sttRes.ok) {
            const sttData = await sttRes.json();
            transcript = sttData.text || '';
            if (transcript) console.log('STT transcript:', transcript);
          }
        } catch (e) { console.warn('STT failed:', e); }

        // If transcription is empty, use a natural fallback (NEVER mention voice/audio)
        if (!transcript) {
          const fallbacks = [
            'heyy what are you up to rn? 😊',
            'i was just thinking about you',
            'hi babe, tell me something good',
            'sooo... i have something to tell you 😏',
            'hey! miss me? 💕',
          ];
          transcript = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        const userAudioUrl = persistentAudioUrl || tempBlobUrl;

        try {
          // Send transcribed text to AI (hidden — user only sees audio bubble)
          const data = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: transcript } });

          // Mark user message as voice note in DB
          if (data.userMessage?.id) {
            try { await api('/voice/save', { method: 'POST', body: { companionId: companion.id, audioUrl: userAudioUrl, messageId: data.userMessage.id, isUser: true } }); } catch {}
          }

          if (data.message?.content) {
            // Convert AI reply to audio via TTS
            let audioSaved = false;
            try {
              const token = getToken();
              const ttsRes = await fetch('/api/voice/tts', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: data.message.content, voice: companion.voice }),
              });
              if (ttsRes.ok) {
                const ttsData = await ttsRes.json();
                if (ttsData.audio_url) {
                  try {
                    await api('/voice/save', {
                      method: 'POST',
                      body: { companionId: companion.id, audioUrl: ttsData.audio_url, content: data.message.content, messageId: data.message.id },
                    });
                    audioSaved = true;
                  } catch (e) { console.warn('Voice save failed:', e); }
                } else if (ttsData.useBrowserTTS && 'speechSynthesis' in window) {
                  const utter = new SpeechSynthesisUtterance(ttsData.text || data.message.content);
                  utter.rate = 0.92;
                  utter.pitch = 1.15;
                  const pickVoice = () => {
                    const voices = window.speechSynthesis.getVoices();
                    const en = voices.filter(v => v.lang.startsWith('en'));
                    for (const hint of (ttsData.voiceHints?.nameHints || ['samantha', 'sara', 'female'])) {
                      const m = en.find(v => v.name.toLowerCase().includes(hint));
                      if (m) { utter.voice = m; return; }
                    }
                    if (en.length) utter.voice = en[0];
                  };
                  if (window.speechSynthesis.getVoices().length) pickVoice();
                  else window.speechSynthesis.onvoiceschanged = pickVoice;
                  window.speechSynthesis.speak(utter);
                }
              }
            } catch (e) { console.error('TTS error:', e); }

            // Reload messages from DB
            try {
              const chatData = await api(`/chat/${companion.id}`);
              setMessages(chatData.messages || []);
            } catch {
              if (!audioSaved) {
                setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]);
              }
            }
          }
          refreshUser();
        } catch (err) { console.error('Voice chat error:', err); }
        setLoading(false);
      };

      mediaRecorder.start();
      setRecording(true);
      setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 30000);

    } catch (e) {
      console.error('Mic error:', e);
      if (e.name === 'NotAllowedError') alert('Microphone access denied.');
      else alert('Could not access microphone.');
      setRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    }
  };

  // ===== Media generation helpers =====
  const recoverLatestMediaMessage = async (expectedType, attempts = 8, delayMs = 1500) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const d = await api(`/chat/${companion.id}`);
        const latest = [...(d.messages || [])].reverse().find(m => m.role === 'assistant' && m.type === expectedType && m.media_url);
        if (latest) { setMessages(d.messages || []); return latest; }
      } catch {}
      await new Promise(r => setTimeout(r, delayMs));
    }
    return null;
  };

  const pollJob = async (jobId, type, maxMs = 660000) => {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      try {
        const d = await api(`/image/job/${jobId}`);
        if (d.status === 'completed') return d;
        if (d.status === 'failed') throw { error: d.error || `${type} generation failed` };
        const elapsed = d.elapsed || (Date.now() - started);
        const est = type === 'video' ? 180000 : 90000;
        setMediaProgress(Math.min(90, (elapsed / est) * 90));
      } catch (err) {
        if (err.status === 404) return null;
        throw err;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    return null;
  };

  const handleGenerateImage = async () => {
    if (!canUseFeature(user, 'image') && !user?.is_admin) { onNavigate('pricing'); return; }
    setMediaLoading('image'); setMediaProgress(0);
    try {
      const startRes = await api('/image/generate-scene', { method: 'POST', body: { companionId: companion.id, context: messages.slice(-4).map(m => m.content).join(' ') } });
      if (!startRes.jobId) {
        const url = startRes.image_url || startRes.imageUrl || startRes.media_url;
        if (url) { setMessages(p => [...p, { role: 'assistant', type: 'image', content: startRes.caption || '📸', media_url: url, created_at: new Date().toISOString() }]); refreshUser(); }
        setMediaLoading(null); setMediaProgress(0); return;
      }
      const result = await pollJob(startRes.jobId, 'image'); setMediaProgress(100);
      if (result) {
        const url = result.image_url || result.imageUrl;
        if (url) { setMessages(p => [...p, { role: 'assistant', type: 'image', content: result.caption || '📸', media_url: url, created_at: new Date().toISOString() }]); refreshUser(); }
        else throw { error: 'No URL returned' };
      } else {
        const recovered = await recoverLatestMediaMessage('image', 15, 3000);
        if (!recovered) setMessages(p => [...p, { role: 'assistant', type: 'text', content: '📸 Still generating! Refresh in a moment.', created_at: new Date().toISOString() }]);
      }
    } catch (err) {
      if (err.code === 'NO_TOKENS') onNavigate('pricing');
      else if (err.code === 'IMAGE_RATE_LIMIT') setMessages(p => [...p, { role: 'assistant', type: 'text', content: '⏳ Wait a moment before generating another image.', created_at: new Date().toISOString() }]);
      else { const r = await recoverLatestMediaMessage('image', 10, 2500); if (!r) setMessages(p => [...p, { role: 'assistant', type: 'text', content: `📸 Didn't work — ${err.error || 'try again!'}`, created_at: new Date().toISOString() }]); }
    }
    setMediaLoading(null); setMediaProgress(0);
  };

  const handleGenerateVideo = async () => {
    if (!canUseFeature(user, 'video') && !user?.is_admin) { onNavigate('pricing'); return; }
    setMediaLoading('video'); setMediaProgress(0);
    try {
      const startRes = await api('/image/generate-video', { method: 'POST', body: { companionId: companion.id, context: messages.slice(-4).map(m => m.content).join(' ') } });
      if (!startRes.jobId) {
        const vUrl = startRes.video_url || startRes.videoUrl;
        const iUrl = startRes.image_url || startRes.imageUrl;
        if (vUrl) { setMessages(p => [...p, { role: 'assistant', type: 'video', content: '🎬', media_url: vUrl, created_at: new Date().toISOString() }]); refreshUser(); }
        else if (iUrl) { setMessages(p => [...p, { role: 'assistant', type: 'image', content: '📸', media_url: iUrl, created_at: new Date().toISOString() }]); refreshUser(); }
        setMediaLoading(null); setMediaProgress(0); return;
      }
      const result = await pollJob(startRes.jobId, 'video', 480000); setMediaProgress(100);
      if (result) {
        const url = result.video_url || result.videoUrl;
        if (url) { setMessages(p => [...p, { role: 'assistant', type: 'video', content: '🎬', media_url: url, created_at: new Date().toISOString() }]); refreshUser(); }
        else throw { error: 'No URL' };
      } else {
        const rv = await recoverLatestMediaMessage('video', 15, 3000);
        if (!rv) await recoverLatestMediaMessage('image', 5, 2000);
        if (!rv) setMessages(p => [...p, { role: 'assistant', type: 'text', content: '🎬 Still generating! Refresh soon.', created_at: new Date().toISOString() }]);
      }
    } catch (err) {
      if (err.code === 'NO_TOKENS') onNavigate('pricing');
      else if (err.code === 'IMAGE_RATE_LIMIT') setMessages(p => [...p, { role: 'assistant', type: 'text', content: '⏳ Wait before generating another video.', created_at: new Date().toISOString() }]);
      else { const r = await recoverLatestMediaMessage('video'); if (!r) setMessages(p => [...p, { role: 'assistant', type: 'text', content: `🎬 Didn't work — ${err.error || 'try again!'}`, created_at: new Date().toISOString() }]); }
    }
    setMediaLoading(null); setMediaProgress(0);
  };

  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtRecordTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="aura-chat-page">
      {/* ====== HEADER ====== */}
      <div className="aura-chat-header">
        <button className="aura-chat-back" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="aura-chat-header-avatar">
          {companion.avatar_url ? <img src={companion.avatar_url} alt={companion.name} /> : <Avatar name={companion.name} size="sm" />}
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
                      {companion.avatar_url ? <img src={companion.avatar_url} alt="" /> : <Avatar name={companion.name} size="xs" />}
                    </div>
                  )}
                  <div className="aura-chat-bubble-area">
                    <div className={`aura-chat-bubble ${isUser ? 'aura-chat-bubble-user' : 'aura-chat-bubble-ai'}`}>
                      {m.type === 'image' && m.media_url && (
                        <img src={m.media_url} alt="Generated" className="aura-chat-media-img" loading="lazy"
                          onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                      )}
                      {m.type === 'video' && m.media_url && (
                        <video src={m.media_url} controls playsInline preload="metadata" className="aura-chat-media-video"
                          poster={companion.avatar_url || undefined}
                          onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }} />
                      )}
                      {(m.type === 'audio' || m.type === 'vn') && m.media_url && (
                        <VoiceNoteBubble src={m.media_url} isUser={isUser} avatarUrl={isUser ? null : companion.avatar_url} />
                      )}
                      {m.content && m.type !== 'audio' && m.type !== 'vn'
                        && !(m.type === 'image' && m.content === '📸')
                        && !(m.type === 'video' && m.content === '🎬')
                        && <div className="aura-chat-bubble-text">{m.content}</div>}
                    </div>
                    <div className="aura-chat-bubble-time">{fts(m.created_at)}</div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="aura-chat-msg aura-chat-msg-ai">
                <div className="aura-chat-msg-avatar">
                  {companion.avatar_url ? <img src={companion.avatar_url} alt="" /> : <Avatar name={companion.name} size="xs" />}
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

            {mediaLoading && (
              <div className="aura-chat-msg aura-chat-msg-ai">
                <div className="aura-chat-msg-avatar">
                  {companion.avatar_url ? <img src={companion.avatar_url} alt="" /> : <Avatar name={companion.name} size="xs" />}
                </div>
                <div className="aura-chat-bubble-area">
                  <div className="aura-chat-media-loading">
                    <div className="aura-chat-media-loading-icon">{mediaLoading === 'image' ? '📸' : '🎬'}</div>
                    <div className="aura-chat-media-loading-text">{companion.name} is sending a {mediaLoading === 'image' ? 'photo' : 'video'}...</div>
                    <div className="aura-chat-media-progress-bar">
                      <div className="aura-chat-media-progress-fill" style={{ width: `${mediaProgress}%` }} />
                    </div>
                    <div className="aura-chat-media-progress-pct">{Math.round(mediaProgress)}% • {mediaLoading === 'video' ? '2-5 min' : '~1 min'}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ====== INPUT BAR ====== */}
      <div className="aura-chat-input-bar">
        {recording ? (
          /* Recording state — WhatsApp style */
          <div className="aura-chat-recording-bar">
            <button className="aura-chat-rec-cancel" onClick={() => { if (mediaRecorderRef.current?.stop) mediaRecorderRef.current.stop(); setRecording(false); if (recordTimerRef.current) clearInterval(recordTimerRef.current); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/></svg>
            </button>
            <div className="aura-chat-rec-indicator">
              <span className="aura-chat-rec-dot" />
              <span className="aura-chat-rec-time">{fmtRecordTime(recordTime)}</span>
            </div>
            <button className="aura-chat-rec-send" onClick={() => { if (mediaRecorderRef.current?.stop) mediaRecorderRef.current.stop(); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        ) : (
          <>
            <div className="aura-chat-input-row">
              <input
                className="aura-chat-text-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
                placeholder="Write a message..."
                disabled={loading || !!mediaLoading}
              />
              {input.trim() ? (
                <button className="aura-chat-send-btn" onClick={sendText} disabled={loading || !!mediaLoading}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
              ) : (
                <button className={`aura-chat-mic-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={loading || !!mediaLoading}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                </button>
              )}
            </div>
            <div className="aura-chat-action-row">
              <span className="aura-chat-action-label">Show me the scene:</span>
              <button className="aura-chat-action-btn" onClick={handleGenerateImage} disabled={loading || !!mediaLoading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>Image</span>
                <span className="aura-chat-token-cost">{TOKEN_COSTS.image} tokens</span>
              </button>
              <button className="aura-chat-action-btn" onClick={handleGenerateVideo} disabled={loading || !!mediaLoading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
                <span>Video</span>
                <span className="aura-chat-token-cost">{TOKEN_COSTS.video} tokens</span>
              </button>
            </div>
            {user && <div className="aura-chat-tokens-display">🪙 {getUserTokens(user)} tokens remaining</div>}
          </>
        )}
      </div>

      {/* ====== STYLES ====== */}
      <style>{`
        .aura-chat-page {
          display: flex; flex-direction: column;
          height: calc(100vh - var(--topbar-h));
          background: #0d0d0d; overflow: hidden;
        }

        /* === HEADER === */
        .aura-chat-header {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; background: #161616;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          flex-shrink: 0; min-height: 56px;
        }
        .aura-chat-back {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.6); padding: 4px; display: flex; align-items: center;
        }
        .aura-chat-back:hover { color: #fff; }
        .aura-chat-header-avatar { position: relative; width: 40px; height: 40px; flex-shrink: 0; }
        .aura-chat-header-avatar img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
        .aura-chat-online-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 10px; height: 10px; border-radius: 50%;
          background: #22c55e; border: 2px solid #161616;
        }
        .aura-chat-header-info { flex: 1; min-width: 0; }
        .aura-chat-header-name { font-weight: 600; font-size: 15px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .aura-chat-header-status { font-size: 12px; color: rgba(255,255,255,0.45); }
        .aura-chat-header-actions { display: flex; gap: 8px; }
        .aura-chat-hdr-btn {
          background: none; border: none; cursor: pointer;
          color: rgba(255,255,255,0.5); font-size: 20px; padding: 4px;
        }
        .aura-chat-hdr-btn:hover { color: #fff; }

        /* === MESSAGES === */
        .aura-chat-messages {
          flex: 1; overflow-y: auto; padding: 16px; display: flex;
          flex-direction: column; gap: 6px;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
        }
        .aura-chat-system-msg { text-align: center; color: rgba(255,255,255,0.3); font-size: 13px; padding: 20px 0; }
        .aura-chat-msg { display: flex; gap: 8px; max-width: 75%; animation: auraMsgIn 0.2s ease-out; }
        .aura-chat-msg-user { align-self: flex-end; flex-direction: row-reverse; }
        .aura-chat-msg-ai { align-self: flex-start; }
        .aura-chat-msg-avatar { width: 30px; height: 30px; flex-shrink: 0; border-radius: 50%; overflow: hidden; margin-top: 4px; }
        .aura-chat-msg-avatar img { width: 30px; height: 30px; border-radius: 50%; object-fit: cover; }
        .aura-chat-bubble-area { display: flex; flex-direction: column; }
        .aura-chat-bubble { padding: 10px 14px; border-radius: 16px; overflow: hidden; word-break: break-word; }
        .aura-chat-bubble-user {
          background: #7c3aed; color: #fff;
          border-bottom-right-radius: 4px;
        }
        .aura-chat-bubble-ai {
          background: #1e1e1e; color: #e5e5e5;
          border-bottom-left-radius: 4px;
        }
        .aura-chat-bubble-text { font-size: 14px; line-height: 1.45; white-space: pre-wrap; }
        .aura-chat-bubble-time { font-size: 10px; color: rgba(255,255,255,0.25); margin-top: 2px; padding: 0 4px; }
        .aura-chat-msg-user .aura-chat-bubble-time { text-align: right; }

        /* === MEDIA === */
        .aura-chat-media-img, .aura-chat-media-video {
          width: 220px; max-width: 100%; border-radius: 12px; margin-bottom: 4px; display: block;
        }
        .aura-chat-media-loading {
          background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.15);
          border-radius: 14px; padding: 16px 18px; min-width: 200px; text-align: center;
        }
        .aura-chat-media-loading-icon { font-size: 28px; margin-bottom: 8px; }
        .aura-chat-media-loading-text { font-size: 13px; color: #e5e5e5; margin-bottom: 10px; }
        .aura-chat-media-progress-bar { height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
        .aura-chat-media-progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #a855f7); border-radius: 2px; transition: width 0.3s; }
        .aura-chat-media-progress-pct { font-size: 11px; color: rgba(255,255,255,0.4); }

        /* === VOICE NOTE BUBBLES === */
        .vn-bubble { display: flex; align-items: center; gap: 8px; min-width: 180px; max-width: 260px; padding: 4px 0; }
        .vn-user { flex-direction: row; }
        .vn-ai { flex-direction: row; }
        .vn-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
        .vn-play-btn {
          width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: 0.15s;
        }
        .vn-user .vn-play-btn { background: rgba(255,255,255,0.2); color: #fff; }
        .vn-ai .vn-play-btn { background: rgba(168,85,247,0.2); color: #a855f7; }
        .vn-wave-area { flex: 1; min-width: 0; }
        .vn-waveform { display: flex; align-items: center; gap: 1.5px; height: 28px; }
        .vn-bar { width: 2.5px; border-radius: 2px; transition: background 0.1s; }
        .vn-time { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 2px; }

        /* === INPUT BAR === */
        .aura-chat-input-bar {
          background: #161616; border-top: 1px solid rgba(255,255,255,0.06);
          padding: 10px 16px; flex-shrink: 0;
        }
        .aura-chat-input-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .aura-chat-text-input {
          flex: 1; background: #0d0d0d;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 24px; padding: 10px 18px; color: #e5e5e5;
          font-size: 14px; outline: none; font-family: inherit; min-width: 0;
        }
        .aura-chat-text-input::placeholder { color: rgba(255,255,255,0.3); }
        .aura-chat-text-input:focus { border-color: rgba(124,58,237,0.5); }
        .aura-chat-send-btn {
          width: 40px; height: 40px; border-radius: 50%;
          background: #7c3aed; border: none; cursor: pointer;
          color: #fff; display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: 0.15s;
        }
        .aura-chat-send-btn:hover:not(:disabled) { background: #6d28d9; }
        .aura-chat-send-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .aura-chat-mic-btn {
          width: 40px; height: 40px; border-radius: 50%; border: none;
          background: rgba(255,255,255,0.08); color: #ccc; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: 0.2s;
        }
        .aura-chat-mic-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); color: #fff; }
        .aura-chat-mic-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        /* === RECORDING BAR (WhatsApp-style) === */
        .aura-chat-recording-bar {
          display: flex; align-items: center; gap: 12px; padding: 4px 0;
        }
        .aura-chat-rec-cancel {
          width: 40px; height: 40px; border-radius: 50%; border: none;
          background: rgba(239,68,68,0.15); color: #ef4444; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .aura-chat-rec-cancel:hover { background: rgba(239,68,68,0.3); }
        .aura-chat-rec-indicator {
          flex: 1; display: flex; align-items: center; gap: 10px;
          background: #0d0d0d; border-radius: 24px; padding: 10px 18px;
        }
        .aura-chat-rec-dot {
          width: 10px; height: 10px; border-radius: 50%; background: #ef4444;
          animation: auraPulse 1s infinite; flex-shrink: 0;
        }
        .aura-chat-rec-time { font-size: 14px; color: #e5e5e5; font-variant-numeric: tabular-nums; }
        .aura-chat-rec-send {
          width: 40px; height: 40px; border-radius: 50%; border: none;
          background: #7c3aed; color: #fff; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .aura-chat-rec-send:hover { background: #6d28d9; }

        /* === ACTION ROW === */
        .aura-chat-action-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .aura-chat-action-label { font-size: 12px; color: rgba(255,255,255,0.35); }
        .aura-chat-action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 8px; padding: 6px 12px; cursor: pointer;
          color: rgba(255,255,255,0.7); font-size: 12px; font-family: inherit;
          transition: 0.15s; white-space: nowrap;
        }
        .aura-chat-action-btn:hover:not(:disabled) { background: rgba(124,58,237,0.15); border-color: rgba(124,58,237,0.3); color: #a855f7; }
        .aura-chat-action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
        .aura-chat-token-cost { font-size: 10px; color: rgba(255,255,255,0.3); margin-left: 2px; }
        .aura-chat-tokens-display { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 6px; text-align: center; }

        /* === TYPING DOTS === */
        .typing-dots { display: flex; gap: 4px; padding: 4px 0; }
        .typing-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.4); animation: auraBounce 1.4s infinite ease-in-out both; }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }

        @keyframes auraBounce { 0%,80%,100%{ transform:scale(0); opacity:.4; } 40%{ transform:scale(1); opacity:1; } }
        @keyframes auraMsgIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes auraPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }

        /* ========== MOBILE ========== */
        @media (max-width: 768px) {
          .aura-chat-page { position: fixed; inset: 0; z-index: 60; height: 100vh; height: 100dvh; padding-top: 0; }
          .aura-chat-header { padding: 8px 10px; gap: 8px; min-height: 48px; padding-top: max(8px, env(safe-area-inset-top)); }
          .aura-chat-header-avatar { width: 36px; height: 36px; }
          .aura-chat-header-avatar img { width: 36px; height: 36px; }
          .aura-chat-header-name { font-size: 14px; }
          .aura-chat-header-status { font-size: 11px; }
          .aura-chat-messages { padding: 10px 10px; }
          .aura-chat-msg { max-width: 85%; }
          .aura-chat-bubble { padding: 8px 12px; border-radius: 14px; }
          .aura-chat-bubble-text { font-size: 13px; }
          .aura-chat-media-img, .aura-chat-media-video { width: 100%; max-width: 100%; border-radius: 10px; }
          .aura-chat-msg-avatar { width: 26px; height: 26px; }
          .aura-chat-msg-avatar img { width: 26px; height: 26px; }
          .aura-chat-input-bar { padding: 6px 8px; padding-bottom: max(6px, env(safe-area-inset-bottom)); }
          .aura-chat-input-row { gap: 6px; }
          .aura-chat-text-input { padding: 8px 14px; font-size: 14px; }
          .aura-chat-send-btn, .aura-chat-mic-btn { width: 36px; height: 36px; }
          .aura-chat-send-btn svg, .aura-chat-mic-btn svg { width: 18px; height: 18px; }
          .aura-chat-action-row { gap: 4px; }
          .aura-chat-action-label { font-size: 10px; }
          .aura-chat-action-btn { font-size: 11px; padding: 5px 8px; }
          .aura-chat-token-cost { font-size: 9px; }
          .aura-chat-media-loading { min-width: 180px; padding: 12px 14px; }
          .aura-chat-tokens-display { font-size: 10px; margin-top: 4px; }
          .vn-bubble { min-width: 150px; max-width: 220px; }
          .aura-chat-rec-cancel, .aura-chat-rec-send { width: 36px; height: 36px; }
        }

        @media (max-width: 380px) {
          .aura-chat-header { padding: 6px 8px; gap: 6px; }
          .aura-chat-header-avatar { width: 32px; height: 32px; }
          .aura-chat-header-avatar img { width: 32px; height: 32px; }
          .aura-chat-header-name { font-size: 13px; }
          .aura-chat-messages { padding: 8px; }
          .aura-chat-msg { max-width: 92%; }
          .aura-chat-bubble { padding: 7px 10px; }
          .aura-chat-bubble-text { font-size: 12px; }
          .aura-chat-input-bar { padding: 4px 6px; }
          .aura-chat-text-input { padding: 7px 12px; font-size: 13px; }
          .aura-chat-send-btn, .aura-chat-mic-btn { width: 32px; height: 32px; }
          .aura-chat-action-label { display: none; }
          .aura-chat-action-btn { font-size: 10px; padding: 4px 6px; }
        }

        @media (min-width: 769px) and (max-width: 1024px) {
          .aura-chat-msg { max-width: 70%; }
          .aura-chat-media-img, .aura-chat-media-video { width: 200px; }
        }
        @media (min-width: 1025px) {
          .aura-chat-msg { max-width: 60%; }
          .aura-chat-media-img, .aura-chat-media-video { width: 240px; }
        }
      `}</style>
    </div>
  );
}
