import { requireOptionalNativeModule } from 'expo-modules-core';

interface DvaNativeMediaServerBridge {
  dvaStartOfflineMediaServer(rootDirPath: string): Promise<number>;
  dvaRestartOfflineMediaServer?: (rootDirPath: string) => Promise<number>;
  dvaGetOfflineMediaServerPort(): Promise<number>;
  dvaStopOfflineMediaServer(): Promise<boolean>;
  dvaHasPipSubtitleProxy?: () => boolean;
  dvaSetPipSubtitleCues?: (cuesJson: string) => boolean;
  dvaGetSigningInfo?: () => string;
  dvaSetBackgroundDownloadActive?: (active: boolean) => boolean;
  dvaSetVideoPlaybackActive?: (active: boolean) => boolean;
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

export function setNativePipSubtitleCues(cuesJson: string): boolean {
  const bridge = getNativeMediaBridge();
  if (!bridge || typeof bridge.dvaSetPipSubtitleCues !== 'function') {
    return false;
  }
  try {
    return Boolean(bridge.dvaSetPipSubtitleCues(String(cuesJson || '')));
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

export function setNativeVideoPlaybackActive(active: boolean): boolean {
  const bridge = getNativeMediaBridge();
  if (!bridge || typeof bridge.dvaSetVideoPlaybackActive !== 'function') {
    return false;
  }
  try {
    return Boolean(bridge.dvaSetVideoPlaybackActive(Boolean(active)));
  } catch {
    return false;
  }
}

export function getCachedOfflineMediaServerPort(): number {
  return cachedPort;
}

async function pingLocalMediaServer(port: number): Promise<boolean> {
  if (!port || port <= 0) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 500);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/hls-pip/ping`, {
      method: 'GET',
      signal: ctrl.signal,
    });
    return Boolean(res && res.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function restartOfflineMediaServer(rootDirUri: string): Promise<number> {
  if (!rootDirUri) return 0;
  const bridge = getNativeMediaBridge();
  if (!bridge) return 0;
  cachedPort = 0;
  cachedRootDir = rootDirUri;
  try {
    let port = 0;
    if (typeof bridge.dvaRestartOfflineMediaServer === 'function') {
      port = await bridge.dvaRestartOfflineMediaServer(rootDirUri);
    } else {
      try {
        await bridge.dvaStopOfflineMediaServer();
      } catch {}
      port = await bridge.dvaStartOfflineMediaServer(rootDirUri);
    }
    if (typeof port === 'number' && port > 0 && port <= 65535) {
      cachedPort = Math.trunc(port);
      return cachedPort;
    }
    return 0;
  } catch {
    return 0;
  }
}

export async function ensureOfflineMediaServer(rootDirUri: string): Promise<number> {
  if (!rootDirUri) return 0;
  const bridge = getNativeMediaBridge();
  if (!bridge) {
    return 0;
  }
  if (startingPromise && cachedRootDir === rootDirUri) {
    return startingPromise;
  }
  const previousRoot = cachedRootDir;
  cachedRootDir = rootDirUri;
  startingPromise = (async () => {
    try {
      if (cachedPort > 0 && previousRoot === rootDirUri) {
        const alive = await pingLocalMediaServer(cachedPort);
        if (alive) {
          return cachedPort;
        }
        // Loopback socket was reclaimed while app was backgrounded; force clean native restart
        cachedPort = 0;
        if (typeof bridge.dvaRestartOfflineMediaServer === 'function') {
          const restartedPort = await bridge.dvaRestartOfflineMediaServer(rootDirUri);
          if (typeof restartedPort === 'number' && restartedPort > 0 && restartedPort <= 65535) {
            cachedPort = Math.trunc(restartedPort);
            return cachedPort;
          }
        }
      }
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
