import { useState, useEffect } from 'react';
import { api, PLANS, getPlanInfo, TOKEN_COSTS } from '../utils/api';
import { Avatar, CompanionCard, EmptyState, LoadingSpinner } from '../components/UI';
import { useAuth } from '../hooks/useAuth';

// ==================== CHAT LIST ====================
export function ChatListPage({ onSelectChat }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/chat')
      .then(d => setChats(d.chats || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="section">
      <h2 className="section-title">Your Chats</h2>
      <p className="section-subtitle">Continue your conversations</p>

      {chats.length === 0 ? (
        <EmptyState icon="💬" text="No chats yet. Discover companions to start chatting!" />
      ) : (
        chats.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)).map(chat => (
          <div key={chat.id} className="chat-list-item" onClick={() => onSelectChat(chat)}>
            <Avatar name={chat.name} src={chat.avatar_url} size="sm" />
            <div className="chat-list-meta">
              <div className="chat-list-name">
                <span>{chat.name}</span>
                <span className="chat-list-time">
                  {chat.last_message_at ? new Date(chat.last_message_at).toLocaleDateString() : ''}
                </span>
              </div>
              <div className="chat-list-preview">{chat.last_message || ''}</div>
            </div>
            <span className="tag" style={{ flexShrink: 0 }}>{chat.message_count}</span>
          </div>
        ))
      )}
    </div>
  );
}

// ==================== COLLECTION ====================
export function CollectionPage({ onChat, onToggleSave, collection }) {
  const [companions, setCompanions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/collections')
      .then(d => setCompanions(d.companions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [collection]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="section">
      <h2 className="section-title">Your Collection</h2>
      <p className="section-subtitle">Your saved favorite companions</p>

      {companions.length === 0 ? (
        <EmptyState icon="💎" text="Save your favorite companions here by clicking the heart icon" />
      ) : (
        <div className="companion-grid">
          {companions.map(comp => (
            <CompanionCard key={comp.id} companion={comp} onChat={() => onChat(comp)}
              onToggleSave={() => onToggleSave(comp.id)} isSaved={true} />
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== MY AI ====================
export function MyAIPage({ onChat, onNavigate, onToggleSave, collection, setMyCompanionCount }) {
  const [companions, setCompanions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/companions/user/mine')
      .then(d => {
        setCompanions(d.companions || []);
        setMyCompanionCount?.(d.companions?.length || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="section">
      <div className="flex-between mb-3">
        <div>
          <h2 className="section-title">My Companions</h2>
          <p className="section-subtitle" style={{ marginBottom: 0 }}>{companions.length} created</p>
        </div>
        <button className="btn btn-primary" onClick={() => onNavigate('create')}>✨ Create New</button>
      </div>

      {companions.length === 0 ? (
        <EmptyState
          icon="🤖"
          text="You haven't created any companions yet"
          action={() => onNavigate('create')}
          actionText="Create Your First"
        />
      ) : (
        <div className="companion-grid">
          {companions.map(comp => (
            <CompanionCard key={comp.id} companion={comp} onChat={() => onChat(comp)}
              onToggleSave={() => onToggleSave(comp.id)}
              isSaved={collection?.includes(comp.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ==================== PRICING ====================
export function PricingPage({ onRequireAuth }) {
  const { user, refreshUser } = useAuth();
  const [loading, setLoading] = useState(null);

  // Check for payment success redirect from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const plan = params.get('plan');
    if (payment === 'success' && plan && user) {
      api('/payments/confirm', { method: 'POST', body: { plan } })
        .then(() => { refreshUser(); window.history.replaceState({}, '', '/'); })
        .catch(() => {});
    }
  }, [user]);

  const handleSubscribe = async (planId) => {
    if (!user) return onRequireAuth('signup');
    if (user.plan === planId) return;
    setLoading(planId);
    try {
      const data = await api('/payments/create-checkout', { method: 'POST', body: { plan: planId } });
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.demo && data.success) {
        // Admin demo mode activated by backend
        await refreshUser();
        alert(`Activated ${getPlanInfo(planId).name} plan with ${getPlanInfo(planId).tokens} tokens!`);
        setLoading(null);
        return;
      }
    } catch (err) {
      // Fallback: try legacy subscribe for admin
      if (user.is_admin) {
        try {
          await api('/payments/subscribe', { method: 'POST', body: { plan: planId } });
          await refreshUser();
          alert(`Activated ${getPlanInfo(planId).name} plan with ${getPlanInfo(planId).tokens} tokens!`);
        } catch (err2) {
          alert(err2.error || 'Failed');
        }
      } else {
        alert(err.error || 'Payment system coming soon! Contact support.');
      }
    }
    setLoading(null);
  };

  return (
    <div className="section" style={{ maxWidth: 960 }}>
      <h2 className="section-title text-center">Choose Your Plan</h2>
      <p className="section-subtitle text-center" style={{ maxWidth: 460, margin: '0 auto 36px' }}>
        Unlock AI image generation, video scenes, and unlimited messaging
      </p>

      <div className="pricing-grid">
        {PLANS.map(plan => (
          <div key={plan.id} className={`plan-card ${plan.id === 'plus' ? 'featured' : ''}`}>
            {plan.id === 'plus' && <div className="plan-badge">Most Popular</div>}
            <div className="plan-name">{plan.name}</div>
            <div className="plan-price">${plan.price}<span>/mo</span></div>
            <div className="plan-messages">
              {plan.messages === 999999 ? 'Unlimited' : plan.messages.toLocaleString()} messages/month
            </div>
            <div className="plan-features">
              ✦ {plan.companions} companion slot{plan.companions > 1 ? 's' : ''}<br />
              ✦ Full text chat<br />
              ✦ 🪙 {plan.tokens} tokens/month<br />
              {plan.images && <>✦ 📸 AI Image generation ({TOKEN_COSTS.image} tokens each)<br /></>}
              {plan.videos && <>✦ 🎬 AI Video generation ({TOKEN_COSTS.video} tokens each)<br /></>}
              {plan.voice && <>✦ 🎤 Voice messages<br /></>}
              ✦ Chat history saved<br />
              ✦ Priority support
            </div>
            <button
              className={`btn btn-block ${plan.id === 'plus' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleSubscribe(plan.id)}
              disabled={loading === plan.id || user?.plan === plan.id}
            >
              {user?.plan === plan.id ? '✓ Current Plan' : loading === plan.id ? 'Processing...' : 'Subscribe'}
            </button>
          </div>
        ))}
      </div>

      {user && (
        <div className="text-center mt-3" style={{ fontSize: 13, color: 'var(--text2)' }}>
          🪙 Your tokens: <strong>{user.tokens || 0}</strong>
        </div>
      )}

      {user?.plan && (
        <div className="text-center mt-2">
          <button className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}
            onClick={async () => {
              try {
                const data = await api('/payments/cancel', { method: 'POST' });
                if (data.url) window.location.href = data.url;
              } catch (err) {
                alert(err.error || 'Failed to open subscription management.');
              }
            }}>
            Manage Subscription / Cancel
          </button>
        </div>
      )}

      <div className="text-center mt-3" style={{ fontSize: 11, color: 'var(--text3)', maxWidth: 500, margin: '16px auto 0', lineHeight: 1.6 }}>
        🔒 Secure payments via Stripe • Cancel anytime • Discreet billing<br />
        By subscribing you confirm you are 18+ years of age and agree to our Terms of Service and Privacy Policy.
        All content is AI-generated fictional characters. No real individuals are depicted.
        Subscriptions auto-renew monthly until cancelled.
      </div>
    </div>
  );
}
