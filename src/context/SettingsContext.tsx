import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { AppSettings } from '../types/models';

const SETTINGS_FILE = `${FileSystem.documentDirectory ?? ''}dva_ios_settings.json`;

export const DEFAULT_SUBTITLE_SETTINGS: Pick<
  AppSettings,
  | 'subtitleEnabled'
  | 'subShowVi'
  | 'subShowEn'
  | 'subReverse'
  | 'subFont'
  | 'subColor'
  | 'subAutoLayout'
  | 'subFontSizeStep'
  | 'subPositionPct'
  | 'subOutline'
  | 'subDelaySec'
  | 'subExtendSec'
  | 'subTranslateLang'
  | 'subAiVoiceEnabled'
  | 'subAiVoiceMode'
  | 'subAiVoiceVolume'
> = {
  subtitleEnabled: true,
  subShowVi: true,
  subShowEn: false,
  subReverse: false,
  subFont: 'Arial,Helvetica,sans-serif',
  subColor: 'white',
  subAutoLayout: true,
  subFontSizeStep: 8,
  subPositionPct: 4,
  subOutline: 'uniform2',
  subDelaySec: 0,
  subExtendSec: 0,
  subTranslateLang: '',
  subAiVoiceEnabled: false,
  subAiVoiceMode: 'adaptive',
  subAiVoiceVolume: 80,
};

export const DEFAULT_SETTINGS: AppSettings = {
  preferredQuality: 'auto',
  autoPlayNext: true,
  autoSkipIntro: true,
  pipEnabled: true,
  faceIdEnabled: false,
  wifiOnlyDownload: true,
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
  autoOptimalServer: true,
  autoDubNext: false,
  contrastLevel: 'Mặc định',
  resumeOnHome: false,
  seekWarningEnabled: false,
  holdSeekSpeed: 2,
  nextEpisodeDelaySec: 0,
  seamlessPreloadEnabled: true,
  transitionEffectEnabled: true,
  ...DEFAULT_SUBTITLE_SETTINGS,
};

interface SettingsContextValue {
  settings: AppSettings;
  loaded: boolean;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  updateSettingsBatch: (patch: Partial<AppSettings>) => Promise<void>;
  resetSubtitleSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  updateSetting: async () => {},
  updateSettingsBatch: async () => {},
  resetSubtitleSettings: async () => {},
});

function syncDerivedContrastFields(
  prev: AppSettings,
  patch: Partial<AppSettings>
): AppSettings {
  const next = { ...prev, ...patch };
  if ('contrastLevel' in patch && !('highContrastMode' in patch)) {
    next.highContrastMode =
      patch.contrastLevel === 'Cao' || patch.contrastLevel === 'Rất cao';
  } else if ('highContrastMode' in patch && !('contrastLevel' in patch)) {
    next.contrastLevel = patch.highContrastMode ? 'Cao' : 'Mặc định';
  }
  if ('subShowVi' in patch || 'subShowEn' in patch) {
    next.subtitleEnabled = Boolean(next.subShowVi || next.subShowEn);
  }
  return next;
}

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
              const merged = syncDerivedContrastFields(DEFAULT_SETTINGS, parsed);
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

  const persistNext = useCallback(async (next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
    if (FileSystem.documentDirectory) {
      try {
        await FileSystem.writeAsStringAsync(SETTINGS_FILE, JSON.stringify(next));
      } catch {}
    }
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      const next = syncDerivedContrastFields(settingsRef.current, { [key]: value });
      await persistNext(next);
    },
    [persistNext]
  );

  const updateSettingsBatch = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = syncDerivedContrastFields(settingsRef.current, patch);
      await persistNext(next);
    },
    [persistNext]
  );

  const resetSubtitleSettings = useCallback(async () => {
    const next = syncDerivedContrastFields(settingsRef.current, DEFAULT_SUBTITLE_SETTINGS);
    await persistNext(next);
  }, [persistNext]);

  return (
    <SettingsContext.Provider
      value={{ settings, loaded, updateSetting, updateSettingsBatch, resetSubtitleSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
