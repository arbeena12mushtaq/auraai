import { useState, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getCompanionSlots } from '../utils/api';
import { Avatar } from '../components/UI';

const ETHNICITIES = ['Caucasian', 'Latina', 'Asian', 'African', 'Arab', 'Mixed'];
const EYE_COLORS = ['Brown', 'Blue', 'Green', 'Hazel', 'Gray'];
const HAIR_STYLES = ['Straight', 'Wavy', 'Curly', 'Bangs', 'Pixie', 'Long'];
const HAIR_COLORS = ['Black', 'Brown', 'Blonde', 'Red', 'Pink', 'White', 'Purple'];
const BODY_TYPES = ['Slim', 'Athletic', 'Curvy', 'Petite', 'Average'];
const PERSONALITIES = ['Sweet & Caring', 'Bold & Confident', 'Shy & Gentle', 'Witty & Playful', 'Wise & Calm', 'Energetic & Fun'];
const HOBBIES = ['Reading', 'Gaming', 'Cooking', 'Yoga', 'Music', 'Art', 'Travel', 'Fitness', 'Dancing', 'Photography'];
const VOICES = ['Soft & Gentle', 'Warm & Rich', 'Bright & Cheerful', 'Calm & Soothing', 'Deep & Confident'];
const AGES = ['20-24', '25-29', '30-35'];

export default function CreatePage({ onChat, onNavigate, myCompanionCount = 0 }) {
  const { user, refreshUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const [form, setForm] = useState({
    name: '', category: 'Girls', art_style: 'Realistic', ethnicity: 'Caucasian',
    age_range: '20-24', eye_color: 'Brown', hair_style: 'Straight', hair_color: 'Black',
    body_type: 'Slim', personality: 'Sweet & Caring', voice: 'Soft & Gentle',
    hobbies: [], description: '', avatarFile: null, avatarPreview: null,
    generatedAvatarUrl: null,
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
    setGenerating(true);
    setError('');
    try {
      const data = await api('/image/generate', {
        method: 'POST',
        body: {
          category: form.category, art_style: form.art_style,
          ethnicity: form.ethnicity, age_range: form.age_range,
          eye_color: form.eye_color, hair_style: form.hair_style,
          hair_color: form.hair_color, body_type: form.body_type,
          personality: form.personality, description: form.description,
        },
      });
      if (data.avatar_url) {
        set('generatedAvatarUrl', data.avatar_url);
        set('avatarPreview', data.avatar_url);
        set('avatarFile', null);
      }
    } catch (err) {
      setError(err.error || 'Image generation failed. You can upload an image manually instead.');
    }
    setGenerating(false);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return setError('Please give your companion a name');
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('name', form.name);
      formData.append('category', form.category);
      formData.append('art_style', form.art_style);
      formData.append('ethnicity', form.ethnicity);
      formData.append('age_range', form.age_range);
      formData.append('eye_color', form.eye_color);
      formData.append('hair_style', form.hair_style);
      formData.append('hair_color', form.hair_color);
      formData.append('body_type', form.body_type);
      formData.append('personality', form.personality);
      formData.append('voice', form.voice);
      formData.append('hobbies', JSON.stringify(form.hobbies));
      formData.append('description', form.description);
      formData.append('tagline', `${form.personality} companion`);
      if (form.generatedAvatarUrl) formData.append('generated_avatar_url', form.generatedAvatarUrl);
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
      <p className="section-subtitle">Step {step} of 4 — {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} remaining</p>

      <div className="progress-bar">
        {[1,2,3,4].map(s => <div key={s} className={`progress-step ${s <= step ? 'active' : ''}`} />)}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* ===== STEP 1: Style & Image ===== */}
      {step === 1 && (
        <div>
          <h3 style={{ marginBottom: 16, fontSize: 18 }}>Style & Image</h3>
          <div className="form-label">Character Type</div>
          <div className="chip-group mb-2">
            {['Girls', 'Guys', 'Anime'].map(s => <Chip key={s} value={s} selected={form.category===s} onClick={() => set('category', s)} />)}
          </div>
          <div className="form-label">Art Style</div>
          <div className="chip-group mb-2">
            {['Realistic', 'Anime'].map(s => <Chip key={s} value={s} selected={form.art_style===s} onClick={() => set('art_style', s)} />)}
          </div>

          <div style={{
            border: '2px dashed rgba(255,107,157,0.25)', borderRadius: 'var(--radius-lg)',
            padding: 28, textAlign: 'center', marginBottom: 16, background: 'rgba(255,255,255,0.02)',
          }}>
            {previewSrc ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={previewSrc} alt="Preview" style={{
                  width: 130, height: 130, borderRadius: '50%', objectFit: 'cover',
                  border: '3px solid var(--accent)', boxShadow: 'var(--shadow-glow)',
                }} />
                <button className="btn btn-ghost btn-sm" type="button"
                  style={{ position: 'absolute', top: -6, right: -6, background: 'var(--bg-card)', borderRadius: '50%', width: 26, height: 26, padding: 0, fontSize: 13 }}
                  onClick={() => { set('avatarPreview', null); set('avatarFile', null); set('generatedAvatarUrl', null); }}>
                  ✕
                </button>
                {form.generatedAvatarUrl && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--success)' }}>✓ AI Generated</div>}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 42, marginBottom: 10, opacity: 0.6 }}>🖼️</div>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 18 }}>
                  Upload a photo or generate one with AI
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} type="button">
                    📷 Upload Photo
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={handleGenerateImage} disabled={generating} type="button">
                    {generating ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="gen-spinner" />
                        Generating...
                      </span>
                    ) : '✨ Generate with AI'}
                  </button>
                </div>
              </>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />
          </div>

          {previewSrc && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => fileRef.current?.click()} type="button">
                📷 Upload Different
              </button>
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleGenerateImage} disabled={generating} type="button">
                {generating ? '✨ Generating...' : '🔄 Regenerate'}
              </button>
            </div>
          )}

          <div className="form-label">Description (improves AI image + personality)</div>
          <textarea className="input" style={{ minHeight: 90 }}
            placeholder="e.g. 'A cheerful woman with freckles and a warm smile, wearing a cozy sweater in a coffee shop'"
            value={form.description} onChange={e => set('description', e.target.value)} />

          {form.description && !previewSrc && (
            <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--accent-glow)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--accent)' }}>
              💡 You wrote a description — click "Generate with AI" to create a matching avatar!
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

      {/* ===== STEP 2: Appearance ===== */}
      {step === 2 && (
        <div>
          <h3 style={{ marginBottom: 16, fontSize: 18 }}>Appearance</h3>
          <div className="form-label">Name *</div>
          <input className="input" placeholder="Give your companion a name" value={form.name}
            onChange={e => set('name', e.target.value)} />
          <div className="form-label">Ethnicity</div>
          <div className="chip-group">{ETHNICITIES.map(v => <Chip key={v} value={v} selected={form.ethnicity===v} onClick={() => set('ethnicity', v)} />)}</div>
          <div className="form-label">Age Range</div>
          <div className="chip-group">{AGES.map(v => <Chip key={v} value={v} selected={form.age_range===v} onClick={() => set('age_range', v)} />)}</div>
          <div className="form-label">Eye Color</div>
          <div className="chip-group">{EYE_COLORS.map(v => <Chip key={v} value={v} selected={form.eye_color===v} onClick={() => set('eye_color', v)} />)}</div>
          <div className="form-label">Hair Style</div>
          <div className="chip-group">{HAIR_STYLES.map(v => <Chip key={v} value={v} selected={form.hair_style===v} onClick={() => set('hair_style', v)} />)}</div>
          <div className="form-label">Hair Color</div>
          <div className="chip-group">{HAIR_COLORS.map(v => <Chip key={v} value={v} selected={form.hair_color===v} onClick={() => set('hair_color', v)} />)}</div>
          <div className="form-label">Body Type</div>
          <div className="chip-group">{BODY_TYPES.map(v => <Chip key={v} value={v} selected={form.body_type===v} onClick={() => set('body_type', v)} />)}</div>

          {/* Regen banner */}
          <div style={{ marginTop: 20, padding: '14px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            {previewSrc && <img src={previewSrc} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                {previewSrc ? 'Changed traits? Regenerate to match.' : 'No avatar yet — generate one!'}
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleGenerateImage} disabled={generating} type="button">
                {generating ? '✨ Generating...' : previewSrc ? '🔄 Regenerate Avatar' : '✨ Generate Avatar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== STEP 3: Personality ===== */}
      {step === 3 && (
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

      {/* ===== STEP 4: Review ===== */}
      {step === 4 && (
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
                <p className="text-muted" style={{ fontSize: 13 }}>{form.personality} • {form.ethnicity}</p>
                {form.generatedAvatarUrl && <span style={{ fontSize: 10, color: 'var(--success)' }}>✓ AI Generated Avatar</span>}
              </div>
            </div>
            <div className="review-detail-grid">
              <div><span className="review-detail-label">Style: </span>{form.category} / {form.art_style}</div>
              <div><span className="review-detail-label">Age: </span>{form.age_range}</div>
              <div><span className="review-detail-label">Eyes: </span>{form.eye_color}</div>
              <div><span className="review-detail-label">Hair: </span>{form.hair_color} {form.hair_style}</div>
              <div><span className="review-detail-label">Body: </span>{form.body_type}</div>
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
                <button className="btn btn-primary btn-sm" onClick={handleGenerateImage} disabled={generating} type="button">
                  {generating ? '✨ Generating...' : '✨ Generate Avatar Now'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
        {step > 1 && <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(s => s-1)}>Back</button>}
        {step < 4 ? (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(s => s+1)}>Continue</button>
        ) : (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : '✨ Create & Start Chatting'}
          </button>
        )}
      </div>
    </div>
  );
}
