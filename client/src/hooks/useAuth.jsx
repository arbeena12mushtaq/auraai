import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setToken, removeToken, getToken, isTrialExpired } from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    try {
      const data = await api('/auth/me');
      setUser(data.user);
    } catch {
      removeToken();
      setUser(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchUser(); }, [fetchUser]);

  const login = async (email, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const signup = async (email, name, password) => {
    const data = await api('/auth/signup', { method: 'POST', body: { email, name, password } });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    removeToken();
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const data = await api('/auth/me');
      setUser(data.user);
    } catch {}
  };

  const trialExpired = user ? isTrialExpired(user) : false;

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser, trialExpired }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
