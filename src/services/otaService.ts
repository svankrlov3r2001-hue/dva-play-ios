import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Linking } from 'react-native';
import {
  APP_RUNTIME_VERSION,
  APP_VERSION,
  APP_VERSION_CODE,
  EXPO_UPDATES_URL,
} from '../constants/config';
import {
  checkOtaUpdateApi,
  fetchDirectInstallStatusApi,
  fetchDirectInstallUrlApi,
} from './api';
import { AppSigningInfo, getAppSigningInfo } from './localMediaServer';
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
  canDirectInstall: boolean;
  directInstallReady: boolean;
  signingInfo: AppSigningInfo;
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
 * Explicit OTA + .ipa + P12 direct overwrite install check.
 */
export async function checkAndFetchOtaCombinedAsync(): Promise<CombinedUpdateCheckResult> {
  const state = getOtaRuntimeState();
  const signingInfo = getAppSigningInfo();
  const canDirectInstall = Boolean(signingInfo.canDirectInstall && signingInfo.isP12Signed);

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
      otaError = err?.message || 'Không thể kiểm tra bản cập nhật.';
    }
  }

  let manifest: VersionManifest | null = null;
  let ipaAvailable = false;
  try {
    manifest = await checkOtaUpdateApi();
    ipaAvailable = (manifest?.versionCode || 0) > APP_VERSION_CODE ||
      (Boolean(manifest?.versionName) && manifest.versionName !== APP_VERSION && manifest.versionCode >= APP_VERSION_CODE);
  } catch {}

  let directInstallReady = false;
  if (canDirectInstall && ipaAvailable) {
    try {
      const status = await fetchDirectInstallStatusApi();
      directInstallReady = Boolean(status?.signed_ipa_ready);
    } catch {
      directInstallReady = false;
    }
  }

  return {
    otaSupported: state.isEnabled,
    otaUpdated,
    otaUpdateId,
    otaError,
    ipaAvailable,
    canDirectInstall,
    directInstallReady,
    signingInfo,
    manifest,
  };
}

export async function applyOtaReloadNow(): Promise<void> {
  const state = getOtaRuntimeState();
  if (!state.isEnabled) return;
  await Updates.reloadAsync();
}

export async function triggerDirectP12InstallNow(): Promise<void> {
  const res = await fetchDirectInstallUrlApi();
  if (!res?.success || !res?.itms_url || !res.itms_url.startsWith('itms-services://')) {
    throw new Error('Không thể khởi tạo liên kết cập nhật trực tiếp.');
  }
  await Linking.openURL(res.itms_url);
}
