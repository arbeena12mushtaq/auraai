import { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { api, isTrialExpired, PLANS, getPlanInfo } from './utils/api';
import Sidebar from './components/Sidebar';
import AuthModal from './components/AuthModal';
import { Avatar } from './components/UI';
import HomePage from './pages/HomePage';
import DiscoverPage from './pages/DiscoverPage';
import CreatePage from './pages/CreatePage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';
import { ChatListPage, CollectionPage, MyAIPage, PricingPage } from './pages/OtherPages';

function AppContent() {
  const { user, loading, logout, refreshUser, trialExpired } = useAuth();
  const [page, setPage] = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authModal, setAuthModal] = useState(null);
  const [activeChat, setActiveChat] = useState(null);
  const [collection, setCollection] = useState([]);
  const [myCompanionCount, setMyCompanionCount] = useState(0);

  // Load collection
  useEffect(() => {
    if (user) {
      api('/collections').then(d => {
        setCollection((d.companions || []).map(c => c.id));
      }).catch(() => {});
    }
  }, [user]);

  const navigate = useCallback((p) => {
    setPage(p);
    setActiveChat(null);
    window.scrollTo(0, 0);
  }, []);

  const openChat = useCallback((companion) => {
    setActiveChat(companion);
    setPage('chat');
  }, []);

  const toggleSave = useCallback(async (companionId) => {
    if (!user) return setAuthModal('signup');
    const inCol = collection.includes(companionId);
    try {
      if (inCol) {
        await api(`/collections/${companionId}`, { method: 'DELETE' });
        setCollection(prev => prev.filter(id => id !== companionId));
      } else {
        await api(`/collections/${companionId}`, { method: 'POST' });
        setCollection(prev => [...prev, companionId]);
      }
    } catch {}
  }, [user, collection]);

  const handleSubscribe = async (planId) => {
    try {
      await api('/payments/subscribe', { method: 'POST', body: { plan: planId } });
      await refreshUser();
      navigate('home');
    } catch {}
  };

  // Render page
  const renderPage = () => {
    const commonProps = {
      onNavigate: navigate,
      onChat: openChat,
      onToggleSave: toggleSave,
      collection,
      onRequireAuth: setAuthModal,
      user,
    };

    switch (page) {
      case 'home':
        return <HomePage {...commonProps} />;
      case 'discover':
        return <DiscoverPage {...commonProps} />;
      case 'create':
        return user ? <CreatePage {...commonProps} myCompanionCount={myCompanionCount} /> : <HomePage {...commonProps} />;
      case 'chat':
        return <ChatPage companion={activeChat} onBack={() => navigate('chats')}
          onNavigate={navigate} onToggleSave={toggleSave} isSaved={activeChat && collection.includes(activeChat.id)} />;
      case 'chats':
        return user ? <ChatListPage onSelectChat={openChat} /> : <HomePage {...commonProps} />;
      case 'collection':
        return user ? <CollectionPage {...commonProps} /> : <HomePage {...commonProps} />;
      case 'my-ai':
        return user ? <MyAIPage {...commonProps} setMyCompanionCount={setMyCompanionCount} /> : <HomePage {...commonProps} />;
      case 'pricing':
        return <PricingPage {...commonProps} />;
      case 'admin':
        return user?.is_admin ? <AdminPage /> : <HomePage {...commonProps} />;
      default:
        return <HomePage {...commonProps} />;
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>✦</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading Aura AI...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        currentPage={page}
        onNavigate={navigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Topbar */}
      <header className="topbar">
        <button className="topbar-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
        <div className="topbar-spacer" />
        {!user ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setAuthModal('login')}>Sign In</button>
            <button className="btn btn-primary btn-sm" onClick={() => setAuthModal('signup')}>Join Free</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.name}</span>
            <Avatar name={user.name} src={user.avatar_url} size="xs" />
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="main-content">
        {renderPage()}
      </main>

      {/* Auth Modal */}
      {authModal && (
        <AuthModal mode={authModal} onClose={() => setAuthModal(null)} />
      )}

      {/* Paywall */}
      {user && trialExpired && !user.plan && !user.is_admin && (
        <div className="paywall">
          <div className="paywall-inner">
            <h2 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Your Free Trial Has Ended</h2>
            <p className="text-muted" style={{ marginBottom: 36, fontSize: 16 }}>Choose a plan to continue your journey with Aura AI</p>
            <div className="pricing-grid">
              {PLANS.map(plan => (
                <div key={plan.id} className={`plan-card ${plan.id === 'plus' ? 'featured' : ''}`}>
                  {plan.id === 'plus' && <div className="plan-badge">Popular</div>}
                  <div className="plan-name">{plan.name}</div>
                  <div className="plan-price">${plan.price}<span>/mo</span></div>
                  <div className="plan-messages">{plan.messages === 999999 ? 'Unlimited' : plan.messages.toLocaleString()} msgs/mo</div>
                  <div className="plan-features">
                    ✦ {plan.companions} companion{plan.companions > 1 ? 's' : ''}<br />
                    ✦ Text chat<br />
                    {plan.voice && <>✦ Voice chat<br /></>}
                    ✦ Chat history
                  </div>
                  <button className="btn btn-primary btn-block" onClick={() => handleSubscribe(plan.id)}>
                    Subscribe
                  </button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost mt-3" onClick={logout}>Sign out instead</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
