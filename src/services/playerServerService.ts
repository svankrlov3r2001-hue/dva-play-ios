import {
  OfflineDownloadItem,
  StreamQuality,
  StreamResolvedData,
} from '../types/models';
import {
  buildLocalOfflineUrl,
  isNativePipProxySupported,
} from './localMediaServer';

export type BackupServerId = '99' | '11' | '36' | '40' | '3' | 'fallback';

export type ServerReadinessStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'preview_10p'
  | 'preview_30p'
  | 'ready'
  | 'error'
  | 'unsupported';

export interface ServerRuntimeState {
  id: BackupServerId;
  codeName: string;
  label: string;
  subtitle: string;
  supported: boolean;
  status: ServerReadinessStatus;
  progress: number;
  progressLabel: string;
  etaText: string;
  format: 'hls' | 'mp4';
  preview10pReady: boolean;
  preview30pReady: boolean;
  totalSeconds: number;
  pingMs: number | null;
  pingFailed: boolean;
  streamUrl: string;
  previewTag: '' | '10p' | '30p';
  errored: boolean;
}

export interface CheckFileResult {
  ok: boolean;
  status: string;
  message: string;
  progress: string;
  progressNum: number;
  time_end: string;
  format: 'hls' | 'mp4';
  ext: 'm3u8' | 'mp4';
  preview_10p: boolean;
  preview_30p: boolean;
  total_seconds: number;
}

export interface GgdriverCheckResult {
  ggdriver_1: boolean;
  ggdriver_2: boolean;
  ggdriver_3: boolean;
}

const CHECK_FILE_PRIMARY = 'https://dangvietanh.io.vn/check_file';
const CHECK_FILE_FALLBACK = 'https://handle.dangvietanh.com/check_file';
const TRIGGER_GDRIVE_PRIMARY = 'https://download.s1dangvietanh.io.vn/download_file_gdrive';
const TRIGGER_GDRIVE_FALLBACK = 'https://dangvietanh.io.vn/download_file_gdrive';
const CHECK_GGDRIVER_API = 'https://api.dangvietanh.com/api/check_ggdriver';
const PING_11_URL = 'https://dangvietanh.io.vn/delay_ms.jpg';
const PING_36_URL = 'https://handle.dangvietanh.com/delay_ms.jpg';
const QUALITY_KTCL_DEFAULT = 'https://ktcl.s1dangvietanh.io.vn/kiem_tra_chat_luong_video';
const QUALITY_KTCL_36 = 'https://handle.dangvietanh.com/kiem_tra_chat_luong_video';
const KOREA_WORKERS_BASE = 'https://dangvietanh.svankrlov3r2001.workers.dev/0:/movie';
const KOREA_WORKERS_BASE_2 = 'https://dangvietanh2.svankrlov3r2001.workers.dev/0:/movie';

export const PREVIEW_10P_SAFE_LIMIT_SEC = 480; // 10 phút trừ hao 2 phút còn 8 phút
export const PREVIEW_30P_SAFE_LIMIT_SEC = 1680; // 30 phút trừ hao 2 phút còn 28 phút
export const PREVIEW_10P_HARD_LIMIT_SEC = 590;
export const PREVIEW_30P_HARD_LIMIT_SEC = 1790;

function parseProgressNum(raw: string, status: string): number {
  if (status === 'success') return 100;
  const m = String(raw || '').match(/(\d+(?:\.\d+)?)/);
  if (m) {
    const val = Math.round(parseFloat(m[1]));
    if (!isNaN(val)) return Math.max(0, Math.min(99, val));
  }
  return 0;
}

function encodeFormBody(obj: Record<string, string>): string {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k])}`)
    .join('&');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkGgdriverApi(
  serverFileKey: string,
  serverMovieTitle?: string,
  nextEpisodeNum?: number
): Promise<GgdriverCheckResult> {
  const empty: GgdriverCheckResult = {
    ggdriver_1: false,
    ggdriver_2: false,
    ggdriver_3: false,
  };
  if (!serverFileKey) return empty;
  try {
    const res = await fetchWithTimeout(
      CHECK_GGDRIVER_API,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: encodeFormBody({
          filename: serverFileKey,
          movie_name: serverMovieTitle || '',
          check_next: nextEpisodeNum ? '1' : '0',
          next_episode: nextEpisodeNum ? String(nextEpisodeNum) : '',
        }),
      },
      4500
    );
    const json: any = await res.json();
    const d = json?.data || json?.results || json;
    if (!d) return empty;
    return {
      ggdriver_1: Boolean(d.ggdriver_1 || d.ggdriver || d.check_ggd_1 == 1),
      ggdriver_2: Boolean(d.ggdriver_2 || d.check_ggd_2 == 1),
      ggdriver_3: Boolean(d.ggdriver_3 || d.check_ggd_3 == 1),
    };
  } catch {
    return empty;
  }
}

export async function checkServerFileStatus(serverFileKey: string): Promise<CheckFileResult> {
  const cleanKey = String(serverFileKey || '').trim();
  const fallback: CheckFileResult = {
    ok: false,
    status: 'error',
    message: '',
    progress: '',
    progressNum: 0,
    time_end: '',
    format: 'hls',
    ext: 'm3u8',
    preview_10p: false,
    preview_30p: false,
    total_seconds: 0,
  };
  if (!cleanKey) return fallback;

  const tryUrl = async (url: string): Promise<any> => {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Cache-Control': 'no-cache',
        },
        body: encodeFormBody({ name_movies: cleanKey }),
      },
      5500
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  let data: any = null;
  try {
    data = await tryUrl(CHECK_FILE_PRIMARY);
  } catch {
    try {
      data = await tryUrl(CHECK_FILE_FALLBACK);
    } catch {
      return fallback;
    }
  }

  if (!data || typeof data !== 'object') return fallback;
  const statusStr = String(data.status || '');
  const rawFormat = String(data.format || data.ext || 'hls').toLowerCase();
  const format: 'hls' | 'mp4' = rawFormat === 'mp4' ? 'mp4' : 'hls';
  const ext: 'm3u8' | 'mp4' = format === 'mp4' ? 'mp4' : 'm3u8';
  const progressStr = String(data.progress || '');

  return {
    ok: true,
    status: statusStr,
    message: String(data.message || ''),
    progress: progressStr,
    progressNum: parseProgressNum(progressStr, statusStr),
    time_end: String(data.time_end || ''),
    format,
    ext,
    preview_10p: data.preview_10p === 'success',
    preview_30p: data.preview_30p === 'success',
    total_seconds: Number(data.total_seconds) || 0,
  };
}

export async function triggerServerPrepare(serverFileKey: string): Promise<boolean> {
  const cleanKey = String(serverFileKey || '').trim();
  if (!cleanKey) return false;
  const sendReq = async (url: string) => {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: encodeFormBody({ name_movies: cleanKey }),
      },
      6000
    );
    return res.ok;
  };
  try {
    if (await sendReq(TRIGGER_GDRIVE_PRIMARY)) return true;
  } catch {}
  try {
    return await sendReq(TRIGGER_GDRIVE_FALLBACK);
  } catch {
    return false;
  }
}

async function probeImageLatencyMs(url: string, timeoutMs = 3200): Promise<number | null> {
  const startedAt = Date.now();
  try {
    const sep = url.includes('?') ? '&' : '?';
    const res = await fetchWithTimeout(`${url}${sep}t=${Date.now()}`, { method: 'GET' }, timeoutMs);
    if (!res.ok) return null;
    try {
      await res.arrayBuffer();
    } catch {}
    return Math.max(8, Date.now() - startedAt);
  } catch {
    return null;
  }
}

export async function measureAllServerPings(hasOffline: boolean): Promise<{
  ping99: number | null;
  ping11: number | null;
  ping36: number | null;
  ping40: number | null;
  ping3: number | null;
}> {
  const [p11, p36Raw] = await Promise.all([
    probeImageLatencyMs(PING_11_URL),
    probeImageLatencyMs(PING_36_URL),
  ]);

  return {
    ping99: hasOffline ? 1 : null,
    ping11: p11,
    ping36: p36Raw !== null ? p36Raw + 100 : null,
    ping40: p11 !== null ? p11 + 200 : 500,
    ping3: 800,
  };
}

export function buildServer11Or36MediaUrl(
  serverId: '11' | '36',
  serverFileKey: string,
  checkRes: Pick<CheckFileResult, 'status' | 'format' | 'preview_10p' | 'preview_30p' | 'total_seconds'>,
  knownDurationSec = 0
): { url: string; format: 'hls' | 'mp4'; previewTag: '' | '10p' | '30p' } {
  const cleanKey = String(serverFileKey || '').trim();
  if (!cleanKey) return { url: '', format: 'hls', previewTag: '' };
  const ext = checkRes.format === 'mp4' ? 'mp4' : 'm3u8';
  const effectiveTotalSec = Math.max(checkRes.total_seconds || 0, knownDurationSec || 0);
  let suffix = '';
  let previewTag: '' | '10p' | '30p' = '';

  if (checkRes.status === 'success') {
    suffix = '';
    previewTag = '';
  } else if (checkRes.preview_30p && effectiveTotalSec >= 3600 && ext === 'm3u8') {
    suffix = '_30p';
    previewTag = '30p';
  } else if (checkRes.preview_10p) {
    suffix = '_10p';
    previewTag = '10p';
  } else {
    return { url: '', format: checkRes.format, previewTag: '' };
  }

  const fileName = `${cleanKey}${suffix}.${ext}`;
  if (serverId === '11') {
    return {
      url: `https://dangvietanh.io.vn/uploads/${encodeURIComponent(cleanKey)}/${encodeURIComponent(fileName)}`,
      format: checkRes.format,
      previewTag,
    };
  }
  return {
    url: `https://handle.dangvietanh.com/stream_h?code=${encodeURIComponent(cleanKey)}/${encodeURIComponent(fileName)}`,
    format: checkRes.format,
    previewTag,
  };
}

export function buildOfflineServerUrl(
  offlineItem: OfflineDownloadItem | null | undefined,
  localServerPort: number
): { url: string; format: 'hls' | 'mp4' } {
  if (!offlineItem) return { url: '', format: 'mp4' };
  const isHls = Boolean(
    offlineItem.media_format === 'hls' || offlineItem.local_uri?.toLowerCase().includes('.m3u8')
  );
  const rawRel =
    offlineItem.relative_entry ||
    (offlineItem.local_uri && offlineItem.local_uri.includes('dva_offline/')
      ? offlineItem.local_uri.substring(
          offlineItem.local_uri.indexOf('dva_offline/') + 'dva_offline/'.length
        )
      : '');
  const pipRel =
    isHls && isNativePipProxySupported() && rawRel.toLowerCase().endsWith('index.m3u8')
      ? `${rawRel.slice(0, -'index.m3u8'.length)}pip_master.m3u8`
      : rawRel;
  const httpUrl = pipRel && localServerPort > 0 ? buildLocalOfflineUrl(pipRel, localServerPort) : '';
  if (isHls) {
    return { url: httpUrl || offlineItem.local_uri || '', format: 'hls' };
  }
  return { url: offlineItem.local_uri || httpUrl || '', format: 'mp4' };
}

export function buildKoreaWorkerUrl(
  serverFileKey: string,
  resolved?: Pick<StreamResolvedData, 'hanquoc_url' | 'server_tap_phim' | 'movie' | 'ggdriver_1' | 'ggdriver_2'> | null,
  ggd?: Pick<GgdriverCheckResult, 'ggdriver_1' | 'ggdriver_2'> | null
): string {
  if (resolved?.hanquoc_url) {
    return resolved.hanquoc_url;
  }
  const cleanKey = String(serverFileKey || '').trim();
  if (!cleanKey) return '';
  const hasGgd1 = Boolean(ggd?.ggdriver_1 ?? resolved?.ggdriver_1);
  const hasGgd2 = Boolean(ggd?.ggdriver_2 ?? resolved?.ggdriver_2);
  const workerBase = !hasGgd1 && hasGgd2 ? KOREA_WORKERS_BASE_2 : KOREA_WORKERS_BASE;
  const isSeries =
    cleanKey.includes('.Tập.') ||
    Boolean(resolved?.server_tap_phim) ||
    resolved?.movie?.is_tvseries === 1;
  return `${workerBase}/${isSeries ? 'B' : 'L'}/${encodeURIComponent(cleanKey)}.mp4`;
}

export function buildPhien40Url(
  serverFileKey: string,
  resolved?: Pick<StreamResolvedData, 'phien40_url'> | null
): string {
  if (resolved?.phien40_url) {
    return resolved.phien40_url;
  }
  const cleanKey = String(serverFileKey || '').trim();
  if (!cleanKey) return '';
  return `https://dangvietanh.io.vn/?code=${encodeURIComponent(cleanKey)}`;
}

export function buildInitialServerStates(opts: {
  serverFileKey: string;
  offlineItem?: OfflineDownloadItem | null;
  localServerPort: number;
  resolved?: StreamResolvedData | null;
  ggd?: GgdriverCheckResult;
  pings?: {
    ping99: number | null;
    ping11: number | null;
    ping36: number | null;
    ping40: number | null;
    ping3: number | null;
  };
  erroredIds?: Set<BackupServerId>;
}): ServerRuntimeState[] {
  const {
    serverFileKey,
    offlineItem,
    localServerPort,
    resolved,
    ggd,
    pings,
    erroredIds = new Set(),
  } = opts;

  const hasOffline = Boolean(offlineItem && offlineItem.status === 'completed' && offlineItem.local_uri);
  const offlineUrl = hasOffline ? buildOfflineServerUrl(offlineItem, localServerPort) : { url: '', format: 'mp4' as const };

  const hasGgd1 = Boolean(ggd?.ggdriver_1 ?? resolved?.ggdriver_1);
  const hasGgd2 = Boolean(ggd?.ggdriver_2 ?? resolved?.ggdriver_2);
  const hasGgd3 = Boolean(ggd?.ggdriver_3 ?? resolved?.ggdriver_3);
  const hasAnyGgd = hasGgd1 || hasGgd2 || hasGgd3;
  const hasKorea = hasGgd1 || hasGgd2 || Boolean(resolved?.hanquoc_url);

  const list: ServerRuntimeState[] = [];

  if (hasOffline && offlineUrl.url) {
    list.push({
      id: '99',
      codeName: 'Phiên 99',
      label: 'Phát từ máy',
      subtitle: 'Tệp ngoại tuyến đã lưu',
      supported: true,
      status: erroredIds.has('99') ? 'error' : 'ready',
      progress: 100,
      progressLabel: 'Sẵn sàng',
      etaText: '',
      format: offlineUrl.format,
      preview10pReady: false,
      preview30pReady: false,
      totalSeconds: offlineItem?.duration_sec || 0,
      pingMs: 1,
      pingFailed: false,
      streamUrl: offlineUrl.url,
      previewTag: '',
      errored: erroredIds.has('99'),
    });
  }

  list.push({
    id: '11',
    codeName: 'Phiên 11',
    label: 'Phiên 11',
    subtitle: 'Máy chủ tốc độ cao trực tiếp',
    supported: Boolean(serverFileKey),
    status: !serverFileKey ? 'unsupported' : erroredIds.has('11') ? 'error' : 'checking',
    progress: 0,
    progressLabel: serverFileKey ? 'Đang kiểm tra...' : 'Chưa hỗ trợ',
    etaText: '',
    format: 'hls',
    preview10pReady: false,
    preview30pReady: false,
    totalSeconds: 0,
    pingMs: pings ? pings.ping11 : null,
    pingFailed: pings ? pings.ping11 === null : false,
    streamUrl: '',
    previewTag: '',
    errored: erroredIds.has('11'),
  });

  list.push({
    id: '36',
    codeName: 'Phiên 36',
    label: 'Phiên 36',
    subtitle: 'Máy chủ dự phòng tăng tốc',
    supported: Boolean(serverFileKey),
    status: !serverFileKey ? 'unsupported' : erroredIds.has('36') ? 'error' : 'checking',
    progress: 0,
    progressLabel: serverFileKey ? 'Đang kiểm tra...' : 'Chưa hỗ trợ',
    etaText: '',
    format: 'hls',
    preview10pReady: false,
    preview30pReady: false,
    totalSeconds: 0,
    pingMs: pings ? pings.ping36 : null,
    pingFailed: pings ? pings.ping36 === null : false,
    streamUrl: '',
    previewTag: '',
    errored: erroredIds.has('36'),
  });

  const p40Url = hasAnyGgd ? buildPhien40Url(serverFileKey, resolved) : '';
  list.push({
    id: '40',
    codeName: 'Phiên 40',
    label: 'Phiên 40',
    subtitle: hasAnyGgd ? 'Luồng phát gốc trực tiếp' : 'Chưa hỗ trợ phim này',
    supported: Boolean(hasAnyGgd && p40Url),
    status: !hasAnyGgd || !p40Url ? 'unsupported' : erroredIds.has('40') ? 'error' : 'ready',
    progress: hasAnyGgd ? 100 : 0,
    progressLabel: hasAnyGgd ? 'Sẵn sàng' : 'Chưa hỗ trợ',
    etaText: '',
    format: 'mp4',
    preview10pReady: false,
    preview30pReady: false,
    totalSeconds: 0,
    pingMs: pings ? pings.ping40 : 450,
    pingFailed: false,
    streamUrl: p40Url,
    previewTag: '',
    errored: erroredIds.has('40'),
  });

  const hqUrl = hasKorea ? buildKoreaWorkerUrl(serverFileKey, resolved, ggd) : '';
  list.push({
    id: '3',
    codeName: 'Hàn Quốc',
    label: 'Hàn Quốc',
    subtitle: hasKorea ? 'Máy chủ quốc tế ổn định' : 'Chưa hỗ trợ phim này',
    supported: Boolean(hasKorea && hqUrl),
    status: !hasKorea || !hqUrl ? 'unsupported' : erroredIds.has('3') ? 'error' : 'ready',
    progress: hasKorea ? 100 : 0,
    progressLabel: hasKorea ? 'Sẵn sàng' : 'Chưa hỗ trợ',
    etaText: '',
    format: 'mp4',
    preview10pReady: false,
    preview30pReady: false,
    totalSeconds: 0,
    pingMs: pings ? pings.ping3 : 800,
    pingFailed: false,
    streamUrl: hqUrl,
    previewTag: '',
    errored: erroredIds.has('3'),
  });

  // Legacy direct URL fallback if LinkGoc/DuPhong provides a direct playable URL outside Phiên 11/36/40/3
  const directQuality: StreamQuality | undefined =
    resolved?.qualities?.find((q) => q.url && !q.url.includes('workers.dev') && !q.url.includes('dangvietanh.io.vn/?code='));
  if (directQuality) {
    list.push({
      id: 'fallback',
      codeName: 'Nguồn gốc',
      label: directQuality.label || 'Máy chủ gốc',
      subtitle: 'Nguồn phát trực tiếp thay thế',
      supported: true,
      status: erroredIds.has('fallback') ? 'error' : 'ready',
      progress: 100,
      progressLabel: 'Sẵn sàng',
      etaText: '',
      format: directQuality.type === 'hls' ? 'hls' : 'mp4',
      preview10pReady: false,
      preview30pReady: false,
      totalSeconds: 0,
      pingMs: 320,
      pingFailed: false,
      streamUrl: directQuality.url,
      previewTag: '',
      errored: erroredIds.has('fallback'),
    });
  }

  return list;
}

export function applyCheckFileToServers(
  prev: ServerRuntimeState[],
  serverFileKey: string,
  checkRes: CheckFileResult,
  knownDurationSec = 0
): ServerRuntimeState[] {
  return prev.map((srv) => {
    if (srv.id !== '11' && srv.id !== '36') return srv;
    if (!serverFileKey) {
      return { ...srv, status: 'unsupported', supported: false, progressLabel: 'Chưa hỗ trợ' };
    }
    if (srv.errored) {
      return { ...srv, status: 'error', progressLabel: 'Lỗi phiên' };
    }
    if (!checkRes.ok) {
      return {
        ...srv,
        status: 'error',
        progressLabel: 'Mất kết nối',
      };
    }

    const effectiveTotalSec = Math.max(
      checkRes.total_seconds || 0,
      knownDurationSec || 0,
      srv.totalSeconds || 0
    );
    const media = buildServer11Or36MediaUrl(srv.id, serverFileKey, checkRes, effectiveTotalSec);
    let nextStatus: ServerReadinessStatus = 'downloading';
    let progressLabel = checkRes.progress || `${checkRes.progressNum}%`;

    if (checkRes.status === 'success' && media.url) {
      nextStatus = 'ready';
      progressLabel = '100%';
    } else if (
      checkRes.preview_30p &&
      effectiveTotalSec >= 3600 &&
      checkRes.format !== 'mp4' &&
      media.url
    ) {
      nextStatus = 'preview_30p';
      progressLabel = `${checkRes.progressNum}% (Xem trước 30p)`;
    } else if (checkRes.preview_10p && media.url) {
      nextStatus = 'preview_10p';
      progressLabel = `${checkRes.progressNum}% (Xem trước 10p)`;
    } else if (checkRes.status === 'error_ffmpeg') {
      nextStatus = 'downloading';
      progressLabel = checkRes.message || 'Hàng đợi...';
    } else if (
      checkRes.status === 'error' ||
      checkRes.status === 'error_disk_quota'
    ) {
      nextStatus = 'error';
      progressLabel = checkRes.message || 'Tạm bận';
    } else if (checkRes.status === 'error_file' || checkRes.status === 'error_file_log') {
      nextStatus = 'downloading';
      progressLabel = 'Đang chuẩn bị...';
    }

    return {
      ...srv,
      supported: true,
      status: nextStatus,
      progress: checkRes.progressNum,
      progressLabel,
      etaText: checkRes.time_end,
      format: media.format,
      preview10pReady: checkRes.preview_10p,
      preview30pReady: checkRes.preview_30p,
      totalSeconds: effectiveTotalSec,
      streamUrl: media.url,
      previewTag: media.previewTag,
    };
  });
}

export function isServerPlayable(srv: ServerRuntimeState): boolean {
  return (
    srv.supported &&
    !srv.errored &&
    Boolean(srv.streamUrl) &&
    (srv.status === 'ready' || srv.status === 'preview_30p' || srv.status === 'preview_10p')
  );
}

export function isServerEligibleForWatchTime(
  srv: ServerRuntimeState,
  watchPosSec = 0
): boolean {
  if (!isServerPlayable(srv)) return false;
  const pos = Math.max(0, Number(watchPosSec) || 0);
  if (srv.status === 'preview_10p' || srv.previewTag === '10p') {
    return pos < PREVIEW_10P_SAFE_LIMIT_SEC;
  }
  if (srv.status === 'preview_30p' || srv.previewTag === '30p') {
    return pos < PREVIEW_30P_SAFE_LIMIT_SEC;
  }
  return true;
}

/**
 * Priority tiers for Auto-Optimal server selection:
 * 0. Local ('99') when preferOffline = true
 * 1. Phiên 11 & Phiên 36 (prioritizing Phiên 11, combined with latency ms & preview time-safety limits)
 * 2. Phiên 40 & Hàn Quốc (prioritizing Phiên 40, combined with latency ms)
 * 3. Direct fallback / local (when preferOffline = false)
 */
export function selectOptimalServer(
  servers: ServerRuntimeState[],
  opts: { preferOffline: boolean; hasGgdDirect?: boolean; watchPosSec?: number }
): ServerRuntimeState | null {
  const watchPosSec = Math.max(0, Number(opts.watchPosSec) || 0);
  const eligible = servers.filter((s) => isServerEligibleForWatchTime(s, watchPosSec));
  if (eligible.length === 0) return null;

  if (opts.preferOffline) {
    const localSrv = eligible.find((s) => s.id === '99');
    if (localSrv) return localSrv;
  }

  const pickBestFromPair = (ids: BackupServerId[]): ServerRuntimeState | null => {
    const pair = eligible.filter((s) => ids.includes(s.id));
    if (pair.length === 0) return null;
    pair.sort((a, b) => {
      const readinessScore = (s: ServerRuntimeState) => {
        if (s.status === 'ready') return 3;
        if (s.status === 'preview_30p') return 2;
        if (s.status === 'preview_10p') return 1;
        return 0;
      };
      const rDiff = readinessScore(b) - readinessScore(a);
      if (rDiff !== 0) return rDiff;

      const pingA = a.pingMs !== null && !a.pingFailed ? a.pingMs : 9999;
      const pingB = b.pingMs !== null && !b.pingFailed ? b.pingMs : 9999;
      if (Math.abs(pingA - pingB) >= 25) {
        return pingA - pingB;
      }
      return ids.indexOf(a.id) - ids.indexOf(b.id);
    });
    return pair[0] || null;
  };

  // Tier 1: Phiên 11 & Phiên 36 (ưu tiên 11, kết hợp ping ms)
  const tier1 = pickBestFromPair(['11', '36']);
  if (tier1) return tier1;

  // Tier 2: Phiên 40 & Hàn Quốc (ưu tiên 40, kết hợp ping ms)
  const tier2 = pickBestFromPair(['40', '3']);
  if (tier2) return tier2;

  const fallbackSrv = eligible.find((s) => s.id === 'fallback');
  if (fallbackSrv) return fallbackSrv;

  return eligible[0] || null;
}

export function wrapUrlForIosNativePlayer(opts: {
  rawUrl: string;
  format: 'hls' | 'mp4';
  serverId: BackupServerId;
  vnSubUrl: string;
  enSubUrl: string;
  localServerPort: number;
  pipEnabled: boolean;
  pipProxyBroken: boolean;
}): { uri: string; contentType: 'hls' | 'progressive' } {
  const {
    rawUrl,
    format,
    serverId,
    vnSubUrl,
    enSubUrl,
    localServerPort,
    pipEnabled,
    pipProxyBroken,
  } = opts;

  if (!rawUrl) {
    return { uri: '', contentType: format === 'hls' ? 'hls' : 'progressive' };
  }

  // Offline HLS already points directly to local loopback pip_master.m3u8
  if (serverId === '99' || format !== 'hls') {
    return { uri: rawUrl, contentType: format === 'hls' ? 'hls' : 'progressive' };
  }

  if (
    pipEnabled &&
    !pipProxyBroken &&
    localServerPort > 0 &&
    isNativePipProxySupported() &&
    !rawUrl.startsWith('http://127.0.0.1:')
  ) {
    const qs = `src=${encodeURIComponent(rawUrl)}&vn=${encodeURIComponent(vnSubUrl)}&en=${encodeURIComponent(enSubUrl)}`;
    return {
      uri: `http://127.0.0.1:${localServerPort}/hls-pip/master.m3u8?${qs}`,
      contentType: 'hls',
    };
  }

  return { uri: rawUrl, contentType: 'hls' };
}

export async function probeVideoQualityLabel(
  serverFileKey: string,
  activeServerId: BackupServerId,
  fallbackQuality?: string
): Promise<string> {
  const cleanKey = String(serverFileKey || '').trim();
  if (!cleanKey) return fallbackQuality || '1080pHD';
  const endpoint = activeServerId === '36' ? QUALITY_KTCL_36 : QUALITY_KTCL_DEFAULT;
  try {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: encodeFormBody({ name_movies: cleanKey }),
      },
      4500
    );
    const json: any = await res.json();
    if (!json || json.error) {
      return fallbackQuality || '1080pHD';
    }
    const w = parseInt(String(json.width || '0'), 10) || 0;
    const fps = parseFloat(String(json.fps || '0')) || 0;
    const isHdr = typeof json.hdr === 'string' && json.hdr.includes('HDR');
    const fpsSuffix = fps > 30 ? 'p60' : 'p';
    let badge = '';
    if (isHdr) badge = ' HDR';
    else if (w >= 3840) badge = ' 4K';
    else if (w >= 2560) badge = ' 2K';
    else if (w >= 1280) badge = 'HD';

    if (w >= 3840) return `2160${fpsSuffix}${badge}`;
    if (w >= 2560) return `1440${fpsSuffix}${badge}`;
    if (w >= 1920) return `1080${fpsSuffix}${badge}`;
    if (w >= 1280) return `720${fpsSuffix}${badge}`;
    if (w >= 854) return '480p';
    if (w >= 640) return '360p';
    return fallbackQuality || '1080pHD';
  } catch {
    return fallbackQuality || '1080pHD';
  }
}

export function formatVietnameseEta(rawEta: string): string {
  const trimmed = String(rawEta || '').trim();
  if (!trimmed) return '';
  if (/phút|giây|giờ/i.test(trimmed)) return trimmed;
  const parts = trimmed.split(':').map((n) => parseInt(n, 10));
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    if (parts[0] > 0) return `${parts[0]} giờ ${parts[1]} phút`;
    if (parts[1] > 0) return `${parts[1]} phút ${parts[2]} giây`;
    return `${parts[2]} giây`;
  }
  if (parts.length === 2 && parts.every((n) => !isNaN(n))) {
    if (parts[0] > 0) return `${parts[0]} phút ${parts[1]} giây`;
    return `${parts[1]} giây`;
  }
  return trimmed;
}
