import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { OfflineDownloadItem } from '../types/models';

const OFFLINE_DIR = `${FileSystem.documentDirectory ?? ''}dva_offline/`;
const INDEX_FILE = `${FileSystem.documentDirectory ?? ''}dva_offline_index.json`;

type ProgressListener = (items: OfflineDownloadItem[]) => void;

const activeTasks = new Map<string, FileSystem.DownloadResumable>();
const listeners = new Set<ProgressListener>();
let cachedItems: OfflineDownloadItem[] = [];
let initialized = false;

async function ensureDir(): Promise<void> {
  if (!FileSystem.documentDirectory) return;
  const info = await FileSystem.getInfoAsync(OFFLINE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(OFFLINE_DIR, { intermediates: true });
  }
}

async function persistIndex(items: OfflineDownloadItem[]): Promise<void> {
  cachedItems = items;
  if (FileSystem.documentDirectory) {
    await FileSystem.writeAsStringAsync(INDEX_FILE, JSON.stringify(items));
  }
  listeners.forEach((fn) => fn([...cachedItems]));
}

export async function loadOfflineDownloads(): Promise<OfflineDownloadItem[]> {
  if (initialized) {
    return [...cachedItems];
  }
  await ensureDir();
  if (FileSystem.documentDirectory) {
    const info = await FileSystem.getInfoAsync(INDEX_FILE);
    if (info.exists) {
      try {
        const raw = await FileSystem.readAsStringAsync(INDEX_FILE);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          cachedItems = parsed.map((item) =>
            item.status === 'downloading' ? { ...item, status: 'failed' } : item
          );
        }
      } catch {
        cachedItems = [];
      }
    }
  }
  initialized = true;
  return [...cachedItems];
}

export function subscribeOfflineDownloads(listener: ProgressListener): () => void {
  listeners.add(listener);
  listener([...cachedItems]);
  return () => {
    listeners.delete(listener);
  };
}

export async function startOfflineDownload(params: {
  videos_id: number;
  episode_id?: number;
  stream_code: string;
  title: string;
  episode_title?: string;
  poster_url: string;
  thumbnail_url: string;
  remote_url: string;
}): Promise<OfflineDownloadItem> {
  await loadOfflineDownloads();
  await ensureDir();

  const safeCode = params.stream_code.replace(/[^a-zA-Z0-9_-]/g, '_') || String(params.videos_id);
  const id = `${params.videos_id}_${params.episode_id || 0}_${safeCode}`;
  const existing = cachedItems.find((i) => i.id === id && i.status === 'completed');
  if (existing) {
    const info = await FileSystem.getInfoAsync(existing.local_uri);
    if (info.exists) return existing;
  }

  const localUri = `${OFFLINE_DIR}${id}.mp4`;
  const newItem: OfflineDownloadItem = {
    id,
    videos_id: params.videos_id,
    episode_id: params.episode_id || 0,
    stream_code: params.stream_code,
    title: params.title,
    episode_title: params.episode_title,
    poster_url: params.poster_url,
    thumbnail_url: params.thumbnail_url,
    local_uri: localUri,
    remote_url: params.remote_url,
    size_bytes: 0,
    progress: 0,
    status: 'downloading',
    created_at: new Date().toISOString(),
  };

  const nextList = [newItem, ...cachedItems.filter((i) => i.id !== id)];
  await persistIndex(nextList);

  let lastUpdateMs = 0;
  const resumable = FileSystem.createDownloadResumable(
    params.remote_url,
    localUri,
    {},
    (dp) => {
      const now = Date.now();
      if (now - lastUpdateMs < 400 && dp.totalBytesWritten < dp.totalBytesExpectedToWrite) {
        return;
      }
      lastUpdateMs = now;
      const pct =
        dp.totalBytesExpectedToWrite > 0
          ? Math.min(100, Math.round((dp.totalBytesWritten / dp.totalBytesExpectedToWrite) * 100))
          : 0;
      cachedItems = cachedItems.map((it) =>
        it.id === id
          ? {
              ...it,
              progress: pct,
              size_bytes: dp.totalBytesWritten,
            }
          : it
      );
      listeners.forEach((fn) => fn([...cachedItems]));
    }
  );

  activeTasks.set(id, resumable);

  try {
    const res = await resumable.downloadAsync();
    activeTasks.delete(id);
    if (!res || res.status >= 400) {
      throw new Error('Không thể tải tệp video.');
    }
    const fInfo = await FileSystem.getInfoAsync(localUri);
    const completed: OfflineDownloadItem = {
      ...newItem,
      local_uri: res.uri,
      size_bytes: fInfo.exists && 'size' in fInfo ? fInfo.size || 0 : newItem.size_bytes,
      progress: 100,
      status: 'completed',
    };
    await persistIndex(cachedItems.map((it) => (it.id === id ? completed : it)));
    return completed;
  } catch (err) {
    activeTasks.delete(id);
    await persistIndex(
      cachedItems.map((it) => (it.id === id ? { ...it, status: 'failed' } : it))
    );
    throw err;
  }
}

export async function removeOfflineDownload(id: string): Promise<void> {
  await loadOfflineDownloads();
  const task = activeTasks.get(id);
  if (task) {
    try {
      await task.cancelAsync();
    } catch {}
    activeTasks.delete(id);
  }
  const target = cachedItems.find((i) => i.id === id);
  if (target) {
    try {
      const info = await FileSystem.getInfoAsync(target.local_uri);
      if (info.exists) {
        await FileSystem.deleteAsync(target.local_uri, { idempotent: true });
      }
    } catch {}
  }
  await persistIndex(cachedItems.filter((i) => i.id !== id));
}

export async function clearAllOfflineDownloads(): Promise<void> {
  await loadOfflineDownloads();
  for (const [, task] of activeTasks) {
    try {
      await task.cancelAsync();
    } catch {}
  }
  activeTasks.clear();
  try {
    const info = await FileSystem.getInfoAsync(OFFLINE_DIR);
    if (info.exists) {
      await FileSystem.deleteAsync(OFFLINE_DIR, { idempotent: true });
    }
    await ensureDir();
  } catch {}
  await persistIndex([]);
}

export async function exportOfflineToFiles(localUri: string): Promise<void> {
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
