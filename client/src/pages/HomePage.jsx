import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { CompanionCard } from '../components/UI';

const CATEGORIES = ['Girls', 'Anime', 'Guys'];

const FAQS = [
  { q: 'What is Aura AI?', a: 'Aura AI is a premium companion platform where you create personalized AI friends with unique personalities, appearances, and interests. Chat anytime for meaningful, supportive conversations.' },
  { q: 'Is it safe to use?', a: 'Yes. Encrypted transactions, strict content filtering, privacy-first design. Fully compliant with Stripe and PayPal policies.' },
  { q: 'Can I customize my companion?', a: 'Customize ethnicity, age, eye/hair color, personality, voice, hobbies. Upload your own image or generate with AI.' },
  { q: 'How does the free trial work?', a: '24-hour free trial with 50 messages and 1 companion. Subscribe after to continue.' },
  { q: 'What payment methods are accepted?', a: 'All major cards via Stripe and PayPal. Discreet billing.' },
];

export default function HomePage({ onNavigate, onChat, onToggleSave, collection, onRequireAuth }) {
  const { user } = useAuth();
  const [category, setCategory] = useState('Girls');
  const [presets, setPresets] = useState([]);
  const [faqOpen, setFaqOpen] = useState(null);
  const [heroIdx, setHeroIdx] = useState(0);
  const scrollRef = useRef();

  useEffect(() => {
    api('/companions/presets').then(d => setPresets(d.companions || [])).catch(() => {});
  }, []);

  // Auto-rotate hero
  useEffect(() => {
    const t = setInterval(() => setHeroIdx(i => i + 1), 4000);
    return () => clearInterval(t);
  }, []);

  const filtered = presets.filter(c => c.category === category);
  const heroChars = presets.filter(c => c.category === 'Girls').slice(0, 6);
  const allGirls = presets.filter(c => c.category === 'Girls');

  const goChat = (c) => { if (!user) onRequireAuth('signup'); else onChat(c); };

  return (
    <div style={{ overflow: 'hidden' }}>

      {/* ========== HERO BANNER — FULL WIDTH ========== */}
      <div style={{
        position: 'relative', minHeight: 480, display: 'flex', alignItems: 'center',
        background: 'linear-gradient(135deg, #1a0a20 0%, #0d0d1a 50%, #170a1e 100%)',
        overflow: 'hidden',
      }}>
        {/* Animated gradient orbs */}
        <div style={{ position: 'absolute', top: '-20%', left: '5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,157,0.12) 0%, transparent 70%)', animation: 'float1 8s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-10%', right: '10%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(196,69,105,0.08) 0%, transparent 70%)', animation: 'float2 10s ease-in-out infinite', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '50px 20px 40px', display: 'flex', alignItems: 'center', gap: 40, width: '100%', position: 'relative', zIndex: 1, flexWrap: 'wrap', justifyContent: 'center' }}>

          {/* Left — Text */}
          <div style={{ flex: '1 1 400px', maxWidth: 520 }}>
            <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: 20, background: 'rgba(255,107,157,0.12)', border: '1px solid rgba(255,107,157,0.2)', fontSize: 12, fontWeight: 600, color: '#ff6b9d', marginBottom: 20, letterSpacing: 0.5 }}>
              ✦ #1 AI Companion Platform
            </div>
            <h1 style={{ fontSize: 'clamp(36px, 5vw, 54px)', fontWeight: 900, lineHeight: 1.08, letterSpacing: -1.5, marginBottom: 18 }}>
              Create your own<br />
              <span style={{ background: 'linear-gradient(135deg, #ff6b9d, #f8a5c2, #ff6b9d)', backgroundSize: '200% 200%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', animation: 'shimmer 3s ease-in-out infinite' }}>
                AI Companion
              </span>
            </h1>
            <p style={{ color: '#9b9bb5', fontSize: 16, lineHeight: 1.7, marginBottom: 30, maxWidth: 420 }}>
              Always available, always in the mood, and made just for you.
              Design their look, personality and start chatting instantly.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-primary btn-lg"
                onClick={() => user ? onNavigate('create') : onRequireAuth('signup')}
                style={{ padding: '16px 36px', fontSize: 16, boxShadow: '0 4px 30px rgba(255,107,157,0.3)' }}>
                {user ? '✨ Create Now' : 'Join for FREE'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex' }}>
                  {heroChars.slice(0, 4).map((c, i) => (
                    <div key={c.id} style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', border: '2px solid #1a0a20', marginLeft: i > 0 ? -8 : 0, position: 'relative', zIndex: 4 - i }}>
                      <img src={c.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} />
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ color: '#ffd32a', fontSize: 11, letterSpacing: 1 }}>★★★★★</div>
                  <div style={{ fontSize: 10, color: '#8b8ba7' }}>Loved by thousands</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right — Hero character showcase */}
          <div style={{ flex: '1 1 400px', maxWidth: 540, display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'flex-end' }}>
            {heroChars.slice(0, 3).map((c, i) => {
              const isCenter = i === 1;
              return (
                <div key={c.id}
                  onClick={() => goChat(c)}
                  style={{
                    width: isCenter ? 190 : 155,
                    height: isCenter ? 280 : 240,
                    borderRadius: 20,
                    overflow: 'hidden',
                    position: 'relative',
                    cursor: 'pointer',
                    border: `2px solid rgba(255,107,157,${isCenter ? 0.5 : 0.2})`,
                    boxShadow: isCenter ? '0 12px 40px rgba(255,107,157,0.25)' : '0 8px 24px rgba(0,0,0,0.3)',
                    transform: `translateY(${isCenter ? 0 : 20}px)`,
                    transition: 'all 0.4s ease',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = `translateY(${isCenter ? -8 : 12}px) scale(1.03)`; e.currentTarget.style.borderColor = 'rgba(255,107,157,0.6)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = `translateY(${isCenter ? 0 : 20}px) scale(1)`; e.currentTarget.style.borderColor = `rgba(255,107,157,${isCenter ? 0.5 : 0.2})`; }}
                >
                  <img src={c.avatar_url} alt={c.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { e.target.parentNode.style.background = 'linear-gradient(135deg,#ff6b9d,#c44569)'; e.target.style.display = 'none'; }}
                  />
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                    padding: '30px 14px 14px',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{c.personality}</div>
                  </div>
                  {/* Online pulse */}
                  <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: '3px 8px', backdropFilter: 'blur(4px)' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#2ecc71', boxShadow: '0 0 6px #2ecc71', animation: 'pulse2 2s infinite' }} />
                    <span style={{ fontSize: 9, color: '#2ecc71' }}>Online</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ========== SCROLLING AVATAR ROW ========== */}
      <div style={{
        padding: '28px 0', background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div ref={scrollRef} style={{
          display: 'flex', gap: 24, justifyContent: 'center',
          overflowX: 'auto', padding: '0 20px', maxWidth: 1000, margin: '0 auto',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        }}>
          {allGirls.slice(0, 8).map(c => (
            <div key={c.id} style={{ textAlign: 'center', flexShrink: 0, cursor: 'pointer' }}
              onClick={() => goChat(c)}>
              <div style={{
                width: 68, height: 68, borderRadius: '50%', overflow: 'hidden',
                border: '3px solid rgba(255,107,157,0.35)', margin: '0 auto 6px',
                boxShadow: '0 0 12px rgba(255,107,157,0.12)',
                transition: 'all 0.3s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#ff6b9d'; e.currentTarget.style.transform = 'scale(1.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,107,157,0.35)'; e.currentTarget.style.transform = 'scale(1)'; }}
              >
                <img src={c.avatar_url} alt={c.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.parentNode.style.background = 'linear-gradient(135deg,#ff6b9d,#c44569)'; e.target.style.display = 'none'; }}
                />
              </div>
              <div style={{ fontSize: 11, color: '#ccc', fontWeight: 500 }}>{c.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ========== CATEGORY TABS ========== */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, padding: '28px 20px 20px' }}>
        {CATEGORIES.map(cat => (
          <button key={cat}
            className={`chip ${category === cat ? 'active' : ''}`}
            onClick={() => setCategory(cat)}
            style={{ padding: '10px 28px', fontSize: 14, borderRadius: 25 }}>
            {cat === 'Girls' ? '♀ ' : cat === 'Guys' ? '♂ ' : '✿ '}{cat}
          </button>
        ))}
      </div>

      {/* ========== COMPANION GRID ========== */}
      <div className="section" style={{ paddingTop: 4, maxWidth: 1100 }}>
        <div className="companion-grid">
          {filtered.map(comp => (
            <CompanionCard key={comp.id} companion={comp}
              onChat={() => goChat(comp)}
              onToggleSave={() => { if (!user) onRequireAuth('signup'); else onToggleSave(comp.id); }}
              isSaved={collection?.includes(comp.id)}
            />
          ))}
          {filtered.length === 0 && presets.length > 0 && (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#8b8ba7' }}>
              No companions in this category yet.
            </div>
          )}
        </div>
      </div>

      {/* ========== CREATE YOUR OWN — VISUAL CTA ========== */}
      <div style={{
        position: 'relative', margin: '40px 20px', borderRadius: 24,
        background: 'linear-gradient(135deg, rgba(255,107,157,0.08), rgba(196,69,105,0.06))',
        border: '1px solid rgba(255,107,157,0.15)',
        overflow: 'hidden', maxWidth: 1060, marginLeft: 'auto', marginRight: 'auto',
      }}>
        <div style={{ position: 'absolute', top: 0, right: 0, width: 300, height: '100%', background: 'radial-gradient(circle at 100% 50%, rgba(255,107,157,0.1) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, padding: '40px 36px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Preview images */}
          <div style={{ display: 'flex', gap: 10 }}>
            {presets.slice(0, 4).map((c, i) => (
              <div key={c.id} style={{
                width: 80, height: 100, borderRadius: 14, overflow: 'hidden',
                border: '2px solid rgba(255,107,157,0.25)',
                transform: `rotate(${(i - 1.5) * 3}deg)`,
              }}>
                <img src={c.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.parentNode.style.background = 'linear-gradient(135deg,#ff6b9d,#c44569)'; e.target.style.display = 'none'; }} />
              </div>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 250 }}>
            <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: -0.5 }}>
              Create your own AI companion
            </h2>
            <p style={{ color: '#8b8ba7', fontSize: 14, marginBottom: 20, maxWidth: 360 }}>
              Shape their look, set their personality, choose their voice, and bring them to life instantly.
            </p>
            <button className="btn btn-primary"
              onClick={() => user ? onNavigate('create') : onRequireAuth('signup')}
              style={{ boxShadow: '0 4px 20px rgba(255,107,157,0.25)' }}>
              ✨ Create Your AI
            </button>
          </div>
        </div>
      </div>

      {/* ========== FEATURES ========== */}
      <div className="section" style={{ maxWidth: 900 }}>
        <h2 className="section-title text-center">Everything You Need</h2>
        <p className="section-subtitle text-center" style={{ maxWidth: 400, margin: '0 auto 28px' }}>
          A complete AI companion experience
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
          {[
            { icon: '💬', title: 'Text Chat', desc: 'Natural conversations that feel real and deeply personal' },
            { icon: '🎤', title: 'Voice Chat', desc: 'Hear your companion talk back in their unique voice' },
            { icon: '🧠', title: 'Memory', desc: 'They remember your conversations and grow with you' },
            { icon: '🎭', title: 'Roleplay', desc: 'Explore creative scenarios and stories together' },
            { icon: '🎨', title: 'Full Customization', desc: 'Design every detail — looks, personality, voice' },
            { icon: '🔒', title: 'Private & Secure', desc: 'Encrypted conversations, your data stays safe' },
          ].map((f, i) => (
            <div key={i} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ========== FAQ ========== */}
      <div className="section" style={{ maxWidth: 660 }}>
        <h2 className="section-title text-center mb-3">Frequently Asked Questions</h2>
        {FAQS.map((faq, i) => (
          <div key={i} className="faq-item">
            <button className="faq-question" onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
              {faq.q}
              <span className={`faq-arrow ${faqOpen === i ? 'open' : ''}`}>▾</span>
            </button>
            {faqOpen === i && <div className="faq-answer">{faq.a}</div>}
          </div>
        ))}
      </div>

      {/* ========== FOOTER ========== */}
      <div style={{ textAlign: 'center', padding: '40px 20px 30px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, background: 'linear-gradient(135deg, #ff6b9d, #f8a5c2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Aura AI</div>
        <p style={{ fontSize: 12, color: '#5a5a78' }}>© 2026 Aura AI — All rights reserved</p>
        <p style={{ fontSize: 11, color: '#5a5a78', marginTop: 4 }}>Your conversations are private, secure, and encrypted.</p>
      </div>

      {/* ========== ANIMATIONS ========== */}
      <style>{`
        @keyframes float1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -20px) scale(1.05); }
        }
        @keyframes float2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-20px, 15px) scale(1.08); }
        }
        @keyframes shimmer {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes pulse2 {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        div::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
