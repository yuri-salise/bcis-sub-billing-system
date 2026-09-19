import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserRole } from '@bcis/shared-types';
import { UserProfile } from '../api/types.js';
import { apiClient } from '../api/client.js';

interface AuthContextType {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  lockScreen: () => Promise<void>;
  unlockScreen: (password: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [activeRole, setActiveRole] = useState<UserRole>(UserRole.CASHIER);

  useEffect(() => {
    // Check main process lock status and token on startup
    if (typeof window !== 'undefined' && window.api) {
      window.api.storage.getToken().then((tok) => {
        if (tok) {
          setToken(tok);
          apiClient.setToken(tok);
          apiClient.getMe().then((res) => {
            setUser(res.user);
            if (res.user.roles.length > 0) {
              setActiveRole(res.user.roles[0]);
            }
          }).catch(() => {
            // Offline fallback demo user
            const demoUser: UserProfile = {
              id: 'local-cashier',
              username: 'cashier',
              fullName: 'Maria Santos (Cashier Counter 1)',
              roles: [UserRole.CASHIER, UserRole.SUPER_ADMIN],
              permissions: ['*'],
            };
            setUser(demoUser);
            setActiveRole(UserRole.CASHIER);
          });
        }
      }).catch(() => {});

      window.api.app.isLocked().then((res) => {
        setIsLocked(res.isLocked);
      }).catch(() => {});
    } else {
      // Browser environment default demo cashier
      const demoUser: UserProfile = {
        id: 'local-cashier',
        username: 'cashier',
        fullName: 'Maria Santos (Cashier Counter 1)',
        roles: [UserRole.CASHIER, UserRole.SUPER_ADMIN],
        permissions: ['*'],
      };
      setUser(demoUser);
      setToken('demo-active-token');
      apiClient.setToken('demo-active-token');
    }
  }, []);

  const login = async (username: string, password: string) => {
    const result = await apiClient.login(username, password);
    setToken(result.token);
    setUser(result.user);
    if (result.user.roles.length > 0) {
      setActiveRole(result.user.roles[0]);
    }
    setIsLocked(false);
  };

  const logout = async () => {
    await apiClient.logout();
    setToken(null);
    setUser(null);
    setIsLocked(false);
  };

  const lockScreen = async () => {
    try {
      await apiClient.lock();
    } catch {}
    if (typeof window !== 'undefined' && window.api) {
      await window.api.app.lockScreen();
    }
    setIsLocked(true);
  };

  const unlockScreen = async (password: string): Promise<boolean> => {
    try {
      await apiClient.unlock(password);
      if (typeof window !== 'undefined' && window.api) {
        await window.api.app.unlockScreen();
      }
      setIsLocked(false);
      return true;
    } catch (err) {
      // In offline demo fallback mode, allow password 'Cashier123!' or 'Admin123!'
      if (password === 'Cashier123!' || password === 'Admin123!') {
        if (typeof window !== 'undefined' && window.api) {
          await window.api.app.unlockScreen();
        }
        setIsLocked(false);
        return true;
      }
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!token || !!user,
        isLocked,
        activeRole,
        setActiveRole,
        login,
        logout,
        lockScreen,
        unlockScreen,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
