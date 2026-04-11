import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { CompanionCard } from '../components/UI';

const CATEGORIES = ['Girls', 'Anime', 'Guys'];
const FEATURES = [
  { icon: '💬', title: 'Text Chat', desc: 'Natural conversations that feel real and deeply personal' },
  { icon: '🎤', title: 'Voice Chat', desc: 'Hear your companion talk back in their unique voice' },
  { icon: '🧠', title: 'Memory', desc: 'They remember your conversations and grow with you' },
  { icon: '🎭', title: 'Roleplay', desc: 'Explore creative scenarios and stories together' },
  { icon: '🎨', title: 'Full Customization', desc: 'Design every detail — looks, personality, voice' },
  { icon: '🔒', title: 'Private & Secure', desc: 'Encrypted conversations, your data stays safe' },
];

const FAQS = [
  { q: 'What is Aura AI?', a: 'Aura AI is a premium companion platform where you create personalized AI friends with unique personalities, appearances, and interests. Chat anytime for meaningful, supportive conversations in a safe environment.' },
  { q: 'Is it safe to use?', a: 'Absolutely. We use encrypted transactions, strict content filtering, and privacy-first design. All conversations are private. Fully compliant with Stripe and PayPal policies.' },
  { q: 'Can I customize my companion?', a: 'Yes! Customize ethnicity, age range, eye color, hair style/color, body type, personality, voice, and hobbies. Upload your own image or generate one with AI.' },
  { q: 'How does the free trial work?', a: 'New users get a 24-hour free trial with 50 messages and 1 companion slot. After the trial, subscribe to continue.' },
  { q: 'What payment methods are accepted?', a: 'We accept all major cards via Stripe and PayPal. Discreet billing — no reference to Aura AI on your statement.' },
  { q: 'Can my companion send voice messages?', a: 'Voice chat is available on Plus and Premium plans with natural-sounding responses.' },
];

export default function HomePage({ onNavigate, onChat, onToggleSave, collection, onRequireAuth }) {
  const { user } = useAuth();
  const [category, setCategory] = useState('Girls');
  const [presets, setPresets] = useState([]);
  const [faqOpen, setFaqOpen] = useState(null);

  useEffect(() => {
    api('/companions/presets').then(d => setPresets(d.companions || [])).catch(() => {});
  }, []);

  const filtered = presets.filter(c => c.category === category);
  const heroChars = presets.filter(c => c.category === 'Girls').slice(0, 3);

  return (
    <div>
      {/* ============ HERO BANNER ============ */}
      <div style={{
        position: 'relative', overflow: 'hidden',
        background: 'linear-gradient(135deg, #1a0a1e 0%, #0d0d1a 40%, #150a1a 100%)',
        padding: '50px 20px 40px',
      }}>
        {/* Glow effects */}
        <div style={{ position:'absolute', top:'-30%', left:'20%', width:400, height:400, background:'radial-gradient(circle, rgba(255,107,157,0.15) 0%, transparent 70%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', top:'-20%', right:'10%', width:300, height:300, background:'radial-gradient(circle, rgba(196,69,105,0.1) 0%, transparent 70%)', pointerEvents:'none' }} />

        <div style={{ maxWidth: 1000, margin: '0 auto', position: 'relative', zIndex: 1 }}>
          {/* Hero images row — large character portraits */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 16,
            marginBottom: 32, flexWrap: 'wrap',
          }}>
            {heroChars.map((c, i) => (
              <div key={c.id} style={{
                width: i === 1 ? 180 : 150, height: i === 1 ? 220 : 190,
                borderRadius: 20, overflow: 'hidden', position: 'relative',
                border: '3px solid rgba(255,107,157,0.4)',
                boxShadow: '0 8px 32px rgba(255,107,157,0.2)',
                transform: i === 1 ? 'scale(1.05)' : 'scale(1)',
                cursor: 'pointer',
              }} onClick={() => { if(!user) onRequireAuth('signup'); else onChat(c); }}>
                <img src={c.avatar_url} alt={c.name}
                  style={{ width:'100%', height:'100%', objectFit:'cover' }}
                  onError={e => { e.target.style.display='none'; }}
                />
                <div style={{
                  position:'absolute', bottom:0, left:0, right:0,
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
                  padding: '20px 12px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>{c.name}</div>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,0.7)' }}>{c.personality}</div>
                </div>
              </div>
            ))}
          </div>

          <h1 style={{
            textAlign:'center', fontSize:'clamp(36px, 6vw, 58px)', fontWeight:900,
            lineHeight:1.1, marginBottom:16, letterSpacing:-1.5,
          }}>
            Create your own{' '}
            <span style={{
              background:'linear-gradient(135deg, #ff6b9d, #f8a5c2)',
              WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent',
            }}>AI Companion</span>
          </h1>

          <p style={{
            textAlign:'center', color:'#8b8ba7', fontSize:16,
            maxWidth:480, margin:'0 auto 32px', lineHeight:1.6,
          }}>
            Always available, always supportive, and made just for you.
          </p>

          <div style={{ textAlign:'center' }}>
            <button className="btn btn-primary btn-lg"
              onClick={() => user ? onNavigate('create') : onRequireAuth('signup')}
              style={{ padding:'16px 40px', fontSize:17, boxShadow:'0 4px 24px rgba(255,107,157,0.35)' }}>
              {user ? '✨ Create Your AI' : 'Join Now for FREE'}
            </button>
          </div>

          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:18, fontSize:13, color:'#8b8ba7' }}>
            <span style={{ color:'#ffd32a', letterSpacing:2 }}>★★★★★</span>
            <span>Trusted by thousands worldwide</span>
          </div>
        </div>
      </div>

      {/* ============ CIRCULAR AVATAR ROW (like candy.ai) ============ */}
      <div style={{ padding:'30px 20px 10px', background:'var(--bg-primary)' }}>
        <div style={{
          display:'flex', justifyContent:'center', gap:20,
          overflowX:'auto', padding:'10px 0', maxWidth:900, margin:'0 auto',
        }}>
          {presets.filter(c => c.category === 'Girls').slice(0, 8).map(c => (
            <div key={c.id} style={{ textAlign:'center', flexShrink:0, cursor:'pointer' }}
              onClick={() => { if(!user) onRequireAuth('signup'); else onChat(c); }}>
              <div style={{
                width:72, height:72, borderRadius:'50%', overflow:'hidden',
                border:'3px solid rgba(255,107,157,0.4)', margin:'0 auto 6px',
                boxShadow:'0 0 16px rgba(255,107,157,0.15)',
              }}>
                <img src={c.avatar_url} alt={c.name}
                  style={{ width:'100%', height:'100%', objectFit:'cover' }}
                  onError={e => { e.target.parentNode.style.background='linear-gradient(135deg,#ff6b9d,#c44569)'; e.target.style.display='none'; }}
                />
              </div>
              <div style={{ fontSize:11, color:'#ccc', fontWeight:500 }}>{c.name}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ CATEGORY TABS ============ */}
      <div className="category-tabs" style={{ paddingTop:20 }}>
        {CATEGORIES.map(cat => (
          <button key={cat}
            className={`chip ${category === cat ? 'active' : ''}`}
            onClick={() => setCategory(cat)}
            style={{ padding:'10px 28px', fontSize:14 }}>
            {cat === 'Girls' ? '♀ ' : cat === 'Guys' ? '♂ ' : '✿ '}{cat}
          </button>
        ))}
      </div>

      {/* ============ COMPANION GRID ============ */}
      <div className="section" style={{ paddingTop:8 }}>
        {filtered.length === 0 && presets.length === 0 ? (
          <div style={{ textAlign:'center', padding:40, color:'#8b8ba7' }}>
            <div style={{ fontSize:48, marginBottom:12, opacity:0.5 }}>🔄</div>
            <p>Loading companions...</p>
          </div>
        ) : (
          <div className="companion-grid">
            {filtered.map(comp => (
              <CompanionCard key={comp.id} companion={comp}
                onChat={() => { if(!user) return onRequireAuth('signup'); onChat(comp); }}
                onToggleSave={() => { if(!user) return onRequireAuth('signup'); onToggleSave(comp.id); }}
                isSaved={collection?.includes(comp.id)}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn:'1/-1', textAlign:'center', padding:30, color:'#8b8ba7' }}>
                No companions in this category yet.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============ CREATE CTA ============ */}
      <div style={{
        textAlign:'center', padding:'50px 20px 60px', position:'relative',
        background:'linear-gradient(180deg, transparent, rgba(255,107,157,0.04))',
      }}>
        <h2 style={{ fontSize:30, fontWeight:800, marginBottom:12, letterSpacing:-0.5 }}>
          Create your own AI companion
        </h2>
        <p style={{ color:'#8b8ba7', maxWidth:440, margin:'0 auto 28px', fontSize:15 }}>
          Shape their look, personality, and bring them to life instantly.
        </p>
        <div style={{ display:'flex', justifyContent:'center', gap:16, flexWrap:'wrap' }}>
          {presets.slice(0,4).map(c => (
            <div key={c.id} style={{ width:80, height:100, borderRadius:14, overflow:'hidden', border:'2px solid rgba(255,255,255,0.1)' }}>
              <img src={c.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}
                onError={e => { e.target.parentNode.style.background='linear-gradient(135deg,#ff6b9d,#c44569)'; e.target.style.display='none'; }} />
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-lg" style={{ marginTop:28 }}
          onClick={() => user ? onNavigate('create') : onRequireAuth('signup')}>
          ✨ Create Your AI
        </button>
      </div>

      {/* ============ FEATURES ============ */}
      <div className="section">
        <h2 className="section-title text-center">Everything You Need</h2>
        <p className="section-subtitle text-center" style={{ maxWidth:500, margin:'0 auto 28px' }}>
          A complete AI companion experience
        </p>
        <div className="features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="feature-card">
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ============ FAQ ============ */}
      <div className="section" style={{ maxWidth:660 }}>
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

      {/* ============ FOOTER ============ */}
      <div style={{ textAlign:'center', padding:'40px 20px', fontSize:12, color:'#5a5a78' }}>
        <p>© 2026 Aura AI — All rights reserved</p>
        <p style={{ marginTop:6 }}>Your conversations are private, secure, and encrypted.</p>
      </div>
    </div>
  );
}
