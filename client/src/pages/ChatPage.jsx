import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft, getToken, TOKEN_COSTS, canUseFeature, getUserTokens } from '../utils/api';
import { Avatar } from '../components/UI';

const ensurePuterAuth = async () => {
  if (!window.puter) throw new Error('Puter.js not loaded');

  const signedIn = await window.puter.auth.isSignedIn();
  if (!signedIn) {
    await window.puter.auth.signIn();
  }
};

// Random scene generator
function getRandomScene() {
  const scenes = [
    { setting: 'cozy coffee shop, warm lighting, sitting by window', outfit: 'elegant knit sweater and tailored trousers' },
    { setting: 'beach during golden hour, ocean behind', outfit: 'flowy maxi dress, bohemian resort styling' },
    { setting: 'rooftop restaurant, city lights, night', outfit: 'sleek black evening dress with jacket' },
    { setting: 'garden with flowers, soft sunlight', outfit: 'floral midi dress, romantic elegant styling' },
    { setting: 'park in autumn, golden leaves', outfit: 'leather jacket over turtleneck and skirt' },
    { setting: 'library with wooden shelves, warm light', outfit: 'tailored blazer and smart trousers' },
    { setting: 'cobblestone street at sunset, European city', outfit: 'fitted trench coat over designer dress' },
    { setting: 'art gallery, white walls, modern art', outfit: 'minimalist black outfit, gallery-chic' },
    { setting: 'mountain viewpoint, misty landscape', outfit: 'stylish outdoor coat and boots' },
    { setting: 'rainy city street, neon reflections, night', outfit: 'sleek dark coat, noir fashion' },
  ];
  const cameras = [
    'selfie angle, front facing',
    'close-up portrait, looking at camera',
    'medium shot, 3/4 angle, natural pose',
    'full body shot, standing pose',
    'candid side profile, soft focus background',
  ];
  const s = scenes[Math.floor(Math.random() * scenes.length)];
  const c = cameras[Math.floor(Math.random() * cameras.length)];
  return { setting: s.setting, outfit: s.outfit, camera: c };
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

  const sendText = async () => {
    const t = input.trim();
    if (!t || loading) return;
    if (getMessagesLeft(user) <= 0) { onNavigate('pricing'); return; }
    setMessages(p => [...p, { role: 'user', type: 'text', content: t, created_at: new Date().toISOString() }]);
    setInput('');
    setLoading(true);
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

  // ===== Voice Recording =====
  const toggleRecording = async () => {
    if (recording) { mediaRecorderRef.current?.stop(); setRecording(false); return; }
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
        setMessages(prev => [...prev, { role: 'user', content: '🎤 Voice message', type: 'audio', media_url: userAudioUrl, created_at: new Date().toISOString() }]);
        setLoading(true);
        try {
          const formData = new FormData();
          formData.append('audio', blob, 'voice.webm');
          const token = getToken();
          const sttRes = await fetch('/api/voice/stt', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
          const sttData = await sttRes.json();
          const transcribedText = sttData.text || 'Hello';
          const data = await api(`/chat/${companion.id}`, { method: 'POST', body: { content: transcribedText } });
          if (data.message?.content) {
            try {
              const ttsRes = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: data.message.content, voice: companion.voice }) });
              if (ttsRes.ok) {
                const ttsData = await ttsRes.json();
                if (ttsData.audio_url) {
                  setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'audio', media_url: ttsData.audio_url, created_at: new Date().toISOString() }]);
                } else {
                  setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]);
                }
              } else {
                setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]);
              }
            } catch { setMessages(prev => [...prev, { role: 'assistant', content: data.message.content, type: 'text', created_at: new Date().toISOString() }]); }
          }
          refreshUser();
        } catch (err) { console.error('Voice error:', err); }
        setLoading(false);
      };
      mediaRecorder.start();
      setRecording(true);
    } catch { alert('Microphone access denied.'); }
  };

  // ===== Generate Image via Puter.js (Nano Banana — FREE) =====
 const handleGenerateImage = async () => {
  if (!canUseFeature(user, 'image') && !user?.is_admin) {
    onNavigate('pricing');
    return;
  }

  try {
  await ensurePuterAuth();
} catch (e) {
  console.error('Puter auth failed full:', e);
  console.error('message:', e?.message);
  console.error('error:', e?.error);
  console.error('stack:', e?.stack);
  alert(e?.message || e?.error || 'Puter sign-in failed');
  return;
}

  setMediaLoading('image');
  setMediaProgress(0);
  const interval = setInterval(() => setMediaProgress(p => Math.min(p + Math.random() * 12, 90)), 600);

  try {
    await api('/image/deduct-tokens', {
      method: 'POST',
      body: {
        action: 'image_gen',
        amount: TOKEN_COSTS.image,
        companionId: companion.id,
        description: `Photo of ${companion.name}`
      }
    });
    const { setting, outfit, camera } = getRandomScene();
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const desc = companion.description || companion.personality || '';

    let imageDataUrl = null;

    if (companion.avatar_url && window.puter) {
      try {
        const avatarRes = await fetch(companion.avatar_url);
        const avatarBlob = await avatarRes.blob();

        const avatarBase64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const full = reader.result || '';
            resolve(String(full).split(',')[1]);
          };
          reader.readAsDataURL(avatarBlob);
        });

        const editPrompt = `Edit this photo. Keep the EXACT same person, same face, same features, same wings if any. Place them in: ${setting}. Dress them in: ${outfit}. Camera angle: ${camera}. Photorealistic, professional fashion photography, tasteful, fully clothed.`;

        const imgEl = await window.puter.ai.txt2img(editPrompt, {
          model: 'gemini-2.5-flash-image-preview',
          input_images: [avatarBase64],
        });

        if (imgEl?.src) imageDataUrl = imgEl.src;
      } catch (e) {
        console.log('Puter edit failed, trying text-to-image:', e);
      }
    }

    if (!imageDataUrl && window.puter) {
      const prompt = `photorealistic fantasy ${gender}, ${desc}, in ${setting}, wearing ${outfit}, ${camera}, professional editorial photography, natural lighting, tasteful, fully clothed`;

      const imgEl = await window.puter.ai.txt2img(prompt, {
        model: 'gemini-2.5-flash-image-preview',
      });

      if (imgEl?.src) imageDataUrl = imgEl.src;
    }

    clearInterval(interval);
    setMediaProgress(100);

    if (imageDataUrl) {
      setMessages(p => [...p, {
        role: 'assistant',
        type: 'image',
        content: '📸',
        media_url: imageDataUrl,
        created_at: new Date().toISOString(),
      }]);

      api('/image/save-media', {
        method: 'POST',
        body: {
          companionId: companion.id,
          type: 'image',
          mediaUrl: imageDataUrl,
          caption: '📸'
        }
      }).catch(() => {});

      refreshUser();
    } else {
      alert('Image generation failed. Please try again.');
    }
  } catch (err) {
    clearInterval(interval);
    if (err.code === 'NO_TOKENS') onNavigate('pricing');
    else alert(err.error || err.message || 'Image generation failed');
  }

  setMediaLoading(null);
  setMediaProgress(0);
};
  
  // ===== Generate Video via Puter.js (Veo 3.1 Lite — FREE) =====
  const handleGenerateVideo = async () => {
  if (!canUseFeature(user, 'video') && !user?.is_admin) {
    onNavigate('pricing');
    return;
  }

  try {
    await ensurePuterAuth();
  } catch (e) {
    console.error('Puter auth failed:', e);
    alert('Please allow the Puter popup and try again.');
    return;
  }

  setMediaLoading('video');
  setMediaProgress(0);
  const interval = setInterval(() => setMediaProgress(p => Math.min(p + Math.random() * 5, 85)), 1000);

  try {
    await api('/image/deduct-tokens', {
      method: 'POST',
      body: {
        action: 'video_gen',
        amount: TOKEN_COSTS.video,
        companionId: companion.id,
        description: `Video of ${companion.name}`
      }
    });

    const { setting, outfit } = getRandomScene();
    const gender = companion.category === 'Guys' ? 'man' : 'woman';
    const desc = companion.description || companion.personality || '';
    const prompt = `A ${gender}, ${desc}, in ${setting}, wearing ${outfit}, slight natural movement, soft smile, cinematic lighting, photorealistic, tasteful, fully clothed`;

    let videoDataUrl = null;

    if (window.puter) {
      try {
        const videoEl = await window.puter.ai.txt2vid(prompt, {
          model: 'veo-3.1-lite-generate-preview',
          seconds: 4,
        });

        if (videoEl?.src) {
          videoDataUrl = videoEl.src;
        }
      } catch (e) {
        console.error('Puter video failed:', e);
      }
    }

    clearInterval(interval);
    setMediaProgress(100);

    if (videoDataUrl) {
      setMessages(p => [...p, {
        role: 'assistant',
        type: 'video',
        content: '🎬',
        media_url: videoDataUrl,
        created_at: new Date().toISOString(),
      }]);

      api('/image/save-media', {
        method: 'POST',
        body: {
          companionId: companion.id,
          type: 'video',
          mediaUrl: videoDataUrl,
          caption: '🎬'
        }
      }).catch(() => {});

      refreshUser();
    } else {
      alert('Video generation failed. Please try again.');
    }
  } catch (err) {
    clearInterval(interval);
    if (err.code === 'NO_TOKENS') onNavigate('pricing');
    else alert(err.error || err.message || 'Video generation failed');
  }

  setMediaLoading(null);
  setMediaProgress(0);
};

  const testPuterLogin = async () => {
  try {
    const res = await window.puter.auth.signIn();
    console.log('signIn result:', res);

    const signedInAfter = await window.puter.auth.isSignedIn();
    console.log('signed in after:', signedInAfter);

    alert('Puter login success');
  } catch (e) {
    console.error('RAW PUTER LOGIN ERROR', e);
    console.error('error:', e?.error);
    console.error('message:', e?.message);
    alert(e?.error || e?.message || 'Puter login failed');
  }
};
  
  const fts = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  
  return (
    <div className="aura-chat-page">
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
          <button className="aura-chat-hdr-btn" onClick={() => onToggleSave?.(companion.id)} style={{ color: isSaved ? '#ff6b9d' : undefined }}>
            {isSaved ? '♥' : '♡'}
          </button>
        </div>
      </div>

      <div className="aura-chat-messages" ref={chatRef}>
        {initLoad ? (
          <div className="flex-center" style={{ flex: 1, color: 'var(--text2)' }}>Loading...</div>
        ) : (
          <>
            {messages.length === 0 && <div className="aura-chat-system-msg">Start chatting with {companion.name}</div>}
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
                      {m.type === 'image' && m.media_url && <img src={m.media_url} alt="Generated" className="aura-chat-media-img" />}
                      {m.type === 'video' && m.media_url && <video src={m.media_url} controls playsInline preload="metadata" className="aura-chat-media-video" />}
                      {(m.type === 'audio' || m.type === 'vn') && m.media_url && <div className="aura-chat-audio-wrapper"><audio src={m.media_url} controls preload="none" /></div>}
                      {m.content && !(m.type === 'image' && m.content === '📸') && !(m.type === 'video' && m.content === '🎬') && !((m.type === 'audio' || m.type === 'vn') && (m.content === '🎤 Voice message' || m.content === '🔊 Voice reply')) && (
                        <div className="aura-chat-bubble-text">{m.content}</div>
                      )}
                    </div>
                    <div className="aura-chat-bubble-time">{fts(m.created_at)}</div>
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="aura-chat-msg aura-chat-msg-ai">
                <div className="aura-chat-msg-avatar">{companion.avatar_url ? <img src={companion.avatar_url} alt="" /> : <Avatar name={companion.name} size="xs" />}</div>
                <div className="aura-chat-bubble-area"><div className="aura-chat-bubble aura-chat-bubble-ai"><div className="typing-dots"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></div></div></div>
              </div>
            )}
            {mediaLoading && (
              <div className="aura-chat-msg aura-chat-msg-ai">
                <div className="aura-chat-msg-avatar">{companion.avatar_url ? <img src={companion.avatar_url} alt="" /> : <Avatar name={companion.name} size="xs" />}</div>
                <div className="aura-chat-bubble-area">
                  <div className="aura-chat-media-loading">
                    <div className="aura-chat-media-loading-icon">{mediaLoading === 'image' ? '📸' : '🎬'}</div>
                    <div className="aura-chat-media-loading-text">{companion.name} is {mediaLoading === 'video' ? 'creating a video' : 'sending a photo'}...</div>
                    <div className="aura-chat-media-progress-bar"><div className="aura-chat-media-progress-fill" style={{ width: `${mediaProgress}%` }} /></div>
                    <div className="aura-chat-media-progress-pct">{Math.round(mediaProgress)}% • {mediaLoading === 'video' ? 'Videos take 30-60s' : 'This may take a moment'}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="aura-chat-input-bar">
        <div className="aura-chat-input-row">
          <input className="aura-chat-text-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendText()} placeholder="Write a message..." disabled={loading || !!mediaLoading} />
          <button className={`aura-chat-mic-btn ${recording ? 'recording' : ''}`} onClick={toggleRecording} disabled={loading || !!mediaLoading}>
            {recording ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
          </button>
          <button className="aura-chat-send-btn" onClick={sendText} disabled={loading || !!mediaLoading || !input.trim()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <div className="aura-chat-action-row">
          <span className="aura-chat-action-label">Show me the scene:</span>
          <button className="aura-chat-action-btn" onClick={testPuterLogin}> Test Puter Login </button>
          <button className="aura-chat-action-btn" onClick={handleGenerateImage} disabled={loading || !!mediaLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span>Image</span><span className="aura-chat-token-cost">{TOKEN_COSTS.image} tokens</span>
          </button>
          <button className="aura-chat-action-btn" onClick={handleGenerateVideo} disabled={loading || !!mediaLoading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            <span>Video</span><span className="aura-chat-token-cost">{TOKEN_COSTS.video} tokens</span>
          </button>
        </div>
        {user && <div className="aura-chat-tokens-display">🪙 {getUserTokens(user)} tokens remaining</div>}
      </div>

      <style>{`
        .aura-chat-page { display:flex; flex-direction:column; height:calc(100vh - var(--topbar-h)); background:#0d0d0d; overflow:hidden; }
        .aura-chat-header { display:flex; align-items:center; gap:12px; padding:12px 16px; background:#161616; border-bottom:1px solid rgba(255,255,255,0.06); flex-shrink:0; min-height:56px; }
        .aura-chat-back { background:none; border:none; cursor:pointer; color:rgba(255,255,255,0.6); padding:4px; display:flex; align-items:center; }
        .aura-chat-back:hover { color:#fff; }
        .aura-chat-header-avatar { position:relative; width:40px; height:40px; flex-shrink:0; }
        .aura-chat-header-avatar img { width:40px; height:40px; border-radius:50%; object-fit:cover; }
        .aura-chat-online-dot { position:absolute; bottom:1px; right:1px; width:10px; height:10px; border-radius:50%; background:#22c55e; border:2px solid #161616; }
        .aura-chat-header-info { flex:1; min-width:0; }
        .aura-chat-header-name { font-weight:600; font-size:15px; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .aura-chat-header-status { font-size:12px; color:rgba(255,255,255,0.45); }
        .aura-chat-header-actions { display:flex; gap:4px; flex-shrink:0; }
        .aura-chat-hdr-btn { background:none; border:none; cursor:pointer; color:rgba(255,255,255,0.5); font-size:20px; padding:6px; }
        .aura-chat-hdr-btn:hover { color:#fff; }
        .aura-chat-messages { flex:1; overflow-y:auto; overflow-x:hidden; padding:16px 20px; background:#0d0d0d; -webkit-overflow-scrolling:touch; }
        .aura-chat-system-msg { text-align:center; font-size:12px; color:rgba(255,255,255,0.3); margin:20px 0; }
        .aura-chat-msg { display:flex; gap:8px; margin-bottom:12px; max-width:75%; animation:auraMsgIn 0.2s ease; }
        .aura-chat-msg-user { margin-left:auto; flex-direction:row-reverse; }
        .aura-chat-msg-ai { margin-right:auto; }
        .aura-chat-msg-avatar { flex-shrink:0; width:32px; height:32px; align-self:flex-end; }
        .aura-chat-msg-avatar img { width:32px; height:32px; border-radius:50%; object-fit:cover; }
        .aura-chat-bubble-area { max-width:100%; min-width:0; overflow:hidden; }
        .aura-chat-bubble { padding:10px 14px; border-radius:18px; word-wrap:break-word; overflow-wrap:break-word; overflow:hidden; }
        .aura-chat-bubble-user { background:#7c3aed; color:#fff; border-bottom-right-radius:4px; }
        .aura-chat-bubble-ai { background:#1e1e1e; color:#e5e5e5; border:1px solid rgba(255,255,255,0.06); border-bottom-left-radius:4px; }
        .aura-chat-bubble-text { font-size:14px; line-height:1.5; }
        .aura-chat-bubble-time { font-size:10px; color:rgba(255,255,255,0.3); margin-top:3px; padding:0 4px; }
        .aura-chat-msg-user .aura-chat-bubble-time { text-align:right; }
        .aura-chat-media-img { max-width:100%; width:280px; border-radius:12px; display:block; margin-bottom:6px; height:auto; }
        .aura-chat-media-video { max-width:100%; width:280px; border-radius:12px; display:block; margin-bottom:6px; height:auto; }
        .aura-chat-audio-wrapper { width:100%; min-width:180px; max-width:280px; }
        .aura-chat-audio-wrapper audio { width:100%; height:40px; border-radius:20px; }
        .aura-chat-media-loading { background:#1e1e1e; border-radius:18px; border:1px solid rgba(255,255,255,0.06); padding:16px 20px; min-width:220px; max-width:100%; }
        .aura-chat-media-loading-icon { font-size:28px; margin-bottom:8px; }
        .aura-chat-media-loading-text { font-size:13px; color:#e5e5e5; margin-bottom:10px; }
        .aura-chat-media-progress-bar { height:4px; background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden; margin-bottom:6px; }
        .aura-chat-media-progress-fill { height:100%; background:linear-gradient(90deg,#7c3aed,#a855f7); border-radius:2px; transition:width 0.3s; }
        .aura-chat-media-progress-pct { font-size:11px; color:rgba(255,255,255,0.4); }
        .aura-chat-input-bar { background:#161616; border-top:1px solid rgba(255,255,255,0.06); padding:10px 16px; flex-shrink:0; }
        .aura-chat-input-row { display:flex; gap:8px; margin-bottom:8px; align-items:center; }
        .aura-chat-text-input { flex:1; background:#0d0d0d; border:1px solid rgba(255,255,255,0.08); border-radius:24px; padding:10px 18px; color:#e5e5e5; font-size:14px; outline:none; font-family:inherit; min-width:0; }
        .aura-chat-text-input::placeholder { color:rgba(255,255,255,0.3); }
        .aura-chat-text-input:focus { border-color:rgba(124,58,237,0.5); }
        .aura-chat-send-btn { width:40px; height:40px; border-radius:50%; background:#7c3aed; border:none; cursor:pointer; color:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.15s; }
        .aura-chat-send-btn:hover:not(:disabled) { background:#6d28d9; }
        .aura-chat-send-btn:disabled { opacity:0.3; cursor:not-allowed; }
        .aura-chat-mic-btn { width:40px; height:40px; border-radius:50%; border:none; background:rgba(255,255,255,0.08); color:#ccc; cursor:pointer; display:flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s; }
        .aura-chat-mic-btn:hover:not(:disabled) { background:rgba(255,255,255,0.15); color:#fff; }
        .aura-chat-mic-btn.recording { background:#ef4444; color:#fff; animation:auraPulse 1s infinite; }
        .aura-chat-mic-btn:disabled { opacity:0.3; cursor:not-allowed; }
        .aura-chat-action-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .aura-chat-action-label { font-size:12px; color:rgba(255,255,255,0.35); }
        .aura-chat-action-btn { display:inline-flex; align-items:center; gap:5px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:6px 12px; cursor:pointer; color:rgba(255,255,255,0.7); font-size:12px; font-family:inherit; transition:all 0.15s; white-space:nowrap; }
        .aura-chat-action-btn:hover:not(:disabled) { background:rgba(124,58,237,0.15); border-color:rgba(124,58,237,0.3); color:#a855f7; }
        .aura-chat-action-btn:disabled { opacity:0.3; cursor:not-allowed; }
        .aura-chat-token-cost { font-size:10px; color:rgba(255,255,255,0.3); margin-left:2px; }
        .aura-chat-tokens-display { font-size:11px; color:rgba(255,255,255,0.3); margin-top:6px; text-align:center; }
        .typing-dots { display:flex; gap:4px; padding:4px 0; }
        .typing-dot { width:7px; height:7px; border-radius:50%; background:rgba(255,255,255,0.4); animation:auraBounce 1.4s infinite ease-in-out both; }
        .typing-dot:nth-child(1) { animation-delay:-0.32s; }
        .typing-dot:nth-child(2) { animation-delay:-0.16s; }
        @keyframes auraBounce { 0%,80%,100%{ transform:scale(0); opacity:.4; } 40%{ transform:scale(1); opacity:1; } }
        @keyframes auraMsgIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes auraPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.1); } }
        @media (max-width:768px) {
          .aura-chat-page { position:fixed; inset:0; z-index:60; height:100vh; height:100dvh; }
          .aura-chat-header { padding:8px 10px; gap:8px; min-height:48px; }
          .aura-chat-header-avatar { width:36px; height:36px; }
          .aura-chat-header-avatar img { width:36px; height:36px; }
          .aura-chat-header-name { font-size:14px; }
          .aura-chat-messages { padding:10px; }
          .aura-chat-msg { max-width:88%; }
          .aura-chat-bubble { padding:8px 12px; border-radius:14px; }
          .aura-chat-bubble-text { font-size:13px; }
          .aura-chat-media-img, .aura-chat-media-video { width:100%; max-width:240px; border-radius:10px; }
          .aura-chat-audio-wrapper { min-width:150px; max-width:220px; }
          .aura-chat-msg-avatar { width:26px; height:26px; }
          .aura-chat-msg-avatar img { width:26px; height:26px; }
          .aura-chat-input-bar { padding:6px 8px; }
          .aura-chat-input-row { gap:6px; }
          .aura-chat-text-input { padding:8px 14px; font-size:13px; }
          .aura-chat-send-btn, .aura-chat-mic-btn { width:36px; height:36px; }
          .aura-chat-action-row { gap:4px; }
          .aura-chat-action-label { font-size:10px; }
          .aura-chat-action-btn { font-size:11px; padding:5px 8px; }
          .aura-chat-media-loading { min-width:180px; padding:12px 14px; }
          .aura-chat-tokens-display { font-size:10px; margin-top:4px; }
        }
        @media (max-width:380px) {
          .aura-chat-messages { padding:8px; }
          .aura-chat-msg { max-width:92%; }
          .aura-chat-media-img, .aura-chat-media-video { max-width:200px; }
          .aura-chat-action-label { display:none; }
          .aura-chat-action-btn { font-size:10px; padding:4px 6px; }
        }
        @media (min-width:769px) and (max-width:1024px) { .aura-chat-msg { max-width:70%; } }
        @media (min-width:1025px) { .aura-chat-msg { max-width:60%; } }
      `}</style>
    </div>
  );
}
