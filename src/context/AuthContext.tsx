import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  checkAuthStatusApi,
  loginApi,
  logoutApi,
  setApiAuthToken,
} from '../services/api';
import { AuthCookies, User } from '../types/models';
import { useSettings } from './SettingsContext';

const KEY_TOKEN = 'dvaios_auth_token';
const KEY_USER = 'dvaios_auth_user';
const KEY_COOKIES = 'dvaios_auth_cookies';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  cookies: AuthCookies | null;
  bootstrapping: boolean;
  isLocked: boolean;
  login: (identity: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  unlockWithBiometrics: () => Promise<boolean>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  cookies: null,
  bootstrapping: true,
  isLocked: false,
  login: async () => {},
  logout: async () => {},
  unlockWithBiometrics: async () => true,
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { settings, loaded: settingsLoaded } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [cookies, setCookies] = useState<AuthCookies | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  const unlockWithBiometrics = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        setIsLocked(false);
        return true;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Mở khóa Đặng Việt Anh',
        cancelLabel: 'Hủy',
        fallbackLabel: 'Dùng mật khẩu thiết bị',
      });
      if (res.success) {
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    let active = true;

    (async () => {
      try {
        const [savedToken, savedUserRaw, savedCookiesRaw] = await Promise.all([
          SecureStore.getItemAsync(KEY_TOKEN),
          SecureStore.getItemAsync(KEY_USER),
          SecureStore.getItemAsync(KEY_COOKIES),
        ]);

        if (!active) return;

        if (savedToken) {
          setApiAuthToken(savedToken);
          setToken(savedToken);
          if (savedCookiesRaw) {
            try {
              setCookies(JSON.parse(savedCookiesRaw));
            } catch {}
          }
          if (savedUserRaw) {
            try {
              setUser(JSON.parse(savedUserRaw));
            } catch {}
          }

          if (settings.faceIdEnabled) {
            setIsLocked(true);
          }

          try {
            const statusRes = await checkAuthStatusApi();
            if (active) {
              if (statusRes.authenticated && statusRes.user) {
                setUser(statusRes.user);
                SecureStore.setItemAsync(KEY_USER, JSON.stringify(statusRes.user)).catch(() => {});
              } else {
                setApiAuthToken(null);
                setToken(null);
                setUser(null);
                setCookies(null);
                setIsLocked(false);
                await Promise.all([
                  SecureStore.deleteItemAsync(KEY_TOKEN),
                  SecureStore.deleteItemAsync(KEY_USER),
                  SecureStore.deleteItemAsync(KEY_COOKIES),
                ]);
              }
            }
          } catch {
            // Keep cached offline user if network temporarily unavailable
          }
        }
      } finally {
        if (active) setBootstrapping(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [settingsLoaded]);

  const login = useCallback(async (identity: string, password: string) => {
    const res = await loginApi(identity, password);
    if (!res.success || !res.token || !res.user) {
      throw new Error('Đăng nhập thất bại.');
    }
    setApiAuthToken(res.token);
    setToken(res.token);
    setUser(res.user);
    setCookies(res.cookies || null);
    setIsLocked(false);

    await Promise.all([
      SecureStore.setItemAsync(KEY_TOKEN, res.token),
      SecureStore.setItemAsync(KEY_USER, JSON.stringify(res.user)),
      res.cookies
        ? SecureStore.setItemAsync(KEY_COOKIES, JSON.stringify(res.cookies))
        : SecureStore.deleteItemAsync(KEY_COOKIES),
    ]);
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {}
    setApiAuthToken(null);
    setToken(null);
    setUser(null);
    setCookies(null);
    setIsLocked(false);
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_TOKEN),
      SecureStore.deleteItemAsync(KEY_USER),
      SecureStore.deleteItemAsync(KEY_COOKIES),
    ]);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const statusRes = await checkAuthStatusApi();
      if (statusRes.authenticated && statusRes.user) {
        setUser(statusRes.user);
        await SecureStore.setItemAsync(KEY_USER, JSON.stringify(statusRes.user));
      }
    } catch {}
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        cookies,
        bootstrapping,
        isLocked,
        login,
        logout,
        unlockWithBiometrics,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
