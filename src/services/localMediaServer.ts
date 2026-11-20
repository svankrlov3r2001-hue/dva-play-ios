import { requireOptionalNativeModule } from 'expo-modules-core';

interface DvaNativeMediaServerBridge {
  dvaStartOfflineMediaServer(rootDirPath: string): Promise<number>;
  dvaGetOfflineMediaServerPort(): Promise<number>;
  dvaStopOfflineMediaServer(): Promise<boolean>;
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
