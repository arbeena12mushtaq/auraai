import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, getMessagesLeft } from '../utils/api';
import { Avatar } from '../components/UI';

export default function ChatPage({ companion, onBack, onNavigate, onToggleSave, isSaved }) {
  const { user, refreshUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const chatRef = useRef();

  // Load chat history
  useEffect(() => {
    if (!companion) return;
    setInitialLoading(true);
    api(`/chat/${companion.id}`)
      .then(d => setMessages(d.messages))
      .catch(() => {})
      .finally(() => setInitialLoading(false));
  }, [companion?.id]);

  // Auto scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, loading]);

  if (!companion) {
    return (
      <div className="section text-center" style={{ paddingTop: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
        <h2>Select a companion to chat</h2>
        <p className="text-muted mt-1">Go to Discover or My AI to start chatting</p>
        <button className="btn btn-primary mt-3" onClick={() => onNavigate('discover')}>Discover</button>
      </div>
    );
  }

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const msgsLeft = getMessagesLeft(user);
    if (msgsLeft <= 0) {
      onNavigate('pricing');
      return;
    }

    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const data = await api(`/chat/${companion.id}`, {
        method: 'POST',
        body: { content: text },
      });
      setMessages(prev => [...prev, data.message]);
      refreshUser();
    } catch (err) {
      if (err.code === 'TRIAL_EXPIRED' || err.code === 'MESSAGE_LIMIT') {
        onNavigate('pricing');
      } else {
        const fallback = {
          role: 'assistant',
          content: err.error || "I'm here for you! What would you like to talk about?",
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, fallback]);
      }
    }
    setLoading(false);
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ fontSize: 18, padding: '4px 8px' }}>←</button>
        <Avatar name={companion.name} src={companion.avatar_url} size="sm" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{companion.name}</div>
          <div style={{ fontSize: 11, color: 'var(--success)' }}>● Online</div>
        </div>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => onToggleSave?.(companion.id)}
          style={{ color: isSaved ? 'var(--accent)' : 'var(--text-secondary)', fontSize: 20 }}
        >
          {isSaved ? '♥' : '♡'}
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={chatRef}>
        {initialLoading ? (
          <div className="flex-center" style={{ flex: 1 }}>
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chat...</div>
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-secondary)' }}>
                <Avatar name={companion.name} src={companion.avatar_url} size="xl" style={{ margin: '0 auto 16px' }} />
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>{companion.name}</h3>
                <p style={{ fontSize: 13, marginBottom: 4 }}>{companion.tagline || companion.personality}</p>
                <p style={{ fontSize: 12 }}>Say hello to start your conversation!</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user' : 'ai'}`}>
                {msg.role !== 'user' && <Avatar name={companion.name} src={companion.avatar_url} size="xs" />}
                <div>
                  <div className="message-bubble">{msg.content}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left', padding: '0 4px' }}>
                    {formatTime(msg.created_at)}
                  </div>
                </div>
              </div>
            ))}

            {loading && (
              <div className="message ai">
                <Avatar name={companion.name} src={companion.avatar_url} size="xs" />
                <div className="typing-dots">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <input
          className="input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder={`Message ${companion.name}...`}
          style={{ flex: 1 }}
          disabled={loading}
        />
        <button
          className="btn btn-primary"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
