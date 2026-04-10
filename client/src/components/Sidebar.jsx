import { useAuth } from '../hooks/useAuth';
import { Avatar } from './UI';
import { getPlanInfo, getMessagesLeft } from '../utils/api';

const NAV_ITEMS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'discover', icon: '🔍', label: 'Discover' },
  { id: 'chats', icon: '💬', label: 'Chat' },
  { id: 'collection', icon: '💎', label: 'Collection' },
  { id: 'create', icon: '✨', label: 'Create Character' },
  { id: 'my-ai', icon: '🤖', label: 'My AI' },
];

export default function Sidebar({ currentPage, onNavigate, isOpen, onClose }) {
  const { user, logout } = useAuth();

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">✦</div>
          <span className="sidebar-brand-text">Aura AI</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
              onClick={() => { onNavigate(item.id); onClose(); }}
            >
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}

          {user?.is_admin && (
            <>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />
              <button
                className={`nav-item ${currentPage === 'admin' ? 'active' : ''}`}
                onClick={() => { onNavigate('admin'); onClose(); }}
              >
                <span className="nav-item-icon">⚙️</span>
                Admin Panel
              </button>
            </>
          )}

          <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' }} />
          <button
            className={`nav-item ${currentPage === 'pricing' ? 'active' : ''}`}
            onClick={() => { onNavigate('pricing'); onClose(); }}
          >
            <span className="nav-item-icon">💳</span>
            Premium Plans
          </button>
        </nav>

        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <Avatar name={user.name} src={user.avatar_url} size="sm" />
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-plan">
                  {user.plan ? getPlanInfo(user.plan)?.name + ' Plan' : 'Free Trial'}
                </div>
              </div>
            </div>
            {!user.is_admin && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
                {getMessagesLeft(user)} messages remaining
              </div>
            )}
            <div className="sidebar-actions">
              {!user.plan && !user.is_admin && (
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                  onClick={() => { onNavigate('pricing'); onClose(); }}>
                  Upgrade
                </button>
              )}
              <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={logout}>
                Logout
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
