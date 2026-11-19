import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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
  verifyBiometricsForEnable: () => Promise<{ ok: boolean; reason?: string }>;
  lockAppNow: () => void;
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
  verifyBiometricsForEnable: async () => ({ ok: true }),
  lockAppNow: () => {},
  refreshUser: async () => {},
});

async function checkBiometricSupportAsync(): Promise<{ supported: boolean; reason?: string }> {
  try {
    const [hasHardware, isEnrolled, enrolledLevel] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);

    if (
      !isEnrolled &&
      enrolledLevel === LocalAuthentication.SecurityLevel.NONE
    ) {
      return {
        supported: false,
        reason: hasHardware
          ? 'Thiết bị chưa bật Face ID, Touch ID hoặc mật mã khóa máy trong Cài đặt iPhone.'
          : 'Thiết bị chưa thiết lập bảo mật khóa màn hình trong Cài đặt.',
      };
    }

    return { supported: true };
  } catch {
    return { supported: true };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { settings, loaded: settingsLoaded } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [cookies, setCookies] = useState<AuthCookies | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const userRef = useRef(user);
  userRef.current = user;
  const biometricBusyRef = useRef(false);
  const lastUnlockAtRef = useRef(0);
  const backgroundedAtRef = useRef(0);

  const releaseBusyAfterCooldown = useCallback(() => {
    setTimeout(() => {
      biometricBusyRef.current = false;
    }, 850);
  }, []);

  const verifyBiometricsForEnable = useCallback(async (): Promise<{
    ok: boolean;
    reason?: string;
  }> => {
    const support = await checkBiometricSupportAsync();
    if (!support.supported) {
      return { ok: false, reason: support.reason };
    }

    biometricBusyRef.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Xác thực để bật khóa ứng dụng',
        cancelLabel: 'Hủy',
        fallbackLabel: 'Dùng mật mã thiết bị',
        disableDeviceFallback: false,
      });
      if (res.success) {
        lastUnlockAtRef.current = Date.now();
        return { ok: true };
      }
      return {
        ok: false,
        reason: 'Xác thực Face ID / Touch ID đã bị hủy hoặc không khớp.',
      };
    } catch (e: any) {
      return {
        ok: false,
        reason: e?.message || 'Không thể mở hộp thoại xác thực sinh trắc học.',
      };
    } finally {
      releaseBusyAfterCooldown();
    }
  }, [releaseBusyAfterCooldown]);

  const unlockWithBiometrics = useCallback(async (): Promise<boolean> => {
    if (biometricBusyRef.current) {
      return false;
    }
    const support = await checkBiometricSupportAsync();
    if (!support.supported) {
      setIsLocked(false);
      return true;
    }

    biometricBusyRef.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Mở khóa Đặng Việt Anh',
        cancelLabel: 'Hủy',
        fallbackLabel: 'Dùng mật mã thiết bị',
        disableDeviceFallback: false,
      });
      if (res.success) {
        lastUnlockAtRef.current = Date.now();
        setIsLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      releaseBusyAfterCooldown();
    }
  }, [releaseBusyAfterCooldown]);

  const lockAppNow = useCallback(() => {
    if (userRef.current) {
      setIsLocked(true);
    }
  }, []);

  // Lock automatically when returning from real background while faceIdEnabled is on
  useEffect(() => {
    const onAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background') {
        if (!biometricBusyRef.current) {
          backgroundedAtRef.current = Date.now();
        }
        return;
      }

      if (nextState === 'active') {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = 0;

        if (biometricBusyRef.current) return;
        if (Date.now() - lastUnlockAtRef.current < 1600) return;
        if (
          bgAt > 0 &&
          Date.now() - bgAt >= 1500 &&
          settingsRef.current.faceIdEnabled &&
          userRef.current
        ) {
          setIsLocked(true);
        }
      }
    };

    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => {
      sub.remove();
    };
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

          if (settingsRef.current.faceIdEnabled) {
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
        verifyBiometricsForEnable,
        lockAppNow,
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
