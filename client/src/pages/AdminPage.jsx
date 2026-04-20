import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Avatar, StatCard, LoadingSpinner } from '../components/UI';
import { useAuth } from '../hooks/useAuth';

export default function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [companions, setCompanions] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.is_admin) return;
    setLoading(true);
    Promise.all([
      api('/admin/stats').catch(() => ({ stats: {} })),
      api('/admin/users').catch(() => ({ users: [] })),
      api('/admin/companions').catch(() => ({ companions: [] })),
      api('/admin/payments').catch(() => ({ payments: [] })),
    ]).then(([s, u, c, p]) => {
      setStats(s.stats);
      setUsers(u.users);
      setCompanions(c.companions);
      setPayments(p.payments);
    }).finally(() => setLoading(false));
  }, [user]);

  if (!user?.is_admin) return <div className="section text-center"><h2>Access Denied</h2></div>;
  if (loading) return <LoadingSpinner />;

  const TABS = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'users', label: '👥 Users' },
    { id: 'companions', label: '🤖 Companions' },
    { id: 'payments', label: '💰 Payments' },
  ];

  return (
    <div className="section">
      <h2 className="section-title">Admin Panel</h2>
      <p className="section-subtitle">Manage your platform</p>

      <div className="admin-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`chip ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)} style={{ padding: '9px 18px' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && stats && (
        <div>
          <div className="stats-grid">
            <StatCard label="Total Users" value={stats.totalUsers} />
            <StatCard label="Paid Users" value={stats.paidUsers} />
            <StatCard label="Total Revenue" value={`$${stats.totalRevenue?.toFixed(2)}`} />
            <StatCard label="Total Messages" value={stats.totalMessages?.toLocaleString()} />
            <StatCard label="Companions" value={stats.totalCompanions} />
          </div>

          {/* Admin Actions */}
          <div style={{ marginTop: 24, padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Admin Actions</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={async () => {
                if (!confirm('Generate AI avatars for all 16 presets? This costs ~$0.64 from your OpenAI credits.')) return;
                try {
                  const data = await api('/admin/generate-avatars', { method: 'POST' });
                  alert(data.message || 'Avatar generation started! Check Railway logs for progress. Refresh the page in a few minutes.');
                } catch (err) {
                  alert(err.error || 'Failed to start generation');
                }
              }}>
                🎨 Generate AI Avatars for Presets
              </button>
              <button className="btn btn-secondary" onClick={async () => {
                if (!confirm('Reseed all preset companions? This deletes and recreates them.')) return;
                try {
                  await api('/admin/reseed-presets', { method: 'POST' });
                  alert('Presets reseeded! Refresh the page.');
                  window.location.reload();
                } catch (err) {
                  alert(err.error || 'Reseed failed');
                }
              }}>
                🔄 Reseed Presets
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
              Generate AI Avatars creates beautiful DALL-E portraits for all preset characters. Takes ~2 minutes.
            </p>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div>
          <h3 style={{ marginBottom: 14, fontSize: 16 }}>All Users ({users.length})</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th><th>Email</th><th>Plan</th><th>Messages</th><th>Joined</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={u.name} size="xs" />
                        <span>{u.name}</span>
                        {u.is_admin && <span className="tag" style={{ background: 'rgba(162,155,254,0.15)', color: '#a29bfe' }}>Admin</span>}
                      </div>
                    </td>
                    <td>{u.email}</td>
                    <td><span className={`tag ${u.plan ? 'tag-success' : 'tag-warning'}`}>{u.plan || 'Trial'}</span></td>
                    <td>{u.messages_used || 0}</td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>
                      {!u.is_admin && (
                        <button className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            if (confirm('Delete this user?')) {
                              await api(`/admin/users/${u.id}`, { method: 'DELETE' });
                              setUsers(prev => prev.filter(x => x.id !== u.id));
                            }
                          }}>
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'companions' && (
        <div>
          <h3 style={{ marginBottom: 14, fontSize: 16 }}>All Companions ({companions.length})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {companions.map(c => (
              <div key={c.id} className="card" style={{ cursor: 'default' }}>
                <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={c.name} src={c.avatar_url} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{c.personality}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {c.is_preset ? '📌 Preset' : `By: ${c.creator_name || 'User'}`}
                    </div>
                  </div>
                  <span className="tag">{c.category}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'payments' && (
        <div>
          <h3 style={{ marginBottom: 14, fontSize: 16 }}>Payment History ({payments.length})</h3>
          {payments.length === 0 ? (
            <p className="text-muted">No payments recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>User</th><th>Plan</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td>{p.user_name} ({p.user_email})</td>
                      <td><span className="tag">{p.plan}</span></td>
                      <td style={{ fontWeight: 600 }}>${parseFloat(p.amount).toFixed(2)}</td>
                      <td>{p.payment_method}</td>
                      <td><span className="tag tag-success">{p.status}</span></td>
                      <td>{new Date(p.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
