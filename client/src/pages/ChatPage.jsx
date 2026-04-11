import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [speaking, setSpeaking] = useState(false);
  const [simliReady, setSimliReady] = useState(false);
  const [simliConfig, setSimliConfig] = useState(null);
  const chatRef = useRef();
  const mediaRef = useRef();
  const chunksRef = useRef([]);
  const timerRef = useRef();
  const audioRef = useRef();
  const videoRef = useRef();
  const simliAudioRef = useRef();
  const simliClientRef = useRef();

  // Load chat history
  useEffect(() => {
    if (!companion) return;
    setInitLoad(true);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages || [])).catch(() => {}).finally(() => setInitLoad(false));
  }, [companion?.id]);

  // Auto scroll
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  // Load Simli SDK
  useEffect(() => {
    api('/voice/simli-config').then(cfg => {
      if (cfg.available) {
        setSimliConfig(cfg);
        // Load Simli client SDK
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/simli-client@latest/dist/SimliClient.js';
        script.onload = () => setSimliReady(true);
        script.onerror = () => console.log('Simli SDK failed to load');
        document.head.appendChild(script);
      }
    }).catch(() => {});
  }, []);

  // Initialize Simli connection when entering chat
  const initSimli = useCallback(async () => {
    if (!simliConfig || !window.SimliClient || !videoRef.current || !simliAudioRef.current) return;
    try {
      const client = new window.SimliClient();
      client.Initialize({
        apiKey: simliConfig.apiKey,
        faceID: companion.simli_face_id || '5514e24d-6086-46a3-ace4-6a7264e5cb7c', // default face
        handleSilence: true,
        maxSessionLength: 600,
        maxIdleTime: 120,
        videoRef: videoRef.current,
        audioRef: simliAudioRef.current,
      });
      await client.start();
      simliClientRef.current = client;
      console.log('✅ Simli connected');
    } catch (e) {
      console.log('Simli init failed:', e);
    }
  }, [simliConfig, companion]);

  if (!companion) return (
    <div style={{ padding: 60, textAlign: 'center' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
      <h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
    </div>
  );

  // Send audio to Simli avatar
  const sendToSimli = async (pcmUrl) => {
    try {
      if (!simliClientRef.current) {
        await initSimli();
      }
      if (simliClientRef.current) {
        const res = await fetch(pcmUrl);
        const buffer = await res.arrayBuffer();
        const uint8 = new Uint8Array(buffer);
        // Send in chunks
        const chunkSize = 6000;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          const chunk = uint8.slice(i, i + chunkSize);
          simliClientRef.current.sendAudioData(chunk);
          await new Promise(r => setTimeout(r, 100));
        }
        setSpeaking(true);
        setTimeout(() => setSpeaking(false), (uint8.length / 32000) * 1000 + 1000);
      }
    } catch (e) {
      console.log('Simli send failed:', e);
    }
  };

  // Generate voice + avatar
  const genVoiceAndAvatar = async (text) => {
    setSpeaking(true);
    try {
      if (simliReady && simliConfig) {
        // Get PCM audio for Simli
        const d = await api('/voice/tts-pcm', { method: 'POST', body: { text, voice: companion.voice } });
        if (d.pcm_url) sendToSimli(d.pcm_url);
        if (d.audio_url) {
          setMessages(prev => [...prev, { role: 'assistant', type: 'vn', audio_url: d.audio_url, created_at: new Date().toISOString() }]);
        }
      } else {
        // Fallback: TTS only with animated avatar
        const d = await api('/voice/tts', { method: 'POST', body: { text, voice: companion.voice } });
        if (d.audio_url) {
          setMessages(prev => [...prev, { role: 'assistant', type: 'vn', audio_url: d.audio_url, created_at: new Date().toISOString() }]);
          const a = new Audio(d.audio_url);
          audioRef.current = a;
          a.onended = () => setSpeaking(false);
          a.play().catch(() => setSpeaking(false));
          return;
        }
      }
    } catch {
      setSpeaking(false);
    }
  };

  // Send text message
  const sendText = async (textOverride) => {
    const t = (textOverride || input).trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }

    setMessages(prev => [...prev, { role: 'user', type: 'text', content: t, created_at: new Date().toISOString() }]);
    if (!textOverride) setInput('');
    setLoading(true);

    try {
      const d = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: t } });
      setMessages(prev => [...prev, { role: 'assistant', type: 'text', content: d.message.content, created_at: d.message.created_at }]);
      refreshUser();
      if (voiceOn && d.message?.content) genVoiceAndAvatar(d.message.content);
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(prev => [...prev, { role: 'assistant', type: 'text', content: err.error || "hey 💕", created_at: new Date().toISOString() }]);
    }
    setLoading(false);
  };

  // Voice recording
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(timerRef.current);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size > 500) handleVN(blob);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
      setRecTime(0);
      timerRef.current = setInterval(() => setRecTime(t => t + 1), 1000);
    } catch { alert('Please allow microphone access.'); }
  };

  const stopRec = () => { if (mediaRef.current && recording) { mediaRef.current.stop(); setRecording(false); } };
  const cancelRec = () => { if (mediaRef.current) try { mediaRef.current.stop(); } catch {} setRecording(false); clearInterval(timerRef.current); chunksRef.current = []; };

  const handleVN = async (blob) => {
    const localUrl = URL.createObjectURL(blob);
    setMessages(prev => [...prev, { role: 'user', type: 'vn', audio_url: localUrl, created_at: new Date().toISOString() }]);
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'voice.webm');
      const res = await fetch('/api/voice/stt', { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: formData });
      const stt = await res.json();
      if (stt.text?.trim()) {
        await sendText(stt.text);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', type: 'text', content: "couldn't hear you 🎤 try again?", created_at: new Date().toISOString() }]);
        setLoading(false);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', type: 'text', content: "try typing instead 💬", created_at: new Date().toISOString() }]);
      setLoading(false);
    }
  };

  const fmtSec = s => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  const fmtTs = ts => ts ? new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{fontSize:18,padding:'4px 6px'}}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14}}>{companion.name}</div>
          <div style={{fontSize:10,color:speaking?'var(--pink2)':'var(--green)'}}>
            {speaking?'♫ Speaking...':'● Online'}
          </div>
        </div>
        <button className={`btn btn-sm ${voiceOn?'btn-primary':'btn-secondary'}`}
          onClick={()=>{setVoiceOn(!voiceOn); if(audioRef.current) audioRef.current.pause(); setSpeaking(false);}}
          style={{padding:'4px 8px',fontSize:13}}>
          {voiceOn?'🔊':'🔇'}
        </button>
        <button className="btn btn-ghost" onClick={()=>onToggleSave?.(companion.id)}
          style={{color:isSaved?'var(--pink2)':'var(--text2)',fontSize:18,padding:4}}>
          {isSaved?'♥':'♡'}
        </button>
      </div>

      {/* Talking Avatar Area */}
      <div style={{
        borderBottom:'1px solid var(--border)', flexShrink:0,
        background:'linear-gradient(180deg, rgba(232,67,126,0.04), var(--bg))',
        padding:'16px', display:'flex', alignItems:'center', justifyContent:'center',
        minHeight: 140, position: 'relative',
      }}>
        {/* Simli WebRTC video (hidden until active) */}
        <video ref={videoRef} autoPlay playsInline muted
          style={{
            width: 160, height: 160, borderRadius: '50%', objectFit: 'cover',
            border: `3px solid ${speaking ? 'var(--pink)' : 'var(--border)'}`,
            boxShadow: speaking ? '0 0 30px rgba(232,67,126,0.4)' : 'none',
            transition: 'all 0.3s',
            display: simliReady ? 'block' : 'none',
          }}
        />
        <audio ref={simliAudioRef} autoPlay style={{ display: 'none' }} />

        {/* Fallback: Static image with speaking animation */}
        {!simliReady && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <div style={{
              width: 120, height: 120, borderRadius: '50%', overflow: 'hidden',
              border: `3px solid ${speaking ? 'var(--pink)' : 'rgba(255,255,255,0.1)'}`,
              boxShadow: speaking ? '0 0 30px rgba(232,67,126,0.4)' : '0 4px 16px rgba(0,0,0,0.3)',
              transition: 'all 0.3s',
              animation: speaking ? 'avatarBreath 1.5s ease-in-out infinite' : 'none',
            }}>
              {companion.avatar_url ? (
                <img src={companion.avatar_url} alt={companion.name}
                  style={{ width:'100%', height:'100%', objectFit:'cover' }}
                  onError={e => e.target.style.display='none'} />
              ) : (
                <div style={{width:'100%',height:'100%',background:'linear-gradient(135deg,var(--pink),var(--red))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,fontWeight:800,color:'#fff'}}>
                  {companion.name.charAt(0)}
                </div>
              )}
            </div>
            {speaking && <>
              <div style={{position:'absolute',inset:-6,borderRadius:'50%',border:'2px solid rgba(232,67,126,0.3)',animation:'ripple 2s infinite'}} />
              <div style={{position:'absolute',inset:-14,borderRadius:'50%',border:'1px solid rgba(232,67,126,0.15)',animation:'ripple 2s 0.6s infinite'}} />
            </>}
          </div>
        )}

        <div style={{ marginLeft: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{companion.name}</div>
          <div style={{ fontSize: 11, color: speaking ? 'var(--pink2)' : 'var(--text2)', marginTop: 2 }}>
            {speaking ? '♫ Speaking to you...' : companion.personality}
          </div>
          {speaking && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, fontSize: 11 }}
              onClick={() => { if(audioRef.current) audioRef.current.pause(); setSpeaking(false); }}>
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{flex:1,color:'var(--text2)'}}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && (
              <div style={{textAlign:'center',padding:'20px 16px',color:'var(--text2)'}}>
                <p style={{fontSize:12}}>Type a message or tap 🎤 to start talking</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role==='user'?'user':'ai'}`}>
                {msg.role !== 'user' && <Avatar name={companion.name} src={companion.avatar_url} size="xs" />}
                <div style={{maxWidth:'100%',minWidth:0}}>
                  {msg.type !== 'vn' && <div className="message-bubble">{msg.content}</div>}
                  {msg.type === 'vn' && msg.audio_url && (
                    <div style={{
                      padding:'8px 12px', borderRadius:16,
                      background: msg.role==='user' ? 'linear-gradient(135deg,var(--pink),var(--red))' : 'var(--bg4)',
                      border: msg.role==='user' ? 'none' : '1px solid var(--border)',
                      display:'flex', alignItems:'center', gap:8, minWidth:160,
                    }}>
                      <span>🎤</span>
                      <audio src={msg.audio_url} controls preload="none"
                        style={{height:28,flex:1,minWidth:0,maxWidth:200}} />
                    </div>
                  )}
                  <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2,padding:'0 4px'}}>
                    <span style={{fontSize:9,color:'var(--text3)'}}>{fmtTs(msg.created_at)}</span>
                    {msg.role==='assistant' && msg.type==='text' && voiceOn && (
                      <button onClick={()=>genVoiceAndAvatar(msg.content)}
                        style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'var(--pink2)',padding:0,fontFamily:'inherit'}}>
                        🔊 Play
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="message ai">
                <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                <div className="typing-dots"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/></div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-area">
        {recording ? (
          <div style={{flex:1,display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:10,height:10,borderRadius:'50%',background:'var(--red)',animation:'recPulse 1s infinite',flexShrink:0}} />
            <span style={{fontSize:13,color:'var(--red)',fontWeight:600,flex:1}}>Recording {fmtSec(recTime)}</span>
            <button className="btn btn-secondary btn-sm" onClick={cancelRec}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={stopRec}>✓ Send</button>
          </div>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={startRec} style={{padding:'8px 12px',fontSize:16,flexShrink:0}}>🎤</button>
            <input className="input" value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendText()} placeholder={`Message ${companion.name}...`}
              style={{flex:1}} disabled={loading} />
            <button className="btn btn-primary" onClick={()=>sendText()} disabled={loading||!input.trim()}>Send</button>
          </>
        )}
      </div>

      <style>{`
        @keyframes avatarBreath { 0%,100%{transform:scale(1);} 50%{transform:scale(1.03);} }
        @keyframes ripple { 0%{transform:scale(1);opacity:0.6;} 100%{transform:scale(1.6);opacity:0;} }
        @keyframes recPulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
      `}</style>
    </div>
  );
}
