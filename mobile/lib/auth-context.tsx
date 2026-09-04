import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, ApiError } from './api';

type AuthState = {
  status: 'checking' | 'signedOut' | 'signedIn';
  username: string | null;
  error: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// Mirrors server/index.js auth: POST /api/auth/login, GET /api/auth/me,
// POST /api/auth/logout, all via the httpOnly session cookie
// (lapanza_admin_session). RN's native HTTP stack persists that cookie
// automatically once the login response sets it.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('checking');
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      const res = await api.get<{ authenticated: boolean; username?: string }>('/api/auth/me');
      if (res.authenticated) {
        setUsername(res.username ?? null);
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    } catch {
      // Base URL unreachable, or a genuine 401 — either way, land on the
      // login screen rather than spinning forever.
      setStatus('signedOut');
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (u: string, p: string) => {
    setError(null);
    try {
      await api.post('/api/auth/login', { username: u, password: p });
      setUsername(u);
      setStatus('signedIn');
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Could not reach the server.';
      setError(message);
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Ignore — we're clearing local state regardless.
    }
    setUsername(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(
    () => ({ status, username, error, signIn, signOut, refreshSession }),
    [status, username, error, signIn, signOut, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
