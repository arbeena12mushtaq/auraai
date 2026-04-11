import { useState } from 'react';

const GRADIENTS = [
  ['#ff6b9d','#c44569'], ['#f8a5c2','#e056a0'], ['#ff9ff3','#f368e0'],
  ['#a29bfe','#6c5ce7'], ['#74b9ff','#0984e3'], ['#55efc4','#00b894'],
  ['#ffeaa7','#fdcb6e'], ['#fab1a0','#e17055'], ['#fd79a8','#e84393'],
  ['#00cec9','#00b894'], ['#e17055','#d63031'], ['#6c5ce7','#a29bfe'],
];

function hashStr(s) {
  return (s || 'A').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
}

export function Avatar({ name, src, size = 'md', className = '', style = {} }) {
  const [imgErr, setImgErr] = useState(false);
  const idx = hashStr(name) % GRADIENTS.length;
  const [c1, c2] = GRADIENTS[idx];
  const showImg = src && !imgErr;

  return (
    <div
      className={`avatar avatar-${size} ${className}`}
      style={{
        background: showImg ? 'transparent' : `linear-gradient(135deg, ${c1}, ${c2})`,
        ...style,
      }}
    >
      {showImg ? (
        <img src={src} alt={name} onError={() => setImgErr(true)} loading="lazy" />
      ) : (
        (name || 'A').charAt(0).toUpperCase()
      )}
    </div>
  );
}

export function CompanionCard({ companion, onChat, onToggleSave, isSaved, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const handleClick = () => onClick ? onClick(companion) : onChat?.(companion);
  const hasSrc = companion.avatar_url && !imgErr;

  return (
    <div className="card" onClick={handleClick} style={{ cursor: 'pointer' }}>
      {/* Large photo area */}
      <div style={{
        width: '100%', height: 200, overflow: 'hidden', position: 'relative',
        background: hasSrc ? 'transparent' : `linear-gradient(135deg, ${GRADIENTS[hashStr(companion.name) % GRADIENTS.length][0]}, ${GRADIENTS[hashStr(companion.name) % GRADIENTS.length][1]})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {hasSrc ? (
          <img src={companion.avatar_url} alt={companion.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        ) : (
          <span style={{ fontSize: 56, fontWeight: 800, color: 'rgba(255,255,255,0.4)' }}>
            {(companion.name || 'A').charAt(0)}
          </span>
        )}
        {/* Online indicator */}
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: 'rgba(0,0,0,0.5)', borderRadius: 20,
          padding: '3px 10px', fontSize: 10, color: '#2ecc71',
          display: 'flex', alignItems: 'center', gap: 4, backdropFilter: 'blur(4px)',
        }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:'#2ecc71', display:'inline-block' }} />
          Online
        </div>
        {/* Gradient overlay */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 60,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
        }} />
      </div>
      <div style={{ padding: '12px 14px 8px' }}>
        <div className="companion-name">{companion.name}</div>
        <div className="companion-tagline">{companion.tagline || companion.personality}</div>
        <div className="companion-tags">
          {companion.personality && (
            <span className="tag">{companion.personality.split(' ')[0]}</span>
          )}
          {(companion.hobbies?.[0] || companion.hobby) && (
            <span className="tag">{companion.hobbies?.[0] || companion.hobby}</span>
          )}
        </div>
      </div>
      <div className="card-footer">
        <button onClick={e => { e.stopPropagation(); onChat?.(companion); }}>
          💬 Chat
        </button>
        <button onClick={e => { e.stopPropagation(); onToggleSave?.(companion.id); }}
          style={{ color: isSaved ? 'var(--accent)' : undefined }}>
          {isSaved ? '♥' : '♡'} Save
        </button>
      </div>
    </div>
  );
}

export function StatCard({ label, value }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export function EmptyState({ icon, text, action, actionText }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <div className="empty-text">{text}</div>
      {action && (
        <button className="btn btn-primary" onClick={action}>{actionText}</button>
      )}
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="flex-center" style={{ padding: 60 }}>
      <div style={{
        width: 40, height: 40, border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
