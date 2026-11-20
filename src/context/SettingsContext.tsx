import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { AppSettings } from '../types/models';

const SETTINGS_FILE = `${FileSystem.documentDirectory ?? ''}dva_ios_settings.json`;

const DEFAULT_SETTINGS: AppSettings = {
  preferredQuality: 'auto',
  autoPlayNext: true,
  autoSkipIntro: true,
  pipEnabled: true,
  faceIdEnabled: false,
  wifiOnlyDownload: true,
  subtitleEnabled: true,
  subtitleFontSize: 17,
  subtitleBottomOffset: 34,
  subtitleBgOpacity: 0.55,
  highContrastMode: false,
  videoFillMode: 'contain',
  autoDownloadCurrentOnWatch: false,
  autoDownloadNextCount: 0,
  preferOfflineWhenOnline: true,
  offlineDownloadFormat: 'auto',
  offlineDownloadConcurrency: 3,
};

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  updateSetting: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (FileSystem.documentDirectory) {
          const info = await FileSystem.getInfoAsync(SETTINGS_FILE);
          if (info.exists) {
            const raw = await FileSystem.readAsStringAsync(SETTINGS_FILE);
            const parsed = JSON.parse(raw);
            if (active && parsed && typeof parsed === 'object') {
              const merged = { ...DEFAULT_SETTINGS, ...parsed };
              settingsRef.current = merged;
              setSettings(merged);
            }
          }
        }
      } catch {
        // Fallback to defaults
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const next = { ...settingsRef.current, [key]: value };
      settingsRef.current = next;
      setSettings(next);
      if (FileSystem.documentDirectory) {
        try {
          await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(next));
        } catch {}
      }
    },
    []
  );

  return (
    <SettingsContext.Provider value={{ settings, loaded, updateSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
