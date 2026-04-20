import { useState } from 'react';

const GRADIENTS = [
  ['#e8437e','#d63864'],['#ff5c8d','#e8437e'],['#a29bfe','#6c5ce7'],
  ['#74b9ff','#0984e3'],['#55efc4','#00b894'],['#ffeaa7','#fdcb6e'],
  ['#fab1a0','#e17055'],['#fd79a8','#e84393'],['#00cec9','#00b894'],
];

function hashStr(s) { return (s||'A').split('').reduce((a,c)=>a+c.charCodeAt(0),0); }

export function Avatar({ name, src, size='md', className='', style={} }) {
  const [err, setErr] = useState(false);
  const [c1,c2] = GRADIENTS[hashStr(name)%GRADIENTS.length];
  const show = src && !err;
  return (
    <div className={`avatar avatar-${size} ${className}`}
      style={{ background: show?'transparent':`linear-gradient(135deg,${c1},${c2})`, ...style }}>
      {show ? <img src={src} alt={name} onError={()=>setErr(true)} loading="lazy"/> : (name||'A').charAt(0).toUpperCase()}
    </div>
  );
}

export function CompanionCard({ companion, onChat, onToggleSave, isSaved }) {
  const [imgErr, setImgErr] = useState(false);
  const hasSrc = companion.avatar_url && !imgErr;
  const [c1,c2] = GRADIENTS[hashStr(companion.name)%GRADIENTS.length];

  return (
    <div className="card" onClick={()=>onChat?.(companion)} style={{ cursor:'pointer' }}>
      {/* Large image */}
      <div style={{
        width:'100%', height:220, overflow:'hidden', position:'relative',
        background: hasSrc?'#111':`linear-gradient(135deg,${c1},${c2})`,
      }}>
        {hasSrc ? (
          <img src={companion.avatar_url} alt={companion.name}
            style={{ width:'100%', height:'100%', objectFit:'cover', transition:'transform 0.4s' }}
            onError={()=>setImgErr(true)} loading="lazy"
            onMouseEnter={e=>e.target.style.transform='scale(1.05)'}
            onMouseLeave={e=>e.target.style.transform='scale(1)'}
          />
        ) : (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', fontSize:52, fontWeight:800, color:'rgba(255,255,255,0.3)' }}>
            {(companion.name||'A').charAt(0)}
          </div>
        )}
        {/* Online badge */}
        <div style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,0.6)', borderRadius:14, padding:'3px 8px', fontSize:9, color:'#2ecc71', display:'flex', alignItems:'center', gap:3, backdropFilter:'blur(4px)' }}>
          <span style={{ width:5, height:5, borderRadius:'50%', background:'#2ecc71', display:'inline-block' }}/>Online
        </div>
        {/* Bottom gradient */}
        <div style={{ position:'absolute', bottom:0, left:0, right:0, height:70, background:'linear-gradient(transparent,rgba(0,0,0,0.8))' }}/>
        {/* Name overlay */}
        <div style={{ position:'absolute', bottom:8, left:10, right:10 }}>
          <div style={{ fontWeight:700, fontSize:15 }}>{companion.name}</div>
          <div style={{ fontSize:10, color:'rgba(255,255,255,0.6)', lineHeight:1.3 }}>{companion.tagline||companion.personality}</div>
        </div>
      </div>
      {/* Tags */}
      <div style={{ padding:'8px 10px', display:'flex', gap:4, flexWrap:'wrap' }}>
        {companion.personality && <span className="tag">{companion.personality.split(' ')[0]}</span>}
        {(companion.hobbies?.[0]||companion.hobby) && <span className="tag">{companion.hobbies?.[0]||companion.hobby}</span>}
      </div>
      <div className="card-footer">
        <button onClick={e=>{e.stopPropagation();onChat?.(companion);}}>💬 Chat</button>
        <button onClick={e=>{e.stopPropagation();onToggleSave?.(companion.id);}} style={{color:isSaved?'var(--pink2)':undefined}}>
          {isSaved?'♥':'♡'} Save
        </button>
      </div>
    </div>
  );
}

export function StatCard({ label, value }) {
  return <div className="stat-card"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>;
}

export function EmptyState({ icon, text, action, actionText }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontSize:14, marginBottom:16 }}>{text}</div>
      {action && <button className="btn btn-primary" onClick={action}>{actionText}</button>}
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex-center" style={{ padding:60 }}>
      <div style={{ width:36, height:36, border:'3px solid var(--border)', borderTopColor:'var(--pink)', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
