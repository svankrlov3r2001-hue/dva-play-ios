import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {
  EpisodeItem,
  OfflineDownloadItem,
  OfflineSubtitleTrack,
  StreamQuality,
  StreamResolvedData,
  StreamSubtitle,
} from '../types/models';
import {
  fetchBatchWatchProgressApi,
  fetchMovieDetailsApi,
  resolveStreamApi,
  saveWatchProgressApi,
} from './api';
import { buildLocalOfflineUrl, isNativePipProxySupported, setNativeBackgroundDownloadActive } from './localMediaServer';
import { encodeSubtitlePathUrl } from './subtitleService';

const OFFLINE_DIR = `${FileSystem.documentDirectory ?? ''}dva_offline/`;
const INDEX_FILE = `${FileSystem.documentDirectory ?? ''}dva_offline_index.json`;

const CHECK_API_URL = 'https://dangvietanh.io.vn/check_file';
const TRIGGER_DOWNLOAD_API = 'https://dangvietanh.io.vn/download_file_gdrive';
const SHARD_DOMAINS = ['s1dangvietanh.io.vn'];

type ProgressListener = (items: OfflineDownloadItem[]) => void;

export interface OfflineEnqueueParams {
  videos_id: number;
  episode_id?: number;
  episode_number?: number;
  stream_code: string;
  title: string;
  episode_title?: string;
  server_movie_title?: string;
  server_file_key?: string;
  poster_url: string;
  thumbnail_url: string;
  remote_url?: string;
  preferred_format?: 'auto' | 'hls' | 'mp4';
  concurrency?: number;
}

export interface OfflineWebViewRegistryItem {
  id: string;
  videos_id: number;
  episode_id: number;
  stream_code: string;
  title: string;
  episode_title: string;
  server_file_key: string;
  norm_key: string;
  media_format: 'hls' | 'mp4';
  relative_entry: string;
  url: string;
  subtitles: {
    lang: string;
    label: string;
    url: string;
  }[];
}

export interface OfflineWebViewRegistry {
  enabled: boolean;
  baseUrl: string;
  pipProxy?: boolean;
  items: OfflineWebViewRegistryItem[];
}

const listeners = new Set<ProgressListener>();
const activeControllers = new Map<string, AbortController>();
const activeResumables = new Map<string, FileSystem.DownloadResumable>();
const pendingManualRestartIds = new Set<string>();
const downloadQueue: string[] = [];

export interface OfflineRetentionPolicy {
  storageLimitGb: number;
  autoDeleteEnabled: boolean;
  autoDeleteDays: number;
  antiStallEnabled: boolean;
}

const DOWNLOAD_REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_WATCHDOG_TIMEOUT_MS = 30000;
const DOWNLOAD_LOW_SPEED_THRESHOLD_BPS = 300 * 1024;
const DOWNLOAD_LOW_SPEED_DURATION_MS = 25000;
const DOWNLOAD_MAX_AUTO_RESTARTS = 4;

let activeOfflinePolicy: OfflineRetentionPolicy = {
  storageLimitGb: 20,
  autoDeleteEnabled: false,
  autoDeleteDays: 7,
  antiStallEnabled: true,
};

let cachedItems: OfflineDownloadItem[] = [];
let initialized = false;
let isProcessingQueue = false;
let currentDownloadingId: string | null = null;
let workerConcurrencyPref = 3;
let enforcingPolicyPromise: Promise<{ deletedCount: number; freedBytes: number }> | null = null;

export function setOfflineRuntimePolicy(policy: Partial<OfflineRetentionPolicy>): void {
  activeOfflinePolicy = {
    storageLimitGb: Math.max(
      10,
      Math.min(
        100,
        Math.round((policy.storageLimitGb ?? activeOfflinePolicy.storageLimitGb) / 10) * 10
      )
    ),
    autoDeleteEnabled:
      typeof policy.autoDeleteEnabled === 'boolean'
        ? policy.autoDeleteEnabled
        : activeOfflinePolicy.autoDeleteEnabled,
    autoDeleteDays: Math.max(
      3,
      Math.min(90, Math.round(policy.autoDeleteDays ?? activeOfflinePolicy.autoDeleteDays))
    ),
    antiStallEnabled:
      typeof policy.antiStallEnabled === 'boolean'
        ? policy.antiStallEnabled
        : activeOfflinePolicy.antiStallEnabled,
  };
}

export function getOfflineStorageBytes(): number {
  return cachedItems.reduce((sum, it) => sum + Math.max(0, Number(it.size_bytes || 0)), 0);
}

function hasActiveDownloadWork(): boolean {
  if (isProcessingQueue || downloadQueue.length > 0 || activeControllers.size > 0) {
    return true;
  }
  return cachedItems.some(
    (it) => it.status === 'downloading' || it.status === 'preparing' || it.status === 'queued'
  );
}

function syncBackgroundDownloadGuard(): void {
  try {
    setNativeBackgroundDownloadActive(hasActiveDownloadWork());
  } catch {}
}

export function getOfflineRootDir(): string {
  return OFFLINE_DIR;
}

function getShardedBaseUrl(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let prefix = '';
  for (let i = 0; i < 12; i++) {
    prefix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const domain = SHARD_DOMAINS[Math.floor(Math.random() * SHARD_DOMAINS.length)];
  return `https://dl${prefix}.${domain}/uploads/`;
}

function swapToFreshShard(url: string): string {
  const m = url.match(/^https?:\/\/[^/]*dangvietanh\.io\.vn\/uploads\/(.+)$/i);
  if (m && m[1]) {
    return `${getShardedBaseUrl()}${m[1]}`;
  }
  return url;
}

export function normalizeOfflineMatchKey(raw?: string): string {
  if (!raw) return '';
  let clean = '';
  try {
    clean = decodeURIComponent(raw);
  } catch {
    clean = raw;
  }
  clean = clean.replace(/\.(mp4|m3u8|vtt)$/i, '').replace(/_vi$/i, '');
  const epMatch = clean.match(/(.+?)[\.\s_-]*t[ậâa]p[\.\s_-]*0*(\d+)/i);
  if (epMatch && epMatch[1] && epMatch[2]) {
    const base = epMatch[1].toLowerCase().replace(/[._\-+\s]+/g, ' ').trim();
    const epNum = parseInt(epMatch[2], 10);
    return `${base}::ep::${epNum}`;
  }
  return clean.toLowerCase().replace(/[._\-+\s]+/g, ' ').trim();
}

export function extractEpisodeNumberFromName(name?: string): number {
  const str = String(name || '');
  const mEp = str.match(/(?:t[ậâa]p|tap|episode|ep)\s*0*(\d+)/i);
  if (mEp && mEp[1]) return parseInt(mEp[1], 10);
  const mAny = str.match(/0*(\d+)/);
  return mAny && mAny[1] ? parseInt(mAny[1], 10) : 0;
}

export function normalizeEpisodeOrder(episodes: EpisodeItem[]): EpisodeItem[] {
  if (!Array.isArray(episodes) || episodes.length <= 1) {
    return episodes ? [...episodes] : [];
  }
  const firstNum = extractEpisodeNumberFromName(episodes[0].episodes_name);
  const lastNum = extractEpisodeNumberFromName(episodes[episodes.length - 1].episodes_name);
  if (firstNum > 0 && lastNum > 0 && firstNum > lastNum) {
    return [...episodes].reverse();
  }
  return [...episodes];
}

export function getCurrentAndNextEpisodes(
  episodes: EpisodeItem[],
  currentStreamCode: string,
  nextCount: number
): EpisodeItem[] {
  const ordered = normalizeEpisodeOrder(episodes);
  if (ordered.length === 0) return [];
  const curIdx = ordered.findIndex((e) => e.stream_code === currentStreamCode);
  if (curIdx < 0) return ordered.slice(0, Math.max(1, 1 + Math.max(0, nextCount)));
  const count = 1 + Math.max(0, nextCount);
  return ordered.slice(curIdx, curIdx + count);
}

function buildDownloadId(params: {
  videos_id: number;
  episode_id?: number;
  stream_code: string;
}): string {
  const safeCode =
    String(params.stream_code || '').replace(/[^a-zA-Z0-9_-]/g, '_') || String(params.videos_id);
  return `${params.videos_id}_${params.episode_id || 0}_${safeCode}`;
}

function constructSubtitleUrl(serverFileKey: string, lang: 'vn' | 'en'): string {
  const cleanName = serverFileKey.replace(/\.(mp4|m3u8)$/i, '').replace(/_vi$/i, '');
  let category = 'Phim.Lẻ';
  let movieName = cleanName;
  if (cleanName.includes('.Tập.') || /[\.\s]T[ậâa]p/i.test(cleanName)) {
    category = 'Phim.Bộ';
    movieName = cleanName.split(/[\.\s]T[ậâa]p/i)[0] || cleanName;
  }
  const langFolder = lang === 'vn' ? 'VN' : 'EN';
  return encodeSubtitlePathUrl(
    'https://sub.dangvietanh.com/dashboard?ssl=' +
      `${category}/${movieName}/Subtitle/${langFolder}/${cleanName}.vtt&dtpd=0&vtpd=80&vtpdtt=0`
  );
}

async function ensureDir(dir = OFFLINE_DIR): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch {}
}

function notifyListeners(): void {
  const snapshot = [...cachedItems];
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {}
  });
}

async function persistIndex(items: OfflineDownloadItem[]): Promise<void> {
  cachedItems = items;
  if (FileSystem.documentDirectory) {
    try {
      await FileSystem.writeAsStringAsync(INDEX_FILE, JSON.stringify(items));
    } catch {}
  }
  notifyListeners();
}

function updateItemInMemory(
  id: string,
  patch: Partial<OfflineDownloadItem>,
  persistNow = false
): void {
  cachedItems = cachedItems.map((it) =>
    it.id === id
      ? {
          ...it,
          ...patch,
          updated_at: new Date().toISOString(),
        }
      : it
  );
  if (persistNow) {
    void persistIndex(cachedItems);
  } else {
    notifyListeners();
  }
}

function reanchorOfflineUri(uri: string | undefined): string {
  if (!uri || !OFFLINE_DIR) return uri || '';
  if (/^https?:\/\//i.test(uri)) return uri;
  const marker = '/dva_offline/';
  const idx = uri.indexOf(marker);
  if (idx >= 0) {
    const rel = uri.substring(idx + marker.length).replace(/^\/+/, '');
    return `${OFFLINE_DIR}${rel}`;
  }
  const altMarker = 'dva_offline/';
  const altIdx = uri.indexOf(altMarker);
  if (altIdx >= 0) {
    const rel = uri.substring(altIdx + altMarker.length).replace(/^\/+/, '');
    return `${OFFLINE_DIR}${rel}`;
  }
  return uri;
}

function extractNormalizedTitleBase(raw?: string): string {
  const beforeDash = String(raw || '').split(' - ')[0] || '';
  return beforeDash
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[._\-+\s:/\\|()[\]]+/g, ' ')
    .trim();
}

function extractServerTitleBase(item: OfflineDownloadItem): string {
  const raw = item.server_movie_title || item.server_file_key || '';
  if (!raw) return '';
  const withoutExt = raw.replace(/\.(mp4|m3u8|vtt)$/i, '').replace(/_vi$/i, '');
  const beforeEp = withoutExt.split(/[.\s_-]T[ậâa]p/i)[0] || withoutExt;
  return beforeEp
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[._\-+\s]+/g, ' ')
    .trim();
}

function shareSignificantToken(a: string, b: string): boolean {
  if (!a || !b) return true;
  const tokA = a.split(' ').filter((w) => w.length >= 2);
  const tokB = new Set(b.split(' ').filter((w) => w.length >= 2));
  if (tokA.length === 0 || tokB.size === 0) return true;
  return tokA.some((w) => tokB.has(w));
}

async function sanitizeCorruptedOfflineItems(
  items: OfflineDownloadItem[]
): Promise<{ items: OfflineDownloadItem[]; mutated: boolean }> {
  if (items.length <= 1) return { items, mutated: false };
  let mutated = false;

  // Map canonical server_movie_title bases -> known series group metadata (only when title agrees with serverBase)
  const serverBaseToOwner = new Map<
    string,
    {
      videos_id: number;
      title: string;
      poster_url: string;
      thumbnail_url: string;
      local_poster_uri?: string;
    }
  >();

  for (const it of items) {
    const sBase = extractServerTitleBase(it);
    const tBase = extractNormalizedTitleBase(it.title);
    if (!sBase || !tBase) continue;
    if (shareSignificantToken(sBase, tBase) && !serverBaseToOwner.has(sBase)) {
      serverBaseToOwner.set(sBase, {
        videos_id: it.videos_id,
        title: it.title,
        poster_url: it.poster_url,
        thumbnail_url: it.thumbnail_url,
        local_poster_uri: it.local_poster_uri,
      });
    }
  }

  // Group by videos_id to detect heterogeneous server_movie_title contamination inside one videos_id
  const byVideosId = new Map<number, OfflineDownloadItem[]>();
  for (const it of items) {
    if (!it.videos_id) continue;
    const list = byVideosId.get(it.videos_id) || [];
    list.push(it);
    byVideosId.set(it.videos_id, list);
  }

  const dropIds = new Set<string>();
  const foldersToDelete: string[] = [];
  const nextItems = items.map((it) => ({ ...it }));

  for (let i = 0; i < nextItems.length; i++) {
    const it = nextItems[i];
    const sBase = extractServerTitleBase(it);
    const tBase = extractNormalizedTitleBase(it.title);
    if (!sBase || !tBase) continue;

    // Case 1: item belongs unambiguously to a different series present in offline storage
    const owner = serverBaseToOwner.get(sBase);
    if (
      owner &&
      owner.videos_id !== it.videos_id &&
      !shareSignificantToken(sBase, tBase)
    ) {
      const duplicateInOwner = nextItems.some(
        (other, idx) =>
          idx !== i &&
          !dropIds.has(other.id) &&
          other.videos_id === owner.videos_id &&
          other.stream_code &&
          other.stream_code === it.stream_code
      );
      mutated = true;
      if (duplicateInOwner) {
        dropIds.add(it.id);
        foldersToDelete.push(it.local_dir || `${OFFLINE_DIR}${it.id}/`);
      } else {
        it.videos_id = owner.videos_id;
        it.title = owner.title;
        if (!it.poster_url && owner.poster_url) it.poster_url = owner.poster_url;
        if (!it.thumbnail_url && owner.thumbnail_url) it.thumbnail_url = owner.thumbnail_url;
      }
      continue;
    }

    // Case 2: single movie shares videos_id with leaked series episodes whose server_movie_title mismatches completely
    const group = byVideosId.get(it.videos_id) || [];
    if (group.length > 1 && it.episode_title) {
      const matchingTitleSib = group.find((sib) => {
        const sibS = extractServerTitleBase(sib);
        const sibT = extractNormalizedTitleBase(sib.title);
        return sib.id !== it.id && Boolean(sibS) && shareSignificantToken(sibS, sibT);
      });
      if (matchingTitleSib && !shareSignificantToken(sBase, tBase) && !it.poster_url && !it.thumbnail_url) {
        mutated = true;
        dropIds.add(it.id);
        foldersToDelete.push(it.local_dir || `${OFFLINE_DIR}${it.id}/`);
      }
    }
  }

  for (const dir of foldersToDelete) {
    if (dir) {
      await FileSystem.deleteAsync(dir, { idempotent: true }).catch(() => {});
    }
  }

  const filtered = dropIds.size > 0 ? nextItems.filter((it) => !dropIds.has(it.id)) : nextItems;
  return { items: filtered, mutated };
}

async function isValidPosterFile(uri?: string): Promise<boolean> {
  if (!uri) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    const sz = info.exists && 'size' in info ? Number(info.size || 0) : 0;
    return Boolean(info.exists && sz > 500);
  } catch {
    return false;
  }
}

async function repairMissingOfflinePosters(items: OfflineDownloadItem[]): Promise<void> {
  if (!OFFLINE_DIR) return;

  const validLocalByVideo = new Map<number, string>();
  const remoteByVideo = new Map<number, { poster: string; thumb: string }>();

  for (const it of items) {
    if (!it.videos_id) continue;
    const remoteThumb = it.thumbnail_url || it.poster_url;
    if (remoteThumb && /^https?:\/\//i.test(remoteThumb) && !remoteByVideo.has(it.videos_id)) {
      remoteByVideo.set(it.videos_id, {
        poster: it.poster_url || remoteThumb,
        thumb: it.thumbnail_url || remoteThumb,
      });
    }
    if (it.local_poster_uri && !validLocalByVideo.has(it.videos_id)) {
      if (await isValidPosterFile(it.local_poster_uri)) {
        validLocalByVideo.set(it.videos_id, it.local_poster_uri);
      }
    }
  }

  const fetchedDetailsAttempted = new Set<number>();

  for (const item of items) {
    if (item.status !== 'completed') continue;
    const hasLocal = await isValidPosterFile(item.local_poster_uri);
    if (hasLocal) continue;

    const itemDir = `${OFFLINE_DIR}${item.id}/`;
    const posterDest = `${itemDir}poster.jpg`;
    const patch: Partial<OfflineDownloadItem> = {};

    // 1. Copy immediately from any sibling episode of the same movie
    const sibLocal = item.videos_id ? validLocalByVideo.get(item.videos_id) : undefined;
    if (sibLocal && sibLocal !== posterDest) {
      try {
        await ensureDir(itemDir);
        await FileSystem.copyAsync({ from: sibLocal, to: posterDest });
        if (await isValidPosterFile(posterDest)) {
          patch.local_poster_uri = posterDest;
          const sibRemote = item.videos_id ? remoteByVideo.get(item.videos_id) : undefined;
          if (!item.poster_url && sibRemote?.poster) patch.poster_url = sibRemote.poster;
          if (!item.thumbnail_url && sibRemote?.thumb) patch.thumbnail_url = sibRemote.thumb;
          updateItemInMemory(item.id, patch, true);
          continue;
        }
      } catch {}
    }

    // 2. Download from own or sibling remote URL, or fetch movie details once if both missing
    let remoteImg =
      item.thumbnail_url ||
      item.poster_url ||
      (item.videos_id ? remoteByVideo.get(item.videos_id)?.thumb : '') ||
      '';

    if ((!remoteImg || !/^https?:\/\//i.test(remoteImg)) && item.videos_id > 0 && !fetchedDetailsAttempted.has(item.videos_id)) {
      fetchedDetailsAttempted.add(item.videos_id);
      try {
        const detailRes = await fetchMovieDetailsApi(item.videos_id);
        const mv = detailRes?.movie;
        if (mv?.thumbnail_url || mv?.poster_url) {
          remoteImg = mv.thumbnail_url || mv.poster_url;
          remoteByVideo.set(item.videos_id, {
            poster: mv.poster_url || remoteImg,
            thumb: mv.thumbnail_url || remoteImg,
          });
          if (!item.poster_url && mv.poster_url) patch.poster_url = mv.poster_url;
          if (!item.thumbnail_url && mv.thumbnail_url) patch.thumbnail_url = mv.thumbnail_url;
        }
      } catch {}
    }

    if (!remoteImg || !/^https?:\/\//i.test(remoteImg)) continue;

    try {
      await ensureDir(itemDir);
      const dl = await FileSystem.downloadAsync(remoteImg, posterDest, {
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      });
      if (dl && dl.status < 400 && (await isValidPosterFile(posterDest))) {
        patch.local_poster_uri = posterDest;
        if (item.videos_id && !validLocalByVideo.has(item.videos_id)) {
          validLocalByVideo.set(item.videos_id, posterDest);
        }
        updateItemInMemory(item.id, patch, true);
      } else {
        await FileSystem.deleteAsync(posterDest, { idempotent: true }).catch(() => {});
      }
    } catch {}
  }
}

export async function loadOfflineDownloads(): Promise<OfflineDownloadItem[]> {
  if (initialized) {
    return [...cachedItems];
  }
  let indexMutated = false;
  try {
    await ensureDir(OFFLINE_DIR);
    if (FileSystem.documentDirectory) {
      const info = await FileSystem.getInfoAsync(INDEX_FILE);
      if (info.exists) {
        const raw = await FileSystem.readAsStringAsync(INDEX_FILE);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cachedItems = parsed.map((rawItem) => {
            const item = { ...rawItem } as OfflineDownloadItem;
            if (!item.relative_entry && item.local_uri) {
              const idx = item.local_uri.indexOf('dva_offline/');
              if (idx >= 0) {
                item.relative_entry = item.local_uri.substring(idx + 'dva_offline/'.length);
              } else {
                const baseName = item.local_uri.split('/').pop();
                if (baseName) item.relative_entry = baseName;
              }
            }
            // Re-anchor all sandbox URIs against current container Documents UUID
            const nextDir = item.local_dir
              ? reanchorOfflineUri(item.local_dir)
              : `${OFFLINE_DIR}${item.id}/`;
            const normDir = nextDir.endsWith('/') ? nextDir : `${nextDir}/`;
            if (normDir !== item.local_dir) {
              item.local_dir = normDir;
              indexMutated = true;
            }
            if (item.local_uri) {
              const nextUri = reanchorOfflineUri(item.local_uri);
              if (nextUri !== item.local_uri) {
                item.local_uri = nextUri;
                indexMutated = true;
              }
            } else if (item.relative_entry) {
              item.local_uri = `${OFFLINE_DIR}${item.relative_entry.replace(/^\/+/, '')}`;
              indexMutated = true;
            }
            if (item.local_poster_uri) {
              const nextPoster = reanchorOfflineUri(item.local_poster_uri);
              if (nextPoster !== item.local_poster_uri) {
                item.local_poster_uri = nextPoster;
                indexMutated = true;
              }
            }
            if (Array.isArray(item.subtitles) && item.subtitles.length > 0) {
              item.subtitles = item.subtitles.map((sub) => {
                const nextSubUri = sub.local_uri
                  ? reanchorOfflineUri(sub.local_uri)
                  : sub.relative_path
                    ? `${OFFLINE_DIR}${sub.relative_path.replace(/^\/+/, '')}`
                    : '';
                if (nextSubUri && nextSubUri !== sub.local_uri) {
                  indexMutated = true;
                  return { ...sub, local_uri: nextSubUri };
                }
                return sub;
              });
            }
            if (!item.media_format && item.local_uri) {
              item.media_format = item.local_uri.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4';
            }
            if (item.status === 'downloading' || item.status === 'preparing') {
              item.status = 'paused';
              item.status_text = 'Đã tạm dừng';
            } else if (item.status === 'queued') {
              if (!downloadQueue.includes(item.id)) {
                downloadQueue.push(item.id);
              }
            }
            return item;
          });
        }
      }
    }
  } catch {
    cachedItems = [];
  }
  const cleaned = await sanitizeCorruptedOfflineItems(cachedItems);
  cachedItems = cleaned.items;
  if (cleaned.mutated) {
    indexMutated = true;
  }
  initialized = true;
  if (indexMutated) {
    await persistIndex(cachedItems);
  }
  void repairMissingOfflinePosters(cachedItems);
  return [...cachedItems];
}

export function getOfflineDownloadsSnapshot(): OfflineDownloadItem[] {
  return [...cachedItems];
}

export function subscribeOfflineDownloads(listener: ProgressListener): () => void {
  listeners.add(listener);
  listener([...cachedItems]);
  return () => {
    listeners.delete(listener);
  };
}

function createAbortError(): Error {
  const err = new Error('DownloadPausedOrCancelled');
  err.name = 'AbortError';
  return err;
}

class DownloadRestartRequestedError extends Error {
  reason: 'stall' | 'low_speed';
  constructor(reason: 'stall' | 'low_speed') {
    super(`DownloadRestart_${reason}`);
    this.name = 'DownloadRestartRequestedError';
    this.reason = reason;
  }
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resolvePlaylistUrl(baseUrl: string, ref: string): string {
  const cleanRef = ref.trim();
  if (/^https?:\/\//i.test(cleanRef)) return cleanRef;
  try {
    return new URL(cleanRef, baseUrl).toString();
  } catch {
    if (cleanRef.startsWith('/')) {
      const m = baseUrl.match(/^(https?:\/\/[^/]+)/i);
      return m ? `${m[1]}${cleanRef}` : cleanRef;
    }
    const lastSlash = baseUrl.lastIndexOf('/');
    const baseDir = lastSlash >= 0 ? baseUrl.substring(0, lastSlash + 1) : baseUrl;
    return `${baseDir}${cleanRef}`;
  }
}

function parseExtAttributeUri(line: string): string | null {
  const m = line.match(/URI="([^"]+)"/i);
  return m && m[1] ? m[1] : null;
}

function replaceExtAttributeUri(line: string, newUri: string): string {
  return line.replace(/URI="[^"]+"/i, `URI="${newUri}"`);
}

function getFileExtensionClean(url: string, fallback = '.ts'): string {
  const noQuery = url.split('?')[0].split('#')[0];
  const m = noQuery.match(/\.(ts|m4s|mp4|aac|cmfv|cmfa)$/i);
  return m ? `.${m[1].toLowerCase()}` : fallback;
}

async function probeRemoteCandidate(
  url: string,
  kind: 'hls' | 'mp4',
  signal: AbortSignal
): Promise<boolean> {
  try {
    if (kind === 'hls') {
      const res = await fetch(url, { method: 'GET', signal });
      if (!res.ok) return false;
      const txt = await res.text();
      return txt.includes('#EXTM3U');
    }
    const head = await fetch(url, { method: 'HEAD', signal });
    if (head.ok) {
      const cl = parseInt(head.headers.get('content-length') || '0', 10);
      if (isNaN(cl) || cl > 10240) return true;
    }
    if (head.status === 405) {
      const rangeGet = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1023' },
        signal,
      });
      return rangeGet.status === 206 || rangeGet.status === 200;
    }
    return false;
  } catch {
    return false;
  }
}

interface ResolvedMediaCandidate {
  url: string;
  format: 'hls' | 'mp4';
}

async function resolveDownloadCandidates(
  item: OfflineDownloadItem,
  signal: AbortSignal
): Promise<{
  candidates: ResolvedMediaCandidate[];
  resolvedData: StreamResolvedData | null;
  serverFileKey: string;
  serverMovieTitle: string;
  serverDurationSec: number;
}> {
  let resolvedData: StreamResolvedData | null = null;
  if (item.stream_code) {
    try {
      resolvedData = await resolveStreamApi(item.stream_code, item.videos_id);
    } catch {}
  }

  const serverMovieTitle =
    resolvedData?.server_movie_title || item.server_movie_title || '';
  const serverFileKey =
    resolvedData?.server_file_key ||
    item.server_file_key ||
    (serverMovieTitle
      ? item.episode_number && item.episode_number > 0
        ? `${serverMovieTitle}.Tập.${item.episode_number}`
        : serverMovieTitle
      : '');

  const preferred = item.preferred_format || 'auto';
  const candidates: ResolvedMediaCandidate[] = [];
  let serverFormatHint: 'hls' | 'mp4' | '' = '';
  let serverDurationSec = 0;

  if (serverFileKey) {
    updateItemInMemory(item.id, {
      status: 'preparing',
      status_text: 'Đang kiểm tra nguồn trên máy chủ...',
      server_file_key: serverFileKey,
      server_movie_title: serverMovieTitle,
    });

    let triggeredCount = 0;
    let triggerExhausted = false;
    let serverReady = false;
    const maxWaitMs = 95000;
    const startPollMs = Date.now();

    while (!serverReady && !signal.aborted && Date.now() - startPollMs < maxWaitMs) {
      try {
        const fd = new FormData();
        fd.append('name_movies', serverFileKey);
        const checkRes = await fetch(CHECK_API_URL, {
          method: 'POST',
          body: fd as any,
          signal,
        });
        const resData = await checkRes.json().catch(() => null);
        if (resData && resData.status === 'success') {
          serverReady = true;
          serverFormatHint =
            resData.format === 'mp4' || resData.ext === 'mp4' ? 'mp4' : 'hls';
          if (resData.total_seconds && Number(resData.total_seconds) > 0) {
            serverDurationSec = Math.round(Number(resData.total_seconds));
          }
          break;
        }
        if (resData && resData.status === 'progress') {
          updateItemInMemory(item.id, {
            status: 'preparing',
            status_text: `Máy chủ đang xử lý: ${resData.progress || '...'}`,
          });
        } else if (!triggerExhausted && triggeredCount < 3) {
          try {
            const tfd = new FormData();
            tfd.append('name_movies', serverFileKey);
            const trigRes = await fetch(TRIGGER_DOWNLOAD_API, {
              method: 'POST',
              body: tfd as any,
              signal,
            });
            const trigData = await trigRes.json().catch(() => null);
            const st = trigData?.status || 'failed';
            if (st !== 'success' && st !== 'locked') {
              triggeredCount++;
              if (triggeredCount >= 3) triggerExhausted = true;
            }
          } catch {
            triggeredCount++;
            if (triggeredCount >= 3) triggerExhausted = true;
          }
          updateItemInMemory(item.id, {
            status: 'preparing',
            status_text: 'Đang chuẩn bị tệp phim trên máy chủ...',
          });
        }
      } catch (err: any) {
        if (signal.aborted || err?.name === 'AbortError') throw createAbortError();
      }
      await abortableSleep(3000, signal);
    }

    if (serverReady || preferred !== 'auto') {
      const shard = getShardedBaseUrl();
      const encKey = encodeURIComponent(serverFileKey);
      const hlsCandidate: ResolvedMediaCandidate = {
        url: `${shard}${encKey}/${encKey}.m3u8`,
        format: 'hls',
      };
      const mp4Candidate1: ResolvedMediaCandidate = {
        url: `${shard}${encKey}/${encKey}.mp4`,
        format: 'mp4',
      };
      const mp4Candidate2: ResolvedMediaCandidate = {
        url: `${shard}${encKey}.mp4`,
        format: 'mp4',
      };

      const wantMp4First =
        preferred === 'mp4' || (preferred === 'auto' && serverFormatHint === 'mp4');
      if (wantMp4First) {
        candidates.push(mp4Candidate1, mp4Candidate2, hlsCandidate);
      } else {
        candidates.push(hlsCandidate, mp4Candidate1, mp4Candidate2);
      }
    }
  }

  // Merge candidates from stream_resolve.php + explicit remote_url
  const resolveList: ResolvedMediaCandidate[] = [];
  const pushQuality = (q: StreamQuality) => {
    if (!q?.url || !/^https?:\/\//i.test(q.url)) return;
    if (resolveList.some((c) => c.url === q.url) || candidates.some((c) => c.url === q.url)) {
      return;
    }
    const isHls = q.type === 'hls' || /\.m3u8(\?|$)/i.test(q.url);
    resolveList.push({ url: q.url, format: isHls ? 'hls' : 'mp4' });
  };

  if (resolvedData?.qualities && Array.isArray(resolvedData.qualities)) {
    resolvedData.qualities.forEach(pushQuality);
  }
  if (resolvedData?.download_mp4_url) {
    pushQuality({ label: 'MP4', url: resolvedData.download_mp4_url, type: 'mp4' });
  }
  if (item.remote_url && /^https?:\/\//i.test(item.remote_url)) {
    const isHls = /\.m3u8(\?|$)/i.test(item.remote_url);
    pushQuality({
      label: isHls ? 'HLS' : 'MP4',
      url: item.remote_url,
      type: isHls ? 'hls' : 'mp4',
    });
  }

  if (preferred === 'mp4') {
    resolveList.sort((a, b) => (a.format === b.format ? 0 : a.format === 'mp4' ? -1 : 1));
  } else if (preferred === 'hls') {
    resolveList.sort((a, b) => (a.format === b.format ? 0 : a.format === 'hls' ? -1 : 1));
  }
  candidates.push(...resolveList);

  return {
    candidates,
    resolvedData,
    serverFileKey,
    serverMovieTitle,
    serverDurationSec,
  };
}

async function downloadTextWithSignal(url: string, signal: AbortSignal): Promise<{ text: string; finalUrl: string }> {
  const res = await fetch(url, { method: 'GET', signal });
  if (!res.ok) {
    throw new Error(`HTTP_${res.status}`);
  }
  const text = await res.text();
  return { text, finalUrl: res.url || url };
}

async function downloadChunkWithRequestTimeout(
  url: string,
  destUri: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<FileSystem.FileSystemDownloadResult> {
  if (signal.aborted) throw createAbortError();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const task = FileSystem.createDownloadResumable(url, destUri, {
    sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
  });
  const onAbort = () => {
    task.cancelAsync().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const dlRes = await Promise.race([
      task.downloadAsync(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          task.cancelAsync().catch(() => {});
          reject(new Error(`REQUEST_TIMEOUT_${timeoutMs}`));
        }, timeoutMs);
      }),
    ]);
    if (!dlRes) throw new Error('EMPTY_DOWNLOAD_RESULT');
    return dlRes;
  } catch (err) {
    if (timedOut || signal.aborted) {
      await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

async function downloadFileChunkSafe(
  remoteUrl: string,
  destUri: string,
  minBytes: number,
  signal: AbortSignal
): Promise<number> {
  if (signal.aborted) throw createAbortError();
  let attemptUrl = remoteUrl;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (signal.aborted) throw createAbortError();
    try {
      const dlRes = await downloadWithTimeoutCompat(attemptUrl, destUri, signal);
      if (signal.aborted) {
        await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
        throw createAbortError();
      }
      if (!dlRes || dlRes.status >= 400) {
        throw new Error(`HTTP_${dlRes?.status || 0}`);
      }
      const info = await FileSystem.getInfoAsync(destUri);
      const size = info.exists && 'size' in info ? Number(info.size || 0) : 0;
      if (!info.exists || size < minBytes) {
        await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
        throw new Error(`INVALID_SIZE_${size}`);
      }
      return size;
    } catch (e: any) {
      if (signal.aborted || e?.name === 'AbortError') throw createAbortError();
      lastErr = e instanceof Error ? e : new Error(String(e));
      attemptUrl = swapToFreshShard(remoteUrl);
      await abortableSleep(450 * (attempt + 1), signal);
    }
  }
  throw lastErr || new Error('Failed to download segment');
}

function downloadWithTimeoutCompat(
  url: string,
  destUri: string,
  signal: AbortSignal
): Promise<FileSystem.FileSystemDownloadResult> {
  return downloadChunkWithRequestTimeout(url, destUri, DOWNLOAD_REQUEST_TIMEOUT_MS, signal);
}

async function downloadHlsItem(
  item: OfflineDownloadItem,
  m3u8Url: string,
  concurrency: number,
  signal: AbortSignal
): Promise<{
  localUri: string;
  localDir: string;
  relativeEntry: string;
  sizeBytes: number;
  durationSec: number;
  totalSegments: number;
  completedSegments: number;
}> {
  const itemDir = `${OFFLINE_DIR}${item.id}/`;
  const segsDir = `${itemDir}segs/`;
  await ensureDir(itemDir);
  await ensureDir(segsDir);

  let playlistUrl = m3u8Url;
  let { text: playlistText, finalUrl } = await downloadTextWithSignal(playlistUrl, signal);
  playlistUrl = finalUrl || playlistUrl;

  if (!playlistText.includes('#EXTM3U')) {
    throw new Error('InvalidM3u8');
  }

  // Handle Master Playlist -> pick highest BANDWIDTH media playlist
  if (playlistText.includes('#EXT-X-STREAM-INF')) {
    const rawLines = playlistText.split(/\r?\n/);
    let bestBw = -1;
    let bestUri = '';
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        for (let j = i + 1; j < rawLines.length; j++) {
          const nextLine = rawLines[j].trim();
          if (!nextLine) continue;
          if (!nextLine.startsWith('#')) {
            if (bw >= bestBw) {
              bestBw = bw;
              bestUri = nextLine;
            }
            break;
          }
        }
      }
    }
    if (!bestUri) throw new Error('EmptyMasterPlaylist');
    const variantUrl = resolvePlaylistUrl(playlistUrl, bestUri);
    const subRes = await downloadTextWithSignal(variantUrl, signal);
    playlistText = subRes.text;
    playlistUrl = subRes.finalUrl || variantUrl;
  }

  const lines = playlistText.split(/\r?\n/);
  const rewrittenLines: string[] = [];
  const tasks: {
    segIndex: number;
    url: string;
    destUri: string;
    relPath: string;
    minBytes: number;
  }[] = [];

  let totalDuration = 0;
  let segSeq = 0;
  let mapSeq = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      rewrittenLines.push('');
      continue;
    }

    if (trimmed.startsWith('#EXTINF:')) {
      const m = trimmed.match(/#EXTINF:([\d.]+)/);
      if (m) totalDuration += parseFloat(m[1]) || 0;
      rewrittenLines.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-KEY')) {
      const keyUriRaw = parseExtAttributeUri(trimmed);
      if (keyUriRaw) {
        const keyRel = 'enc.key';
        tasks.push({
          segIndex: -1,
          url: resolvePlaylistUrl(playlistUrl, keyUriRaw),
          destUri: `${itemDir}${keyRel}`,
          relPath: keyRel,
          minBytes: 1,
        });
        rewrittenLines.push(replaceExtAttributeUri(trimmed, keyRel));
        continue;
      }
      rewrittenLines.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-MAP')) {
      const mapUriRaw = parseExtAttributeUri(trimmed);
      if (mapUriRaw) {
        const mapRel = `segs/init_${mapSeq++}.mp4`;
        tasks.push({
          segIndex: -1,
          url: resolvePlaylistUrl(playlistUrl, mapUriRaw),
          destUri: `${itemDir}${mapRel}`,
          relPath: mapRel,
          minBytes: 32,
        });
        rewrittenLines.push(replaceExtAttributeUri(trimmed, mapRel));
        continue;
      }
      rewrittenLines.push(trimmed);
      continue;
    }

    if (trimmed.startsWith('#')) {
      rewrittenLines.push(trimmed);
      continue;
    }

    const remoteSegUrl = resolvePlaylistUrl(playlistUrl, trimmed);
    const ext = getFileExtensionClean(remoteSegUrl, '.ts');
    const relPath = `segs/seg_${String(segSeq).padStart(5, '0')}${ext}`;
    tasks.push({
      segIndex: segSeq,
      url: remoteSegUrl,
      destUri: `${itemDir}${relPath}`,
      relPath,
      minBytes: 64,
    });
    segSeq++;
    rewrittenLines.push(relPath);
  }

  const totalSegments = tasks.length;
  if (totalSegments === 0) {
    throw new Error('NoHlsSegments');
  }

  let nextIdx = 0;
  let completedCount = 0;
  let downloadedBytes = 0;
  let sessionBytes = 0;
  const startedAt = Date.now();
  let lastNotifyAt = 0;
  let lastProgressAt = startedAt;
  let lastWindowAt = startedAt;
  let lastWindowBytes = 0;
  let lowSpeedSince = 0;
  let restartReason: 'stall' | 'low_speed' | null = null;

  const attemptController = new AbortController();
  const onParentAbort = () => attemptController.abort();
  if (signal.aborted) {
    attemptController.abort();
  } else {
    signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const workerCount = Math.max(1, Math.min(6, concurrency || 3, totalSegments));

  updateItemInMemory(item.id, {
    status: 'downloading',
    media_format: 'hls',
    total_segments: totalSegments,
    completed_segments: 0,
    progress: 0,
    status_text: `Đang tải (0/${totalSegments})`,
  });

  const emitProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastNotifyAt < 450 && completedCount < totalSegments) return;
    lastNotifyAt = now;
    const elapsedSec = Math.max(0.25, (now - startedAt) / 1000);
    const speedMbps = sessionBytes / (1024 * 1024) / elapsedSec;
    const pct = Math.min(99, Math.round((completedCount / totalSegments) * 100));
    updateItemInMemory(item.id, {
      status: 'downloading',
      media_format: 'hls',
      progress: pct,
      size_bytes: downloadedBytes,
      total_segments: totalSegments,
      completed_segments: completedCount,
      status_text: `Đang tải ${pct}% • ${speedMbps.toFixed(1)} MB/s (${completedCount}/${totalSegments})`,
    });
  };

  const watchdogTimer = setInterval(() => {
    if (
      !activeOfflinePolicy.antiStallEnabled ||
      signal.aborted ||
      attemptController.signal.aborted
    ) {
      return;
    }
    const now = Date.now();
    if (now - lastProgressAt >= DOWNLOAD_WATCHDOG_TIMEOUT_MS) {
      restartReason = 'stall';
      attemptController.abort();
      return;
    }
    if (now - startedAt > 10000) {
      const winSec = (now - lastWindowAt) / 1000;
      if (winSec >= 3) {
        const deltaBytes = sessionBytes - lastWindowBytes;
        const bps = deltaBytes / winSec;
        lastWindowAt = now;
        lastWindowBytes = sessionBytes;
        if (bps < DOWNLOAD_LOW_SPEED_THRESHOLD_BPS) {
          if (lowSpeedSince === 0) lowSpeedSince = now;
          else if (now - lowSpeedSince >= DOWNLOAD_LOW_SPEED_DURATION_MS) {
            restartReason = 'low_speed';
            attemptController.abort();
          }
        } else {
          lowSpeedSince = 0;
        }
      }
    }
  }, 1000);

  try {
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIdx < totalSegments) {
        if (signal.aborted) throw createAbortError();
        if (attemptController.signal.aborted) {
          if (restartReason) throw new DownloadRestartRequestedError(restartReason);
          throw createAbortError();
        }
        const idx = nextIdx++;
        const t = tasks[idx];

        // Reuse already-downloaded segment on resume
        try {
          const exist = await FileSystem.getInfoAsync(t.destUri);
          const existSize = exist.exists && 'size' in exist ? Number(exist.size || 0) : 0;
          if (exist.exists && existSize >= t.minBytes) {
            downloadedBytes += existSize;
            completedCount++;
            lastProgressAt = Date.now();
            emitProgress();
            continue;
          }
        } catch {}

        const segBytes = await downloadFileChunkSafe(
          t.url,
          t.destUri,
          t.minBytes,
          attemptController.signal
        );
        downloadedBytes += segBytes;
        sessionBytes += segBytes;
        completedCount++;
        lastProgressAt = Date.now();
        emitProgress();
      }
    });

    await Promise.all(workers);
  } catch (err: any) {
    if (!signal.aborted && restartReason) {
      throw new DownloadRestartRequestedError(restartReason);
    }
    throw err;
  } finally {
    clearInterval(watchdogTimer);
    signal.removeEventListener('abort', onParentAbort);
  }

  if (signal.aborted) throw createAbortError();

  // Verify every segment exists on disk before writing playlist
  for (const t of tasks) {
    const info = await FileSystem.getInfoAsync(t.destUri);
    const sz = info.exists && 'size' in info ? Number(info.size || 0) : 0;
    if (!info.exists || sz < t.minBytes) {
      throw new Error(`MissingSegment_${t.relPath}`);
    }
  }

  const localPlaylistUri = `${itemDir}index.m3u8`;
  await FileSystem.writeAsStringAsync(localPlaylistUri, rewrittenLines.join('\n'));

  return {
    localUri: localPlaylistUri,
    localDir: itemDir,
    relativeEntry: `${item.id}/index.m3u8`,
    sizeBytes: downloadedBytes,
    durationSec: Math.round(totalDuration),
    totalSegments,
    completedSegments: completedCount,
  };
}

async function downloadMp4Item(
  item: OfflineDownloadItem,
  mp4Url: string,
  signal: AbortSignal
): Promise<{
  localUri: string;
  localDir: string;
  relativeEntry: string;
  sizeBytes: number;
}> {
  const itemDir = `${OFFLINE_DIR}${item.id}/`;
  await ensureDir(itemDir);
  const localVideoUri = `${itemDir}video.mp4`;

  let attemptUrl = mp4Url;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    if (signal.aborted) throw createAbortError();
    let lastUpdateMs = 0;
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let lastWindowAt = startedAt;
    let lastWindowBytes = 0;
    let totalWritten = 0;
    let lowSpeedSince = 0;
    let watchdogReason: 'stall' | 'low_speed' | null = null;

    const resumable = FileSystem.createDownloadResumable(
      attemptUrl,
      localVideoUri,
      { sessionType: FileSystem.FileSystemSessionType.FOREGROUND },
      (dp) => {
        if (signal.aborted) return;
        const now = Date.now();
        if (dp.totalBytesWritten > totalWritten) {
          totalWritten = dp.totalBytesWritten;
          lastProgressAt = now;
        }
        if (now - lastUpdateMs < 450 && dp.totalBytesWritten < dp.totalBytesExpectedToWrite) {
          return;
        }
        lastUpdateMs = now;
        const pct =
          dp.totalBytesExpectedToWrite > 0
            ? Math.min(99, Math.round((dp.totalBytesWritten / dp.totalBytesExpectedToWrite) * 100))
            : 0;
        const elapsed = Math.max(0.25, (now - startedAt) / 1000);
        const speedMbps = dp.totalBytesWritten / (1024 * 1024) / elapsed;
        updateItemInMemory(item.id, {
          status: 'downloading',
          media_format: 'mp4',
          progress: pct,
          size_bytes: dp.totalBytesWritten,
          status_text: `Đang tải ${pct}% • ${speedMbps.toFixed(1)} MB/s`,
        });
      }
    );

    activeResumables.set(item.id, resumable);
    const onAbort = () => {
      resumable.pauseAsync().catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const watchdogTimer = setInterval(() => {
      if (!activeOfflinePolicy.antiStallEnabled || signal.aborted || watchdogReason) {
        return;
      }
      const now = Date.now();
      if (now - lastProgressAt >= DOWNLOAD_WATCHDOG_TIMEOUT_MS) {
        watchdogReason = 'stall';
        resumable.cancelAsync().catch(() => {});
        return;
      }
      if (now - startedAt > 10000) {
        const winSec = (now - lastWindowAt) / 1000;
        if (winSec >= 3) {
          const delta = totalWritten - lastWindowBytes;
          const bps = delta / winSec;
          lastWindowAt = now;
          lastWindowBytes = totalWritten;
          if (bps < DOWNLOAD_LOW_SPEED_THRESHOLD_BPS) {
            if (lowSpeedSince === 0) lowSpeedSince = now;
            else if (now - lowSpeedSince >= DOWNLOAD_LOW_SPEED_DURATION_MS) {
              watchdogReason = 'low_speed';
              resumable.cancelAsync().catch(() => {});
            }
          } else {
            lowSpeedSince = 0;
          }
        }
      }
    }, 1000);

    try {
      const res = await resumable.downloadAsync();
      clearInterval(watchdogTimer);
      activeResumables.delete(item.id);
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) throw createAbortError();
      if (watchdogReason) throw new DownloadRestartRequestedError(watchdogReason);
      if (!res || res.status >= 400) {
        throw new Error(`HTTP_${res?.status || 0}`);
      }
      const fInfo = await FileSystem.getInfoAsync(localVideoUri);
      const sz = fInfo.exists && 'size' in fInfo ? Number(fInfo.size || 0) : 0;
      if (!fInfo.exists || sz < 10240) {
        await FileSystem.deleteAsync(localVideoUri, { idempotent: true }).catch(() => {});
        throw new Error(`INVALID_MP4_SIZE_${sz}`);
      }
      return {
        localUri: res.uri || localVideoUri,
        localDir: itemDir,
        relativeEntry: `${item.id}/video.mp4`,
        sizeBytes: sz,
      };
    } catch (err: any) {
      clearInterval(watchdogTimer);
      activeResumables.delete(item.id);
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted || err?.name === 'AbortError') throw createAbortError();
      if (watchdogReason) {
        throw new DownloadRestartRequestedError(watchdogReason);
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
      attemptUrl = swapToFreshShard(mp4Url);
      await abortableSleep(800 * (attempt + 1), signal);
    }
  }

  throw lastErr || new Error('Không thể tải dữ liệu phim ngoại tuyến.');
}

async function downloadSubtitlesAndPoster(
  item: OfflineDownloadItem,
  resolvedData: StreamResolvedData | null,
  serverFileKey: string
): Promise<{
  subtitles: OfflineSubtitleTrack[];
  localPosterUri?: string;
  resolvedPosterUrl?: string;
  resolvedThumbnailUrl?: string;
}> {
  const itemDir = `${OFFLINE_DIR}${item.id}/`;
  await ensureDir(itemDir);

  const subtitles: OfflineSubtitleTrack[] = [];
  const subCandidates: StreamSubtitle[] = [];

  if (resolvedData?.subtitles && resolvedData.subtitles.length > 0) {
    subCandidates.push(...resolvedData.subtitles);
  }
  if (serverFileKey) {
    const vnUrl = constructSubtitleUrl(serverFileKey, 'vn');
    const enUrl = constructSubtitleUrl(serverFileKey, 'en');
    if (!subCandidates.some((s) => s.lang === 'vi' || s.lang === 'vn')) {
      subCandidates.push({ label: 'Tiếng Việt', url: vnUrl, lang: 'vi' });
    }
    if (!subCandidates.some((s) => s.lang === 'en')) {
      subCandidates.push({ label: 'English', url: enUrl, lang: 'en' });
    }
  }

  const seenLangs = new Set<string>();
  for (const sub of subCandidates) {
    if (!sub?.url) continue;
    const normLang = sub.lang === 'vn' ? 'vi' : sub.lang || 'vi';
    if (seenLangs.has(normLang)) continue;
    const relPath = `${item.id}/sub_${normLang}.vtt`;
    const destUri = `${OFFLINE_DIR}${relPath}`;
    try {
      const res = await FileSystem.downloadAsync(sub.url, destUri, {
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      });
      if (res && res.status < 400) {
        const content = await FileSystem.readAsStringAsync(destUri);
        if (content && (content.includes('WEBVTT') || content.includes('-->'))) {
          seenLangs.add(normLang);
          subtitles.push({
            lang: normLang,
            label: sub.label || (normLang === 'en' ? 'English' : 'Tiếng Việt'),
            local_uri: destUri,
            relative_path: relPath,
          });
        } else {
          await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
        }
      } else {
        await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
      }
    } catch {
      await FileSystem.deleteAsync(destUri, { idempotent: true }).catch(() => {});
    }
  }

  const sibling = cachedItems.find(
    (s) => s.id !== item.id && s.videos_id === item.videos_id && (s.thumbnail_url || s.poster_url || s.local_poster_uri)
  );
  let resolvedPosterUrl =
    item.poster_url || resolvedData?.movie?.poster_url || sibling?.poster_url || '';
  let resolvedThumbnailUrl =
    item.thumbnail_url || resolvedData?.movie?.thumbnail_url || sibling?.thumbnail_url || resolvedPosterUrl;

  if (!resolvedThumbnailUrl && !resolvedPosterUrl && item.videos_id > 0) {
    try {
      const detailRes = await fetchMovieDetailsApi(item.videos_id);
      const mv = detailRes?.movie;
      if (mv?.poster_url || mv?.thumbnail_url) {
        resolvedPosterUrl = mv.poster_url || mv.thumbnail_url || '';
        resolvedThumbnailUrl = mv.thumbnail_url || mv.poster_url || '';
      }
    } catch {}
  }

  let localPosterUri: string | undefined;
  const imgUrl = resolvedThumbnailUrl || resolvedPosterUrl;
  const posterDest = `${itemDir}poster.jpg`;
  if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
    try {
      const pRes = await FileSystem.downloadAsync(imgUrl, posterDest, {
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      });
      if (pRes && pRes.status < 400 && (await isValidPosterFile(posterDest))) {
        localPosterUri = posterDest;
      } else {
        await FileSystem.deleteAsync(posterDest, { idempotent: true }).catch(() => {});
      }
    } catch {
      await FileSystem.deleteAsync(posterDest, { idempotent: true }).catch(() => {});
    }
  }

  if (!localPosterUri && sibling?.local_poster_uri && (await isValidPosterFile(sibling.local_poster_uri))) {
    try {
      await FileSystem.copyAsync({ from: sibling.local_poster_uri, to: posterDest });
      if (await isValidPosterFile(posterDest)) {
        localPosterUri = posterDest;
      }
    } catch {}
  }

  return { subtitles, localPosterUri, resolvedPosterUrl, resolvedThumbnailUrl };
}

async function processSingleItem(id: string): Promise<void> {
  const item = cachedItems.find((i) => i.id === id);
  if (!item) return;

  const controller = new AbortController();
  activeControllers.set(id, controller);
  currentDownloadingId = id;

  try {
    let completedResult: {
      chosen: ResolvedMediaCandidate;
      resolvedData: StreamResolvedData | null;
      serverFileKey: string;
      serverDurationSec: number;
      completedMedia: {
        localUri: string;
        localDir: string;
        relativeEntry: string;
        sizeBytes: number;
        durationSec?: number;
        totalSegments?: number;
        completedSegments?: number;
      };
    } | null = null;

    for (let restartAttempt = 0; restartAttempt <= DOWNLOAD_MAX_AUTO_RESTARTS; restartAttempt++) {
      if (controller.signal.aborted) throw createAbortError();
      updateItemInMemory(id, {
        status: 'preparing',
        status_text:
          restartAttempt > 0
            ? `Đang khởi động lại liên kết tải (${restartAttempt}/${DOWNLOAD_MAX_AUTO_RESTARTS})...`
            : 'Đang chuẩn bị liên kết tải...',
        error_message: undefined,
      });

      const {
        candidates,
        resolvedData,
        serverFileKey,
        serverMovieTitle,
        serverDurationSec,
      } = await resolveDownloadCandidates(item, controller.signal);

      if (controller.signal.aborted) throw createAbortError();
      if (candidates.length === 0) {
        throw new Error('Nguồn phim này hiện chỉ hỗ trợ phát trực tuyến.');
      }

      let chosen: ResolvedMediaCandidate | null = null;
      for (const c of candidates) {
        if (controller.signal.aborted) throw createAbortError();
        const ok = await probeRemoteCandidate(c.url, c.format, controller.signal);
        if (ok) {
          chosen = c;
          break;
        }
      }
      if (!chosen) {
        chosen = candidates[0];
      }

      updateItemInMemory(id, {
        status: 'downloading',
        media_format: chosen.format,
        remote_url: chosen.url,
        server_file_key: serverFileKey || item.server_file_key,
        server_movie_title: serverMovieTitle || item.server_movie_title,
        skip_intro_sec: resolvedData?.skip_intro_sec ?? item.skip_intro_sec ?? 0,
        end_credits_sec: resolvedData?.end_credits_sec ?? item.end_credits_sec ?? 0,
      });

      try {
        let completedMedia;
        if (chosen.format === 'hls') {
          completedMedia = await downloadHlsItem(
            item,
            chosen.url,
            workerConcurrencyPref,
            controller.signal
          );
        } else {
          completedMedia = await downloadMp4Item(item, chosen.url, controller.signal);
        }
        completedResult = {
          chosen,
          resolvedData,
          serverFileKey,
          serverDurationSec,
          completedMedia,
        };
        break;
      } catch (primaryErr: any) {
        if (controller.signal.aborted || primaryErr?.name === 'AbortError') {
          throw primaryErr;
        }
        if (
          primaryErr?.name === 'DownloadRestartRequestedError' &&
          restartAttempt < DOWNLOAD_MAX_AUTO_RESTARTS
        ) {
          await abortableSleep(1200, controller.signal);
          continue;
        }
        // Fallback to another candidate (e.g. MP4 <-> HLS) if available
        const alternate = candidates.find((c) => c.url !== chosen!.url);
        if (!alternate) throw primaryErr;
        updateItemInMemory(id, {
          status: 'preparing',
          status_text: 'Đang chuyển nguồn tải...',
        });
        try {
          let completedMedia;
          if (alternate.format === 'hls') {
            completedMedia = await downloadHlsItem(
              item,
              alternate.url,
              workerConcurrencyPref,
              controller.signal
            );
          } else {
            completedMedia = await downloadMp4Item(item, alternate.url, controller.signal);
          }
          completedResult = {
            chosen: alternate,
            resolvedData,
            serverFileKey,
            serverDurationSec,
            completedMedia,
          };
          break;
        } catch (altErr: any) {
          if (
            altErr?.name === 'DownloadRestartRequestedError' &&
            restartAttempt < DOWNLOAD_MAX_AUTO_RESTARTS
          ) {
            await abortableSleep(1200, controller.signal);
            continue;
          }
          throw altErr;
        }
      }
    }

    if (!completedResult) {
      throw new Error('Không thể hoàn tất tải phim sau nhiều lần khởi động lại liên kết.');
    }
    const { chosen, resolvedData, serverFileKey, serverDurationSec, completedMedia } =
      completedResult;

    if (controller.signal.aborted) throw createAbortError();

    updateItemInMemory(id, {
      status: 'preparing',
      progress: 99,
      status_text: 'Đang tải phụ đề & ảnh bìa ngoại tuyến...',
    });

    const { subtitles, localPosterUri, resolvedPosterUrl, resolvedThumbnailUrl } =
      await downloadSubtitlesAndPoster(item, resolvedData, serverFileKey);

    const latestItem = cachedItems.find((x) => x.id === id) || item;
    const finalized: OfflineDownloadItem = {
      ...latestItem,
      media_format: chosen.format,
      remote_url: chosen.url,
      local_uri: completedMedia.localUri,
      local_dir: completedMedia.localDir,
      relative_entry: completedMedia.relativeEntry,
      poster_url: resolvedPosterUrl || latestItem.poster_url,
      thumbnail_url: resolvedThumbnailUrl || latestItem.thumbnail_url,
      local_poster_uri: localPosterUri || latestItem.local_poster_uri,
      subtitles,
      size_bytes: completedMedia.sizeBytes,
      duration_sec:
        completedMedia.durationSec || serverDurationSec || latestItem.duration_sec || 0,
      skip_intro_sec: resolvedData?.skip_intro_sec ?? latestItem.skip_intro_sec ?? 0,
      end_credits_sec: resolvedData?.end_credits_sec ?? latestItem.end_credits_sec ?? 0,
      total_segments: completedMedia.totalSegments,
      completed_segments: completedMedia.completedSegments,
      progress: 100,
      status: 'completed',
      status_text: 'Sẵn sàng',
      error_message: undefined,
      updated_at: new Date().toISOString(),
    };

    await persistIndex(cachedItems.map((it) => (it.id === id ? finalized : it)));
    void enforceOfflineRetentionPolicy();
  } catch (err: any) {
    const latest = cachedItems.find((i) => i.id === id);
    if (!latest) return;
    if (pendingManualRestartIds.delete(id)) {
      updateItemInMemory(
        id,
        {
          status: 'queued',
          status_text: 'Đang khởi động lại liên kết tải...',
          error_message: undefined,
        },
        true
      );
      if (!downloadQueue.includes(id)) {
        downloadQueue.unshift(id);
      }
      return;
    }
    if (controller.signal.aborted || err?.name === 'AbortError') {
      if (latest.status === 'paused') {
        await persistIndex(cachedItems);
      }
    } else {
      await persistIndex(
        cachedItems.map((it) =>
          it.id === id
            ? {
                ...it,
                status: 'failed',
                status_text: 'Tải thất bại',
                error_message: err?.message || 'Không thể tải video ngoại tuyến.',
                updated_at: new Date().toISOString(),
              }
            : it
        )
      );
    }
  } finally {
    pendingManualRestartIds.delete(id);
    activeControllers.delete(id);
    activeResumables.delete(id);
    if (currentDownloadingId === id) {
      currentDownloadingId = null;
    }
  }
}

async function processDownloadQueue(): Promise<void> {
  if (isProcessingQueue) {
    syncBackgroundDownloadGuard();
    return;
  }
  isProcessingQueue = true;
  syncBackgroundDownloadGuard();
  try {
    while (downloadQueue.length > 0) {
      const nextId = downloadQueue.shift();
      if (!nextId) continue;
      const target = cachedItems.find((i) => i.id === nextId);
      if (!target || target.status === 'completed' || target.status === 'paused') {
        continue;
      }
      await processSingleItem(nextId);
      syncBackgroundDownloadGuard();
    }
  } finally {
    isProcessingQueue = false;
    syncBackgroundDownloadGuard();
  }
}

export async function resumeBackgroundQueueIfNeeded(): Promise<void> {
  await loadOfflineDownloads();
  let hasQueued = false;
  for (const it of cachedItems) {
    if (it.status === 'queued') {
      hasQueued = true;
      if (!downloadQueue.includes(it.id)) {
        downloadQueue.push(it.id);
      }
    }
  }
  if (hasQueued && !isProcessingQueue) {
    syncBackgroundDownloadGuard();
    void processDownloadQueue();
  } else {
    syncBackgroundDownloadGuard();
  }
}

export async function enqueueOfflineDownload(
  params: OfflineEnqueueParams
): Promise<OfflineDownloadItem> {
  setNativeBackgroundDownloadActive(true);
  await loadOfflineDownloads();
  await ensureDir(OFFLINE_DIR);

  if (typeof params.concurrency === 'number' && params.concurrency > 0) {
    workerConcurrencyPref = Math.max(1, Math.min(6, Math.round(params.concurrency)));
  }

  const id = buildDownloadId(params);
  const existing = cachedItems.find((i) => i.id === id);

  if (existing && existing.status === 'completed') {
    const info = await FileSystem.getInfoAsync(existing.local_uri);
    if (info.exists) {
      return existing;
    }
  }

  if (
    existing &&
    (existing.status === 'downloading' ||
      existing.status === 'preparing' ||
      existing.status === 'queued')
  ) {
    return existing;
  }

  const epNum =
    params.episode_number && params.episode_number > 0
      ? params.episode_number
      : extractEpisodeNumberFromName(params.episode_title);

  const itemDir = `${OFFLINE_DIR}${id}/`;
  const newItem: OfflineDownloadItem = {
    id,
    videos_id: params.videos_id,
    episode_id: params.episode_id || 0,
    episode_number: epNum || undefined,
    stream_code: params.stream_code,
    title: params.title,
    episode_title: params.episode_title,
    server_movie_title: params.server_movie_title,
    server_file_key: params.server_file_key,
    preferred_format: params.preferred_format || 'auto',
    poster_url: params.poster_url,
    thumbnail_url: params.thumbnail_url,
    local_uri: existing?.local_uri || `${itemDir}index.m3u8`,
    local_dir: itemDir,
    relative_entry: existing?.relative_entry,
    remote_url: params.remote_url || existing?.remote_url || '',
    size_bytes: existing?.size_bytes || 0,
    progress: existing?.status === 'paused' ? existing.progress : 0,
    status: 'queued',
    status_text: 'Đang chờ trong hàng đợi...',
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await persistIndex([newItem, ...cachedItems.filter((i) => i.id !== id)]);
  if (!downloadQueue.includes(id)) {
    downloadQueue.push(id);
  }
  syncBackgroundDownloadGuard();
  void processDownloadQueue();
  return newItem;
}

export async function enqueueEpisodeBatch(
  requests: OfflineEnqueueParams[]
): Promise<OfflineDownloadItem[]> {
  await loadOfflineDownloads();
  await ensureDir(OFFLINE_DIR);

  const queuedResults: OfflineDownloadItem[] = [];
  for (const req of requests) {
    if (!req.stream_code) continue;
    const item = await enqueueOfflineDownload(req);
    queuedResults.push(item);
  }
  return queuedResults;
}

/**
 * Backward-compatible alias used by earlier callers.
 */
export async function startOfflineDownload(
  params: OfflineEnqueueParams
): Promise<OfflineDownloadItem> {
  return enqueueOfflineDownload(params);
}

export async function pauseOfflineDownload(id: string): Promise<void> {
  await loadOfflineDownloads();
  const qIdx = downloadQueue.indexOf(id);
  if (qIdx >= 0) downloadQueue.splice(qIdx, 1);

  updateItemInMemory(id, { status: 'paused', status_text: 'Đã tạm dừng' }, true);

  const ctrl = activeControllers.get(id);
  if (ctrl) ctrl.abort();
  const res = activeResumables.get(id);
  if (res) {
    try {
      await res.pauseAsync();
    } catch {}
  }
  syncBackgroundDownloadGuard();
}

export async function resumeOfflineDownload(id: string): Promise<void> {
  setNativeBackgroundDownloadActive(true);
  await loadOfflineDownloads();
  const item = cachedItems.find((i) => i.id === id);
  if (!item || item.status === 'completed') return;
  if (
    item.status === 'downloading' ||
    item.status === 'preparing' ||
    item.status === 'queued'
  ) {
    return;
  }

  updateItemInMemory(
    id,
    { status: 'queued', status_text: 'Đang tiếp tục tải...', error_message: undefined },
    true
  );
  if (!downloadQueue.includes(id)) {
    downloadQueue.push(id);
  }
  syncBackgroundDownloadGuard();
  void processDownloadQueue();
}

export async function restartOfflineDownload(id: string): Promise<void> {
  setNativeBackgroundDownloadActive(true);
  await loadOfflineDownloads();
  const item = cachedItems.find((i) => i.id === id);
  if (!item || item.status === 'completed') return;

  const isRunning =
    activeControllers.has(id) || activeResumables.has(id) || currentDownloadingId === id;
  if (isRunning) {
    pendingManualRestartIds.add(id);
    updateItemInMemory(id, {
      status: 'preparing',
      status_text: 'Đang khởi động lại liên kết tải...',
      error_message: undefined,
    });
    const ctrl = activeControllers.get(id);
    if (ctrl) ctrl.abort();
    const task = activeResumables.get(id);
    if (task) {
      try {
        await task.cancelAsync();
      } catch {}
    }
    syncBackgroundDownloadGuard();
    return;
  }

  updateItemInMemory(
    id,
    {
      status: 'queued',
      status_text: 'Đang khởi động lại liên kết tải...',
      error_message: undefined,
    },
    true
  );
  if (!downloadQueue.includes(id)) {
    downloadQueue.unshift(id);
  }
  syncBackgroundDownloadGuard();
  void processDownloadQueue();
}

export async function enforceOfflineRetentionPolicy(
  policyOverride?: Partial<OfflineRetentionPolicy>
): Promise<{ deletedCount: number; freedBytes: number }> {
  if (policyOverride) {
    setOfflineRuntimePolicy(policyOverride);
  }
  if (enforcingPolicyPromise) {
    return enforcingPolicyPromise;
  }
  enforcingPolicyPromise = (async () => {
    let deletedCount = 0;
    let freedBytes = 0;
    try {
      await loadOfflineDownloads();
      const now = Date.now();
      const getItemTimestamp = (it: OfflineDownloadItem): number => {
        const isoTs = Date.parse(it.updated_at || it.created_at || '');
        const validIso = Number.isFinite(isoTs) ? isoTs : 0;
        return Math.max(Number(it.resume_updated_at || 0), validIso);
      };

      // Pass 1: Age-based auto deletion (3 days .. 3 months)
      if (activeOfflinePolicy.autoDeleteEnabled) {
        const maxAgeMs = activeOfflinePolicy.autoDeleteDays * 24 * 60 * 60 * 1000;
        const expired = cachedItems.filter((it) => {
          if (it.status !== 'completed') return false;
          const ts = getItemTimestamp(it);
          return ts > 0 && now - ts >= maxAgeMs;
        });
        for (const it of expired) {
          freedBytes += Math.max(0, Number(it.size_bytes || 0));
          await removeOfflineDownload(it.id);
          deletedCount++;
        }
      }

      // Pass 2: Storage quota limit (10 GB .. 100 GB), oldest-first eviction
      const limitBytes = activeOfflinePolicy.storageLimitGb * 1024 * 1024 * 1024;
      const completedSorted = cachedItems
        .filter((it) => it.status === 'completed')
        .sort((a, b) => getItemTimestamp(a) - getItemTimestamp(b));

      let totalBytes = completedSorted.reduce(
        (acc, it) => acc + Math.max(0, Number(it.size_bytes || 0)),
        0
      );
      for (const oldest of completedSorted) {
        if (totalBytes <= limitBytes) break;
        const sz = Math.max(0, Number(oldest.size_bytes || 0));
        await removeOfflineDownload(oldest.id);
        totalBytes -= sz;
        freedBytes += sz;
        deletedCount++;
      }
    } catch {} finally {
      enforcingPolicyPromise = null;
    }
    return { deletedCount, freedBytes };
  })();
  return enforcingPolicyPromise;
}

export async function retryOfflineDownload(id: string): Promise<void> {
  return resumeOfflineDownload(id);
}

export async function removeOfflineDownload(id: string): Promise<void> {
  await loadOfflineDownloads();
  const qIdx = downloadQueue.indexOf(id);
  if (qIdx >= 0) downloadQueue.splice(qIdx, 1);

  const ctrl = activeControllers.get(id);
  if (ctrl) ctrl.abort();
  activeControllers.delete(id);

  const task = activeResumables.get(id);
  if (task) {
    try {
      await task.cancelAsync();
    } catch {}
    activeResumables.delete(id);
  }

  const target = cachedItems.find((i) => i.id === id);
  if (target) {
    if (target.local_dir) {
      await FileSystem.deleteAsync(target.local_dir, { idempotent: true }).catch(() => {});
    }
    const itemFolder = `${OFFLINE_DIR}${id}/`;
    await FileSystem.deleteAsync(itemFolder, { idempotent: true }).catch(() => {});
    if (target.local_uri) {
      await FileSystem.deleteAsync(target.local_uri, { idempotent: true }).catch(() => {});
    }
  }
  await persistIndex(cachedItems.filter((i) => i.id !== id));
  syncBackgroundDownloadGuard();
}

export async function cancelOfflineDownload(id: string): Promise<void> {
  return removeOfflineDownload(id);
}

export async function clearAllOfflineDownloads(): Promise<void> {
  await loadOfflineDownloads();
  downloadQueue.length = 0;
  for (const [, ctrl] of activeControllers) {
    ctrl.abort();
  }
  activeControllers.clear();
  for (const [, task] of activeResumables) {
    try {
      await task.cancelAsync();
    } catch {}
  }
  activeResumables.clear();
  try {
    const info = await FileSystem.getInfoAsync(OFFLINE_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(OFFLINE_DIR, { idempotent: true });
    }
    await ensureDir(OFFLINE_DIR);
  } catch {}
  await persistIndex([]);
  syncBackgroundDownloadGuard();
}

const lastResumeDiskFlushById = new Map<string, number>();
let isFlushingPendingProgress = false;

export async function saveOfflineResumePosition(
  id: string,
  positionSec: number,
  durationSec?: number,
  opts?: { fromOnline?: boolean; flushDisk?: boolean }
): Promise<void> {
  if (!id || !Number.isFinite(positionSec)) return;
  await loadOfflineDownloads();
  const idx = cachedItems.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const nextResume = Math.max(0, Math.floor(positionSec));
  const nextDur =
    durationSec && durationSec > 0 ? Math.floor(durationSec) : cachedItems[idx].duration_sec;
  const now = Date.now();
  const nextPending = opts?.fromOnline ? false : true;
  cachedItems = cachedItems.map((it) =>
    it.id === id
      ? {
          ...it,
          resume_sec: nextResume,
          duration_sec: nextDur,
          resume_updated_at: now,
          resume_sync_pending: nextPending,
        }
      : it
  );
  const lastFlush = lastResumeDiskFlushById.get(id) || 0;
  if (opts?.flushDisk || now - lastFlush >= 8000) {
    lastResumeDiskFlushById.set(id, now);
    await persistIndex(cachedItems);
  } else {
    notifyListeners();
  }
}

export async function syncOnlineProgressToOffline(params: {
  streamCode?: string;
  videosId?: number;
  episodeId?: number;
  positionSec: number;
  durationSec?: number;
  flushDisk?: boolean;
}): Promise<void> {
  const pos = Math.floor(params.positionSec || 0);
  if (pos <= 2) return;
  await loadOfflineDownloads();
  const matched = cachedItems.find(
    (i) =>
      i.status === 'completed' &&
      ((params.streamCode && i.stream_code === params.streamCode) ||
        (params.videosId &&
          i.videos_id === params.videosId &&
          (!params.episodeId || i.episode_id === params.episodeId)))
  );
  if (!matched || matched.resume_sync_pending) return;
  await saveOfflineResumePosition(matched.id, pos, params.durationSec, {
    fromOnline: true,
    flushDisk: params.flushDisk,
  });
}

export async function syncOfflineItemProgressToServer(
  itemOrId: OfflineDownloadItem | string
): Promise<boolean> {
  await loadOfflineDownloads();
  const item =
    typeof itemOrId === 'string'
      ? cachedItems.find((i) => i.id === itemOrId)
      : itemOrId;
  if (
    !item ||
    !item.videos_id ||
    !item.stream_code ||
    !item.resume_sec ||
    item.resume_sec <= 2
  ) {
    return false;
  }
  try {
    const res = await saveWatchProgressApi({
      videos_id: item.videos_id,
      stream_code: item.stream_code,
      position_sec: Math.floor(item.resume_sec),
      duration_sec: Math.floor(item.duration_sec || 0),
      episode_number: item.episode_number || 0,
      title: item.title,
    });
    if (res?.success) {
      cachedItems = cachedItems.map((it) =>
        it.id === item.id ? { ...it, resume_sync_pending: false } : it
      );
      await persistIndex(cachedItems);
      return true;
    }
  } catch {}
  return false;
}

export async function flushPendingOfflineProgressToServer(): Promise<number> {
  if (isFlushingPendingProgress) return 0;
  isFlushingPendingProgress = true;
  let syncedCount = 0;
  try {
    await loadOfflineDownloads();
    const pendingItems = cachedItems.filter(
      (it) =>
        it.status === 'completed' &&
        it.resume_sync_pending === true &&
        (it.resume_sec || 0) > 2 &&
        it.videos_id > 0 &&
        Boolean(it.stream_code)
    );
    for (const item of pendingItems) {
      const ok = await syncOfflineItemProgressToServer(item);
      if (ok) syncedCount++;
    }
  } catch {} finally {
    isFlushingPendingProgress = false;
  }
  return syncedCount;
}

export async function pullOnlineProgressForOfflineItems(): Promise<number> {
  let updatedCount = 0;
  try {
    await loadOfflineDownloads();
    const candidates = cachedItems
      .filter(
        (it) =>
          it.status === 'completed' &&
          !it.resume_sync_pending &&
          Boolean(it.stream_code)
      )
      .slice(0, 100);
    if (candidates.length === 0) return 0;
    const res = await fetchBatchWatchProgressApi(
      candidates.map((it) => ({
        stream_code: it.stream_code,
        videos_id: it.videos_id,
      }))
    );
    const progMap = res?.progress;
    if (!progMap || typeof progMap !== 'object') return 0;

    let changed = false;
    const nextItems = cachedItems.map((it) => {
      if (it.status !== 'completed' || it.resume_sync_pending || !it.stream_code) {
        return it;
      }
      const srv = progMap[it.stream_code];
      if (!srv || typeof srv.resume_seconds !== 'number' || srv.resume_seconds <= 2) {
        return it;
      }
      if (Math.abs((it.resume_sec || 0) - srv.resume_seconds) < 3) {
        return it;
      }
      changed = true;
      updatedCount++;
      return {
        ...it,
        resume_sec: srv.resume_seconds,
        resume_updated_at:
          srv.updated_at && srv.updated_at > 0 ? srv.updated_at * 1000 : Date.now(),
        resume_sync_pending: false,
      };
    });
    if (changed) {
      await persistIndex(nextItems);
    }
  } catch {}
  return updatedCount;
}

export function findCompletedOfflineItem(query: {
  streamCode?: string;
  serverFileKey?: string;
  videosId?: number;
  episodeId?: number;
}): OfflineDownloadItem | null {
  const completed = cachedItems.filter((i) => i.status === 'completed');
  if (completed.length === 0) return null;

  if (query.streamCode) {
    const byCode = completed.find(
      (i) =>
        i.stream_code &&
        i.stream_code === query.streamCode &&
        (!query.videosId || !i.videos_id || i.videos_id === query.videosId)
    );
    if (byCode) return byCode;
  }
  if (query.serverFileKey) {
    const targetNorm = normalizeOfflineMatchKey(query.serverFileKey);
    const byKey = completed.find(
      (i) =>
        (!query.videosId || !i.videos_id || i.videos_id === query.videosId) &&
        (normalizeOfflineMatchKey(i.server_file_key) === targetNorm ||
          normalizeOfflineMatchKey(
            i.title + (i.episode_title ? `.Tập.${extractEpisodeNumberFromName(i.episode_title)}` : '')
          ) === targetNorm)
    );
    if (byKey) return byKey;
  }
  if (query.videosId && query.episodeId) {
    const byEp = completed.find(
      (i) => i.videos_id === query.videosId && i.episode_id === query.episodeId
    );
    if (byEp) return byEp;
  }
  if (query.videosId && !query.episodeId && !query.streamCode) {
    const bySingleMovie = completed.find(
      (i) => i.videos_id === query.videosId && !i.episode_id && !i.episode_title
    );
    if (bySingleMovie) return bySingleMovie;
  }
  return null;
}

export function buildOfflineRegistryForWebView(
  serverPort: number,
  preferOfflineWhenOnline: boolean
): OfflineWebViewRegistry {
  const enabled = Boolean(preferOfflineWhenOnline && serverPort > 0);
  const baseUrl = serverPort > 0 ? `http://127.0.0.1:${serverPort}/offline/` : '';
  const pipProxy = Boolean(serverPort > 0 && isNativePipProxySupported());
  const items: OfflineWebViewRegistryItem[] = [];

  if (serverPort > 0) {
    for (const it of cachedItems) {
      if (it.status !== 'completed') continue;
      const rel =
        it.relative_entry ||
        (it.local_uri.includes('dva_offline/')
          ? it.local_uri.substring(it.local_uri.indexOf('dva_offline/') + 'dva_offline/'.length)
          : it.local_uri.split('/').pop() || '');
      const fmt: 'hls' | 'mp4' =
        it.media_format || (rel.toLowerCase().includes('.m3u8') ? 'hls' : 'mp4');
      const effectiveRel =
        pipProxy && fmt === 'hls' && rel.toLowerCase().endsWith('index.m3u8')
          ? `${rel.slice(0, -'index.m3u8'.length)}pip_master.m3u8`
          : rel;
      const localUrl = buildLocalOfflineUrl(effectiveRel, serverPort);
      if (!localUrl) continue;

      const sKey =
        it.server_file_key ||
        (it.server_movie_title
          ? it.episode_number && it.episode_number > 0
            ? `${it.server_movie_title}.Tập.${it.episode_number}`
            : it.server_movie_title
          : '');

      items.push({
        id: it.id,
        videos_id: it.videos_id,
        episode_id: it.episode_id,
        stream_code: it.stream_code,
        title: it.title,
        episode_title: it.episode_title || '',
        server_file_key: sKey,
        norm_key: normalizeOfflineMatchKey(sKey || it.stream_code || it.title),
        media_format: fmt,
        relative_entry: rel,
        url: localUrl,
        subtitles: (it.subtitles || [])
          .map((s) => {
            const subUrl = buildLocalOfflineUrl(s.relative_path, serverPort);
            return subUrl ? { lang: s.lang, label: s.label, url: subUrl } : null;
          })
          .filter(Boolean) as { lang: string; label: string; url: string }[],
      });
    }
  }

  return { enabled, baseUrl, pipProxy, items };
}

export async function exportOfflineToFiles(localUri: string): Promise<void> {
  if (localUri.toLowerCase().includes('.m3u8')) {
    throw new Error('Phim này chỉ hỗ trợ phát ngoại tuyến trực tiếp trong ứng dụng.');
  }
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Thiết bị không hỗ trợ chia sẻ tệp.');
  }
  await Sharing.shareAsync(localUri, {
    mimeType: 'video/mp4',
    UTI: 'public.mpeg-4',
    dialogTitle: 'Lưu phim vào ứng dụng Tệp',
  });
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}
