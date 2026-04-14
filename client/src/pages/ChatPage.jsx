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
  const [speaking, setSpeaking] = useState(false);
  const [simliAvail, setSimliAvail] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [simliSession, setSimliSession] = useState(null);
  const chatRef = useRef();
  const mediaRef = useRef();
  const chunksRef = useRef([]);
  const timerRef = useRef();
  const audioRef = useRef();

  useEffect(() => {
    if (!companion) return;
    setInitLoad(true);
    api(`/chat/${companion.id}`).then(d => setMessages(d.messages||[])).catch(()=>{}).finally(()=>setInitLoad(false));
    api('/voice/simli-config').then(d => setSimliAvail(d.available)).catch(()=>{});
  }, [companion?.id]);

  useEffect(() => { if(chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [messages, loading]);

  if (!companion) return (
    <div style={{padding:60,textAlign:'center'}}>
      <div style={{fontSize:48,marginBottom:16}}>💬</div><h2>Select a companion</h2>
      <button className="btn btn-primary mt-3" onClick={()=>onNavigate('discover')}>Discover</button>
    </div>
  );

  // Start Simli video call
  const startVideoCall = async () => {
    try {
      setVideoMode(true);
      const d = await api('/voice/simli-start', { method:'POST', body:{ companionId: companion.id } });
      if (d.available) {
        setSimliSession(d);
        // Simli Auto returns a URL or session info for the WebRTC stream
        // The video call is handled by Simli's infrastructure
        console.log('Simli session started:', d);
      } else {
        console.log('Simli not available:', d.error);
      }
    } catch (e) {
      console.log('Video call failed:', e);
    }
  };

  // Play voice
  const playVoice = async (text) => {
    setSpeaking(true);
    try {
      const d = await api('/voice/tts', {method:'POST',body:{text,voice:companion.voice}});
      if (d.audio_url) {
        setMessages(prev=>[...prev,{role:'assistant',type:'vn',audio_url:d.audio_url,created_at:new Date().toISOString()}]);
        const a = new Audio(d.audio_url);
        audioRef.current = a;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        a.play().catch(() => setSpeaking(false));
      } else setSpeaking(false);
    } catch { setSpeaking(false); }
  };

  // Send text
  const sendText = async (to) => {
    const t = (to||input).trim();
    if(!t||loading) return;
    if(getMessagesLeft(user)<=0){onNavigate('pricing');return;}
    setMessages(p=>[...p,{role:'user',type:'text',content:t,created_at:new Date().toISOString()}]);
    if(!to) setInput('');
    setLoading(true);
    try {
      const d = await api(`/chat/${companion.id}`,{method:'POST',body:{content:t}});
      setMessages(p=>[...p,{role:'assistant',type:'text',content:d.message.content,created_at:d.message.created_at}]);
      refreshUser();
      if(voiceOn&&d.message?.content) playVoice(d.message.content);
    } catch(err) {
      if(err.code==='TRIAL_EXPIRED'||err.code==='MESSAGE_LIMIT') onNavigate('pricing');
      else setMessages(p=>[...p,{role:'assistant',type:'text',content:err.error||"hey 💕",created_at:new Date().toISOString()}]);
    }
    setLoading(false);
  };

  // Voice recording
  const startRec = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({audio:true});
      const r = new MediaRecorder(s);
      chunksRef.current = [];
      r.ondataavailable = e=>{if(e.data.size>0) chunksRef.current.push(e.data);};
      r.onstop = ()=>{s.getTracks().forEach(t=>t.stop());clearInterval(timerRef.current);
        const b = new Blob(chunksRef.current,{type:'audio/webm'});
        if(b.size>500) handleVN(b);};
      mediaRef.current = r; r.start();
      setRecording(true); setRecTime(0);
      timerRef.current = setInterval(()=>setRecTime(t=>t+1),1000);
    } catch { alert('Microphone access needed'); }
  };
  const stopRec = ()=>{if(mediaRef.current&&recording){mediaRef.current.stop();setRecording(false);}};
  const cancelRec = ()=>{if(mediaRef.current)try{mediaRef.current.stop();}catch{}setRecording(false);clearInterval(timerRef.current);chunksRef.current=[];};

  const handleVN = async (blob) => {
    const u = URL.createObjectURL(blob);
    setMessages(p=>[...p,{role:'user',type:'vn',audio_url:u,created_at:new Date().toISOString()}]);
    setLoading(true);
    try {
      const fd = new FormData(); fd.append('audio',blob,'voice.webm');
      const r = await fetch('/api/voice/stt',{method:'POST',headers:{'Authorization':`Bearer ${getToken()}`},body:fd});
      const s = await r.json();
      if(s.text?.trim()) await sendText(s.text);
      else {setMessages(p=>[...p,{role:'assistant',type:'text',content:"couldn't hear you 🎤",created_at:new Date().toISOString()}]);setLoading(false);}
    } catch {setMessages(p=>[...p,{role:'assistant',type:'text',content:"try typing 💬",created_at:new Date().toISOString()}]);setLoading(false);}
  };

  const ft = s=>`${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  const fts = ts=>ts?new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{fontSize:18,padding:'4px 6px'}}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:700,fontSize:14}}>{companion.name}</div>
          <div style={{fontSize:10,color:speaking?'var(--pink2)':'var(--green)'}}>{speaking?'♫ Speaking...':'● Online'}</div>
        </div>
        {/* Video call button */}
        {simliAvail && (
          <button className="btn btn-sm btn-primary" onClick={startVideoCall}
            style={{padding:'4px 10px',fontSize:11}} title="Start video call">
            📹 Video
          </button>
        )}
        <button className={`btn btn-sm ${voiceOn?'btn-primary':'btn-secondary'}`}
          onClick={()=>{setVoiceOn(!voiceOn);if(audioRef.current)audioRef.current.pause();setSpeaking(false);}}
          style={{padding:'4px 8px',fontSize:13}}>{voiceOn?'🔊':'🔇'}</button>
        <button className="btn btn-ghost" onClick={()=>onToggleSave?.(companion.id)}
          style={{color:isSaved?'var(--pink2)':'var(--text2)',fontSize:18,padding:4}}>{isSaved?'♥':'♡'}</button>
      </div>

      {/* Avatar area */}
      <div style={{
        borderBottom:'1px solid var(--border)',flexShrink:0,
        background:speaking?'linear-gradient(180deg,rgba(232,67,126,0.06),var(--bg))':'var(--bg)',
        padding:'14px 16px',display:'flex',alignItems:'center',gap:14,transition:'all 0.3s',
      }}>
        <div style={{position:'relative',flexShrink:0}}>
          <div style={{
            width:speaking?100:70,height:speaking?100:70,borderRadius:'50%',overflow:'hidden',transition:'all 0.4s',
            border:`3px solid ${speaking?'var(--pink)':'rgba(255,255,255,0.08)'}`,
            boxShadow:speaking?'0 0 28px rgba(232,67,126,0.4)':'none',
          }}>
            {companion.avatar_url?(
              <img src={companion.avatar_url} alt={companion.name}
                style={{width:'100%',height:'100%',objectFit:'cover',animation:speaking?'breathe 2s ease-in-out infinite':'none'}}
                onError={e=>e.target.style.display='none'}/>
            ):(
              <div style={{width:'100%',height:'100%',background:'linear-gradient(135deg,var(--pink),var(--red))',display:'flex',alignItems:'center',justifyContent:'center',fontSize:speaking?36:24,fontWeight:800,color:'#fff'}}>
                {companion.name.charAt(0)}
              </div>
            )}
          </div>
          {speaking&&<>
            <div style={{position:'absolute',inset:-6,borderRadius:'50%',border:'2px solid rgba(232,67,126,0.25)',animation:'ripple 2s infinite'}}/>
            <div style={{position:'absolute',inset:-14,borderRadius:'50%',border:'1px solid rgba(232,67,126,0.12)',animation:'ripple 2s 0.5s infinite'}}/>
          </>}
        </div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:speaking?17:15,transition:'all 0.3s'}}>{companion.name}</div>
          <div style={{fontSize:11,color:speaking?'var(--pink2)':'var(--text2)',marginTop:2}}>
            {speaking?'♫ Speaking to you...':companion.personality||companion.tagline}
          </div>
          {speaking&&(
            <div style={{marginTop:6,display:'flex',alignItems:'center',gap:3}}>
              {Array.from({length:15}).map((_,i)=>(
                <div key={i} style={{width:2.5,background:'var(--pink2)',borderRadius:2,animation:`wave 0.6s ease-in-out ${i*0.04}s infinite alternate`}}/>
              ))}
              <button className="btn btn-ghost btn-sm" style={{marginLeft:8,fontSize:11}}
                onClick={()=>{if(audioRef.current)audioRef.current.pause();setSpeaking(false);}}>⏹</button>
            </div>
          )}
        </div>
      </div>

      {/* Simli Video Call overlay */}
      {videoMode && simliSession && (
        <div style={{
          position:'fixed',inset:0,zIndex:100,background:'rgba(0,0,0,0.95)',
          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
        }}>
          <div style={{textAlign:'center',color:'var(--text2)',padding:20}}>
            <Avatar name={companion.name} src={companion.avatar_url} size="xl" style={{margin:'0 auto 16px',border:'3px solid var(--pink)',boxShadow:'0 0 30px rgba(232,67,126,0.3)'}} />
            <h3 style={{marginBottom:8}}>{companion.name}</h3>
            <p style={{fontSize:13,marginBottom:4}}>Video call session started</p>
            <p style={{fontSize:11,color:'var(--text3)',marginBottom:20}}>Simli is processing the video stream...</p>
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              <button className="btn btn-primary" onClick={()=>{setVideoMode(false);setSimliSession(null);}}>
                End Call
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages" ref={chatRef}>
        {initLoad?(<div className="flex-center" style={{flex:1,color:'var(--text2)'}}>Loading...</div>):(
          <>
            {messages.length===0&&(<div style={{textAlign:'center',padding:'20px 16px',color:'var(--text2)',fontSize:12}}>Type or tap 🎤 to start</div>)}
            {messages.map((m,i)=>(
              <div key={i} className={`message ${m.role==='user'?'user':'ai'}`}>
                {m.role!=='user'&&<Avatar name={companion.name} src={companion.avatar_url} size="xs"/>}
                <div style={{maxWidth:'100%',minWidth:0}}>
                  {m.type!=='vn'&&<div className="message-bubble">{m.content}</div>}
                  {m.type==='vn'&&m.audio_url&&(
                    <div style={{padding:'8px 12px',borderRadius:16,background:m.role==='user'?'linear-gradient(135deg,var(--pink),var(--red))':'var(--bg4)',border:m.role==='user'?'none':'1px solid var(--border)',display:'flex',alignItems:'center',gap:8,minWidth:160}}>
                      <span>🎤</span><audio src={m.audio_url} controls preload="none" style={{height:28,flex:1,minWidth:0,maxWidth:200}}/>
                    </div>
                  )}
                  <div style={{display:'flex',alignItems:'center',gap:6,marginTop:2,padding:'0 4px'}}>
                    <span style={{fontSize:9,color:'var(--text3)'}}>{fts(m.created_at)}</span>
                    {m.role==='assistant'&&m.type==='text'&&voiceOn&&(
                      <button onClick={()=>playVoice(m.content)} style={{background:'none',border:'none',cursor:'pointer',fontSize:10,color:'var(--pink2)',padding:0,fontFamily:'inherit'}}>🔊 Play</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading&&(<div className="message ai"><Avatar name={companion.name} src={companion.avatar_url} size="xs"/><div className="typing-dots"><span className="typing-dot"/><span className="typing-dot"/><span className="typing-dot"/></div></div>)}
          </>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-area">
        {recording?(
          <div style={{flex:1,display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:10,height:10,borderRadius:'50%',background:'var(--red)',animation:'recPulse 1s infinite',flexShrink:0}}/>
            <span style={{fontSize:13,color:'var(--red)',fontWeight:600,flex:1}}>Recording {ft(recTime)}</span>
            <button className="btn btn-secondary btn-sm" onClick={cancelRec}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={stopRec}>✓ Send</button>
          </div>
        ):(
          <>
            <button className="btn btn-secondary" onClick={startRec} style={{padding:'8px 12px',fontSize:16,flexShrink:0}}>🎤</button>
            <input className="input" value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendText()} placeholder={`Message ${companion.name}...`}
              style={{flex:1}} disabled={loading}/>
            <button className="btn btn-primary" onClick={()=>sendText()} disabled={loading||!input.trim()}>Send</button>
          </>
        )}
      </div>

      <style>{`
        @keyframes breathe{0%,100%{transform:scale(1);}50%{transform:scale(1.02);}}
        @keyframes ripple{0%{transform:scale(1);opacity:0.6;}100%{transform:scale(1.5);opacity:0;}}
        @keyframes recPulse{0%,100%{opacity:1;}50%{opacity:0.3;}}
        @keyframes wave{0%{height:3px;}100%{height:16px;}}
      `}</style>
    </div>
  );
}
