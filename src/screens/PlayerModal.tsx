import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
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
import { useVideoPlayer, VideoAirPlayButton, VideoView } from 'expo-video';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../components/GlassSurface';
import { PlayerOverlayPanels, PlayerPanelType } from '../components/PlayerOverlayPanels';
import { PlayerLandscapeSkeleton } from '../components/SkeletonLoaders';
import { API_BASE_URL, COLORS, RADII, SITE_BASE_URL } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import {
  getApiAuthToken,
  resolveStreamApi,
  saveWatchProgressApi,
  toggleWishlistApi,
} from '../services/api';
import {
  loadOfflineDownloads,
  startOfflineDownload,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import {
  EpisodeItem,
  OfflineDownloadItem,
  SourceItem,
  StreamQuality,
  StreamResolvedData,
} from '../types/models';

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

export interface PlayerLaunchParams {
  videosId: number;
  streamCode: string;
  episodeId?: number;
  episodeNumber?: number;
  seasonId?: string;
  title: string;
  episodeTitle?: string;
  episodes?: EpisodeItem[];
  offlineUri?: string;
}

interface PlayerModalProps {
  visible: boolean;
  params: PlayerLaunchParams | null;
  onClose: () => void;
  onSwitchEpisode?: (ep: EpisodeItem, epIndex: number) => void;
  onOpenCast?: () => void;
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  isTop?: boolean;
}

function parseTimestampSec(ts: string): number {
  const clean = ts.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

function parseVttOrSrt(raw: string): SubtitleCue[] {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const cues: SubtitleCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const [sStr, eRest] = line.split('-->');
      const start = parseTimestampSec(sStr);
      const restTokens = (eRest || '').trim().split(/\s+/);
      const end = parseTimestampSec(restTokens[0] || '');
      const lineMatch = (eRest || '').match(/line:(\d+(?:\.\d+)?)%/i);
      const isTop = lineMatch ? parseFloat(lineMatch[1]) < 25 : false;
      i++;
      const txtLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const cleaned = lines[i].replace(/<[^>]+>/g, '').trim();
        if (cleaned) txtLines.push(cleaned);
        i++;
      }
      if (txtLines.length > 0 && end > start) {
        cues.push({ start, end, text: txtLines.join('\n'), isTop });
      }
    } else {
      i++;
    }
  }
  return cues;
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

export function PlayerModal({
  visible,
  params,
  onClose,
  onSwitchEpisode,
  onOpenCast,
}: PlayerModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user, cookies } = useAuth();
  const { settings, updateSetting } = useSettings();

  const [deviceHglk, setDeviceHglk] = useState<string>(cachedDeviceHglk || '');
  const [orientationReady, setOrientationReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resolved, setResolved] = useState<StreamResolvedData | null>(null);
  const [mode, setMode] = useState<'native' | 'webview'>('native');
  const [webHudReady, setWebHudReady] = useState(false);
  const [nativeReady, setNativeReady] = useState(false);
  const [renderSkeleton, setRenderSkeleton] = useState(true);
  const webProgressRef = useRef({ position: 0, duration: 0 });
  const skeletonOpacity = useRef(new Animated.Value(1)).current;
  const [activeQuality, setActiveQuality] = useState<StreamQuality | null>(null);
  const [overrideStreamCode, setOverrideStreamCode] = useState<string | null>(null);
  const [hudVisible, setHudVisible] = useState(true);
  const [activePanel, setActivePanel] = useState<PlayerPanelType>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [barWidth, setBarWidth] = useState(400);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [subCues, setSubCues] = useState<SubtitleCue[]>([]);
  const [activeSubIndex, setActiveSubIndex] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [inWishlist, setInWishlist] = useState(false);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [sleepMinutesLeft, setSleepMinutesLeft] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [nextPromptDismissed, setNextPromptDismissed] = useState(false);
  const [nextCountdownSec, setNextCountdownSec] = useState<number | null>(null);
  const [transitionLabel, setTransitionLabel] = useState('');

  const transitionOpacity = useRef(new Animated.Value(0)).current;
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSecRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const failedQualityUrlsRef = useRef<Set<string>>(new Set());
  const barWidthRef = useRef(400);
  const durationRef = useRef(0);
  const autoSwitchedForCodeRef = useRef<string>('');

  barWidthRef.current = barWidth;
  durationRef.current = duration;

  const activeStreamCode = overrideStreamCode || params?.streamCode || '';

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 2600);
  }, []);

  const player = useVideoPlayer(null, (p) => {
    p.allowsExternalPlayback = true;
    p.timeUpdateEventInterval = 1;
    p.keepScreenOnWhilePlaying = true;
  });

  const enforceLandscape = useCallback(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
  }, []);

  // Preload device _hglk cookie token in background once on mount
  useEffect(() => {
    if (!cachedDeviceHglk) {
      getOrCreateDeviceHglk()
        .then((val) => setDeviceHglk((prev) => prev || val))
        .catch(() => {});
    }
  }, []);

  // Offline download live list subscription
  useEffect(() => {
    loadOfflineDownloads().then(setOfflineItems).catch(() => {});
    return subscribeOfflineDownloads(setOfflineItems);
  }, []);

  // Strict Landscape lock before mounting Modal & restore Portrait after dismiss
  useEffect(() => {
    if (!visible) {
      setOrientationReady(false);
      setActivePanel(null);
      setOverrideStreamCode(null);
      setNextPromptDismissed(false);
      setNextCountdownSec(null);
      if (closingRestoreTimerRef.current) clearTimeout(closingRestoreTimerRef.current);
      closingRestoreTimerRef.current = setTimeout(() => {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }, 360);
      return () => {
        if (closingRestoreTimerRef.current) {
          clearTimeout(closingRestoreTimerRef.current);
          closingRestoreTimerRef.current = null;
        }
      };
    }

    if (closingRestoreTimerRef.current) {
      clearTimeout(closingRestoreTimerRef.current);
      closingRestoreTimerRef.current = null;
    }

    let cancelled = false;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    const readyHglk = cachedDeviceHglk || deviceHglk;
    if (readyHglk) {
      if (!deviceHglk) setDeviceHglk(readyHglk);
      setOrientationReady(true);
    } else {
      (async () => {
        try {
          const hglkVal = await getOrCreateDeviceHglk();
          if (cancelled) return;
          setDeviceHglk(hglkVal);
          setOrientationReady(true);
        } catch {
          if (!cancelled) {
            setDeviceHglk((prev) => prev || cachedDeviceHglk || generateHglkToken(24));
            setOrientationReady(true);
          }
        }
      })();
    }

    const sub = ScreenOrientation.addOrientationChangeListener((ev) => {
      const ori = ev.orientationInfo?.orientation;
      if (
        ori === ScreenOrientation.Orientation.PORTRAIT_UP ||
        ori === ScreenOrientation.Orientation.PORTRAIT_DOWN
      ) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [visible]);

  useEffect(() => {
    if (visible && orientationReady && winHeight > winWidth) {
      enforceLandscape();
    }
  }, [visible, orientationReady, winWidth, winHeight, enforceLandscape]);

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

  // Sleep timer countdown (minute granularity)
  useEffect(() => {
    if (!visible || sleepMinutesLeft === null) return;
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
  }, [visible, sleepMinutesLeft, player, showToast]);

  const effectiveEpisodes = useMemo(() => {
    if (resolved?.episodes && resolved.episodes.length > 0) return resolved.episodes;
    return params?.episodes || [];
  }, [resolved?.episodes, params?.episodes]);

  const effectiveSeasons = useMemo(() => resolved?.seasons || [], [resolved?.seasons]);

  const nextEpisodeObj = useMemo(() => {
    if (resolved?.next_episode && resolved.next_episode.stream_code) {
      const idx =
        typeof resolved.next_episode.index === 'number'
          ? resolved.next_episode.index
          : effectiveEpisodes.findIndex((e) => e.stream_code === resolved.next_episode?.stream_code);
      return { ep: resolved.next_episode, idx: Math.max(0, idx) };
    }
    if (effectiveEpisodes.length > 1 && activeStreamCode) {
      const idx = effectiveEpisodes.findIndex((e) => e.stream_code === activeStreamCode);
      if (idx >= 0) {
        const parseEpNum = (name: string) => {
          const m = String(name || '').match(/(\d+(?:\.\d+)?)/);
          return m ? parseFloat(m[1]) : null;
        };
        const firstN = parseEpNum(effectiveEpisodes[0].episodes_name);
        const lastN = parseEpNum(effectiveEpisodes[effectiveEpisodes.length - 1].episodes_name);
        const isDesc = firstN !== null && lastN !== null && firstN > lastN;
        const nextIdx = isDesc ? idx - 1 : idx + 1;
        if (nextIdx >= 0 && nextIdx < effectiveEpisodes.length) {
          return { ep: effectiveEpisodes[nextIdx], idx: nextIdx };
        }
      }
    }
    return null;
  }, [effectiveEpisodes, activeStreamCode, resolved?.next_episode]);

  // Smooth 2-layer curtain episode transition
  const triggerSmoothEpisodeSwitch = useCallback(
    (ep: EpisodeItem, epIndex: number) => {
      if (!onSwitchEpisode || autoSwitchedForCodeRef.current === ep.stream_code) return;
      autoSwitchedForCodeRef.current = ep.stream_code;
      setActivePanel(null);
      setNextPromptDismissed(true);
      setNextCountdownSec(null);
      setTransitionLabel(ep.episodes_name || `Tập ${epIndex + 1}`);
      Animated.timing(transitionOpacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }).start(() => {
        try {
          player.pause();
        } catch {}
        setOverrideStreamCode(null);
        onSwitchEpisode(ep, epIndex);
      });
    },
    [onSwitchEpisode, player, transitionOpacity]
  );

  // Near-end auto-next prompt & countdown
  useEffect(() => {
    if (!visible || mode !== 'native' || !nextEpisodeObj || nextPromptDismissed) {
      setNextCountdownSec(null);
      return;
    }
    const triggerSec =
      resolved?.end_credits_sec && resolved.end_credits_sec > 30 && duration > 90
        ? Math.min(duration - 10, resolved.end_credits_sec)
        : duration > 40
          ? duration - 12
          : 0;
    if (triggerSec > 20 && currentTime >= triggerSec) {
      if (nextCountdownSec === null) {
        setNextCountdownSec(settings.autoPlayNext ? 8 : 0);
      }
    } else if (triggerSec > 20 && currentTime < triggerSec - 4 && nextCountdownSec !== null) {
      setNextCountdownSec(null);
    }
  }, [
    visible,
    mode,
    nextEpisodeObj,
    nextPromptDismissed,
    resolved?.end_credits_sec,
    duration,
    currentTime,
    nextCountdownSec,
    settings.autoPlayNext,
  ]);

  useEffect(() => {
    if (nextCountdownSec === null || !settings.autoPlayNext || !nextEpisodeObj) return;
    if (nextCountdownSec <= 0) {
      triggerSmoothEpisodeSwitch(nextEpisodeObj.ep, nextEpisodeObj.idx);
      return;
    }
    const iv = setTimeout(() => {
      setNextCountdownSec((c) => (c !== null ? c - 1 : null));
    }, 1000);
    return () => clearTimeout(iv);
  }, [nextCountdownSec, settings.autoPlayNext, nextEpisodeObj, triggerSmoothEpisodeSwitch]);

  // Player events + fallback quality chain before WebView
  useEffect(() => {
    const subTime = player.addListener('timeUpdate', (e) => {
      setCurrentTime(e.currentTime || 0);
      if (player.duration > 0) setDuration(player.duration);
    });
    const subPlay = player.addListener('playingChange', (e) => {
      setIsPlaying(e.isPlaying);
    });
    const subLoad = player.addListener('sourceLoad', (e) => {
      setNativeReady(true);
      if (e.duration > 0) setDuration(e.duration);
      if (!resumeAppliedRef.current && resolved?.resume_seconds && resolved.resume_seconds > 10) {
        resumeAppliedRef.current = true;
        player.currentTime = resolved.resume_seconds;
      }
      player.playbackRate = playbackRate;
      player.play();
      Animated.timing(transitionOpacity, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start(() => {
        setTransitionLabel('');
      });
    });
    const subStatus = player.addListener('statusChange', (e) => {
      if (e.status === 'readyToPlay') {
        setNativeReady(true);
      }
      if (e.status === 'error') {
        if (activeQuality?.url) {
          failedQualityUrlsRef.current.add(activeQuality.url);
        }
        const nextFallback = resolved?.qualities?.find(
          (q) => !failedQualityUrlsRef.current.has(q.url)
        );
        if (nextFallback) {
          setActiveQuality(nextFallback);
          showToast(`Đang thử nguồn dự phòng: ${nextFallback.label}`);
          player
            .replaceAsync({
              uri: nextFallback.url,
              contentType: nextFallback.type === 'hls' ? 'hls' : 'progressive',
            })
            .catch(() => {});
        } else if (resolved?.webview_url) {
          Animated.timing(transitionOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start(() => setTransitionLabel(''));
          setMode('webview');
        }
      }
    });
    const subEnd = player.addListener('playToEnd', () => {
      if (settings.autoPlayNext && nextEpisodeObj) {
        triggerSmoothEpisodeSwitch(nextEpisodeObj.ep, nextEpisodeObj.idx);
      }
    });

    return () => {
      subTime.remove();
      subPlay.remove();
      subLoad.remove();
      subStatus.remove();
      subEnd.remove();
    };
  }, [
    player,
    resolved,
    activeQuality,
    playbackRate,
    settings.autoPlayNext,
    nextEpisodeObj,
    triggerSmoothEpisodeSwitch,
    transitionOpacity,
    showToast,
  ]);

  // Save watch progress periodically
  useEffect(() => {
    if (!visible || !params || params.offlineUri || mode !== 'native') return;
    if (Math.abs(currentTime - lastSavedSecRef.current) >= 15 && currentTime > 5) {
      lastSavedSecRef.current = currentTime;
      saveWatchProgressApi({
        videos_id: resolved?.movie?.videos_id || params.videosId,
        stream_code: activeStreamCode,
        position_sec: currentTime,
        duration_sec: duration,
        episode_number: params.episodeNumber || 0,
        season_id: params.seasonId || '',
        title: resolved?.movie?.title || params.title,
      }).catch(() => {});
    }
  }, [visible, params, activeStreamCode, resolved?.movie, mode, currentTime, duration]);

  // Resolve stream & load subtitle cues when opening or switching episode/server
  useEffect(() => {
    if (!visible || !params) {
      try {
        player.pause();
      } catch {}
      return;
    }

    let cancelled = false;
    resumeAppliedRef.current = false;
    lastSavedSecRef.current = 0;
    autoSwitchedForCodeRef.current = '';
    failedQualityUrlsRef.current.clear();
    setCurrentTime(0);
    setDuration(0);
    setSubCues([]);
    setActiveSubIndex(0);
    setHudVisible(true);
    setWebHudReady(false);
    setNativeReady(false);
    setNextPromptDismissed(false);
    setNextCountdownSec(null);
    webProgressRef.current = { position: 0, duration: 0 };

    if (params.offlineUri) {
      setMode('native');
      setLoading(false);
      player
        .replaceAsync({
          uri: params.offlineUri,
          contentType: 'progressive',
          metadata: { title: params.title, artist: 'Đặng Việt Anh Offline' },
        })
        .catch(() => {});
      return;
    }

    const isInitialLoad = !resolved || resolved.stream_code !== activeStreamCode;
    if (isInitialLoad && transitionLabel === '') {
      setLoading(true);
    }

    (async () => {
      try {
        const res = await resolveStreamApi(activeStreamCode, params.videosId);
        if (cancelled) return;
        setResolved(res);
        setInWishlist(Boolean(res.movie?.in_wishlist));

        if (res.can_play_native && res.qualities.length > 0) {
          const preferred =
            settings.preferredQuality !== 'auto'
              ? res.qualities.find((q) => q.label.includes(settings.preferredQuality))
              : undefined;
          const chosen = preferred || res.qualities[0];
          setActiveQuality(chosen);
          setMode('native');

          await player.replaceAsync({
            uri: chosen.url,
            contentType: chosen.type === 'hls' ? 'hls' : 'progressive',
            metadata: {
              title: params.episodeTitle ? `${params.title} - ${params.episodeTitle}` : params.title,
              artist: 'Đặng Việt Anh',
            },
          });
        } else {
          Animated.timing(transitionOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start(() => setTransitionLabel(''));
          setMode('webview');
        }
      } catch {
        if (!cancelled) {
          Animated.timing(transitionOpacity, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start(() => setTransitionLabel(''));
          setMode('webview');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, params, activeStreamCode, player, settings.preferredQuality]);

  // Fetch active subtitle track whenever resolved subtitles or activeSubIndex changes
  useEffect(() => {
    const subs = resolved?.subtitles;
    if (!visible || !subs || subs.length === 0) {
      setSubCues([]);
      return;
    }
    const target = subs[activeSubIndex] || subs[0];
    if (!target?.url) return;
    let cancelled = false;
    (async () => {
      try {
        const subRes = await fetch(target.url);
        if (subRes.ok && !cancelled) {
          const subTxt = await subRes.text();
          if (!cancelled) setSubCues(parseVttOrSrt(subTxt));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, resolved?.subtitles, activeSubIndex]);

  const handleClose = () => {
    const posToSave = mode === 'native' ? currentTime : webProgressRef.current.position;
    const durToSave = mode === 'native' ? duration : webProgressRef.current.duration;
    if (params && !params.offlineUri && posToSave > 5) {
      saveWatchProgressApi({
        videos_id: resolved?.movie?.videos_id || params.videosId,
        stream_code: activeStreamCode,
        position_sec: posToSave,
        duration_sec: durToSave,
        episode_number: params.episodeNumber || 0,
        season_id: params.seasonId || '',
        title: resolved?.movie?.title || params.title,
      }).catch(() => {});
    }
    try {
      player.pause();
    } catch {}
    onClose();
  };

  const handleToggleWishlist = async () => {
    const vid = resolved?.movie?.videos_id || params?.videosId || 0;
    if (!vid) return;
    Haptics.selectionAsync();
    try {
      const res = await toggleWishlistApi(vid);
      setInWishlist(res.in_wishlist);
      showToast(res.in_wishlist ? 'Đã thêm vào Danh sách của tôi' : 'Đã gỡ khỏi Danh sách của tôi');
    } catch {
      showToast('Không thể cập nhật Danh sách của tôi');
    }
  };

  const currentOfflineItem = useMemo(() => {
    const vid = resolved?.movie?.videos_id || params?.videosId || 0;
    const epId = params?.episodeId || 0;
    return (
      offlineItems.find(
        (it) =>
          (it.stream_code === activeStreamCode || (it.videos_id === vid && it.episode_id === epId)) &&
          (it.status === 'completed' || it.status === 'downloading')
      ) || null
    );
  }, [offlineItems, resolved?.movie?.videos_id, params?.videosId, params?.episodeId, activeStreamCode]);

  const handleDownloadOffline = async () => {
    if (!params) return;
    if (currentOfflineItem?.status === 'completed') {
      showToast('Tập phim này đã có sẵn trong Tủ phim Offline');
      return;
    }
    if (currentOfflineItem?.status === 'downloading') {
      showToast(`Đang tải offline (${currentOfflineItem.progress}%)...`);
      return;
    }
    const mp4Url =
      resolved?.download_mp4_url ||
      resolved?.qualities?.find((q) => q.type === 'mp4')?.url ||
      '';
    if (!mp4Url) {
      showToast('Phim này đang dùng luồng HLS — mở Web Player để tải offline');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showToast('Bắt đầu tải xuống xem offline...');
    startOfflineDownload({
      videos_id: resolved?.movie?.videos_id || params.videosId,
      episode_id: params.episodeId || 0,
      stream_code: activeStreamCode,
      title: resolved?.movie?.title || params.title,
      episode_title: params.episodeTitle || resolved?.episode_title,
      poster_url: resolved?.movie?.poster_url || '',
      thumbnail_url: resolved?.movie?.thumbnail_url || '',
      remote_url: mp4Url,
    })
      .then(() => showToast('Đã tải xong! Xem trong Tủ phim > Đã tải'))
      .catch(() => showToast('Tải offline thất bại, vui lòng thử lại sau'));
  };

  const handleSelectQuality = async (q: StreamQuality) => {
    if (activeQuality?.url === q.url) return;
    const savedT = player.currentTime;
    setActiveQuality(q);
    showToast(`Đã chuyển sang ${q.label}`);
    await player.replaceAsync({
      uri: q.url,
      contentType: q.type === 'hls' ? 'hls' : 'progressive',
    });
    player.currentTime = savedT;
    player.playbackRate = playbackRate;
    player.play();
  };

  const handleSelectSourceServer = (src: SourceItem) => {
    if (!src.stream_code || src.stream_code === activeStreamCode) return;
    setOverrideStreamCode(src.stream_code);
    showToast(`Đang chuyển máy chủ ${src.label}...`);
  };

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

  const activeBottomSub = useMemo(() => {
    if (!settings.subtitleEnabled || subCues.length === 0) return '';
    const found = subCues.find((c) => !c.isTop && currentTime >= c.start && currentTime <= c.end);
    return found ? found.text : '';
  }, [settings.subtitleEnabled, subCues, currentTime]);

  const activeTopSub = useMemo(() => {
    if (!settings.subtitleEnabled || subCues.length === 0) return '';
    const found = subCues.find((c) => c.isTop && currentTime >= c.start && currentTime <= c.end);
    return found ? found.text : '';
  }, [settings.subtitleEnabled, subCues, currentTime]);

  const playerMeta = useMemo(
    () => ({
      videos_id: resolved?.movie?.videos_id || params?.videosId || 0,
      episode_id: params?.episodeId || 0,
      title: params?.episodeTitle
        ? `${resolved?.movie?.title || params?.title || ''} • ${params.episodeTitle}`
        : resolved?.movie?.title || params?.title || '',
      is_tvseries: effectiveEpisodes.length > 0 || Boolean(params?.episodeId) ? 1 : 0,
    }),
    [resolved?.movie, params, effectiveEpisodes.length]
  );

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
      } catch (e) {}
      true;
    `;
  }, [cookies, deviceHglk, playerMeta, settings]);

  const webviewSourceUrl = useMemo(() => {
    const code = activeStreamCode;
    if (!code) {
      return resolved?.webview_url || `${SITE_BASE_URL}/getlink/va/`;
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
  }, [activeStreamCode, resolved?.webview_url, deviceHglk, playerMeta, settings.preferredQuality, settings.autoPlayNext]);

  const effectiveRatio =
    dragRatio !== null ? dragRatio : duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const shownClockSec = dragRatio !== null ? dragRatio * duration : currentTime;
  const progressPct = effectiveRatio * 100;
  const introCuePct =
    resolved?.skip_intro_sec && resolved.skip_intro_sec > 4 && duration > 10
      ? Math.min(96, Math.max(1, (resolved.skip_intro_sec / duration) * 100))
      : null;

  const showPlayerSkeleton =
    visible &&
    transitionLabel === '' &&
    (loading || (mode === 'webview' ? !webHudReady : !nativeReady));

  useEffect(() => {
    if (!visible) {
      setRenderSkeleton(true);
      skeletonOpacity.setValue(1);
      return;
    }
    if (showPlayerSkeleton) {
      skeletonOpacity.stopAnimation();
      setRenderSkeleton(true);
      skeletonOpacity.setValue(1);
      return;
    }
    skeletonOpacity.stopAnimation();
    Animated.timing(skeletonOpacity, {
      toValue: 0,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setRenderSkeleton(false);
      }
    });
  }, [visible, showPlayerSkeleton, skeletonOpacity]);

  useEffect(() => {
    if (!visible || loading) return;
    if (mode === 'webview' && !webHudReady) {
      const t = setTimeout(() => setWebHudReady(true), 6000);
      return () => clearTimeout(t);
    }
    if (mode === 'native' && !nativeReady) {
      const t = setTimeout(() => setNativeReady(true), 4200);
      return () => clearTimeout(t);
    }
  }, [visible, loading, mode, webHudReady, nativeReady]);

  const displayTitle = resolved?.movie?.title || params?.title || '';
  const displayMetaParts = [
    params?.episodeTitle || resolved?.episode_title,
    activeQuality?.label || resolved?.movie?.video_quality || 'Full HD',
    duration > 0 ? formatClock(duration) : resolved?.movie?.runtime,
  ].filter(Boolean);

  return (
    <Modal
      visible={visible && orientationReady && Boolean(deviceHglk)}
      animationType="none"
      presentationStyle="fullScreen"
      supportedOrientations={['landscape-left', 'landscape-right']}
      onShow={enforceLandscape}
      onOrientationChange={(e) => {
        if (e.nativeEvent?.orientation === 'portrait') {
          enforceLandscape();
        }
      }}
      onDismiss={() => {
        if (!visible) {
          ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        }
      }}
      onRequestClose={handleClose}
    >
      <StatusBar hidden style="light" />
      <View style={styles.stage}>
        {loading ? (
          <View style={[styles.flex, { backgroundColor: COLORS.bg }]} />
        ) : mode === 'webview' ? (
          <View style={[styles.flex, { backgroundColor: COLORS.bg }]}>
            <WebView
              source={{ uri: webviewSourceUrl }}
              applicationNameForUserAgent="DVAPlayiOS/1.0"
              injectedJavaScriptBeforeContentLoaded={cookieBootstrapJs}
              allowsInlineMediaPlayback
              allowsFullscreenVideo
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
                  } else if (data.type === 'DVA_APP_PLAYER_BACK') {
                    handleClose();
                  } else if (data.type === 'DVA_IOS_OPEN_CAST') {
                    if (onOpenCast) onOpenCast();
                  } else if (data.type === 'DVA_IOS_SWITCH_NATIVE' && resolved?.can_play_native) {
                    setMode('native');
                  } else if (data.type === 'DVA_IOS_PLAYER_PROGRESS') {
                    webProgressRef.current = {
                      position: Number(data.position) || 0,
                      duration: Number(data.duration) || 0,
                    };
                  }
                } catch {}
              }}
              style={[styles.flex, { backgroundColor: COLORS.bg }]}
            />
          </View>
        ) : (
          <View style={styles.flex}>
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              contentFit={settings.videoFillMode || 'contain'}
              nativeControls={false}
              allowsPictureInPicture={settings.pipEnabled}
              startsPictureInPictureAutomatically={settings.pipEnabled}
            />

            {/* Subtle Contrast Boost Frame / Edge Vignette when Tăng độ tương phản is enabled */}
            {settings.highContrastMode ? (
              <View pointerEvents="none" style={styles.contrastBoostFrame} />
            ) : null}

            {/* Tap backdrop to show/hide HUD */}
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

            {/* Top Watermark Subtitle Cue (if any) */}
            {activeTopSub ? (
              <View style={[styles.subTopWrap, { top: 16 }]} pointerEvents="none">
                <Text style={styles.subTopText}>{activeTopSub}</Text>
              </View>
            ) : null}

            {/* Customizable Bottom Subtitle Overlay */}
            {activeBottomSub ? (
              <View
                style={[
                  styles.subWrap,
                  {
                    bottom: hudVisible
                      ? Math.max(108, (settings.subtitleBottomOffset || 34) + 74)
                      : settings.subtitleBottomOffset || 34,
                  },
                ]}
                pointerEvents="none"
              >
                <Text
                  style={[
                    styles.subText,
                    {
                      fontSize: settings.subtitleFontSize || 17,
                      backgroundColor: `rgba(0,0,0,${settings.subtitleBgOpacity ?? 0.55})`,
                    },
                  ]}
                >
                  {activeBottomSub}
                </Text>
              </View>
            ) : null}

            {/* Floating Glass Toast Notification */}
            {toastMsg ? (
              <View pointerEvents="none" style={styles.toastWrap}>
                <GlassSurface intensity={65} radius={RADII.pill} style={styles.toastCard}>
                  <Ionicons name="sparkles" size={14} color={COLORS.accent} />
                  <Text style={styles.toastTxt}>{toastMsg}</Text>
                </GlassSurface>
              </View>
            ) : null}

            {/* Skip Intro Button */}
            {settings.autoSkipIntro &&
            resolved?.skip_intro_sec &&
            resolved.skip_intro_sec > 5 &&
            currentTime > 3 &&
            currentTime < resolved.skip_intro_sec ? (
              <TouchableOpacity
                style={[
                  styles.skipIntroBtn,
                  { right: Math.max(22, insets.right + 14), bottom: hudVisible ? 112 : 28 },
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  player.currentTime = resolved.skip_intro_sec;
                  showToast('Đã bỏ qua phần mở đầu');
                }}
              >
                <Text style={styles.skipIntroText}>Bỏ qua mở đầu ▸</Text>
              </TouchableOpacity>
            ) : null}

            {/* Next Episode Smooth Countdown Card */}
            {nextEpisodeObj && nextCountdownSec !== null ? (
              <GlassSurface
                intensity={70}
                radius={RADII.lg}
                style={[styles.nextCountdownCard, { left: Math.max(22, insets.left + 12), bottom: hudVisible ? 112 : 26 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.nextCdSub}>
                    {settings.autoPlayNext
                      ? `Tự động chuyển tập sau ${nextCountdownSec}s`
                      : 'Tập tiếp theo sẵn sàng'}
                  </Text>
                  <Text style={styles.nextCdTitle} numberOfLines={1}>
                    {nextEpisodeObj.ep.episodes_name}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.nextCdCancelBtn}
                  onPress={() => {
                    setNextPromptDismissed(true);
                    setNextCountdownSec(null);
                  }}
                >
                  <Text style={styles.nextCdCancelTxt}>Hủy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.nextCdPlayBtn}
                  onPress={() => triggerSmoothEpisodeSwitch(nextEpisodeObj.ep, nextEpisodeObj.idx)}
                >
                  <Ionicons name="play" size={14} color="#FFF" />
                  <Text style={styles.nextCdPlayTxt}>Phát ngay</Text>
                </TouchableOpacity>
              </GlassSurface>
            ) : null}

            {/* Apple Liquid Glass Player HUD matching #dva-app-hud */}
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
                {/* Top HUD Bar */}
                <View style={styles.topHud}>
                  <View style={styles.topLeft}>
                    <TouchableOpacity style={styles.glassIconBtn} onPress={handleClose}>
                      <Ionicons name="chevron-back" size={23} color="#FFF" />
                    </TouchableOpacity>
                    <View style={{ maxWidth: winWidth * 0.44 }}>
                      <Text style={styles.hudTitle} numberOfLines={1}>
                        {displayTitle}
                      </Text>
                      <Text style={styles.hudSub} numberOfLines={1}>
                        {displayMetaParts.join(' • ')}
                      </Text>
                    </View>
                  </View>

                  <GlassSurface intensity={56} radius={RADII.pill} style={styles.topRightCapsule}>
                    <TouchableOpacity
                      style={styles.capsuleIconBtn}
                      onPress={() => setActivePanel('servers')}
                    >
                      <Ionicons name="server-outline" size={19} color="#FFF" />
                    </TouchableOpacity>
                    <VideoAirPlayButton
                      tint="#FFFFFF"
                      activeTint={COLORS.accent}
                      style={{ width: 40, height: 40 }}
                    />
                    {onOpenCast ? (
                      <TouchableOpacity
                        style={styles.capsuleIconBtn}
                        onPress={() => {
                          onOpenCast();
                        }}
                      >
                        <Ionicons name="tv-outline" size={19} color="#FFF" />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={[
                        styles.capsuleIconBtn,
                        settings.subtitleEnabled && subCues.length > 0 && styles.capsuleBtnActive,
                      ]}
                      onPress={() => setActivePanel('subtitles')}
                    >
                      <Ionicons name="chatbox-ellipses-outline" size={19} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.capsuleIconBtn}
                      onPress={() => setActivePanel('settings')}
                    >
                      <Ionicons name="settings-outline" size={19} color="#FFF" />
                    </TouchableOpacity>
                  </GlassSurface>
                </View>

                {/* Right Vertical Floating Side Toggles (Contrast / AutoNext / Edge-to-Edge) */}
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
                      settings.autoPlayNext && styles.sideIconBtnActive,
                    ]}
                    onPress={() => {
                      const nextVal = !settings.autoPlayNext;
                      Haptics.selectionAsync();
                      updateSetting('autoPlayNext', nextVal);
                      showToast(nextVal ? 'Tự động chuyển tập: Bật' : 'Tự động chuyển tập: Tắt');
                      scheduleHideHud();
                    }}
                  >
                    <Ionicons name="play-skip-forward" size={17} color="#FFF" />
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

                {/* Center Controls */}
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

                {/* Bottom Scrubber + Liquid Glass Action Pills */}
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
                      {introCuePct !== null ? (
                        <View style={[styles.cueTick, { left: `${introCuePct}%` }]} />
                      ) : null}
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
                      {nextEpisodeObj && onSwitchEpisode ? (
                        <TouchableOpacity
                          style={[styles.actionPill, styles.actionPillNext]}
                          onPress={() =>
                            triggerSmoothEpisodeSwitch(nextEpisodeObj.ep, nextEpisodeObj.idx)
                          }
                        >
                          {resolved?.movie?.thumbnail_url ? (
                            <Image
                              source={{ uri: resolved.movie.thumbnail_url }}
                              style={styles.nextPillThumb}
                              resizeMode="cover"
                            />
                          ) : (
                            <Ionicons name="play-skip-forward" size={16} color="#FFF" />
                          )}
                          <Ionicons name="chevron-forward" size={14} color="#FFF" />
                        </TouchableOpacity>
                      ) : null}

                      {!params?.offlineUri ? (
                        <TouchableOpacity
                          style={[
                            styles.actionPill,
                            styles.actionIconPill,
                            inWishlist && styles.actionPillActive,
                          ]}
                          onPress={handleToggleWishlist}
                        >
                          <Ionicons
                            name={inWishlist ? 'bookmark' : 'bookmark-outline'}
                            size={17}
                            color="#FFF"
                          />
                        </TouchableOpacity>
                      ) : null}

                      {effectiveEpisodes.length > 0 ? (
                        <TouchableOpacity
                          style={[styles.actionPill, styles.actionIconPill]}
                          onPress={() => setActivePanel('episodes')}
                        >
                          <Ionicons name="list" size={18} color="#FFF" />
                        </TouchableOpacity>
                      ) : null}

                      {!params?.offlineUri ? (
                        <TouchableOpacity
                          style={[styles.actionPill, styles.actionIconPill]}
                          onPress={handleDownloadOffline}
                        >
                          <Ionicons
                            name={
                              currentOfflineItem?.status === 'completed'
                                ? 'checkmark-circle'
                                : 'cloud-download-outline'
                            }
                            size={18}
                            color={
                              currentOfflineItem?.status === 'completed' ? COLORS.success : '#FFF'
                            }
                          />
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

                      {!params?.offlineUri ? (
                        <TouchableOpacity
                          style={styles.actionPill}
                          onPress={() => setActivePanel('more')}
                        >
                          <Text style={styles.actionPillTxt}>Tùy chọn khác</Text>
                          <Ionicons name="chevron-up" size={14} color="#FFF" />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {/* Apple Liquid Glass Sub-Panels */}
            <PlayerOverlayPanels
              activePanel={activePanel}
              onClose={() => setActivePanel(null)}
              onSwitchPanel={setActivePanel}
              title={displayTitle}
              episodeTitle={params?.episodeTitle || resolved?.episode_title}
              currentStreamCode={activeStreamCode}
              resolved={resolved}
              activeQuality={activeQuality}
              onSelectQuality={handleSelectQuality}
              onSelectSourceServer={handleSelectSourceServer}
              episodes={effectiveEpisodes}
              seasons={effectiveSeasons}
              onSelectEpisode={(ep, idx) => triggerSmoothEpisodeSwitch(ep, idx)}
              activeSubIndex={activeSubIndex}
              onSelectSubtitleIndex={setActiveSubIndex}
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
              inWishlist={inWishlist}
              onToggleWishlist={handleToggleWishlist}
              offlineItem={currentOfflineItem}
              onDownloadOffline={handleDownloadOffline}
              onOpenWebPlayer={() => {
                try {
                  player.pause();
                } catch {}
                setMode('webview');
              }}
              onOpenCast={onOpenCast}
              user={user}
            />

            {/* Layer 2 Smooth Episode Crossfade Curtain */}
            {transitionLabel !== '' ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.transitionCurtain, { opacity: transitionOpacity }]}
              >
                {resolved?.movie?.poster_url ? (
                  <Image
                    source={{ uri: resolved.movie.poster_url }}
                    style={[StyleSheet.absoluteFill, { opacity: 0.28 }]}
                    resizeMode="cover"
                  />
                ) : null}
                <ActivityIndicator size="large" color={COLORS.accent} />
                <Text style={styles.transitionTitle}>Đang chuyển mượt sang {transitionLabel}...</Text>
              </Animated.View>
            ) : null}
          </View>
        )}

        {renderSkeleton ? (
          <Animated.View
            pointerEvents={showPlayerSkeleton ? 'auto' : 'none'}
            style={[styles.skeletonOverlay, { opacity: skeletonOpacity }]}
          >
            <PlayerLandscapeSkeleton
              leftInset={Math.max(20, insets.left + 10)}
              rightInset={Math.max(20, insets.right + 10)}
            />
            <TouchableOpacity
              onPress={handleClose}
              style={[
                styles.glassIconBtn,
                { position: 'absolute', top: 14, left: Math.max(20, insets.left + 10), zIndex: 10 },
              ]}
            >
              <Ionicons name="chevron-back" size={23} color="#FFF" />
            </TouchableOpacity>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  skeletonOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 50,
    backgroundColor: COLORS.bg,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  webHud: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  switchModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: 'rgba(20, 20, 20, 0.72)',
  },
  switchModeTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
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
  capsuleBtnActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.75)',
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
  cueTick: {
    position: 'absolute',
    top: -1,
    bottom: -1,
    width: 4,
    borderRadius: 2,
    backgroundColor: '#FFF',
    marginLeft: -2,
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
  actionPillActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.78)',
    borderColor: 'rgba(255,255,255,0.34)',
  },
  actionPillNext: {
    paddingLeft: 8,
    paddingRight: 11,
  },
  nextPillThumb: {
    width: 34,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  actionPillTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  subTopWrap: {
    position: 'absolute',
    left: 60,
    right: 60,
    alignItems: 'center',
  },
  subTopText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12.5,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: 'hidden',
  },
  subWrap: {
    position: 'absolute',
    left: 56,
    right: 56,
    alignItems: 'center',
  },
  subText: {
    color: '#FFF',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
  skipIntroBtn: {
    position: 'absolute',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(20,20,20,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  skipIntroText: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  nextCountdownCard: {
    position: 'absolute',
    maxWidth: 380,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 25,
  },
  nextCdSub: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  nextCdTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  nextCdCancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  nextCdCancelTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  nextCdPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADII.pill,
    backgroundColor: COLORS.accent,
  },
  nextCdPlayTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  transitionCurtain: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#07090F',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 50,
  },
  transitionTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
