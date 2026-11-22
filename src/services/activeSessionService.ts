import * as FileSystem from 'expo-file-system/legacy';

const ACTIVE_SESSION_FILE = `${FileSystem.documentDirectory ?? ''}dva_active_playback.json`;
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ActivePlaybackSession {
  active: boolean;
  updatedAt: number;
  videosId: number;
  streamCode: string;
  episodeId?: number;
  episodeNumber?: number;
  seasonId?: string;
  title: string;
  episodeTitle?: string;
  posterUrl?: string;
  thumbnailUrl?: string;
  positionSec: number;
  durationSec: number;
  wasOfflineMode: boolean;
  offlineItemId?: string;
}

let ioQueue: Promise<void> = Promise.resolve();

export async function loadActivePlaybackSession(): Promise<ActivePlaybackSession | null> {
  if (!FileSystem.documentDirectory) return null;
  try {
    const info = await FileSystem.getInfoAsync(ACTIVE_SESSION_FILE);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(ACTIVE_SESSION_FILE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePlaybackSession>;
    if (!parsed || !parsed.active || !parsed.streamCode) {
      return null;
    }
    const updatedAt = Number(parsed.updatedAt) || 0;
    if (updatedAt <= 0 || Date.now() - updatedAt > MAX_SESSION_AGE_MS) {
      await clearActivePlaybackSession();
      return null;
    }
    return {
      active: true,
      updatedAt,
      videosId: Number(parsed.videosId) || 0,
      streamCode: String(parsed.streamCode),
      episodeId: parsed.episodeId ? Number(parsed.episodeId) : undefined,
      episodeNumber: parsed.episodeNumber ? Number(parsed.episodeNumber) : undefined,
      seasonId: parsed.seasonId ? String(parsed.seasonId) : undefined,
      title: String(parsed.title || ''),
      episodeTitle: parsed.episodeTitle ? String(parsed.episodeTitle) : undefined,
      posterUrl: parsed.posterUrl ? String(parsed.posterUrl) : undefined,
      thumbnailUrl: parsed.thumbnailUrl ? String(parsed.thumbnailUrl) : undefined,
      positionSec: Math.max(0, Math.floor(Number(parsed.positionSec) || 0)),
      durationSec: Math.max(0, Math.floor(Number(parsed.durationSec) || 0)),
      wasOfflineMode: Boolean(parsed.wasOfflineMode),
      offlineItemId: parsed.offlineItemId ? String(parsed.offlineItemId) : undefined,
    };
  } catch {
    return null;
  }
}

export function saveActivePlaybackSession(session: ActivePlaybackSession): Promise<void> {
  if (!FileSystem.documentDirectory) return Promise.resolve();
  ioQueue = ioQueue
    .then(async () => {
      try {
        await FileSystem.writeAsStringAsync(ACTIVE_SESSION_FILE, JSON.stringify(session));
      } catch {}
    })
    .catch(() => {});
  return ioQueue;
}

export function clearActivePlaybackSession(): Promise<void> {
  if (!FileSystem.documentDirectory) return Promise.resolve();
  ioQueue = ioQueue
    .then(async () => {
      try {
        const info = await FileSystem.getInfoAsync(ACTIVE_SESSION_FILE);
        if (info.exists) {
          await FileSystem.deleteAsync(ACTIVE_SESSION_FILE, { idempotent: true });
        }
      } catch {}
    })
    .catch(() => {});
  return ioQueue;
}
