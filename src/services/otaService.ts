import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import {
  APP_RUNTIME_VERSION,
  APP_VERSION,
  APP_VERSION_CODE,
  EXPO_UPDATES_URL,
} from '../constants/config';
import { checkOtaUpdateApi } from './api';
import { VersionManifest } from '../types/models';

export interface OtaRuntimeState {
  isEnabled: boolean;
  isExpoGo: boolean;
  isEmbeddedLaunch: boolean;
  updateId: string | null;
  runtimeVersion: string;
  channel: string | null;
  createdAt: string | null;
  updatesUrl: string;
}

export interface CombinedUpdateCheckResult {
  otaSupported: boolean;
  otaUpdated: boolean;
  otaUpdateId: string | null;
  otaError?: string;
  ipaAvailable: boolean;
  manifest: VersionManifest | null;
}

export function isRunningInExpoGo(): boolean {
  try {
    return Constants.executionEnvironment === 'storeClient' || (Constants as any).appOwnership === 'expo';
  } catch {
    return false;
  }
}

export function getOtaRuntimeState(): OtaRuntimeState {
  const isExpoGo = isRunningInExpoGo();
  let isEnabled = false;
  let isEmbeddedLaunch = true;
  let updateId: string | null = null;
  let runtimeVersion = APP_RUNTIME_VERSION;
  let channel: string | null = null;
  let createdAt: string | null = null;

  try {
    isEnabled = Boolean(Updates.isEnabled) && !isExpoGo && !__DEV__;
    isEmbeddedLaunch = Updates.isEmbeddedLaunch;
    updateId = Updates.updateId ?? null;
    runtimeVersion = Updates.runtimeVersion || APP_RUNTIME_VERSION;
    channel = Updates.channel ?? null;
    createdAt = Updates.createdAt ? Updates.createdAt.toISOString() : null;
  } catch {
    isEnabled = false;
  }

  return {
    isEnabled,
    isExpoGo,
    isEmbeddedLaunch,
    updateId,
    runtimeVersion,
    channel,
    createdAt,
    updatesUrl: EXPO_UPDATES_URL,
  };
}

/**
 * Silent OTA bundle check on startup (only active in standalone .ipa builds).
 * Downloads new UI JS bundles in the background so next launch applies cleanly.
 */
export async function runSilentBackgroundOtaSync(): Promise<boolean> {
  const state = getOtaRuntimeState();
  if (!state.isEnabled) {
    return false;
  }
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return false;
    }
    const fetched = await Updates.fetchUpdateAsync();
    return Boolean(fetched.isNew);
  } catch {
    return false;
  }
}

/**
 * Explicit OTA + .ipa check triggered from Account & Settings.
 */
export async function checkAndFetchOtaCombinedAsync(): Promise<CombinedUpdateCheckResult> {
  const state = getOtaRuntimeState();
  let otaUpdated = false;
  let otaUpdateId: string | null = state.updateId;
  let otaError: string | undefined;

  if (state.isEnabled) {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) {
          otaUpdated = true;
          otaUpdateId = fetched.manifest?.id ?? state.updateId;
        }
      }
    } catch (err: any) {
      otaError = err?.message || 'Không thể kiểm tra gói OTA.';
    }
  }

  let manifest: VersionManifest | null = null;
  let ipaAvailable = false;
  try {
    manifest = await checkOtaUpdateApi();
    ipaAvailable = (manifest?.versionCode || 0) > APP_VERSION_CODE ||
      (Boolean(manifest?.versionName) && manifest.versionName !== APP_VERSION && manifest.versionCode >= APP_VERSION_CODE);
  } catch {}

  return {
    otaSupported: state.isEnabled,
    otaUpdated,
    otaUpdateId,
    otaError,
    ipaAvailable,
    manifest,
  };
}

export async function applyOtaReloadNow(): Promise<void> {
  const state = getOtaRuntimeState();
  if (!state.isEnabled) return;
  await Updates.reloadAsync();
}
