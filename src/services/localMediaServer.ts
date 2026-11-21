import { requireOptionalNativeModule } from 'expo-modules-core';

interface DvaNativeMediaServerBridge {
  dvaStartOfflineMediaServer(rootDirPath: string): Promise<number>;
  dvaGetOfflineMediaServerPort(): Promise<number>;
  dvaStopOfflineMediaServer(): Promise<boolean>;
  dvaHasPipSubtitleProxy?: () => boolean;
  dvaGetSigningInfo?: () => string;
  dvaSetBackgroundDownloadActive?: (active: boolean) => boolean;
  dvaIsBackgroundDownloadActive?: () => boolean;
}

export interface AppSigningInfo {
  isP12Signed: boolean;
  canDirectInstall: boolean;
  bundleId: string;
  teamId: string;
  teamName: string;
  expiresAt: string;
  ttlDays: number;
}

let cachedPort = 0;
let cachedRootDir = '';
let startingPromise: Promise<number> | null = null;

function getNativeMediaBridge(): DvaNativeMediaServerBridge | null {
  try {
    const mod = requireOptionalNativeModule<DvaNativeMediaServerBridge>('ExpoFetchModule');
    if (
      mod &&
      typeof mod.dvaStartOfflineMediaServer === 'function' &&
      typeof mod.dvaGetOfflineMediaServerPort === 'function'
    ) {
      return mod;
    }
  } catch {}
  return null;
}

export function isOfflineMediaServerSupported(): boolean {
  return getNativeMediaBridge() !== null;
}

export function isNativePipProxySupported(): boolean {
  const bridge = getNativeMediaBridge();
  if (!bridge || typeof bridge.dvaHasPipSubtitleProxy !== 'function') {
    return false;
  }
  try {
    return Boolean(bridge.dvaHasPipSubtitleProxy());
  } catch {
    return false;
  }
}

const DEFAULT_SIGNING_INFO: AppSigningInfo = {
  isP12Signed: false,
  canDirectInstall: false,
  bundleId: '',
  teamId: '',
  teamName: '',
  expiresAt: '',
  ttlDays: 0,
};

export function getAppSigningInfo(): AppSigningInfo {
  const bridge = getNativeMediaBridge();
  if (!bridge || typeof bridge.dvaGetSigningInfo !== 'function') {
    return DEFAULT_SIGNING_INFO;
  }
  try {
    const raw = bridge.dvaGetSigningInfo();
    if (!raw || typeof raw !== 'string') return DEFAULT_SIGNING_INFO;
    const parsed = JSON.parse(raw);
    return {
      isP12Signed: Boolean(parsed?.isP12Signed),
      canDirectInstall: Boolean(parsed?.canDirectInstall ?? parsed?.isP12Signed),
      bundleId: String(parsed?.bundleId || ''),
      teamId: String(parsed?.teamId || ''),
      teamName: String(parsed?.teamName || ''),
      expiresAt: String(parsed?.expiresAt || ''),
      ttlDays: Number(parsed?.ttlDays || 0),
    };
  } catch {
    return DEFAULT_SIGNING_INFO;
  }
}

export function isNativeBackgroundDownloadSupported(): boolean {
  const bridge = getNativeMediaBridge();
  return Boolean(bridge && typeof bridge.dvaSetBackgroundDownloadActive === 'function');
}

export function setNativeBackgroundDownloadActive(active: boolean): boolean {
  const bridge = getNativeMediaBridge();
  if (!bridge || typeof bridge.dvaSetBackgroundDownloadActive !== 'function') {
    return false;
  }
  try {
    return Boolean(bridge.dvaSetBackgroundDownloadActive(Boolean(active)));
  } catch {
    return false;
  }
}

export function getCachedOfflineMediaServerPort(): number {
  return cachedPort;
}

export async function ensureOfflineMediaServer(rootDirUri: string): Promise<number> {
  if (!rootDirUri) return 0;
  if (cachedPort > 0 && cachedRootDir === rootDirUri) {
    return cachedPort;
  }
  const bridge = getNativeMediaBridge();
  if (!bridge) {
    return 0;
  }
  if (startingPromise && cachedRootDir === rootDirUri) {
    return startingPromise;
  }
  cachedRootDir = rootDirUri;
  startingPromise = (async () => {
    try {
      const port = await bridge.dvaStartOfflineMediaServer(rootDirUri);
      if (typeof port === 'number' && port > 0 && port <= 65535) {
        cachedPort = Math.trunc(port);
        return cachedPort;
      }
      return 0;
    } catch {
      return 0;
    } finally {
      startingPromise = null;
    }
  })();
  return startingPromise;
}

export async function refreshOfflineMediaServerPort(): Promise<number> {
  const bridge = getNativeMediaBridge();
  if (!bridge) return 0;
  try {
    const port = await bridge.dvaGetOfflineMediaServerPort();
    if (typeof port === 'number' && port > 0 && port <= 65535) {
      cachedPort = Math.trunc(port);
      return cachedPort;
    }
  } catch {}
  return 0;
}

export async function stopOfflineMediaServer(): Promise<void> {
  cachedPort = 0;
  const bridge = getNativeMediaBridge();
  if (!bridge || typeof bridge.dvaStopOfflineMediaServer !== 'function') return;
  try {
    await bridge.dvaStopOfflineMediaServer();
  } catch {}
}

/**
 * Builds a clean http://127.0.0.1:<port>/offline/<encodedPath> URL for native AVPlayer and WKWebView.
 */
export function buildLocalOfflineUrl(relativePath: string, port?: number): string | null {
  const activePort = port && port > 0 ? port : cachedPort;
  if (!activePort || activePort <= 0 || !relativePath) return null;
  const cleanRel = relativePath.replace(/^\/+/, '');
  if (!cleanRel || cleanRel.includes('..')) return null;
  const encodedPath = cleanRel
    .split('/')
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  if (!encodedPath) return null;
  return `http://127.0.0.1:${activePort}/offline/${encodedPath}`;
}
