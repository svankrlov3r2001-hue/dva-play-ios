import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isPictureInPictureSupported, useVideoPlayer, VideoView } from 'expo-video';
import * as FileSystem from 'expo-file-system/legacy';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../components/GlassSurface';
import { OfflineDownloadSheet } from '../components/OfflineDownloadSheet';
import { PlayerOverlayPanels, PlayerPanelType } from '../components/PlayerOverlayPanels';
import { PlayerLandscapeSkeleton } from '../components/SkeletonLoaders';
import { API_BASE_URL, COLORS, RADII, SITE_BASE_URL } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { fetchMovieDetailsApi, getApiAuthToken, saveWatchProgressApi } from '../services/api';
import {
  buildOfflineRegistryForWebView,
  enqueueEpisodeBatch,
  findCompletedOfflineItem,
  getCurrentAndNextEpisodes,
  getOfflineRootDir,
  loadOfflineDownloads,
  OfflineEnqueueParams,
  saveOfflineResumePosition,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import {
  buildLocalOfflineUrl,
  ensureOfflineMediaServer,
  getCachedOfflineMediaServerPort,
} from '../services/localMediaServer';
import {
  getProxyConfig,
  isNativeProxySupported,
  isProxyActiveForConfig,
  subscribeProxyConfig,
} from '../services/proxyService';
import { EpisodeItem, OfflineDownloadItem, StreamResolvedData } from '../types/models';

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
function encodeBase64UrlUtf8(str: string): string {
  const bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes.charCodeAt(i);
    const has2 = i + 1 < bytes.length;
    const has3 = i + 2 < bytes.length;
    const b2 = has2 ? bytes.charCodeAt(i + 1) : 0;
    const b3 = has3 ? bytes.charCodeAt(i + 2) : 0;
    const trip = (b1 << 16) | (b2 << 8) | b3;
    out += B64_CHARS[(trip >> 18) & 63];
    out += B64_CHARS[(trip >> 12) & 63];
    out += has2 ? B64_CHARS[(trip >> 6) & 63] : '=';
    out += has3 ? B64_CHARS[trip & 63] : '=';
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const HGLK_STORE_KEY = 'dva_ios_hglk_cookie';
const HGLK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
let cachedDeviceHglk: string | null = null;

function generateHglkToken(length = 24): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += HGLK_ALPHABET.charAt(Math.floor(Math.random() * HGLK_ALPHABET.length));
  }
  return out;
}

async function getOrCreateDeviceHglk(): Promise<string> {
  if (cachedDeviceHglk && cachedDeviceHglk.length >= 8) {
    return cachedDeviceHglk;
  }
  try {
    const stored = await SecureStore.getItemAsync(HGLK_STORE_KEY);
    if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) {
      cachedDeviceHglk = stored;
      return stored;
    }
  } catch {}
  const fresh = generateHglkToken(24);
  cachedDeviceHglk = fresh;
  try {
    await SecureStore.setItemAsync(HGLK_STORE_KEY, fresh);
  } catch {}
  return fresh;
}

interface VttCueItem {
  start: number;
  end: number;
  text: string;
}

function parseVttTimestamp(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':').map((p) => parseFloat(p));
  if (parts.some((n) => isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

function parseVttCues(vttText: string): VttCueItem[] {
  if (!vttText) return [];
  const lines = vttText.replace(/\r/g, '').split('\n');
  const cues: VttCueItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
      i++;
      continue;
    }
    const arrowIdx = line.indexOf('-->');
    if (arrowIdx >= 0) {
      const startPart = line.slice(0, arrowIdx).trim();
      const endPart = line.slice(arrowIdx + 3).trim().split(/\s+/)[0] || '';
      const start = parseVttTimestamp(startPart);
      const end = parseVttTimestamp(endPart);
      i++;
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        buf.push(lines[i].replace(/<[^>]*>/g, '').trim());
        i++;
      }
      const txt = buf.filter(Boolean).join('\n');
      if (txt && end > start) {
        cues.push({ start, end, text: txt });
      }
    } else {
      i++;
    }
  }
  return cues;
}

export interface PlayerLaunchParams {
  videosId: number;
  streamCode: string;
  episodeId?: number;
  episodeNumber?: number;
  seasonId?: string;
  title: string;
  episodeTitle?: string;
  episodes?: EpisodeItem[];
  posterUrl?: string;
  thumbnailUrl?: string;
  offlineUri?: string;
  offlineItem?: OfflineDownloadItem;
  offlineEpisodes?: OfflineDownloadItem[];
}

interface PlayerModalProps {
  visible: boolean;
  params: PlayerLaunchParams | null;
  onClose: () => void;
  onSwitchEpisode?: (ep: EpisodeItem, epIndex: number) => void;
  onSwitchOfflineItem?: (item: OfflineDownloadItem) => void;
  onOpenCast?: () => void;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function resolveEpisodeMetaFromParams(params: PlayerLaunchParams | null, activeStreamCode: string) {
  let epNum = params?.episodeNumber || 0;
  let sId = params?.seasonId ? String(params.seasonId) : '';
  const eps = params?.episodes || [];
  if (eps.length > 0) {
    const idx = eps.findIndex(
      (ep) =>
        (activeStreamCode && ep.stream_code === activeStreamCode) ||
        (params?.episodeId && ep.episodes_id === params.episodeId)
    );
    if (idx >= 0) {
      const parseEpNum = (name?: string) => {
        const str = String(name || '');
        const mEp = str.match(/(?:tập|tap|episode|ep)\s*0*(\d+)/i);
        if (mEp) return parseInt(mEp[1], 10);
        const mAny = str.match(/0*(\d+)/);
        return mAny ? parseInt(mAny[1], 10) : null;
      };
      const parsedNameNum = parseEpNum(eps[idx].episodes_name);
      if (parsedNameNum && parsedNameNum > 0) {
        epNum = parsedNameNum;
      } else if (epNum <= 0) {
        const firstN = parseEpNum(eps[0].episodes_name);
        const lastN = parseEpNum(eps[eps.length - 1].episodes_name);
        const isDesc = firstN !== null && lastN !== null && firstN > lastN;
        epNum = isDesc ? eps.length - idx : idx + 1;
      }
      if (!sId && eps[idx].seasons_id) sId = String(eps[idx].seasons_id);
    }
  }
  return { episodeNumber: epNum, seasonId: sId };
}

interface OfflineNativePlayerProps {
  params: PlayerLaunchParams;
  localServerPort: number;
  onClose: () => void;
  onReady: () => void;
  onPipChange: (active: boolean) => void;
  onSwitchOfflineItem?: (item: OfflineDownloadItem) => void;
}

/**
 * Isolated native AVPlayer surface mounted strictly for local offline HLS & MP4 playback.
 * Never mounted during online streaming so it never flickers or competes with WebView PiP.
 */
function OfflineNativePlayer({
  params,
  localServerPort,
  onClose,
  onReady,
  onPipChange,
  onSwitchOfflineItem,
}: OfflineNativePlayerProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const { user, isLocked } = useAuth();
  const { settings, updateSetting } = useSettings();

  const offlineItem = params.offlineItem;
  const offlineEpisodes = useMemo(
    () => (params.offlineEpisodes && params.offlineEpisodes.length > 0 ? params.offlineEpisodes : []),
    [params.offlineEpisodes]
  );

  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const prevLockedRef = useRef(isLocked);
  const wasPlayingBeforeLockRef = useRef(false);
  const preBackgroundPlayingRef = useRef<boolean | null>(null);

  const [hudVisible, setHudVisible] = useState(true);
  const [activePanel, setActivePanel] = useState<PlayerPanelType>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(offlineItem?.duration_sec || 0);
  const [barWidth, setBarWidth] = useState(400);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [activeSubIndex, setActiveSubIndex] = useState(0);
  const [parsedCuesByIdx, setParsedCuesByIdx] = useState<VttCueItem[][]>([]);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const barWidthRef = useRef(400);
  barWidthRef.current = barWidth;
  const durationRef = useRef(0);
  durationRef.current = duration;
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  const restoredForIdRef = useRef('');
  const lastSavedResumeRef = useRef(0);

  const videoViewRef = useRef<VideoView | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 2600);
  }, []);

  const isHlsOffline = Boolean(
    offlineItem?.media_format === 'hls' || params.offlineUri?.toLowerCase().includes('.m3u8')
  );

  const playbackSource = useMemo(() => {
    const rel =
      offlineItem?.relative_entry ||
      (params.offlineUri && params.offlineUri.includes('dva_offline/')
        ? params.offlineUri.substring(params.offlineUri.indexOf('dva_offline/') + 'dva_offline/'.length)
        : '');
    const httpUrl = rel ? buildLocalOfflineUrl(rel, localServerPort) : null;
    if (isHlsOffline) {
      if (httpUrl) {
        return {
          uri: httpUrl,
          contentType: 'hls' as const,
          metadata: { title: params.title, artist: 'Đặng Việt Anh Offline' },
        };
      }
      return params.offlineUri
        ? {
            uri: params.offlineUri,
            contentType: 'hls' as const,
            metadata: { title: params.title, artist: 'Đặng Việt Anh Offline' },
          }
        : null;
    }
    const mp4Uri = params.offlineUri || httpUrl;
    if (!mp4Uri) return null;
    return {
      uri: mp4Uri,
      contentType: 'progressive' as const,
      metadata: { title: params.title, artist: 'Đặng Việt Anh Offline' },
    };
  }, [isHlsOffline, localServerPort, offlineItem?.relative_entry, params.offlineUri, params.title]);

  // Load local VTT subtitle files into cue arrays
  useEffect(() => {
    const tracks = offlineItem?.subtitles || [];
    if (tracks.length === 0) {
      setParsedCuesByIdx([]);
      return;
    }
    let active = true;
    Promise.all(
      tracks.map(async (t) => {
        try {
          const text = await FileSystem.readAsStringAsync(t.local_uri);
          return parseVttCues(text);
        } catch {
          return [];
        }
      })
    ).then((all) => {
      if (active) {
        setParsedCuesByIdx(all);
        setActiveSubIndex(0);
      }
    });
    return () => {
      active = false;
    };
  }, [offlineItem?.id, offlineItem?.subtitles]);

  const activeCueText = useMemo(() => {
    if (!settings.subtitleEnabled) return '';
    const cues = parsedCuesByIdx[activeSubIndex];
    if (!cues || cues.length === 0) return '';
    const hit = cues.find((c) => currentTime >= c.start && currentTime <= c.end);
    return hit ? hit.text : '';
  }, [settings.subtitleEnabled, parsedCuesByIdx, activeSubIndex, currentTime]);

  const player = useVideoPlayer(null, (p) => {
    p.allowsExternalPlayback = false;
    p.timeUpdateEventInterval = 0.5;
    p.keepScreenOnWhilePlaying = true;
    p.staysActiveInBackground = Boolean(settings.pipEnabled);
  });

  useEffect(() => {
    try {
      player.staysActiveInBackground = Boolean(settings.pipEnabled);
    } catch {}
  }, [player, settings.pipEnabled]);

  useEffect(() => {
    if (!playbackSource) return;
    if (isHlsOffline && !playbackSource.uri.startsWith('http://127.0.0.1') && localServerPort <= 0) {
      // Wait for local loopback HTTP server if available before falling back to file://
    }
    restoredForIdRef.current = '';
    setCurrentTime(0);
    setDuration(offlineItem?.duration_sec || 0);
    setHudVisible(true);
    player.replaceAsync(playbackSource).catch(() => {});
  }, [playbackSource, isHlsOffline, localServerPort, offlineItem?.duration_sec, player]);

  useEffect(() => {
    const subTime = player.addListener('timeUpdate', (e) => {
      const sec = e.currentTime || 0;
      setCurrentTime(sec);
      if (player.duration > 0) setDuration(player.duration);
      if (offlineItem?.id && sec > 3 && Math.abs(sec - lastSavedResumeRef.current) >= 5) {
        lastSavedResumeRef.current = sec;
        void saveOfflineResumePosition(offlineItem.id, sec, player.duration || offlineItem.duration_sec);
      }
    });
    const subPlay = player.addListener('playingChange', (e) => {
      setIsPlaying(e.isPlaying);
    });
    const subLoad = player.addListener('sourceLoad', (e) => {
      onReady();
      if (e.duration > 0) setDuration(e.duration);
      player.playbackRate = playbackRate;
      const itemKey = offlineItem?.id || params.offlineUri || '';
      if (itemKey && restoredForIdRef.current !== itemKey) {
        restoredForIdRef.current = itemKey;
        const savedResume = offlineItem?.resume_sec || 0;
        const skipIntro = settings.autoSkipIntro ? offlineItem?.skip_intro_sec || 0 : 0;
        const seekTarget =
          savedResume > 5 && (!e.duration || savedResume < e.duration - 15)
            ? savedResume
            : skipIntro > 0 && (!e.duration || skipIntro < e.duration - 30)
              ? skipIntro
              : 0;
        if (seekTarget > 0) {
          try {
            player.currentTime = seekTarget;
          } catch {}
        }
      }
      if (isLockedRef.current) {
        try {
          player.pause();
        } catch {}
      } else {
        player.play();
      }
    });
    const subStatus = player.addListener('statusChange', (e) => {
      if (e.status === 'readyToPlay') {
        onReady();
      } else if (e.status === 'error') {
        onReady();
        showToast('Không thể phát tệp ngoại tuyến này');
      }
    });
    return () => {
      subTime.remove();
      subPlay.remove();
      subLoad.remove();
      subStatus.remove();
    };
  }, [
    player,
    playbackRate,
    onReady,
    showToast,
    offlineItem?.id,
    offlineItem?.resume_sec,
    offlineItem?.skip_intro_sec,
    offlineItem?.duration_sec,
    params.offlineUri,
    settings.autoSkipIntro,
  ]);

  // Snapshot playing state before backgrounding in case Face ID locks
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        if (!isLockedRef.current) {
          const playingNow =
            Boolean((player as { playing?: boolean }).playing) || isPlayingRef.current;
          preBackgroundPlayingRef.current = playingNow;
        }
      } else if (!isLockedRef.current) {
        preBackgroundPlayingRef.current = null;
      }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = isLocked;
    if (!isLocked) {
      const shouldResume = wasLocked && wasPlayingBeforeLockRef.current;
      wasPlayingBeforeLockRef.current = false;
      preBackgroundPlayingRef.current = null;
      if (shouldResume) {
        try {
          player.play();
        } catch {}
      }
      return;
    }

    if (!wasLocked) {
      const snapshot = preBackgroundPlayingRef.current;
      preBackgroundPlayingRef.current = null;
      wasPlayingBeforeLockRef.current =
        snapshot !== null
          ? snapshot
          : Boolean((player as { playing?: boolean }).playing) || isPlayingRef.current;
    }
    try {
      player.pause();
    } catch {}
  }, [isLocked, player]);

  const scheduleHideHud = useCallback(() => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    if (activePanel !== null) return;
    hudTimerRef.current = setTimeout(() => {
      setHudVisible(false);
    }, 4500);
  }, [activePanel]);

  useEffect(() => {
    if (hudVisible && activePanel === null) {
      scheduleHideHud();
    } else if (hudTimerRef.current) {
      clearTimeout(hudTimerRef.current);
    }
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    };
  }, [hudVisible, activePanel, scheduleHideHud]);

  useEffect(() => {
    if (sleepMinutesLeft === null) return;
    if (sleepMinutesLeft <= 0) {
      try {
        player.pause();
      } catch {}
      setSleepMinutesLeft(null);
      showToast('Hẹn giờ ngủ: đã tạm dừng phim');
      return;
    }
    const timer = setTimeout(() => {
      setSleepMinutesLeft((m) => (m !== null ? Math.max(0, m - 1) : null));
    }, 60000);
    return () => clearTimeout(timer);
  }, [sleepMinutesLeft, player, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (offlineItem?.id && currentTimeRef.current > 3) {
        void saveOfflineResumePosition(
          offlineItem.id,
          currentTimeRef.current,
          durationRef.current || offlineItem.duration_sec
        );
      }
      try {
        player.pause();
      } catch {}
    };
  }, [player, offlineItem?.id, offlineItem?.duration_sec]);

  const scrubberPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const bw = barWidthRef.current;
          if (bw <= 0 || durationRef.current <= 0) return;
          const r = Math.max(0, Math.min(1, e.nativeEvent.locationX / bw));
          setDragRatio(r);
          scheduleHideHud();
        },
        onPanResponderMove: (e) => {
          const bw = barWidthRef.current;
          if (bw <= 0 || durationRef.current <= 0) return;
          const r = Math.max(0, Math.min(1, e.nativeEvent.locationX / bw));
          setDragRatio(r);
        },
        onPanResponderRelease: (e) => {
          const bw = barWidthRef.current;
          const dur = durationRef.current;
          if (bw > 0 && dur > 0) {
            const r = Math.max(0, Math.min(1, e.nativeEvent.locationX / bw));
            player.currentTime = r * dur;
          }
          setDragRatio(null);
          scheduleHideHud();
        },
        onPanResponderTerminate: () => {
          setDragRatio(null);
        },
      }),
    [player, scheduleHideHud]
  );

  const syntheticEpisodes: EpisodeItem[] = useMemo(
    () =>
      offlineEpisodes.map((it, idx) => ({
        episodes_id: it.episode_id || idx + 1,
        seasons_id: 0,
        episodes_name: it.episode_title || `Tập ${it.episode_number || idx + 1}`,
        stream_code: it.stream_code,
        player_url: '',
        full_url: '',
        order: it.episode_number || idx + 1,
      })),
    [offlineEpisodes]
  );

  const nextOfflineEpisode = useMemo(() => {
    if (!offlineItem || offlineEpisodes.length <= 1) return null;
    const idx = offlineEpisodes.findIndex((i) => i.id === offlineItem.id);
    if (idx < 0 || idx + 1 >= offlineEpisodes.length) return null;
    return offlineEpisodes[idx + 1];
  }, [offlineItem, offlineEpisodes]);

  const syntheticResolved: StreamResolvedData | null = useMemo(() => {
    const subs = (offlineItem?.subtitles || []).map((s) => ({
      label: s.label,
      url: s.local_uri,
      lang: s.lang,
    }));
    if (subs.length === 0 && syntheticEpisodes.length === 0) return null;
    return {
      success: true,
      stream_code: params.streamCode,
      can_play_native: true,
      primary_url: '',
      stream_type: isHlsOffline ? 'hls' : 'mp4',
      download_mp4_url: '',
      qualities: [],
      subtitles: subs,
      skip_intro_sec: offlineItem?.skip_intro_sec || 0,
      end_credits_sec: offlineItem?.end_credits_sec || 0,
      next_episode_slug: '',
      resume_seconds: offlineItem?.resume_sec || 0,
      webview_url: '',
      episodes: syntheticEpisodes,
    };
  }, [offlineItem, params.streamCode, isHlsOffline, syntheticEpisodes]);

  const effectiveRatio =
    dragRatio !== null
      ? dragRatio
      : duration > 0
        ? Math.min(1, Math.max(0, currentTime / duration))
        : 0;
  const shownClockSec = dragRatio !== null ? dragRatio * duration : currentTime;
  const progressPct = effectiveRatio * 100;
  const displayMetaParts = [
    params.episodeTitle,
    `Ngoại tuyến (${isHlsOffline ? 'HLS' : 'MP4'})`,
    duration > 0 ? formatClock(duration) : '',
  ].filter(Boolean);

  return (
    <View style={[styles.flex, { backgroundColor: '#000000' }]}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={settings.videoFillMode || 'contain'}
        nativeControls={false}
        allowsPictureInPicture={settings.pipEnabled}
        startsPictureInPictureAutomatically={settings.pipEnabled}
        onPictureInPictureStart={() => onPipChange(true)}
        onPictureInPictureStop={() => onPipChange(false)}
      />

      {settings.highContrastMode ? (
        <View pointerEvents="none" style={styles.contrastBoostFrame} />
      ) : null}

      {activeCueText ? (
        <View
          pointerEvents="none"
          style={[
            styles.subOverlayWrap,
            { bottom: Math.max(20, settings.subtitleBottomOffset || 34) },
          ]}
        >
          <Text
            style={[
              styles.subOverlayTxt,
              {
                fontSize: settings.subtitleFontSize || 17,
                backgroundColor: `rgba(0, 0, 0, ${settings.subtitleBgOpacity ?? 0.55})`,
              },
            ]}
          >
            {activeCueText}
          </Text>
        </View>
      ) : null}

      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => {
          if (activePanel) {
            setActivePanel(null);
          } else {
            setHudVisible((v) => !v);
          }
        }}
      />

      {toastMsg ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <GlassSurface intensity={65} radius={RADII.pill} style={styles.toastCard}>
            <Ionicons name="sparkles" size={14} color={COLORS.accent} />
            <Text style={styles.toastTxt}>{toastMsg}</Text>
          </GlassSurface>
        </View>
      ) : null}

      {hudVisible ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.hudLayer,
            {
              paddingLeft: Math.max(20, insets.left + 10),
              paddingRight: Math.max(20, insets.right + 10),
              paddingTop: 14,
              paddingBottom: 14,
            },
          ]}
        >
          <View style={styles.topHud}>
            <View style={styles.topLeft}>
              <TouchableOpacity
                style={styles.glassIconBtn}
                onPress={() => {
                  try {
                    player.pause();
                  } catch {}
                  onClose();
                }}
              >
                <Ionicons name="chevron-back" size={23} color="#FFF" />
              </TouchableOpacity>
              <View style={{ maxWidth: winWidth * 0.44 }}>
                <Text style={styles.hudTitle} numberOfLines={1}>
                  {params.title}
                </Text>
                <Text style={styles.hudSub} numberOfLines={1}>
                  {displayMetaParts.join(' • ')}
                </Text>
              </View>
            </View>

            <GlassSurface intensity={56} radius={RADII.pill} style={styles.topRightCapsule}>
              {(offlineItem?.subtitles?.length || 0) > 0 ? (
                <TouchableOpacity
                  style={styles.capsuleIconBtn}
                  onPress={() => setActivePanel('subtitles')}
                >
                  <Ionicons name="chatbox-ellipses-outline" size={18} color="#FFF" />
                </TouchableOpacity>
              ) : null}
              {settings.pipEnabled ? (
                <TouchableOpacity
                  style={styles.capsuleIconBtn}
                  onPress={async () => {
                    Haptics.selectionAsync();
                    scheduleHideHud();
                    try {
                      if (
                        typeof isPictureInPictureSupported === 'function' &&
                        !isPictureInPictureSupported()
                      ) {
                        showToast('Thiết bị hiện chưa hỗ trợ thu nhỏ khung hình');
                        return;
                      }
                      await videoViewRef.current?.startPictureInPicture();
                    } catch {
                      showToast('Không thể mở thu nhỏ khung hình lúc này');
                    }
                  }}
                >
                  <Ionicons name="albums-outline" size={18} color="#FFF" />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.capsuleIconBtn}
                onPress={() => setActivePanel('settings')}
              >
                <Ionicons name="settings-outline" size={19} color="#FFF" />
              </TouchableOpacity>
            </GlassSurface>
          </View>

          <GlassSurface
            intensity={54}
            radius={RADII.pill}
            style={[styles.sideToggles, { right: Math.max(16, insets.right + 10) }]}
          >
            <TouchableOpacity
              style={[
                styles.sideIconBtn,
                settings.highContrastMode && styles.sideIconBtnActive,
              ]}
              onPress={() => {
                const nextVal = !settings.highContrastMode;
                Haptics.selectionAsync();
                updateSetting('highContrastMode', nextVal);
                showToast(nextVal ? 'Đã bật Tăng độ tương phản' : 'Đã tắt Tăng độ tương phản');
                scheduleHideHud();
              }}
            >
              <Ionicons name="contrast" size={18} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sideIconBtn,
                settings.videoFillMode === 'cover' && styles.sideIconBtnActive,
              ]}
              onPress={() => {
                const nextMode = settings.videoFillMode === 'cover' ? 'contain' : 'cover';
                Haptics.selectionAsync();
                updateSetting('videoFillMode', nextMode);
                showToast(nextMode === 'cover' ? 'Tràn viền màn hình: Bật' : 'Tỷ lệ màn hình gốc');
                scheduleHideHud();
              }}
            >
              <Ionicons name="scan" size={17} color="#FFF" />
            </TouchableOpacity>
          </GlassSurface>

          <View style={styles.centerControls} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.seekBtn}
              onPress={() => {
                Haptics.selectionAsync();
                player.currentTime = Math.max(0, player.currentTime - 10);
                scheduleHideHud();
              }}
            >
              <Ionicons name="play-back" size={26} color="#FFF" />
              <Text style={styles.seekLabel}>10s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mainPlayBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (player.playing) player.pause();
                else player.play();
                scheduleHideHud();
              }}
            >
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.seekBtn}
              onPress={() => {
                Haptics.selectionAsync();
                player.currentTime = player.currentTime + 10;
                scheduleHideHud();
              }}
            >
              <Ionicons name="play-forward" size={26} color="#FFF" />
              <Text style={styles.seekLabel}>10s</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bottomSection}>
            <View style={styles.timeHeaderRow}>
              <Text style={styles.timeTxt}>
                {formatClock(shownClockSec)} / {formatClock(duration)}
              </Text>
              {sleepMinutesLeft !== null ? (
                <Text style={styles.sleepBadge}>Hẹn tắt: {sleepMinutesLeft}p</Text>
              ) : null}
            </View>

            <View
              style={styles.scrubberHit}
              onLayout={(e) => setBarWidth(e.nativeEvent.layout.width || 400)}
              {...scrubberPanResponder.panHandlers}
            >
              <View style={styles.scrubberBg}>
                <View style={[styles.scrubberFill, { width: `${progressPct}%` }]} />
              </View>
              <View style={[styles.scrubberThumb, { left: `${progressPct}%` }]} />
            </View>

            <View style={styles.actionBarRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={styles.actionsLeftScroll}
              >
                {nextOfflineEpisode && onSwitchOfflineItem ? (
                  <TouchableOpacity
                    style={styles.actionPill}
                    onPress={() => onSwitchOfflineItem(nextOfflineEpisode)}
                  >
                    <Ionicons name="play-skip-forward" size={15} color="#FFF" />
                    <Text style={styles.actionPillTxt}>Tập tiếp theo</Text>
                  </TouchableOpacity>
                ) : null}
                {syntheticEpisodes.length > 1 ? (
                  <TouchableOpacity
                    style={[styles.actionPill, styles.actionIconPill]}
                    onPress={() => setActivePanel('episodes')}
                  >
                    <Ionicons name="list-outline" size={18} color="#FFF" />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={[styles.actionPill, styles.actionIconPill]}
                  onPress={() => setActivePanel('info')}
                >
                  <Ionicons name="person-circle-outline" size={18} color="#FFF" />
                </TouchableOpacity>
              </ScrollView>

              <View style={styles.actionsRightFixed}>
                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => setActivePanel('speed')}
                >
                  <Ionicons name="play" size={12} color="#FFF" />
                  <Text style={styles.actionPillTxt}>{playbackRate}x</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      ) : null}

      <PlayerOverlayPanels
        activePanel={activePanel}
        onClose={() => setActivePanel(null)}
        onSwitchPanel={setActivePanel}
        title={params.title}
        episodeTitle={params.episodeTitle}
        currentStreamCode={params.streamCode}
        resolved={syntheticResolved}
        activeQuality={null}
        onSelectQuality={() => {}}
        onSelectSourceServer={() => {}}
        episodes={syntheticEpisodes}
        seasons={[]}
        onSelectEpisode={(_ep, idx) => {
          const targetItem = offlineEpisodes[idx];
          if (targetItem && onSwitchOfflineItem) {
            onSwitchOfflineItem(targetItem);
          }
        }}
        activeSubIndex={activeSubIndex}
        onSelectSubtitleIndex={(idx) => setActiveSubIndex(idx)}
        playbackRate={playbackRate}
        onSelectRate={(rate) => {
          setPlaybackRate(rate);
          player.playbackRate = rate;
          showToast(`Tốc độ phát: ${rate}x`);
        }}
        settings={settings}
        onUpdateSetting={(key, val) => updateSetting(key, val)}
        sleepMinutesLeft={sleepMinutesLeft}
        onSelectSleepTimer={(mins) => {
          setSleepMinutesLeft(mins);
          showToast(mins ? `Hẹn giờ tắt sau ${mins} phút` : 'Đã tắt hẹn giờ ngủ');
        }}
        inWishlist={false}
        onToggleWishlist={() => {}}
        offlineItem={offlineItem || null}
        onDownloadOffline={() => {}}
        onOpenWebPlayer={() => {}}
        user={user}
      />
    </View>
  );
}

interface ActiveEpisodeCtx {
  streamCode: string;
  serverTitle: string;
  serverTapPhim: string;
  serverFileKey: string;
  nextStreamCode: string;
  title: string;
  episodeTitle: string;
}

export function PlayerModal({
  visible,
  params,
  onClose,
  onSwitchOfflineItem,
  onOpenCast,
}: PlayerModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { cookies, isLocked } = useAuth();
  const { settings } = useSettings();
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const winDimsRef = useRef({ width: winWidth, height: winHeight });
  winDimsRef.current = { width: winWidth, height: winHeight };

  const [deviceHglk, setDeviceHglk] = useState<string>(cachedDeviceHglk || '');
  const [webHudReady, setWebHudReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [renderSkeleton, setRenderSkeleton] = useState(true);
  const [localServerPort, setLocalServerPort] = useState<number>(() =>
    getCachedOfflineMediaServerPort()
  );
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [offlineSheetOpen, setOfflineSheetOpen] = useState(false);
  const [activeEpisodeCtx, setActiveEpisodeCtx] = useState<ActiveEpisodeCtx | null>(null);
  const [detailEpisodes, setDetailEpisodes] = useState<EpisodeItem[]>([]);
  const [moviePosterMeta, setMoviePosterMeta] = useState<{ poster: string; thumb: string }>({
    poster: '',
    thumb: '',
  });

  const webProgressRef = useRef({ position: 0, duration: 0 });
  const skeletonOpacity = useRef(new Animated.Value(0)).current;
  const skeletonShownAtRef = useRef(0);
  const [proxyConfig, setProxyConfigState] = useState(() => getProxyConfig());
  const isProxyActive = useMemo(
    () => isNativeProxySupported() && isProxyActiveForConfig(proxyConfig),
    [proxyConfig]
  );

  const webViewRef = useRef<React.ComponentRef<typeof WebView> | null>(null);
  const isInPipRef = useRef(false);
  const pipRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLockedRef = useRef(isLocked);
  const lastAutoQueuedSigRef = useRef('');
  const detailEpisodesRef = useRef<EpisodeItem[]>([]);
  detailEpisodesRef.current = detailEpisodes;
  const fetchedDetailForVideoRef = useRef(0);
  const prevPreferOfflineRef = useRef(settings.preferOfflineWhenOnline);

  const isOfflineMode = Boolean(params?.offlineUri || params?.offlineItem);
  const activeStreamCode = params?.streamCode || '';

  useEffect(() => {
    return subscribeProxyConfig(setProxyConfigState);
  }, []);

  useEffect(() => {
    loadOfflineDownloads().then(setOfflineItems).catch(() => {});
    return subscribeOfflineDownloads(setOfflineItems);
  }, []);

  // Ensure local HTTP loopback server is running for offline HLS & local-first online playback
  useEffect(() => {
    if (!visible) return;
    ensureOfflineMediaServer(getOfflineRootDir())
      .then((port) => {
        if (port > 0) setLocalServerPort(port);
      })
      .catch(() => {});
  }, [visible]);

  // Seed episode list & poster metadata when online player opens
  useEffect(() => {
    if (!visible || !params || isOfflineMode) return;
    setMoviePosterMeta({
      poster: params.posterUrl || '',
      thumb: params.thumbnailUrl || '',
    });
    if (params.episodes && params.episodes.length > 0) {
      setDetailEpisodes(params.episodes);
      fetchedDetailForVideoRef.current = params.videosId;
    } else if (params.videosId > 0 && fetchedDetailForVideoRef.current !== params.videosId) {
      fetchedDetailForVideoRef.current = params.videosId;
      fetchMovieDetailsApi(params.videosId)
        .then((res) => {
          if (!res?.movie) return;
          const allEps =
            res.movie.episodes && res.movie.episodes.length > 0
              ? res.movie.episodes
              : res.movie.seasons?.[0]?.episodes || [];
          setDetailEpisodes(allEps);
          setMoviePosterMeta({
            poster: res.movie.poster_url || '',
            thumb: res.movie.thumbnail_url || '',
          });
        })
        .catch(() => {});
    }
  }, [visible, params, isOfflineMode]);

  // Preload device _hglk cookie token in background once on mount
  useEffect(() => {
    if (!cachedDeviceHglk) {
      getOrCreateDeviceHglk()
        .then((val) => setDeviceHglk((prev) => prev || val))
        .catch(() => {});
    }
  }, []);

  const clearPipRestoreTimer = useCallback(() => {
    if (pipRestoreTimerRef.current) {
      clearTimeout(pipRestoreTimerRef.current);
      pipRestoreTimerRef.current = null;
    }
  }, []);

  const scheduleLandscapeRestoreAfterPip = useCallback(() => {
    clearPipRestoreTimer();
    pipRestoreTimerRef.current = setTimeout(() => {
      pipRestoreTimerRef.current = null;
      if (
        visible &&
        !isInPipRef.current &&
        AppState.currentState === 'active' &&
        winDimsRef.current.width < winDimsRef.current.height
      ) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      }
    }, 650);
  }, [visible, clearPipRestoreTimer]);

  // Pause WebView playback whenever app is locked by Face ID
  const pauseWebViewForLock = useCallback(() => {
    if (isOfflineMode) return;
    webViewRef.current?.injectJavaScript(`
      (function() {
        try {
          window.__dvaAppLockedPaused = true;
          if (typeof window.__dvaWasPlayingBeforeLock !== 'boolean') {
            var playingNow = false;
            try {
              if (window.jwplayer) {
                var jwInst = window.jwplayer();
                var jwSt = jwInst && typeof jwInst.getState === 'function' ? jwInst.getState() : '';
                if (jwSt === 'playing' || jwSt === 'buffering') playingNow = true;
              }
            } catch (e) {}
            if (!playingNow) {
              var vidsCheck = document.getElementsByTagName('video');
              for (var k = 0; k < vidsCheck.length; k++) {
                if (!vidsCheck[k].paused && !vidsCheck[k].ended) {
                  playingNow = true;
                  break;
                }
              }
            }
            window.__dvaWasPlayingBeforeLock = playingNow;
          }
          if (window.jwplayer) {
            var jw = window.jwplayer();
            if (jw && typeof jw.pause === 'function') jw.pause();
          }
          var vids = document.getElementsByTagName('video');
          for (var i = 0; i < vids.length; i++) {
            vids[i].pause();
          }
        } catch (e) {}
      })();
      true;
    `);
  }, [isOfflineMode]);

  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = isLocked;

    if (!visible || isOfflineMode) {
      return;
    }

    if (!isLocked) {
      webViewRef.current?.injectJavaScript(`
        (function() {
          try {
            window.__dvaAppLockedPaused = false;
            var shouldResume = ${wasLocked ? 'Boolean(window.__dvaWasPlayingBeforeLock)' : 'false'};
            window.__dvaWasPlayingBeforeLock = undefined;
            if (shouldResume) {
              if (window.jwplayer) {
                var jw = window.jwplayer();
                if (jw && typeof jw.play === 'function') {
                  jw.play(true);
                  return;
                }
              }
              var vids = document.getElementsByTagName('video');
              for (var i = 0; i < vids.length; i++) {
                if (vids[i].paused && !vids[i].ended) {
                  var pr = vids[i].play();
                  if (pr && typeof pr.catch === 'function') pr.catch(function() {});
                }
              }
            }
          } catch (e) {}
        })();
        true;
      `);
      return;
    }

    if (AppState.currentState === 'active') {
      pauseWebViewForLock();
    }

    const lockGuardTimer = setInterval(() => {
      if (AppState.currentState === 'active') {
        pauseWebViewForLock();
      }
    }, 700);

    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isLockedRef.current) {
        pauseWebViewForLock();
      }
    });

    return () => {
      clearInterval(lockGuardTimer);
      sub.remove();
    };
  }, [visible, isLocked, isOfflineMode, pauseWebViewForLock]);

  // Ensure _hglk is ready on open and reset state cleanly on close
  useEffect(() => {
    if (!visible) {
      isInPipRef.current = false;
      clearPipRestoreTimer();
      setWebHudReady(false);
      setOfflineReady(false);
      setOfflineSheetOpen(false);
      setActiveEpisodeCtx(null);
      lastAutoQueuedSigRef.current = '';
      return;
    }

    let cancelled = false;
    const readyHglk = cachedDeviceHglk || deviceHglk;
    if (readyHglk) {
      if (!deviceHglk) setDeviceHglk(readyHglk);
    } else {
      (async () => {
        try {
          const hglkVal = await getOrCreateDeviceHglk();
          if (!cancelled) setDeviceHglk(hglkVal);
        } catch {
          if (!cancelled) {
            setDeviceHglk((prev) => prev || cachedDeviceHglk || generateHglkToken(24));
          }
        }
      })();
    }

    return () => {
      cancelled = true;
      clearPipRestoreTimer();
    };
  }, [visible, deviceHglk, clearPipRestoreTimer]);

  // Reset per-stream ready flags when opening or switching stream
  useEffect(() => {
    if (!visible || !params) return;
    setWebHudReady(false);
    setOfflineReady(false);
    webProgressRef.current = { position: 0, duration: 0 };
  }, [visible, params, activeStreamCode]);

  const handleClose = useCallback(() => {
    if (
      params &&
      !params.offlineUri &&
      !params.offlineItem &&
      webProgressRef.current.position > 5
    ) {
      const { episodeNumber, seasonId } = resolveEpisodeMetaFromParams(params, activeStreamCode);
      saveWatchProgressApi({
        videos_id: params.videosId,
        stream_code: activeStreamCode,
        position_sec: webProgressRef.current.position,
        duration_sec: webProgressRef.current.duration,
        episode_number: episodeNumber,
        season_id: seasonId,
        title: params.title,
      }).catch(() => {});
    }
    setOfflineSheetOpen(false);
    isInPipRef.current = false;
    clearPipRestoreTimer();
    onClose();
  }, [params, activeStreamCode, clearPipRestoreTimer, onClose]);

  const playerMeta = useMemo(
    () => ({
      videos_id: params?.videosId || 0,
      episode_id: params?.episodeId || 0,
      title: params?.episodeTitle
        ? `${params?.title || ''} • ${params.episodeTitle}`
        : params?.title || '',
      is_tvseries: (params?.episodes && params.episodes.length > 0) || Boolean(params?.episodeId) ? 1 : 0,
    }),
    [params]
  );

  // Live Local Offline Registry for WebView Local-First playback
  const offlineRegistry = useMemo(
    () => buildOfflineRegistryForWebView(localServerPort, settings.preferOfflineWhenOnline),
    [localServerPort, offlineItems, settings.preferOfflineWhenOnline]
  );
  const offlineRegistryRef = useRef(offlineRegistry);
  offlineRegistryRef.current = offlineRegistry;

  // Push registry updates + download status badge to running WebView whenever local files or preference change
  useEffect(() => {
    if (!visible || isOfflineMode || !webHudReady) return;
    const prefJustTurnedOn =
      !prevPreferOfflineRef.current && settings.preferOfflineWhenOnline;
    prevPreferOfflineRef.current = settings.preferOfflineWhenOnline;

    const currentCode = activeEpisodeCtx?.streamCode || activeStreamCode;
    const matchedItem = offlineItems.find(
      (i) =>
        (currentCode && i.stream_code === currentCode) ||
        (params?.videosId && i.videos_id === params.videosId && i.episode_id === (params.episodeId || 0))
    );
    const badgeState = {
      downloaded: matchedItem?.status === 'completed',
      downloading:
        matchedItem?.status === 'downloading' ||
        matchedItem?.status === 'preparing' ||
        matchedItem?.status === 'queued',
      progress: matchedItem?.progress || 0,
    };

    const forceSwitch = prefJustTurnedOn || matchedItem?.status === 'completed';
    webViewRef.current?.injectJavaScript(`
      try {
        if (typeof window.__dvaIosUpdateOfflineRegistry === 'function') {
          window.__dvaIosUpdateOfflineRegistry(${JSON.stringify(offlineRegistry)}, ${forceSwitch ? 'true' : 'false'});
        }
        if (typeof window.__dvaIosUpdateDownloadBadge === 'function') {
          window.__dvaIosUpdateDownloadBadge(${JSON.stringify(badgeState)});
        }
      } catch (e) {}
      true;
    `);
  }, [
    visible,
    isOfflineMode,
    webHudReady,
    offlineRegistry,
    offlineItems,
    activeEpisodeCtx?.streamCode,
    activeStreamCode,
    params?.videosId,
    params?.episodeId,
    settings.preferOfflineWhenOnline,
  ]);

  // Auto-download current episode and/or next xx episodes when consented in Settings
  useEffect(() => {
    if (!visible || isOfflineMode || !params?.videosId) return;
    const epCode = activeEpisodeCtx?.streamCode || activeStreamCode;
    if (!epCode) return;

    const wantCurrent = settings.autoDownloadCurrentOnWatch;
    const nextCount = Math.max(0, settings.autoDownloadNextCount || 0);
    if (!wantCurrent && nextCount === 0) return;

    const epList =
      detailEpisodes.length > 0 ? detailEpisodes : params.episodes || [];
    const sig = `${params.videosId}|${epCode}|${wantCurrent ? 1 : 0}|${nextCount}|${epList.length}`;
    if (lastAutoQueuedSigRef.current === sig) return;

    const curItemInLib = offlineItems.find(
      (i) =>
        i.videos_id === params.videosId &&
        (i.stream_code === epCode ||
          (activeEpisodeCtx?.serverFileKey && i.server_file_key === activeEpisodeCtx.serverFileKey))
    );
    const currentIsDownloadedOrActive = Boolean(
      curItemInLib &&
        (curItemInLib.status === 'completed' ||
          curItemInLib.status === 'downloading' ||
          curItemInLib.status === 'preparing' ||
          curItemInLib.status === 'queued')
    );

    if (!wantCurrent && !currentIsDownloadedOrActive) {
      return;
    }

    lastAutoQueuedSigRef.current = sig;

    const targets =
      epList.length > 0
        ? getCurrentAndNextEpisodes(epList, epCode, nextCount)
        : [
            {
              episodes_id: params.episodeId || 0,
              seasons_id: Number(params.seasonId || 0) || 0,
              episodes_name: activeEpisodeCtx?.episodeTitle || params.episodeTitle || '',
              stream_code: epCode,
              player_url: '',
              full_url: '',
              order: 1,
            },
          ];

    const filteredTargets = wantCurrent
      ? targets
      : targets.filter((t) => t.stream_code !== epCode);

    if (filteredTargets.length === 0) return;

    const requests: OfflineEnqueueParams[] = filteredTargets.map((ep) => {
      const isCur = ep.stream_code === epCode;
      return {
        videos_id: params.videosId,
        episode_id: ep.episodes_id || 0,
        stream_code: ep.stream_code,
        title: params.title,
        episode_title: ep.episodes_name || (isCur ? activeEpisodeCtx?.episodeTitle : undefined),
        server_movie_title: activeEpisodeCtx?.serverTitle || undefined,
        server_file_key: isCur ? activeEpisodeCtx?.serverFileKey || undefined : undefined,
        poster_url: moviePosterMeta.poster || moviePosterMeta.thumb || '',
        thumbnail_url: moviePosterMeta.thumb || moviePosterMeta.poster || '',
        preferred_format: settings.offlineDownloadFormat,
        concurrency: settings.offlineDownloadConcurrency,
      };
    });

    void enqueueEpisodeBatch(requests);
  }, [
    visible,
    isOfflineMode,
    params,
    activeEpisodeCtx,
    activeStreamCode,
    detailEpisodes,
    offlineItems,
    moviePosterMeta,
    settings.autoDownloadCurrentOnWatch,
    settings.autoDownloadNextCount,
    settings.offlineDownloadFormat,
    settings.offlineDownloadConcurrency,
  ]);

  const cookieBootstrapJs = useMemo(() => {
    const autoNextStr = settings.autoPlayNext ? '1' : '0';
    const qualityStr = settings.preferredQuality || 'auto';
    const safeHglk = deviceHglk || cachedDeviceHglk || '';
    const hglkJs = safeHglk
      ? `
        document.cookie = "_hglk=${safeHglk}; path=/; domain=.dangvietanh.com; max-age=2592000; SameSite=Lax";
        document.cookie = "_hglk=${safeHglk}; path=/; max-age=2592000; SameSite=Lax";
        sessionStorage.setItem('id_cookie', ${JSON.stringify(safeHglk)});
      `
      : '';
    const cookieLines = cookies
      ? `
        document.cookie = "_userid=${cookies._userid}; path=/; domain=.dangvietanh.com; max-age=2592000; SameSite=Lax";
        document.cookie = "_userid=${cookies._userid}; path=/; max-age=2592000; SameSite=Lax";
        document.cookie = "${cookies.email_key}=${cookies.email_val}; path=/; domain=.dangvietanh.com; max-age=2592000; SameSite=Lax";
        document.cookie = "${cookies.pass_key}=${cookies.pass_val}; path=/; domain=.dangvietanh.com; max-age=2592000; SameSite=Lax";
      `
      : '';
    return `
      try {
        document.documentElement.classList.add('dva-ios-app-mode');
        document.cookie = "dva_ios_app=1; path=/; domain=.dangvietanh.com; max-age=2592000; SameSite=Lax";
        document.cookie = "dva_ios_app=1; path=/; max-age=2592000; SameSite=Lax";
        ${hglkJs}
        ${cookieLines}
        localStorage.setItem('dva_ios_app_local', '1');
        localStorage.setItem('dva_play_app_local', '1');
        localStorage.setItem('dva_ios_pip_enabled', ${JSON.stringify(settings.pipEnabled ? '1' : '0')});
        localStorage.setItem('may_chu_toi_uu_E1s5Km5Hv1Vf4Us', '1');
        localStorage.setItem('menu_3Gc4Ti8Bx1Mx8Wo_dangvietanh', ${JSON.stringify(settings.highContrastMode ? '1' : '0')});
        localStorage.setItem('Tự_Động_Chuyển_Tập_0Up6Ex8Ci5Zg6Te', ${JSON.stringify(autoNextStr)});
        localStorage.setItem('menu_3Gi5Co9Pr7Qi5Kf_dangvietanh', ${JSON.stringify(autoNextStr)});
        localStorage.setItem('menu_7We9Qi0Pc0Jv6Mm_dangvietanh', ${JSON.stringify(settings.videoFillMode === 'cover' ? '1' : '0')});
        localStorage.setItem('pd_trangthai', ${JSON.stringify(settings.subtitleEnabled ? '1' : '0')});
        localStorage.setItem('st_toiuu', '0');
        localStorage.setItem('st_toiuu_chat', '0');
        localStorage.setItem('st_toiuu_xc', '0');
        localStorage.setItem('st_toiuu_download', '0');
        localStorage.setItem('dvaplay_resolution', ${JSON.stringify(qualityStr)});
        sessionStorage.setItem('dva_app_current_movie_meta', ${JSON.stringify(JSON.stringify(playerMeta))});
        window.__DVA_IOS_LOCAL_OFFLINE__ = ${JSON.stringify(offlineRegistryRef.current)};
        if (${settings.pipEnabled ? 'true' : 'false'}) {
          setInterval(function () {
            var vids = document.getElementsByTagName('video');
            for (var i = 0; i < vids.length; i++) {
              var v = vids[i];
              try {
                if (v.webkitPresentationMode === 'picture-in-picture') continue;
              } catch (err) {}
              if (v.disablePictureInPicture) v.disablePictureInPicture = false;
              if (!v.hasAttribute('autopictureinpicture')) v.setAttribute('autopictureinpicture', '');
              if (!v.hasAttribute('playsinline')) v.setAttribute('playsinline', '');
              if (!v.hasAttribute('webkit-playsinline')) v.setAttribute('webkit-playsinline', '');
            }
          }, 1500);
        }
      } catch (e) {}
      true;
    `;
  }, [cookies, deviceHglk, playerMeta, settings]);

  const webviewSourceUrl = useMemo(() => {
    const code = activeStreamCode;
    if (!code) {
      return `${SITE_BASE_URL}/getlink/va/`;
    }
    const token = getApiAuthToken() || '';
    const metaB64 = encodeBase64UrlUtf8(JSON.stringify(playerMeta));
    const qs = new URLSearchParams({
      code,
      token,
      hglk: deviceHglk || cachedDeviceHglk || '',
      quality: settings.preferredQuality || 'auto',
      autonext: settings.autoPlayNext ? '1' : '0',
      meta: metaB64,
    });
    return `${API_BASE_URL}/webview_player.php?${qs.toString()}`;
  }, [activeStreamCode, deviceHglk, playerMeta, settings.preferredQuality, settings.autoPlayNext]);

  const showPlayerSkeleton = visible && (isOfflineMode ? !offlineReady : !webHudReady);

  useEffect(() => {
    if (!visible) {
      skeletonOpacity.stopAnimation();
      skeletonOpacity.setValue(0);
      skeletonShownAtRef.current = 0;
      setRenderSkeleton(true);
      return;
    }

    if (showPlayerSkeleton) {
      if (skeletonShownAtRef.current === 0) {
        skeletonShownAtRef.current = Date.now();
        skeletonOpacity.setValue(0);
      } else {
        skeletonOpacity.stopAnimation();
      }
      setRenderSkeleton(true);
      Animated.timing(skeletonOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    let cancelled = false;
    const elapsed = skeletonShownAtRef.current > 0 ? Date.now() - skeletonShownAtRef.current : 280;
    const waitMs = Math.max(0, 280 - elapsed);
    const timer = setTimeout(() => {
      if (cancelled) return;
      skeletonOpacity.stopAnimation();
      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) {
          setRenderSkeleton(false);
        }
      });
    }, waitMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, showPlayerSkeleton, skeletonOpacity]);

  useEffect(() => {
    if (!visible) return;
    if (!isOfflineMode && !webHudReady) {
      const t = setTimeout(() => setWebHudReady(true), 6000);
      return () => clearTimeout(t);
    }
    if (isOfflineMode && !offlineReady) {
      const t = setTimeout(() => setOfflineReady(true), 4200);
      return () => clearTimeout(t);
    }
  }, [visible, isOfflineMode, webHudReady, offlineReady]);

  // If opened from an already-completed online entry while Prefer Offline is enabled, ensure local offline item matches
  const matchedOfflineFallback = useMemo(() => {
    if (!isOfflineMode) return null;
    if (params?.offlineItem) return params.offlineItem;
    return findCompletedOfflineItem({
      streamCode: activeStreamCode,
      videosId: params?.videosId,
      episodeId: params?.episodeId,
    });
  }, [isOfflineMode, params, activeStreamCode]);

  const effectiveOfflineParams = useMemo(() => {
    if (!params) return null;
    if (params.offlineItem || !matchedOfflineFallback) return params;
    return {
      ...params,
      offlineItem: matchedOfflineFallback,
      offlineUri: matchedOfflineFallback.local_uri,
    };
  }, [params, matchedOfflineFallback]);

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.playerLayerRoot}>
      <View style={styles.stage}>
        {isOfflineMode && effectiveOfflineParams ? (
          <OfflineNativePlayer
            params={effectiveOfflineParams}
            localServerPort={localServerPort}
            onClose={handleClose}
            onReady={() => setOfflineReady(true)}
            onSwitchOfflineItem={onSwitchOfflineItem}
            onPipChange={(active) => {
              isInPipRef.current = active;
              if (active) {
                clearPipRestoreTimer();
              } else {
                scheduleLandscapeRestoreAfterPip();
              }
            }}
          />
        ) : (
          <View style={[styles.flex, { backgroundColor: '#000000' }]}>
            {Boolean(deviceHglk) ? (
              <WebView
                key={`wv-${proxyConfig.revision}-${isProxyActive ? 'p' : 'd'}`}
                ref={webViewRef}
                source={{ uri: webviewSourceUrl }}
                incognito={isProxyActive}
                applicationNameForUserAgent="DVAPlayiOS/1.0"
                injectedJavaScriptBeforeContentLoaded={cookieBootstrapJs}
                allowsInlineMediaPlayback
                allowsFullscreenVideo
                allowsPictureInPictureMediaPlayback={settings.pipEnabled}
                autoManageStatusBarEnabled={false}
                mediaPlaybackRequiresUserAction={false}
                contentInsetAdjustmentBehavior="never"
                bounces={false}
                sharedCookiesEnabled
                thirdPartyCookiesEnabled
                onMessage={(ev) => {
                  try {
                    const data = JSON.parse(ev.nativeEvent.data || '{}');
                    if (data.type === 'DVA_APP_PLAYER_READY') {
                      setWebHudReady(true);
                      if (isLockedRef.current) {
                        pauseWebViewForLock();
                      }
                    } else if (data.type === 'DVA_APP_PLAYER_BACK') {
                      handleClose();
                    } else if (data.type === 'DVA_IOS_OPEN_CAST') {
                      if (onOpenCast) onOpenCast();
                    } else if (data.type === 'DVA_IOS_OPEN_OFFLINE_SHEET') {
                      setActiveEpisodeCtx({
                        streamCode: String(data.streamCode || activeStreamCode),
                        serverTitle: String(data.serverTitle || ''),
                        serverTapPhim: String(data.serverTapPhim || ''),
                        serverFileKey: String(data.serverFileKey || ''),
                        nextStreamCode: String(data.nextStreamCode || ''),
                        title: String(data.title || params?.title || ''),
                        episodeTitle: String(data.episodeTitle || params?.episodeTitle || ''),
                      });
                      setOfflineSheetOpen(true);
                    } else if (data.type === 'DVA_IOS_EPISODE_CONTEXT') {
                      setActiveEpisodeCtx({
                        streamCode: String(data.streamCode || activeStreamCode),
                        serverTitle: String(data.serverTitle || ''),
                        serverTapPhim: String(data.serverTapPhim || ''),
                        serverFileKey: String(data.serverFileKey || ''),
                        nextStreamCode: String(data.nextStreamCode || ''),
                        title: String(data.title || params?.title || ''),
                        episodeTitle: String(data.episodeTitle || params?.episodeTitle || ''),
                      });
                    } else if (data.type === 'DVA_IOS_TOGGLE_PIP') {
                      isInPipRef.current = Boolean(data.active);
                      clearPipRestoreTimer();
                      Haptics.selectionAsync();
                    } else if (data.type === 'DVA_IOS_PIP_STATE') {
                      const active = Boolean(data.active);
                      isInPipRef.current = active;
                      clearPipRestoreTimer();
                      if (!active) {
                        scheduleLandscapeRestoreAfterPip();
                      }
                    } else if (data.type === 'DVA_IOS_PLAYER_PROGRESS') {
                      webProgressRef.current = {
                        position: Number(data.position) || 0,
                        duration: Number(data.duration) || 0,
                      };
                    }
                  } catch {}
                }}
                style={[styles.flex, { backgroundColor: '#000000' }]}
              />
            ) : null}

            {params ? (
              <OfflineDownloadSheet
                visible={offlineSheetOpen}
                onClose={() => setOfflineSheetOpen(false)}
                videosId={params.videosId}
                title={params.title}
                posterUrl={moviePosterMeta.poster || params.posterUrl || ''}
                thumbnailUrl={moviePosterMeta.thumb || params.thumbnailUrl || ''}
                serverMovieTitle={activeEpisodeCtx?.serverTitle}
                currentStreamCode={activeEpisodeCtx?.streamCode || activeStreamCode}
                currentEpisodeTitle={activeEpisodeCtx?.episodeTitle || params.episodeTitle}
                currentEpisodeId={params.episodeId}
                currentServerFileKey={activeEpisodeCtx?.serverFileKey}
                episodes={
                  detailEpisodes.length > 0 ? detailEpisodes : params.episodes || []
                }
              />
            ) : null}
          </View>
        )}

        {renderSkeleton || showPlayerSkeleton ? (
          <Animated.View
            pointerEvents={showPlayerSkeleton ? 'auto' : 'none'}
            style={[styles.skeletonOverlay, { opacity: skeletonOpacity }]}
          >
            <PlayerLandscapeSkeleton
              leftInset={Math.max(20, insets.left + 10)}
              rightInset={Math.max(20, insets.right + 10)}
              active={visible && (renderSkeleton || showPlayerSkeleton)}
              onBack={handleClose}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  playerLayerRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9000,
    backgroundColor: '#000000',
  },
  stage: {
    flex: 1,
    backgroundColor: '#000000',
  },
  skeletonOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
    backgroundColor: 'transparent',
  },
  flex: {
    flex: 1,
  },
  contrastBoostFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 18,
    borderColor: 'rgba(0,0,0,0.34)',
  },
  subOverlayWrap: {
    position: 'absolute',
    left: 48,
    right: 48,
    alignItems: 'center',
    zIndex: 6,
  },
  subOverlayTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    overflow: 'hidden',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  glassIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(20, 20, 20, 0.56)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.32)',
    justifyContent: 'space-between',
  },
  topHud: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  hudTitle: {
    color: '#FFF',
    fontSize: 16.5,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  hudSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  topRightCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 12,
  },
  capsuleIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideToggles: {
    position: 'absolute',
    top: '30%',
    paddingVertical: 7,
    paddingHorizontal: 5,
    gap: 7,
    alignItems: 'center',
    zIndex: 10,
  },
  sideIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideIconBtnActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.85)',
  },
  centerControls: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    transform: [{ translateY: -36 }],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
    zIndex: 8,
  },
  seekBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(20,20,20,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  seekLabel: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 1,
  },
  mainPlayBtn: {
    width: 72,
    height: 72,
    borderRadius: 26,
    backgroundColor: 'rgba(229,9,20,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  bottomSection: {
    gap: 6,
  },
  timeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeTxt: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  sleepBadge: {
    color: COLORS.accentGold,
    fontSize: 11.5,
    fontWeight: '700',
  },
  scrubberHit: {
    height: 24,
    justifyContent: 'center',
  },
  scrubberBg: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.24)',
    overflow: 'hidden',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  scrubberThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#FFF',
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionsLeftScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  actionsRightFixed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  actionPill: {
    height: 40,
    paddingHorizontal: 13,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(20, 20, 24, 0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionIconPill: {
    minWidth: 42,
    paddingHorizontal: 12,
  },
  actionPillTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  toastWrap: {
    position: 'absolute',
    top: 66,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 35,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  toastTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
});
