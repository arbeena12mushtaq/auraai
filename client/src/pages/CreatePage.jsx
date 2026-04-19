import { useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getCompanionSlots } from '../utils/api';
import { Avatar } from '../components/UI';

const PERSONALITIES = ['Sweet & Caring', 'Bold & Confident', 'Shy & Gentle', 'Witty & Playful', 'Wise & Calm', 'Energetic & Fun'];
const VOICES = ['Soft & Gentle', 'Warm & Rich', 'Bright & Cheerful', 'Calm & Soothing', 'Deep & Confident'];
const HOBBIES = ['Reading', 'Gaming', 'Cooking', 'Yoga', 'Music', 'Art', 'Travel', 'Fitness', 'Dancing', 'Photography'];

export default function CreatePage({ onChat, onNavigate, myCompanionCount = 0 }) {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const [form, setForm] = useState({
    name: '', category: 'Girls', art_style: 'Realistic',
    personality: 'Sweet & Caring', voice: 'Soft & Gentle',
    hobbies: [], description: '', avatarFile: null, avatarPreview: null,
    generatedAvatarUrl: null, avatarSeed: 0,
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toggleHobby = (h) => set('hobbies', form.hobbies.includes(h) ? form.hobbies.filter(x => x !== h) : form.hobbies.length < 3 ? [...form.hobbies, h] : form.hobbies);

  const slots = getCompanionSlots(user);
  const slotsLeft = slots - myCompanionCount;

  if (!user) return <div className="section text-center"><p>Please sign in first.</p></div>;
  if (slotsLeft <= 0 && !user.is_admin) return (
    <div className="section text-center">
      <h2 className="section-title">No Companion Slots</h2>
      <p className="text-muted mt-1">Upgrade your plan for more companion slots.</p>
      <button className="btn btn-primary mt-3" onClick={() => onNavigate('pricing')}>View Plans</button>
    </div>
  );

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    set('avatarFile', file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      set('avatarPreview', ev.target.result);
      set('generatedAvatarUrl', null);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateImage = async () => {
    if (!form.description.trim()) {
      setError('Please write a description first so we can generate an avatar.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const data = await api('/image/generate', {
        method: 'POST',
        body: {
          category: form.category,
          art_style: form.art_style,
          description: form.description,
        },
      });
      if (data.avatar_url) {
        set('generatedAvatarUrl', data.avatar_url);
        set('avatarPreview', data.avatar_url);
        set('avatarFile', null);
        set('avatarSeed', data.seed || 0);
      }
    } catch (err) {
      setError(err.error || 'Image generation failed. You can upload an image manually instead.');
    }
    setGenerating(false);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return setError('Please give your companion a name');
    if (!form.description.trim()) return setError('Please write a description for your companion');
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('category', form.category);
      formData.append('art_style', form.art_style);
      formData.append('personality', form.personality);
      formData.append('voice', form.voice);
      formData.append('hobbies', JSON.stringify(form.hobbies));
      formData.append('description', form.description);
      formData.append('tagline', `${form.personality} companion`);
      if (form.generatedAvatarUrl) formData.append('generated_avatar_url', form.generatedAvatarUrl);
      if (form.avatarSeed) formData.append('avatar_seed', form.avatarSeed);
      if (form.avatarFile) formData.append('avatar', form.avatarFile);

      const data = await api('/companions', { method: 'POST', body: formData });
      await refreshUser();
      onChat(data.companion);
    } catch (err) {
      setError(err.error || 'Failed to create companion');
    }
    setLoading(false);
  };

  const Chip = ({ value, selected, onClick }) => (
    <button className={`chip ${selected ? 'active' : ''}`} onClick={onClick} type="button">{value}</button>
  );

  const previewSrc = form.avatarPreview || null;

  return (
    <div className="section" style={{ maxWidth: 640 }}>
      <h2 className="section-title">Create Your Companion</h2>
      <p className="section-subtitle">Step {step} of 3 — {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} remaining</p>

      <div className="progress-bar">
        {[1,2,3].map(s => <div key={s} className={`progress-step ${s <= step ? 'active' : ''}`} />)}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ===== STEP 1: Name, Description & Avatar ===== */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 16, fontSize: 18 }}>Describe Your Companion</h3>

          <div className="form-label">Name *</div>
          <input className="input" placeholder="Give your companion a name"
            value={form.name} onChange={e => set('name', e.target.value)} />

          <div className="form-label" style={{ marginTop: 16 }}>Character Type</div>
          <div className="chip-group mb-2">
            {['Girls', 'Guys', 'Anime'].map(s => <Chip key={s} value={s} selected={form.category===s} onClick={() => set('category', s)} />)}
          </div>

          <div className="form-label">Art Style</div>
          <div className="chip-group mb-2">
            {['Realistic', 'Anime'].map(s => <Chip key={s} value={s} selected={form.art_style===s} onClick={() => set('art_style', s)} />)}
          </div>

          <div className="form-label" style={{ marginTop: 16 }}>Description *</div>
          <textarea className="input" style={{ minHeight: 120 }}
            placeholder={"Describe how your companion looks and who they are.\n\ne.g. 'A cheerful woman with long wavy brown hair, freckles, and green eyes. She has a warm smile and loves wearing cozy sweaters. She's the kind of person who lights up a room.'"}
            value={form.description} onChange={e => set('description', e.target.value)} />
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
            This description will be used to generate the avatar and shape their personality.
          </div>

          {/* Avatar area */}
          <div style={{
            border: '2px dashed rgba(255,107,157,0.25)', borderRadius: 'var(--radius-lg)',
            padding: 28, textAlign: 'center', marginTop: 20, background: 'rgba(255,255,255,0.02)',
          }}>
            {previewSrc ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={previewSrc} alt="Preview" style={{
                  width: 130, height: 130, borderRadius: '50%', objectFit: 'cover',
                  border: '3px solid var(--accent)', boxShadow: 'var(--shadow-glow)',
                }} />
                <button className="btn btn-ghost btn-sm" type="button"
                  onClick={() => { set('avatarPreview', null); set('avatarFile', null); set('generatedAvatarUrl', null); }}
                  style={{ position: 'absolute', top: -4, right: -4, background: 'var(--bg3)', borderRadius: '50%', width: 24, height: 24, padding: 0, fontSize: 12, lineHeight: '24px' }}>✕</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🎨</div>
                <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 12 }}>
                  Generate an avatar from your description
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={handleGenerateImage}
                    disabled={generating || !form.description.trim()} type="button">
                    {generating ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="gen-spinner" />
                        Generating...
                      </span>
                    ) : '✨ Generate Avatar'}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} type="button">
                    📷 Upload Instead
                  </button>
                </div>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
          </div>

          {previewSrc && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => fileRef.current?.click()} type="button">
                📷 Upload Different
              </button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleGenerateImage} disabled={generating || !form.description.trim()} type="button">
                {generating ? '✨ Generating...' : '🔄 Regenerate'}
              </button>
            </div>
          )}

          <style>{`
            .gen-spinner {
              width: 14px; height: 14px;
              border: 2px solid rgba(255,255,255,0.3);
              border-top-color: #fff;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              display: inline-block;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      )}

      {/* ===== STEP 2: Personality & Voice ===== */}
      {step === 2 && (
        <div>
          <h3 style={{ marginBottom: 16, fontSize: 18 }}>Personality & Voice</h3>
          <div className="form-label">Personality</div>
          <div className="chip-group">{PERSONALITIES.map(v => <Chip key={v} value={v} selected={form.personality===v} onClick={() => set('personality', v)} />)}</div>
          <div className="form-label">Voice</div>
          <div className="chip-group">{VOICES.map(v => <Chip key={v} value={v} selected={form.voice===v} onClick={() => set('voice', v)} />)}</div>
          <div className="form-label">Hobbies (pick up to 3)</div>
          <div className="chip-group">{HOBBIES.map(v => <Chip key={v} value={v} selected={form.hobbies.includes(v)} onClick={() => toggleHobby(v)} />)}</div>
        </div>
      )}

      {/* ===== STEP 3: Review ===== */}
      {step === 3 && (
        <div>
          <h3 style={{ marginBottom: 16, fontSize: 18 }}>Review & Create</h3>
          <div className="review-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              {previewSrc ? (
                <img src={previewSrc} alt={form.name} style={{
                  width: 80, height: 80, borderRadius: '50%', objectFit: 'cover',
                  border: '3px solid var(--accent)', boxShadow: 'var(--shadow-glow)'
                }} />
              ) : (
                <Avatar name={form.name || 'A'} size="lg" />
              )}
              <div>
                <h3 style={{ fontSize: 22, fontWeight: 800 }}>{form.name || 'Unnamed'}</h3>
                <p className="text-muted" style={{ fontSize: 13 }}>{form.personality}</p>
                {form.generatedAvatarUrl && <span style={{ fontSize: 10, color: 'var(--success)' }}>✓ AI Generated Avatar</span>}
              </div>
            </div>
            <div className="review-detail-grid">
              <div><span className="review-detail-label">Style: </span>{form.category} / {form.art_style}</div>
              <div><span className="review-detail-label">Voice: </span>{form.voice}</div>
            </div>
            {form.hobbies.length > 0 && (
              <div style={{ marginTop: 14, fontSize: 13 }}><span className="review-detail-label">Hobbies: </span>{form.hobbies.join(', ')}</div>
            )}
            {form.description && (
              <div style={{ marginTop: 10, fontSize: 13 }}><span className="review-detail-label">Description: </span>{form.description}</div>
            )}

            {!previewSrc && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--accent-glow)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--accent)', marginBottom: 8 }}>No avatar — generate one before creating?</p>
                <button className="btn btn-primary btn-sm" onClick={handleGenerateImage} disabled={generating || !form.description.trim()} type="button">
                  {generating ? '✨ Generating...' : '✨ Generate Avatar Now'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
        {step > 1 && <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(s => s-1)}>Back</button>}
        {step < 3 ? (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => {
            if (step === 1 && !form.name.trim()) { setError('Please give your companion a name'); return; }
            if (step === 1 && !form.description.trim()) { setError('Please write a description'); return; }
            setError('');
            setStep(s => s+1);
          }}>Continue</button>
        ) : (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : '✨ Create & Start Chatting'}
          </button>
        )}
      </div>
    </div>
  );
}
