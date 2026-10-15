import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from './lib/api';
import type { Me } from './types';

interface AuthState { me: Me | null; loading: boolean; login(email: string, password: string): Promise<Me>; register(b: Record<string, unknown>): Promise<Me>; logout(): void; refresh(): Promise<void> }
const Ctx = createContext<AuthState>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));

  const logout = useCallback(() => { tokenStore.clear(); setMe(null); }, []);
  const refresh = useCallback(async () => { setMe(await api<Me>('/me')); }, []);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  useEffect(() => {
    if (!tokenStore.get()) return;
    refresh().catch(logout).finally(() => setLoading(false));
  }, [refresh, logout]);

  const finish = async (token: string) => { tokenStore.set(token); const m = await api<Me>('/me'); setMe(m); return m; };
  const login = async (email: string, password: string) => finish((await api<{ token: string }>('/auth/login', { body: { email, password } })).token);
  const register = async (b: Record<string, unknown>) => finish((await api<{ token: string }>('/auth/register', { body: b })).token);
  return <Ctx.Provider value={{ me, loading, login, register, logout, refresh }}>{children}</Ctx.Provider>;
}
