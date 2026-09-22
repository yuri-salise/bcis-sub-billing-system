import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserRole } from '@bcis/shared-types';
import { UserProfile } from '../api/types.js';
import { apiClient } from '../api/client.js';
import { getRoleDisplayName } from '../auth/rbac.js';

interface AuthContextType {
  token: string | null;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isLocked: boolean;
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;
  switchTestAccount: (role: UserRole) => Promise<void>;
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
    // Check saved token or initialize default cashier session
    const initAuth = async () => {
      let savedToken: string | null = null;
      if (typeof window !== 'undefined' && window.api) {
        try {
          savedToken = await window.api.storage.getToken();
          const lockState = await window.api.app.isLocked();
          setIsLocked(lockState.isLocked);
        } catch {}
      }

      if (savedToken) {
        setToken(savedToken);
        apiClient.setToken(savedToken);
        try {
          const res = await apiClient.getMe();
          setUser(res.user);
          if (res.user.roles.length > 0) {
            setActiveRole(res.user.roles[0]);
          }
          return;
        } catch {
          // Token invalid or expired, continue to login fallback
        }
      }

      // No valid token, remain logged out
      setToken(null);
      setUser(null);
    };

    initAuth();
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

  const switchTestAccount = async (role: UserRole): Promise<void> => {
    setActiveRole(role);

    const testCreds: Record<UserRole, { username: string; pass: string }> = {
      [UserRole.CASHIER]: { username: 'cashier', pass: 'Cashier123!' },
      [UserRole.TECHNICIAN]: { username: 'technician', pass: 'Tech123!' },
      [UserRole.COLLECTION_SUPERVISOR]: { username: 'collector_supv', pass: 'Supervisor123!' },
      [UserRole.ACCOUNTING]: { username: 'accounting', pass: 'Accounting123!' },
      [UserRole.ADMIN]: { username: 'billing_admin', pass: 'Admin123!' },
      [UserRole.SUPER_ADMIN]: { username: 'admin', pass: 'Admin123!' },
      [UserRole.VIEWER]: { username: 'viewer', pass: 'Viewer123!' },
    };

    const target = testCreds[role] || { username: 'cashier', pass: 'Cashier123!' };
      const result = await apiClient.login(target.username, target.pass);
      setToken(result.token);
      setUser(result.user);
      if (result.user.roles.length > 0) {
        setActiveRole(role);
      }
  };

  const handleSetActiveRole = (role: UserRole) => {
    setActiveRole(role);
    if (!user || !user.roles.includes(role)) {
      switchTestAccount(role).catch(() => {});
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
        setActiveRole: handleSetActiveRole,
        switchTestAccount,
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
