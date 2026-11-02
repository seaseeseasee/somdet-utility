import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Me } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
}
const Ctx = createContext<AuthState>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/auth/me'));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) console.error(e);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const logout = async () => {
    await api.post('/api/auth/logout');
    setMe(null);
  };
  return (
    <Ctx.Provider value={{ me, loading, refresh, logout, can: (p) => !!me?.permissions.includes(p) }}>{children}</Ctx.Provider>
  );
}
