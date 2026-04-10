import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../utils/api';
import { Avatar, CompanionCard } from '../components/UI';

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
  { q: 'What is Aura AI?', a: 'Aura AI is a premium companion platform where you can create personalized AI friends with unique personalities, appearances, and interests. Chat with them anytime for meaningful, supportive conversations in a safe environment.' },
  { q: 'Is Aura AI safe to use?', a: 'Absolutely. We use encrypted transactions, strict content filtering to keep all interactions appropriate, and privacy-first design. All conversations are private and secure. We are fully compliant with Stripe and PayPal content policies.' },
  { q: 'Can I customize my companion?', a: 'Yes! You can customize ethnicity, age range, eye color, hair style and color, body type, personality traits, voice style, and hobbies. You can also upload your own reference image or describe how you want them to look.' },
  { q: 'How does the free trial work?', a: 'New users get a 24-hour free trial with 50 messages and 1 companion slot. After the trial period, you\'ll need to subscribe to one of our plans to continue chatting.' },
  { q: 'What payment methods are accepted?', a: 'We accept all major credit/debit cards via Stripe and PayPal. All transactions are processed securely with discreet billing — no reference to Aura AI appears on your statement.' },
  { q: 'Can my companion send voice messages?', a: 'Voice chat is available on Plus and Premium plans. Your companion will respond with natural-sounding voice messages tailored to their personality.' },
  { q: 'Can I create multiple companions?', a: 'Yes! The number of companions you can create depends on your plan: Starter allows 1, Plus allows 3, and Premium allows up to 10 unique companions.' },
];

export default function HomePage({ onNavigate, onChat, onToggleSave, collection, onRequireAuth }) {
  const { user } = useAuth();
  const [category, setCategory] = useState('Girls');
  const [presets, setPresets] = useState([]);
  const [faqOpen, setFaqOpen] = useState(null);

  useEffect(() => {
    api('/companions/presets').then(d => setPresets(d.companions)).catch(() => {});
  }, []);

  const filtered = presets.filter(c => c.category === category);

  return (
    <div>
      {/* Hero */}
      <div className="hero">
        <div className="hero-avatars">
          {presets.slice(0, 6).map(c => (
            <Avatar key={c.id} name={c.name} src={c.avatar_url} size="md" />
          ))}
        </div>
        <h1 className="hero-title">
          Meet your perfect<br /><span className="accent">AI Companion</span>
        </h1>
        <p className="hero-subtitle">
          Always available, always supportive, and crafted just for you.
          Create your personalized AI friend and start chatting today.
        </p>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => user ? onNavigate('create') : onRequireAuth('signup')}
        >
          {user ? '✨ Create Your AI' : 'Join Now for FREE'}
        </button>
        <div className="hero-trust">
          <span className="hero-stars">★★★★★</span>
          <span>Trusted by thousands worldwide</span>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="category-tabs">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`chip ${category === cat ? 'active' : ''}`}
            onClick={() => setCategory(cat)}
            style={{ padding: '9px 24px', fontSize: 13 }}
          >
            {cat === 'Girls' ? '👩 ' : cat === 'Guys' ? '👨 ' : '🎨 '}{cat}
          </button>
        ))}
      </div>

      {/* Companion Grid */}
      <div className="section" style={{ paddingTop: 0 }}>
        <div className="companion-grid">
          {filtered.map(comp => (
            <CompanionCard
              key={comp.id}
              companion={comp}
              onChat={() => {
                if (!user) return onRequireAuth('signup');
                onChat(comp);
              }}
              onToggleSave={() => {
                if (!user) return onRequireAuth('signup');
                onToggleSave(comp.id);
              }}
              isSaved={collection?.includes(comp.id)}
            />
          ))}
        </div>
      </div>

      {/* Create CTA */}
      <div style={{ textAlign: 'center', padding: '50px 20px 60px', background: 'linear-gradient(180deg, transparent, rgba(255,107,157,0.04))' }}>
        <h2 style={{ fontSize: 30, fontWeight: 800, marginBottom: 12, letterSpacing: -0.5 }}>
          Create your own AI companion
        </h2>
        <p className="text-muted" style={{ maxWidth: 440, margin: '0 auto 28px', fontSize: 15 }}>
          Shape their look, personality, and bring them to life instantly.
        </p>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => user ? onNavigate('create') : onRequireAuth('signup')}
        >
          ✨ Create Your AI
        </button>
      </div>

      {/* Features */}
      <div className="section">
        <h2 className="section-title text-center">Everything You Need</h2>
        <p className="section-subtitle text-center" style={{ maxWidth: 500, margin: '0 auto 28px' }}>
          A complete AI companion experience with all the features you'd want
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

      {/* FAQ */}
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

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '40px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
        <p>© 2026 Aura AI — All rights reserved</p>
        <p style={{ marginTop: 6 }}>Your conversations are private, secure, and encrypted.</p>
      </div>
    </div>
  );
}
