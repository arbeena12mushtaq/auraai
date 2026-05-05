import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken, TOKEN_COSTS, canUseFeature, getUserTokens } from '../utils/api';
import { Avatar } from '../components/UI';

// ===== WhatsApp Voice Note Bubble =====
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
    return () => { a.removeEventListener('loadedmetadata', onMeta); a.removeEventListener('timeupdate', onTime); a.removeEventListener('ended', onEnd); a.removeEventListener('error', onErr); };
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
  const bars = 30;
  const barHeights = useRef(Array.from({ length: bars }, () => 4 + Math.random() * 18)).current;

  return (
    <div className="wa-vn">
      <audio ref={audioRef} src={src} preload="metadata" />
      {!isUser && avatarUrl && <img src={avatarUrl} alt="" className="wa-vn-avatar" />}
      <button className="wa-vn-play" onClick={toggle}>
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        )}
      </button>
      <div className="wa-vn-waves">
        <div className="wa-vn-bars">
          {barHeights.map((h, i) => (
            <div key={i} className="wa-vn-bar" style={{
              height: `${h}px`,
              background: (i / bars) * 100 <= progress ? '#00a884' : 'rgba(233,237,239,0.25)',
            }} />
          ))}
        </div>
        <span className="wa-vn-dur">{playing ? fmt(currentTime) : fmt(duration)}</span>
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
    <div style={{ padding: 60, textAlign: 'center', background: '#0b141a', color: '#e9edef', minHeight: '100vh' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div><h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
    </div>
  );

  // ===== Send text =====
  const sendText = async () => {
    const t = input.trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }
    setMessages(p => [...p, { role: 'user', type: 'text', content: t, created_at: new Date().toISOString() }]);
    setInput(''); setLoading(true);
    try {
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: t } });
      setMessages(p => [...p, { role: 'assistant', type: 'text', content: d.message.content, created_at: d.message.created_at }]);
      refreshUser();
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(p => [...p, { role: 'assistant', type: 'text', content: err.error || "hey 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // ===== Voice Recording → Whisper STT =====
  const toggleRecording = async () => {
    if (recording) {
      if (mediaRecorderRef.current?.stop) mediaRecorderRef.current.stop();
      setRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { alert('Voice not supported. Open in browser.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recordMime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const recordExt = recordMime.includes('mp4') ? '.mp4' : '.webm';
      const mediaRecorder = new MediaRecorder(stream, recordMime ? { mimeType: recordMime } : {});
      const audioChunks = [];
      mediaRecorderRef.current = mediaRecorder;
      setRecordTime(0);
      recordTimerRef.current = setInterval(() => setRecordTime(t => t + 1), 1000);

      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        const audioBlob = new Blob(audioChunks, { type: recordMime || 'audio/webm' });
        if (audioBlob.size < 500) return;
        const tempBlobUrl = URL.createObjectURL(audioBlob);

        setMessages(prev => [...prev, { role: 'user', content: '🎤', type: 'vn', media_url: tempBlobUrl, created_at: new Date().toISOString() }]);
        setLoading(true);

        let persistentAudioUrl = null;
        try {
          const token = getToken();
          const uploadForm = new FormData();
          uploadForm.append('audio', audioBlob, `voice-note${recordExt}`);
          const uploadRes = await fetch('/api/voice/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: uploadForm });
          if (uploadRes.ok) { const d = await uploadRes.json(); persistentAudioUrl = d.audio_url; }
        } catch (e) { console.warn('Upload fail:', e); }

        let transcript = '';
        try {
          const token = getToken();
          const sttForm = new FormData();
          sttForm.append('audio', audioBlob, `recording${recordExt}`);
          const sttRes = await fetch('/api/voice/stt', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: sttForm });
          if (sttRes.ok) { const d = await sttRes.json(); transcript = d.text || ''; }
        } catch (e) { console.warn('STT fail:', e); }

        if (!transcript) {
          const fb = ['heyy what are you up to rn? 😊','i was just thinking about you','hi babe, tell me something good','sooo... i have something to tell you 😏','hey! miss me? 💕'];
          transcript = fb[Math.floor(Math.random() * fb.length)];
        }

        const userAudioUrl = persistentAudioUrl || tempBlobUrl;
        try {
          const data = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: transcript } });
          if (data.userMessage?.id) { try { await api('/voice/save', { method: 'POST', body: { companionId: companion.id, audioUrl: userAudioUrl, messageId: data.userMessage.id, isUser: true } }); } catch {} }

          if (data.message?.content) {
            let audioSaved = false;
            try {
              const token = getToken();
              const ttsRes = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
  text: data.message.content,
  voice: companion.voice,
  category: companion.category,
  companionId: companion.id,
  companionName: companion.name,
}) });
              if (ttsRes.ok) {
                const ttsData = await ttsRes.json();
                if (ttsData.audio_url) {
                  try { await api('/voice/save', { method: 'POST', body: { companionId: companion.id, audioUrl: ttsData.audio_url, content: data.message.content, messageId: data.message.id } }); audioSaved = true; } catch {}
                } else if (ttsData.useBrowserTTS && 'speechSynthesis' in window) {
                  const utter = new SpeechSynthesisUtterance(ttsData.text || data.message.content);
                  utter.rate = 0.92; utter.pitch = 1.15;
                  const pickV = () => { const v = window.speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')); if (v.length) utter.voice = v[0]; };
                  if (window.speechSynthesis.getVoices().length) pickV(); else window.speechSynthesis.onvoiceschanged = pickV;
                  window.speechSynthesis.speak(utter);
                }
              }
            } catch {}

            try { const cd = await api(`/chat/${companion.id}`); setMessages(cd.messages || []); }
            catch { if (!audioSaved) setMessages(p => [...p, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]); }
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
      alert(e.name === 'NotAllowedError' ? 'Mic access denied.' : 'Cannot access mic.');
      setRecording(false);
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    }
  };

  // ===== Media helpers =====
  const recoverLatestMediaMessage = async (type, attempts = 8, delay = 1500) => {
    for (let i = 0; i < attempts; i++) {
      try { const d = await api(`/chat/${companion.id}`); const l = [...(d.messages||[])].reverse().find(m => m.role==='assistant'&&m.type===type&&m.media_url); if (l) { setMessages(d.messages); return l; } } catch {}
      await new Promise(r => setTimeout(r, delay));
    }
    return null;
  };

  const pollJob = async (jobId, type, maxMs = 660000) => {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      try {
        const d = await api(`/image/job/${jobId}`);
        if (d.status === 'completed') return d;
        if (d.status === 'failed') throw { error: d.error || 'Failed' };
        setMediaProgress(Math.min(90, ((d.elapsed || Date.now()-started) / (type==='video'?180000:90000)) * 90));
      } catch (err) { if (err.status===404) return null; throw err; }
      await new Promise(r => setTimeout(r, 3000));
    }
    return null;
  };

  const handleGenerateImage = async () => {
    if (!canUseFeature(user,'image')&&!user?.is_admin) { onNavigate('pricing'); return; }
    setMediaLoading('image'); setMediaProgress(0);
    try {
      const s = await api('/image/generate-scene',{method:'POST',body:{companionId:companion.id,context:messages.slice(-4).map(m=>m.content).join(' ')}});
      if (!s.jobId) { const u=s.image_url||s.imageUrl||s.media_url; if(u){setMessages(p=>[...p,{role:'assistant',type:'image',content:s.caption||'📸',media_url:u,created_at:new Date().toISOString()}]);refreshUser();} setMediaLoading(null);setMediaProgress(0);return; }
      const r = await pollJob(s.jobId,'image'); setMediaProgress(100);
      if(r){const u=r.image_url||r.imageUrl;if(u){setMessages(p=>[...p,{role:'assistant',type:'image',content:r.caption||'📸',media_url:u,created_at:new Date().toISOString()}]);refreshUser();}else throw{error:'No URL'};}
      else{const rc=await recoverLatestMediaMessage('image',15,3000);if(!rc)setMessages(p=>[...p,{role:'assistant',type:'text',content:'📸 Still generating! Refresh soon.',created_at:new Date().toISOString()}]);}
    } catch(err){if(err.code==='NO_TOKENS')onNavigate('pricing');else if(err.code==='IMAGE_RATE_LIMIT')setMessages(p=>[...p,{role:'assistant',type:'text',content:'⏳ Wait before generating another.',created_at:new Date().toISOString()}]);else{const rc=await recoverLatestMediaMessage('image',10,2500);if(!rc)setMessages(p=>[...p,{role:'assistant',type:'text',content:`📸 Failed — ${err.error||'try again'}`,created_at:new Date().toISOString()}]);}}
    setMediaLoading(null);setMediaProgress(0);
  };

  const handleGenerateVideo = async () => {
    if(!canUseFeature(user,'video')&&!user?.is_admin){onNavigate('pricing');return;}
    setMediaLoading('video');setMediaProgress(0);
    try{
      const s=await api('/image/generate-video',{method:'POST',body:{companionId:companion.id,context:messages.slice(-4).map(m=>m.content).join(' ')}});
      if(!s.jobId){const v=s.video_url||s.videoUrl;const im=s.image_url||s.imageUrl;if(v){setMessages(p=>[...p,{role:'assistant',type:'video',content:'🎬',media_url:v,created_at:new Date().toISOString()}]);refreshUser();}else if(im){setMessages(p=>[...p,{role:'assistant',type:'image',content:'📸',media_url:im,created_at:new Date().toISOString()}]);refreshUser();}setMediaLoading(null);setMediaProgress(0);return;}
      const r=await pollJob(s.jobId,'video',480000);setMediaProgress(100);
      if(r){const u=r.video_url||r.videoUrl;if(u){setMessages(p=>[...p,{role:'assistant',type:'video',content:'🎬',media_url:u,created_at:new Date().toISOString()}]);refreshUser();}else throw{error:'No URL'};}
      else{const rv=await recoverLatestMediaMessage('video',15,3000);if(!rv)await recoverLatestMediaMessage('image',5,2000);if(!rv)setMessages(p=>[...p,{role:'assistant',type:'text',content:'🎬 Still generating!',created_at:new Date().toISOString()}]);}
    }catch(err){if(err.code==='NO_TOKENS')onNavigate('pricing');else if(err.code==='IMAGE_RATE_LIMIT')setMessages(p=>[...p,{role:'assistant',type:'text',content:'⏳ Wait before next video.',created_at:new Date().toISOString()}]);else{const rc=await recoverLatestMediaMessage('video');if(!rc)setMessages(p=>[...p,{role:'assistant',type:'text',content:`🎬 Failed — ${err.error||'try again'}`,created_at:new Date().toISOString()}]);}}
    setMediaLoading(null);setMediaProgress(0);
  };

  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtRec = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <div className="wa-page">
      {/* ====== HEADER (WhatsApp dark) ====== */}
      <div className="wa-header">
        <button className="wa-back" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="wa-hdr-avatar">
          {companion.avatar_url ? <img src={companion.avatar_url} alt={companion.name}/> : <Avatar name={companion.name} size="sm"/>}
        </div>
        <div className="wa-hdr-info">
          <div className="wa-hdr-name">{companion.name}</div>
          <div className="wa-hdr-status">{loading ? 'typing...' : 'online'}</div>
        </div>
        <div className="wa-hdr-icons">
          {/* Video call icon */}
          <button className="wa-hdr-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
          </button>
          {/* Phone icon */}
          <button className="wa-hdr-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          </button>
          {/* Heart / save */}
          <button className="wa-hdr-icon" onClick={() => onToggleSave?.(companion.id)} style={{ color: isSaved ? '#ef4444' : undefined }}>
            {isSaved ? '♥' : '♡'}
          </button>
        </div>
      </div>

      {/* ====== CHAT AREA (with WhatsApp wallpaper) ====== */}
      <div className="wa-chat-area" ref={chatRef}>
        {/* WhatsApp doodle pattern overlay */}
        <div className="wa-wallpaper" />

        <div className="wa-messages">
          {initLoad ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(233,237,239,0.4)' }}>Loading...</div>
          ) : (
            <>
              {messages.length === 0 && (
                <div className="wa-system-pill">
                  <span>Messages are secured. Start chatting with {companion.name} 💬</span>
                </div>
              )}

              {messages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                  <div key={i} className={`wa-msg ${isUser ? 'wa-msg-out' : 'wa-msg-in'}`}>
                    <div className={`wa-bubble ${isUser ? 'wa-bubble-out' : 'wa-bubble-in'}`}>
                      {/* Tail */}
                      <div className={`wa-tail ${isUser ? 'wa-tail-out' : 'wa-tail-in'}`} />

                      {/* Image */}
                      {m.type === 'image' && m.media_url && (
                        <img src={m.media_url} alt="" className="wa-media-img" loading="lazy" onError={(e) => { e.target.style.display='none'; }}/>
                      )}
                      {/* Video */}
                      {m.type === 'video' && m.media_url && (
                        <video src={m.media_url} controls playsInline preload="metadata" className="wa-media-vid" poster={companion.avatar_url||undefined} onError={(e) => { e.target.style.display='none'; }}/>
                      )}
                      {/* Voice note */}
                      {(m.type === 'audio' || m.type === 'vn') && m.media_url && (
                        <VoiceNoteBubble src={m.media_url} isUser={isUser} avatarUrl={isUser ? null : companion.avatar_url}/>
                      )}
                      {/* Text */}
                      {m.content && m.type !== 'audio' && m.type !== 'vn'
                        && !(m.type === 'image' && m.content === '📸')
                        && !(m.type === 'video' && m.content === '🎬')
                        && <span className="wa-text">{m.content}</span>}

                      <span className="wa-meta">
                        <span className="wa-time">{fts(m.created_at)}</span>
                        {isUser && <span className="wa-ticks">✓✓</span>}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Typing */}
              {loading && (
                <div className="wa-msg wa-msg-in">
                  <div className="wa-bubble wa-bubble-in">
                    <div className="wa-tail wa-tail-in"/>
                    <div className="wa-typing"><span/><span/><span/></div>
                  </div>
                </div>
              )}

              {/* Media loading */}
              {mediaLoading && (
                <div className="wa-msg wa-msg-in">
                  <div className="wa-bubble wa-bubble-in" style={{ minWidth: 200 }}>
                    <div className="wa-tail wa-tail-in"/>
                    <div style={{ textAlign: 'center', padding: '8px 0' }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>{mediaLoading === 'image' ? '📸' : '🎬'}</div>
                      <div style={{ fontSize: 12, color: '#8696a0', marginBottom: 8 }}>{companion.name} is sending a {mediaLoading === 'image' ? 'photo' : 'video'}...</div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                        <div style={{ height: '100%', width: `${mediaProgress}%`, background: '#00a884', borderRadius: 2, transition: 'width 0.3s' }}/>
                      </div>
                      <div style={{ fontSize: 10, color: '#8696a0' }}>{Math.round(mediaProgress)}%</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ====== INPUT BAR (WhatsApp exact) ====== */}
      <div className="wa-input-bar">
        {recording ? (
          <div className="wa-rec-bar">
            <button className="wa-rec-delete" onClick={() => { if(mediaRecorderRef.current?.stop)mediaRecorderRef.current.stop(); setRecording(false); if(recordTimerRef.current)clearInterval(recordTimerRef.current); }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
            </button>
            <div className="wa-rec-info">
              <span className="wa-rec-dot"/><span className="wa-rec-timer">{fmtRec(recordTime)}</span>
            </div>
            <button className="wa-send-btn" onClick={() => { if(mediaRecorderRef.current?.stop)mediaRecorderRef.current.stop(); }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </div>
        ) : (
          <div className="wa-input-row">
            {/* Attach / plus */}
            <div className="wa-input-field-wrap">
              <button className="wa-field-icon wa-emoji-btn" title="Emoji">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8696a0" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
              <input
                className="wa-input"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()}
                placeholder="Message"
                disabled={loading || !!mediaLoading}
              />
              <button className="wa-field-icon" onClick={handleGenerateImage} disabled={loading||!!mediaLoading} title="Send photo">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8696a0" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              </button>
            </div>

            {input.trim() ? (
              <button className="wa-send-btn" onClick={sendText} disabled={loading||!!mediaLoading}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
            ) : (
              <button className="wa-mic-btn" onClick={toggleRecording} disabled={loading||!!mediaLoading}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </button>
            )}
          </div>
        )}

        {/* Action row for Image/Video tokens */}
        {!recording && (
          <div className="wa-action-row">
            <button className="wa-action-pill" onClick={handleGenerateVideo} disabled={loading||!!mediaLoading}>
              🎬 Video <span className="wa-action-cost">{TOKEN_COSTS.video}</span>
            </button>
            <button className="wa-action-pill" onClick={handleGenerateImage} disabled={loading||!!mediaLoading}>
              📸 Image <span className="wa-action-cost">{TOKEN_COSTS.image}</span>
            </button>
            {user && <span className="wa-tokens">🪙 {getUserTokens(user)}</span>}
          </div>
        )}
      </div>

      {/* ====== WHATSAPP DARK MODE STYLES ====== */}
      <style>{`
        /* === PAGE === */
        .wa-page {
          display: flex; flex-direction: column;
          height: calc(100vh - var(--topbar-h, 0px));
          background: #0b141a; overflow: hidden;
        }

        /* === HEADER === */
        .wa-header {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          background: #1f2c34;
          flex-shrink: 0; min-height: 52px;
        }
        .wa-back {
          background: none; border: none; cursor: pointer;
          color: #00a884; padding: 2px; display: flex; align-items: center;
        }
        .wa-hdr-avatar { width: 38px; height: 38px; flex-shrink: 0; border-radius: 50%; overflow: hidden; }
        .wa-hdr-avatar img { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; }
        .wa-hdr-info { flex: 1; min-width: 0; }
        .wa-hdr-name { font-weight: 500; font-size: 16px; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .wa-hdr-status { font-size: 12px; color: #8696a0; }
        .wa-hdr-icons { display: flex; gap: 16px; align-items: center; }
        .wa-hdr-icon { background: none; border: none; cursor: pointer; color: #aebac1; font-size: 18px; padding: 2px; display: flex; align-items: center; }

        /* === CHAT AREA === */
        .wa-chat-area {
          flex: 1; overflow-y: auto; position: relative;
          scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent;
        }

        /* WhatsApp doodle wallpaper */
        .wa-wallpaper {
          position: fixed; inset: 0; pointer-events: none; z-index: 0;
          background-color: #0b141a;
          opacity: 0.06;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Ctext x='10' y='20' font-size='14' fill='%23fff' opacity='0.6'%3E💬%3C/text%3E%3Ctext x='45' y='50' font-size='12' fill='%23fff' opacity='0.4'%3E📷%3C/text%3E%3Ctext x='15' y='65' font-size='11' fill='%23fff' opacity='0.5'%3E🎤%3C/text%3E%3Ctext x='55' y='25' font-size='10' fill='%23fff' opacity='0.3'%3E❤️%3C/text%3E%3Ctext x='30' y='42' font-size='9' fill='%23fff' opacity='0.4'%3E🔒%3C/text%3E%3C/svg%3E");
        }

        .wa-messages { position: relative; z-index: 1; padding: 8px 16px 8px; display: flex; flex-direction: column; gap: 2px; min-height: 100%; }

        /* System pill */
        .wa-system-pill {
          align-self: center; background: #182229; border-radius: 8px;
          padding: 6px 14px; margin: 8px 0 12px;
          font-size: 12px; color: #8696a0; text-align: center;
        }

        /* === MESSAGES === */
        .wa-msg { display: flex; animation: waMsgIn 0.15s ease-out; }
        .wa-msg-out { justify-content: flex-end; }
        .wa-msg-in { justify-content: flex-start; }

        .wa-bubble {
          position: relative; max-width: 75%;
          padding: 6px 8px 2px; border-radius: 8px;
          margin-bottom: 2px; word-break: break-word;
        }
        .wa-bubble-out {
          background: #005c4b; color: #e9edef;
          border-top-right-radius: 0;
        }
        .wa-bubble-in {
          background: #1f2c34; color: #e9edef;
          border-top-left-radius: 0;
        }

        /* Bubble tail */
        .wa-tail { position: absolute; top: 0; width: 8px; height: 13px; }
        .wa-tail-out { right: -8px; }
        .wa-tail-out::before {
          content: ''; position: absolute; top: 0; left: 0;
          width: 0; height: 0;
          border-left: 8px solid #005c4b;
          border-bottom: 8px solid transparent;
        }
        .wa-tail-in { left: -8px; }
        .wa-tail-in::before {
          content: ''; position: absolute; top: 0; right: 0;
          width: 0; height: 0;
          border-right: 8px solid #1f2c34;
          border-bottom: 8px solid transparent;
        }

        .wa-text { font-size: 14.2px; line-height: 1.4; white-space: pre-wrap; display: inline; }
        .wa-meta { float: right; margin: 4px 0 -4px 12px; display: flex; align-items: center; gap: 3px; }
        .wa-time { font-size: 10.5px; color: rgba(233,237,239,0.5); }
        .wa-ticks { font-size: 13px; color: #53bdeb; letter-spacing: -4px; margin-left: 1px; }

        /* === MEDIA === */
        .wa-media-img, .wa-media-vid {
          width: 240px; max-width: 100%; border-radius: 6px; margin-bottom: 4px; display: block;
        }

        /* === VOICE NOTE === */
        .wa-vn { display: flex; align-items: center; gap: 8px; min-width: 180px; max-width: 260px; padding: 2px 0; }
        .wa-vn-avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 2px solid #00a884; }
        .wa-vn-play {
          width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
          background: rgba(0,168,132,0.15); color: #00a884;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .wa-vn-play:hover { background: rgba(0,168,132,0.3); }
        .wa-vn-waves { flex: 1; min-width: 0; }
        .wa-vn-bars { display: flex; align-items: center; gap: 1.5px; height: 26px; }
        .wa-vn-bar { width: 2.5px; border-radius: 2px; transition: background 0.1s; flex-shrink: 0; }
        .wa-vn-dur { font-size: 11px; color: rgba(233,237,239,0.45); margin-top: 1px; display: block; }

        /* === TYPING === */
        .wa-typing { display: flex; gap: 4px; padding: 6px 4px; }
        .wa-typing span {
          width: 7px; height: 7px; border-radius: 50%;
          background: #8696a0; animation: waBounce 1.4s infinite ease-in-out both;
        }
        .wa-typing span:nth-child(1) { animation-delay: -0.32s; }
        .wa-typing span:nth-child(2) { animation-delay: -0.16s; }

        /* === INPUT BAR === */
        .wa-input-bar {
          background: #1f2c34; padding: 6px 8px;
          flex-shrink: 0;
        }
        .wa-input-row { display: flex; gap: 6px; align-items: center; }

        .wa-input-field-wrap {
          flex: 1; display: flex; align-items: center;
          background: #2a3942; border-radius: 24px;
          padding: 0 8px; min-height: 42px; gap: 2px;
        }
        .wa-field-icon {
          background: none; border: none; cursor: pointer; color: #8696a0;
          padding: 4px; display: flex; align-items: center; flex-shrink: 0;
        }
        .wa-field-icon:disabled { opacity: 0.3; cursor: not-allowed; }
        .wa-input {
          flex: 1; background: none; border: none; outline: none;
          color: #e9edef; font-size: 15px; padding: 8px 6px;
          font-family: inherit; min-width: 0;
        }
        .wa-input::placeholder { color: #8696a0; }

        /* Send / Mic buttons */
        .wa-send-btn, .wa-mic-btn {
          width: 44px; height: 44px; border-radius: 50%; border: none;
          background: #00a884; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; transition: background 0.15s;
        }
        .wa-send-btn:hover, .wa-mic-btn:hover { background: #02c39a; }
        .wa-send-btn:disabled, .wa-mic-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Recording bar */
        .wa-rec-bar { display: flex; align-items: center; gap: 10px; padding: 2px 0; }
        .wa-rec-delete {
          width: 42px; height: 42px; border-radius: 50%; border: none;
          background: rgba(239,68,68,0.1); cursor: pointer;
          display: flex; align-items: center; justify-content: center;
        }
        .wa-rec-delete:hover { background: rgba(239,68,68,0.2); }
        .wa-rec-info {
          flex: 1; display: flex; align-items: center; gap: 10px;
          background: #2a3942; border-radius: 24px; padding: 10px 16px;
        }
        .wa-rec-dot { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; animation: waPulse 1s infinite; flex-shrink: 0; }
        .wa-rec-timer { font-size: 15px; color: #e9edef; font-variant-numeric: tabular-nums; }

        /* Action row */
        .wa-action-row {
          display: flex; align-items: center; gap: 6px; padding: 6px 4px 2px;
        }
        .wa-action-pill {
          display: flex; align-items: center; gap: 4px;
          background: rgba(0,168,132,0.08);
          border: 1px solid rgba(0,168,132,0.15);
          border-radius: 20px; padding: 4px 12px; cursor: pointer;
          color: #00a884; font-size: 12px; font-family: inherit;
          transition: 0.15s; white-space: nowrap;
        }
        .wa-action-pill:hover:not(:disabled) { background: rgba(0,168,132,0.18); border-color: rgba(0,168,132,0.3); }
        .wa-action-pill:disabled { opacity: 0.3; cursor: not-allowed; }
        .wa-action-cost { font-size: 10px; color: #8696a0; }
        .wa-tokens { font-size: 11px; color: #8696a0; margin-left: auto; }

        /* === ANIMATIONS === */
        @keyframes waBounce { 0%,80%,100%{ transform:scale(0); opacity:.4; } 40%{ transform:scale(1); opacity:1; } }
        @keyframes waMsgIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes waPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

        /* ========== MOBILE ========== */
        @media (max-width: 768px) {
          .wa-page { position: fixed; inset: 0; z-index: 60; height: 100vh; height: 100dvh; padding-top: 0; }
          .wa-header { padding: 6px 8px; gap: 8px; min-height: 48px; padding-top: max(6px, env(safe-area-inset-top)); }
          .wa-hdr-avatar { width: 34px; height: 34px; }
          .wa-hdr-avatar img { width: 34px; height: 34px; }
          .wa-hdr-name { font-size: 15px; }
          .wa-hdr-icons { gap: 12px; }
          .wa-messages { padding: 6px 10px; }
          .wa-bubble { max-width: 85%; }
          .wa-text { font-size: 13.5px; }
          .wa-media-img, .wa-media-vid { width: 100%; max-width: 100%; }
          .wa-input-bar { padding: 5px 6px; padding-bottom: max(5px, env(safe-area-inset-bottom)); }
          .wa-input-field-wrap { min-height: 38px; }
          .wa-input { font-size: 14px; padding: 6px 4px; }
          .wa-send-btn, .wa-mic-btn { width: 40px; height: 40px; }
          .wa-vn { min-width: 150px; max-width: 200px; }
          .wa-action-pill { padding: 3px 8px; font-size: 11px; }
          .wa-rec-delete { width: 38px; height: 38px; }
        }

        @media (max-width: 380px) {
          .wa-header { padding: 4px 6px; gap: 6px; }
          .wa-hdr-avatar { width: 30px; height: 30px; }
          .wa-hdr-avatar img { width: 30px; height: 30px; }
          .wa-hdr-name { font-size: 14px; }
          .wa-hdr-icons { gap: 8px; }
          .wa-hdr-icon svg { width: 18px; height: 18px; }
          .wa-messages { padding: 4px 8px; }
          .wa-bubble { max-width: 90%; padding: 5px 7px 2px; }
          .wa-text { font-size: 13px; }
          .wa-input-bar { padding: 3px 4px; }
          .wa-input { font-size: 13px; }
          .wa-send-btn, .wa-mic-btn { width: 36px; height: 36px; }
          .wa-action-pill { font-size: 10px; padding: 3px 6px; }
        }

        @media (min-width: 769px) {
          .wa-bubble { max-width: 65%; }
          .wa-media-img, .wa-media-vid { width: 280px; }
        }
      `}</style>
    </div>
  );
}
