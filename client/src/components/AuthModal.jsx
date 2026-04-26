import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

export default function AuthModal({ mode: initialMode, onClose }) {
  const [mode, setMode] = useState(initialMode || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!email || !password) return setError('Please fill in all fields');
    if (mode === 'signup' && !name) return setError('Please enter your name');
    if (password.length < 6) return setError('Password must be at least 6 characters');

    setLoading(true);
    setError('');

    try {
      if (mode === 'signup') {
        await signup(email, name, password);
      } else {
        await login(email, password);
      }
      onClose();
    } catch (err) {
      setError(err.error || 'Something went wrong');
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>

        <div className="modal-title">
          {mode === 'signup' ? 'Create Account' : 'Welcome Back'}
        </div>
        <div className="modal-subtitle">
          {mode === 'signup'
            ? 'Start your 24-hour free trial today'
            : 'Sign in to continue your journey'
          }
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <input
              className="input"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              style={{ marginBottom: 12 }}
            />
          )}
          <input
            className="input"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ marginBottom: 16 }}
          />
          <button
            className="btn btn-primary btn-block btn-lg"
            type="submit"
            disabled={loading}
          >
            {loading ? 'Please wait...' : mode === 'signup' ? '✨ Start Free Trial' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 22, fontSize: 13, color: 'var(--text-secondary)' }}>
          {mode === 'signup' ? 'Already have an account? ' : "Don't have an account? "}
          <span
            style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
            onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(''); }}
          >
            {mode === 'signup' ? 'Sign in' : 'Sign up free'}
          </span>
        </p>

      </div>
    </div>
  );
}
