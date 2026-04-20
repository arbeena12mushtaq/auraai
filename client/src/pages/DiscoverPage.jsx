import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { CompanionCard, LoadingSpinner } from '../components/UI';

const CATS = ['All', 'Girls', 'Anime', 'Guys'];

export default function DiscoverPage({ onChat, onToggleSave, collection, onRequireAuth, user }) {
  const [companions, setCompanions] = useState([]);
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category !== 'All') params.set('category', category);
    if (search) params.set('search', search);
    api(`/companions/discover?${params}`)
      .then(d => setCompanions(d.companions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [category, search]);

  return (
    <div className="section">
      <h2 className="section-title">Discover Companions</h2>
      <p className="section-subtitle">Browse and find your perfect AI companion</p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="chip-group">
          {CATS.map(cat => (
            <button key={cat} className={`chip ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}>
              {cat}
            </button>
          ))}
        </div>
        <input
          className="input"
          placeholder="Search companions..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 250, marginBottom: 0 }}
        />
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="companion-grid">
          {companions.map(comp => (
            <CompanionCard
              key={comp.id}
              companion={comp}
              onChat={() => { if (!user) return onRequireAuth('signup'); onChat(comp); }}
              onToggleSave={() => { if (!user) return onRequireAuth('signup'); onToggleSave(comp.id); }}
              isSaved={collection?.includes(comp.id)}
            />
          ))}
          {companions.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1/-1' }}>
              <div className="empty-icon">🔍</div>
              <div className="empty-text">No companions found</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
