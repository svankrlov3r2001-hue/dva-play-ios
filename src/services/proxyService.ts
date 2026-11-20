import * as SecureStore from 'expo-secure-store';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { API_BASE_URL } from '../constants/config';

const PROXY_DRAFT_STORE_KEY = 'dvaios_custom_proxy_draft';
const SEAL_KEY = 'dva-ios-proxy-v1';
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export interface ProxyPreset {
  id: string;
  name: string;
  region: string;
  managed: boolean;
}

export interface ProxyRuntimeConfig {
  enabled: boolean;
  mode: 'preset' | 'custom';
  presetId: string;
  presetName: string;
  customHost: string;
  customPort: string;
  customUsername: string;
  customPassword: string;
  revision: number;
}

export interface ResolvedProxyPresetResponse {
  success: boolean;
  preset_id: string;
  label: string;
  region: string;
  managed: boolean;
  sealed: string;
}

export interface ProxyTestResult {
  success: boolean;
  latency_ms: number;
  label: string;
  managed: boolean;
  exit_ip?: string | null;
  error?: string | null;
}

export type ResolvePresetFetcher = (presetId: string) => Promise<ResolvedProxyPresetResponse>;

interface ResolvedProxyEndpoint {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface DvaNativeProxyBridge {
  dvaIsProxySupported(): boolean;
  dvaSetProxy(host: string, port: number, username: string, password: string): Promise<boolean>;
  dvaClearProxy(): Promise<boolean>;
  dvaTestProxy(
    host: string,
    port: number,
    username: string,
    password: string,
    fallbackUrl: string
  ): Promise<string>;
}

const DEFAULT_PROXY_CONFIG: ProxyRuntimeConfig = {
  enabled: false,
  mode: 'preset',
  presetId: 'hanoi',
  presetName: 'Server Hà Nội',
  customHost: '',
  customPort: '',
  customUsername: '',
  customPassword: '',
  revision: 0,
};

let currentProxyConfig: ProxyRuntimeConfig = { ...DEFAULT_PROXY_CONFIG };
let activeNativeEndpoint: ResolvedProxyEndpoint | null = null;
const managedPresetCache = new Map<string, ResolvedProxyEndpoint>();
const listeners = new Set<(cfg: ProxyRuntimeConfig) => void>();

function getNativeProxyBridge(): DvaNativeProxyBridge | null {
  try {
    const mod = requireOptionalNativeModule<DvaNativeProxyBridge>('ExpoFetchModule');
    if (
      mod &&
      typeof mod.dvaIsProxySupported === 'function' &&
      typeof mod.dvaSetProxy === 'function' &&
      typeof mod.dvaClearProxy === 'function' &&
      typeof mod.dvaTestProxy === 'function'
    ) {
      return mod;
    }
  } catch {}
  return null;
}

export function isNativeProxySupported(): boolean {
  const bridge = getNativeProxyBridge();
  if (!bridge) return false;
  try {
    return Boolean(bridge.dvaIsProxySupported());
  } catch {
    return false;
  }
}

function notifyListeners(): void {
  const snapshot = { ...currentProxyConfig };
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {}
  });
}

async function persistDraft(cfg: ProxyRuntimeConfig): Promise<void> {
  try {
    const draft = {
      mode: cfg.mode,
      presetId: cfg.presetId,
      presetName: cfg.presetName,
      customHost: cfg.customHost,
      customPort: cfg.customPort,
      customUsername: cfg.customUsername,
      customPassword: cfg.customPassword,
    };
    await SecureStore.setItemAsync(PROXY_DRAFT_STORE_KEY, JSON.stringify(draft));
  } catch {}
}

function decodeBase64Bytes(input: string): number[] {
  const clean = String(input || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64_ALPHABET.indexOf(clean[i]);
    const c2 = B64_ALPHABET.indexOf(clean[i + 1]);
    const ch3 = clean[i + 2];
    const ch4 = clean[i + 3];
    if (c1 < 0 || c2 < 0) break;
    const c3 = ch3 === '=' ? -1 : B64_ALPHABET.indexOf(ch3);
    const c4 = ch4 === '=' ? -1 : B64_ALPHABET.indexOf(ch4);
    bytes.push((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) {
      bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    }
    if (c4 >= 0 && c3 >= 0) {
      bytes.push(((c3 & 3) << 6) | c4);
    }
  }
  return bytes;
}

export function unsealProxyPayload(sealed: string): ResolvedProxyEndpoint {
  const cipherBytes = decodeBase64Bytes(sealed);
  if (cipherBytes.length === 0) {
    throw new Error('Dữ liệu cấu hình Proxy không hợp lệ.');
  }
  let pct = '';
  for (let i = 0; i < cipherBytes.length; i++) {
    const plainByte = cipherBytes[i] ^ SEAL_KEY.charCodeAt(i % SEAL_KEY.length);
    pct += '%' + (plainByte & 0xff).toString(16).padStart(2, '0');
  }
  const parsed = JSON.parse(decodeURIComponent(pct));
  const portNum = Number(parsed?.port);
  const host = typeof parsed?.host === 'string' ? parsed.host.trim() : '';
  if (!host || !Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('Thông số máy chủ Proxy không hợp lệ.');
  }
  return {
    host,
    port: Math.trunc(portNum),
    username: typeof parsed?.username === 'string' ? parsed.username : '',
    password: typeof parsed?.password === 'string' ? parsed.password : '',
  };
}

export function normalizeCustomProxyInput(
  hostRaw: string,
  portRaw: string
): { host: string; port: number } | null {
  let host = String(hostRaw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  let portStr = String(portRaw || '').trim();

  if (host.includes(':') && host.indexOf(':') === host.lastIndexOf(':')) {
    const [hPart, pPart] = host.split(':');
    host = hPart.trim();
    if (!portStr && /^\d+$/.test(pPart.trim())) {
      portStr = pPart.trim();
    }
  }

  const portNum = parseInt(portStr, 10);
  if (!host || !Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
    return null;
  }
  return { host, port: portNum };
}

async function applyNativeProxy(ep: ResolvedProxyEndpoint): Promise<void> {
  const bridge = getNativeProxyBridge();
  if (!bridge) {
    throw new Error('Cần cài đặt bản ứng dụng mới (v1.0.16) để bật Proxy trực tiếp.');
  }
  await bridge.dvaSetProxy(ep.host, ep.port, ep.username, ep.password);
  activeNativeEndpoint = { ...ep };
}

async function clearNativeProxy(): Promise<void> {
  activeNativeEndpoint = null;
  const bridge = getNativeProxyBridge();
  if (!bridge) return;
  try {
    await bridge.dvaClearProxy();
  } catch {}
}

async function getManagedPresetEndpoint(
  presetId: string,
  resolvePresetFn: ResolvePresetFetcher
): Promise<ResolvedProxyEndpoint> {
  const pid = (presetId || 'hanoi').trim() || 'hanoi';
  const cached = managedPresetCache.get(pid);
  if (cached) {
    return cached;
  }

  // Temporarily clear an active proxy while fetching preset info so dead proxies cannot block resolution
  const prevEndpoint = activeNativeEndpoint;
  if (prevEndpoint) {
    await clearNativeProxy();
  }

  try {
    const res = await resolvePresetFn(pid);
    if (!res?.success || !res?.sealed) {
      throw new Error('Không thể tải thông tin máy chủ Proxy.');
    }
    const endpoint = unsealProxyPayload(res.sealed);
    managedPresetCache.set(pid, endpoint);
    return endpoint;
  } finally {
    if (prevEndpoint) {
      await applyNativeProxy(prevEndpoint).catch(() => {});
    }
  }
}

async function resolveEndpointForConfig(
  cfg: ProxyRuntimeConfig,
  resolvePresetFn: ResolvePresetFetcher
): Promise<{ endpoint: ResolvedProxyEndpoint; label: string; managed: boolean }> {
  if (cfg.mode === 'preset') {
    const ep = await getManagedPresetEndpoint(cfg.presetId, resolvePresetFn);
    return {
      endpoint: ep,
      label: cfg.presetName || 'Server Hà Nội',
      managed: true,
    };
  }

  const normalized = normalizeCustomProxyInput(cfg.customHost, cfg.customPort);
  if (!normalized) {
    throw new Error('Vui lòng nhập đầy đủ Địa chỉ IP/Host và Cổng (1 - 65535).');
  }
  return {
    endpoint: {
      host: normalized.host,
      port: normalized.port,
      username: cfg.customUsername || '',
      password: cfg.customPassword || '',
    },
    label: `${normalized.host}:${normalized.port}`,
    managed: false,
  };
}

export async function warmManagedPresetAsync(
  presetId: string,
  resolvePresetFn: ResolvePresetFetcher
): Promise<void> {
  if (!isNativeProxySupported()) return;
  try {
    await getManagedPresetEndpoint(presetId, resolvePresetFn);
  } catch {}
}

export async function loadProxyDraft(): Promise<ProxyRuntimeConfig> {
  managedPresetCache.clear();
  clearNativeProxy().catch(() => {});
  try {
    const raw = await SecureStore.getItemAsync(PROXY_DRAFT_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        currentProxyConfig = {
          ...currentProxyConfig,
          mode: parsed.mode === 'custom' ? 'custom' : 'preset',
          presetId:
            typeof parsed.presetId === 'string' && parsed.presetId ? parsed.presetId : 'hanoi',
          presetName:
            typeof parsed.presetName === 'string' && parsed.presetName
              ? parsed.presetName
              : 'Server Hà Nội',
          customHost: typeof parsed.customHost === 'string' ? parsed.customHost : '',
          customPort: typeof parsed.customPort === 'string' ? parsed.customPort : '',
          customUsername: typeof parsed.customUsername === 'string' ? parsed.customUsername : '',
          customPassword: typeof parsed.customPassword === 'string' ? parsed.customPassword : '',
          // Always OFF on cold start
          enabled: false,
          revision: currentProxyConfig.revision + 1,
        };
        notifyListeners();
      }
    }
  } catch {}
  return { ...currentProxyConfig };
}

export function getProxyConfig(): ProxyRuntimeConfig {
  return { ...currentProxyConfig };
}

export function setProxyConfig(partial: Partial<ProxyRuntimeConfig>): ProxyRuntimeConfig {
  const turningOff = partial.enabled === false && (currentProxyConfig.enabled || activeNativeEndpoint !== null);
  currentProxyConfig = {
    ...currentProxyConfig,
    ...partial,
    ...(turningOff ? { revision: currentProxyConfig.revision + 1 } : {}),
  };
  if (turningOff) {
    clearNativeProxy().catch(() => {});
  }
  persistDraft(currentProxyConfig).catch(() => {});
  notifyListeners();
  return { ...currentProxyConfig };
}

export async function resetProxySession(): Promise<ProxyRuntimeConfig> {
  managedPresetCache.clear();
  await clearNativeProxy();
  currentProxyConfig = {
    ...currentProxyConfig,
    enabled: false,
    revision: currentProxyConfig.revision + 1,
  };
  notifyListeners();
  return { ...currentProxyConfig };
}

export async function disableProxyAsync(): Promise<ProxyRuntimeConfig> {
  await clearNativeProxy();
  currentProxyConfig = {
    ...currentProxyConfig,
    enabled: false,
    revision: currentProxyConfig.revision + 1,
  };
  persistDraft(currentProxyConfig).catch(() => {});
  notifyListeners();
  return { ...currentProxyConfig };
}

export async function enableProxyAsync(
  resolvePresetFn: ResolvePresetFetcher,
  overridePartial?: Partial<ProxyRuntimeConfig>
): Promise<ProxyRuntimeConfig> {
  if (!isNativeProxySupported()) {
    throw new Error('Tính năng Proxy trực tiếp cần phiên bản ứng dụng mới nhất (v1.0.16) trên iOS 17+.');
  }
  const candidate: ProxyRuntimeConfig = {
    ...currentProxyConfig,
    ...overridePartial,
  };
  const { endpoint } = await resolveEndpointForConfig(candidate, resolvePresetFn);
  await applyNativeProxy(endpoint);
  currentProxyConfig = {
    ...candidate,
    enabled: true,
    revision: currentProxyConfig.revision + 1,
  };
  persistDraft(currentProxyConfig).catch(() => {});
  notifyListeners();
  return { ...currentProxyConfig };
}

export async function testProxyDirectAsync(
  cfg: ProxyRuntimeConfig,
  resolvePresetFn: ResolvePresetFetcher
): Promise<ProxyTestResult> {
  const bridge = getNativeProxyBridge();
  if (!bridge || !isNativeProxySupported()) {
    return {
      success: false,
      latency_ms: 0,
      label: cfg.mode === 'preset' ? cfg.presetName : `${cfg.customHost}:${cfg.customPort}`,
      managed: cfg.mode === 'preset',
      exit_ip: null,
      error: 'Cần cài đặt phiên bản iOS mới nhất (v1.0.16) để kiểm tra Proxy trực tiếp trên iPhone.',
    };
  }

  const { endpoint, label, managed } = await resolveEndpointForConfig(cfg, resolvePresetFn);
  const rawJson = await bridge.dvaTestProxy(
    endpoint.host,
    endpoint.port,
    endpoint.username,
    endpoint.password,
    `${API_BASE_URL}/auth.php?action=status`
  );

  let parsed: any = null;
  try {
    parsed = rawJson ? JSON.parse(rawJson) : null;
  } catch {
    parsed = null;
  }

  if (!parsed || !parsed.success) {
    return {
      success: false,
      latency_ms: Number(parsed?.latency_ms) || 0,
      label,
      managed,
      exit_ip: null,
      error: parsed?.error || 'Không thể kết nối qua proxy này.',
    };
  }

  return {
    success: true,
    latency_ms: Math.max(1, Number(parsed.latency_ms) || 1),
    label,
    managed,
    // Keep managed preset server IP hidden from UI
    exit_ip: managed ? null : parsed.exit_ip ? String(parsed.exit_ip) : null,
    error: null,
  };
}

export function subscribeProxyConfig(listener: (cfg: ProxyRuntimeConfig) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isProxyActiveForConfig(cfg: ProxyRuntimeConfig = currentProxyConfig): boolean {
  if (!cfg.enabled) return false;
  if (cfg.mode === 'preset') {
    return Boolean(cfg.presetId);
  }
  return Boolean(normalizeCustomProxyInput(cfg.customHost, cfg.customPort));
}
