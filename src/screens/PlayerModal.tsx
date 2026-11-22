import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  isPictureInPictureSupported,
  SubtitleTrack,
  useVideoPlayer,
  VideoPlayer,
  VideoView,
} from 'expo-video';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppAlert } from '../components/AppAlertModal';
import { BouncyButton } from '../components/BouncyButton';
import { GlassSurface } from '../components/GlassSurface';
import { NativeSubtitleOverlay } from '../components/NativeSubtitleOverlay';
import { OfflineDownloadSheet } from '../components/OfflineDownloadSheet';
import { PlayerEpisodeListModal } from '../components/PlayerEpisodeListModal';
import {
  PlayerGeneralSettingsModal,
  PreloadVisualState,
  SleepTimerSettingValue,
} from '../components/PlayerGeneralSettingsModal';
import { PlayerOverlayPanels, PlayerPanelType } from '../components/PlayerOverlayPanels';
import { PlayerServerPanelModal } from '../components/PlayerServerPanelModal';
import { PlayerSubtitleSettingsModal } from '../components/PlayerSubtitleSettingsModal';
import { PlayerLandscapeSkeleton, useShimmerProgress } from '../components/SkeletonLoaders';
import {
  WaterDropToastBanner,
  WaterDropToastIcon,
  WaterDropToastPayload,
} from '../components/WaterDropToastBanner';
import { CastModal, CastMoviePayload } from './CastModal';
import { COLORS, GLASS_SHADOW } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import {
  clearActivePlaybackSession,
  saveActivePlaybackSession,
} from '../services/activeSessionService';
import {
  fetchMovieDetailsApi,
  fetchWatchProgressApi,
  resolveStreamApi,
  saveWatchProgressApi,
  toggleWishlistApi,
} from '../services/api';
import {
  enqueueEpisodeBatch,
  findCompletedOfflineItem,
  flushPendingOfflineProgressToServer,
  getCurrentAndNextEpisodes,
  getOfflineDownloadsSnapshot,
  getOfflineRootDir,
  loadOfflineDownloads,
  OfflineEnqueueParams,
  saveOfflineResumePosition,
  subscribeOfflineDownloads,
  syncOfflineItemProgressToServer,
  syncOnlineProgressToOffline,
} from '../services/downloadService';
import {
  ensureOfflineMediaServer,
  getCachedOfflineMediaServerPort,
  restartOfflineMediaServer,
} from '../services/localMediaServer';
import {
  probeConnectivity,
  startNetworkMonitor,
  subscribeNetworkStatus,
} from '../services/networkService';
import {
  applyCheckFileToServers,
  BackupServerId,
  buildInitialServerStates,
  buildOfflineServerUrl,
  buildServer11Or36MediaUrl,
  checkGgdriverApi,
  checkServerFileStatus,
  isServerPlayable,
  measureAllServerPings,
  probeVideoQualityLabel,
  selectOptimalServer,
  ServerRuntimeState,
  triggerServerPrepare,
  wrapUrlForIosNativePlayer,
} from '../services/playerServerService';
import {
  buildSubtitleUrls,
  loadDualSubtitles,
  ParsedVttCue,
} from '../services/subtitleService';
import {
  EpisodeItem,
  OfflineDownloadItem,
  StreamResolvedData,
} from '../types/models';

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
  initialResumeSec?: number;
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
  onEnterOfflineMode?: () => void;
  onWatchProgressSaved?: () => void;
}

interface PreloadedNextPackage {
  streamCode: string;
  episode: EpisodeItem;
  episodeIndex: number;
  resolved: StreamResolvedData;
  vnCues: ParsedVttCue[];
  enCues: ParsedVttCue[];
  vnUrl: string;
  enUrl: string;
  serverId: BackupServerId;
  serverLabel: string;
  streamUrl: string;
  qualityLabel: string;
  skipIntroSec: number;
  endCreditsSec: number;
  subHighRaw: string;
  offlineItem: OfflineDownloadItem | null;
  servers: ServerRuntimeState[];
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

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

function formatDurationShort(sec: number): string {
  const totalMins = Math.floor(Math.max(0, sec || 0) / 60);
  if (totalMins <= 0) return '';
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function resolveEpisodeMetaFromParams(
  episodes: EpisodeItem[],
  activeStreamCode: string,
  fallbackEpNum?: number,
  fallbackSeasonId?: string,
  episodeId?: number
) {
  let epNum = fallbackEpNum || 0;
  let sId = fallbackSeasonId ? String(fallbackSeasonId) : '';
  if (episodes.length > 0) {
    const idx = episodes.findIndex(
      (ep) =>
        (activeStreamCode && ep.stream_code === activeStreamCode) ||
        (episodeId && ep.episodes_id === episodeId)
    );
    if (idx >= 0) {
      const parseEpNum = (name?: string) => {
        const str = String(name || '');
        const mEp = str.match(/(?:tập|tap|episode|ep)\s*0*(\d+)/i);
        if (mEp) return parseInt(mEp[1], 10);
        const mAny = str.match(/0*(\d+)/);
        return mAny ? parseInt(mAny[1], 10) : null;
      };
      const parsedNameNum = parseEpNum(episodes[idx].episodes_name);
      if (parsedNameNum && parsedNameNum > 0) {
        epNum = parsedNameNum;
      } else if (epNum <= 0) {
        const firstN = parseEpNum(episodes[0].episodes_name);
        const lastN = parseEpNum(episodes[episodes.length - 1].episodes_name);
        const isDesc = firstN !== null && lastN !== null && firstN > lastN;
        epNum = isDesc ? episodes.length - idx : idx + 1;
      }
      if (!sId && episodes[idx].seasons_id) sId = String(episodes[idx].seasons_id);
    }
  }
  return { episodeNumber: epNum, seasonId: sId };
}

/**
 * Pure-RN outline subtitle box icon normalized to match neighboring 22px Feather icons.
 */
function JwSubtitleIcon({ size = 22, color = '#FFF' }: { size?: number; color?: string }) {
  const boxW = Math.round(size);
  const boxH = Math.round(size * 0.79);
  const stroke = Math.max(1.9, size * 0.09);
  return (
    <View
      style={{
        width: boxW,
        height: boxH,
        borderRadius: 4.5,
        borderWidth: stroke,
        borderColor: color,
        paddingHorizontal: 3.5,
        justifyContent: 'center',
        gap: 3,
      }}
    >
      <View
        style={{
          width: '100%',
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: '66%',
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * Pure-RN Picture-in-Picture icon with open bottom-right rounded outer corner + mini pill.
 */
function JwPipIcon({ color = '#FFF' }: { color?: string }) {
  return (
    <View style={{ width: 22, height: 17.5, position: 'relative' }}>
      {/* Top arc of outer frame */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 20,
          height: 8.5,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: 20,
            height: 14.5,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: color,
          }}
        />
      </View>
      {/* Bottom-left arc of outer frame leaving bottom-right open */}
      <View
        style={{
          position: 'absolute',
          top: 8.5,
          left: 0,
          width: 9,
          height: 6,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            position: 'absolute',
            top: -8.5,
            left: 0,
            width: 20,
            height: 14.5,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: color,
          }}
        />
      </View>
      {/* Bottom-right rounded mini inset window */}
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 11.5,
          height: 8.5,
          borderRadius: 3,
          borderWidth: 2,
          borderColor: color,
        }}
      />
    </View>
  );
}

function computeSafeResumeSec(
  rawSec: number,
  dur: number,
  endCredits: number
): { sec: number; rewound: boolean } {
  if (dur <= 60 || rawSec <= 0) {
    return { sec: Math.max(0, rawSec), rewound: false };
  }
  const triggerSec = endCredits > 15 && dur > endCredits ? dur - endCredits : dur - 15;
  if (rawSec >= Math.max(10, triggerSec - 15)) {
    const rewoundSec = Math.max(0, triggerSec - 120);
    return { sec: rewoundSec, rewound: rewoundSec < rawSec - 10 };
  }
  return { sec: rawSec, rewound: false };
}

/**
 * Animated buffering play indicator with Skeleton shimmer sweep & breathing pulse (scale up/down).
 */
function BufferingSkeletonCenterButton() {
  const shimmer = useShimmerProgress(true);
  const pulse = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.13,
          duration: 620,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.87,
          duration: 620,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const sweepX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-78, 78],
  });

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <GlassSurface
        variant="liquid"
        radius={26}
        intensity={28}
        style={[playerSkStyles.centerSkeletonBox]}
      >
        <View style={playerSkStyles.skeletonCircleInner}>
          <Animated.View
            pointerEvents="none"
            style={[playerSkStyles.skeletonShimmerWrap, { transform: [{ translateX: sweepX }] }]}
          >
            <LinearGradient
              colors={['transparent', 'rgba(255,255,255,0.42)', 'transparent']}
              start={{ x: 0, y: 0.2 }}
              end={{ x: 1, y: 0.8 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Ionicons name="play" size={26} color="rgba(255,255,255,0.55)" style={{ marginLeft: 3 }} />
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

/**
 * Animated download button icon showing continuous downward drop motion into tray + glowing pulse.
 */
function DownloadingIconAnim() {
  const arrowY = useRef(new Animated.Value(-4)).current;
  const ringScale = useRef(new Animated.Value(0.88)).current;
  const ringOpacity = useRef(new Animated.Value(0.7)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(arrowY, {
            toValue: 3.5,
            duration: 650,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(arrowY, {
            toValue: -4,
            duration: 500,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(ringScale, {
            toValue: 1.15,
            duration: 700,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringScale, {
            toValue: 0.88,
            duration: 450,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity, {
            toValue: 0.25,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.75,
            duration: 450,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [arrowY, ringScale, ringOpacity]);

  return (
    <View style={playerSkStyles.dlAnimWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          playerSkStyles.dlHaloRing,
          { opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
      <Animated.View style={{ transform: [{ translateY: arrowY }] }}>
        <Feather name="arrow-down" size={16} color="#30D158" />
      </Animated.View>
      <View style={playerSkStyles.dlTrayBar} />
    </View>
  );
}

const playerSkStyles = StyleSheet.create({
  centerSkeletonBox: {
    width: 78,
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonCircleInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  skeletonShimmerWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 56,
  },
  dlAnimWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dlHaloRing: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#30D158',
  },
  dlTrayBar: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#30D158',
  },
});

export function PlayerModal({
  visible,
  params,
  onClose,
  onSwitchEpisode,
  onSwitchOfflineItem,
  onEnterOfflineMode,
  onWatchProgressSaved,
}: PlayerModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user, isLocked } = useAuth();
  const { settings, updateSetting } = useSettings();

  // Mount two AVPlayers unconditionally for zero-glitch 2-layer ping-pong transitions
  const playerA = useVideoPlayer(null, (p) => {
    p.allowsExternalPlayback = true;
    p.timeUpdateEventInterval = 0.25;
    p.keepScreenOnWhilePlaying = true;
    p.staysActiveInBackground = Boolean(settings.pipEnabled);
  });
  const playerB = useVideoPlayer(null, (p) => {
    p.allowsExternalPlayback = true;
    p.timeUpdateEventInterval = 0.25;
    p.keepScreenOnWhilePlaying = true;
    p.staysActiveInBackground = Boolean(settings.pipEnabled);
  });

  const viewARef = useRef<VideoView | null>(null);
  const viewBRef = useRef<VideoView | null>(null);
  const layerAOpacity = useRef(new Animated.Value(1)).current;
  const layerBOpacity = useRef(new Animated.Value(0)).current;

  const [activeLayer, setActiveLayer] = useState<'A' | 'B'>('A');
  const activeLayerRef = useRef<'A' | 'B'>('A');
  activeLayerRef.current = activeLayer;

  const getActivePlayer = useCallback((): VideoPlayer => {
    return activeLayerRef.current === 'A' ? playerA : playerB;
  }, [playerA, playerB]);

  const getInactivePlayer = useCallback((): VideoPlayer => {
    return activeLayerRef.current === 'A' ? playerB : playerA;
  }, [playerA, playerB]);

  // Core player UI states
  const [localServerPort, setLocalServerPort] = useState<number>(() =>
    getCachedOfflineMediaServerPort()
  );
  const localServerPortRef = useRef<number>(localServerPort);
  localServerPortRef.current = localServerPort;
  const offlineRetryAttemptedRef = useRef(false);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>(() =>
    getOfflineDownloadsSnapshot()
  );
  const [resolved, setResolved] = useState<StreamResolvedData | null>(null);
  const [detailEpisodes, setDetailEpisodes] = useState<EpisodeItem[]>([]);
  const [moviePosterMeta, setMoviePosterMeta] = useState<{ poster: string; thumb: string }>({
    poster: '',
    thumb: '',
  });
  const [activeStreamCode, setActiveStreamCode] = useState('');
  const [activeEpTitle, setActiveEpTitle] = useState('');
  const [qualityBadge, setQualityBadge] = useState('1080pHD');
  const [inWishlist, setInWishlist] = useState(false);
  const [reaction, setReaction] = useState<'like' | 'dislike' | null>(null);

  // Server orchestration states
  const [servers, setServers] = useState<ServerRuntimeState[]>([]);
  const serversRef = useRef<ServerRuntimeState[]>([]);
  serversRef.current = servers;
  const [activeServerId, setActiveServerId] = useState<BackupServerId | null>(null);
  const activeServerIdRef = useRef<BackupServerId | null>(null);
  activeServerIdRef.current = activeServerId;
  const manualLockedServerRef = useRef<BackupServerId | null>(null);
  const erroredServersRef = useRef<Set<BackupServerId>>(new Set());
  const pipProxyBrokenRef = useRef(false);
  const activeMediaUrlRef = useRef('');
  const [pingRefreshing, setPingRefreshing] = useState(false);

  // Playback & timeline states
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [renderSkeleton, setRenderSkeleton] = useState(true);
  const skeletonOpacity = useRef(new Animated.Value(0)).current;
  const skeletonShownAtRef = useRef(0);

  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  const [duration, setDuration] = useState(0);
  const durationRef = useRef(0);
  durationRef.current = duration;
  const [bufferedPos, setBufferedPos] = useState(0);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [barWidth, setBarWidth] = useState(400);
  const barWidthRef = useRef(400);
  barWidthRef.current = barWidth;

  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [holdBoostActive, setHoldBoostActive] = useState(false);
  const savedRateBeforeHoldRef = useRef(1.0);
  const [isInPip, setIsInPip] = useState(false);
  const isInPipRef = useRef(false);
  isInPipRef.current = isInPip;

  // Subtitles & Preload states
  const [vnCues, setVnCues] = useState<ParsedVttCue[]>([]);
  const [enCues, setEnCues] = useState<ParsedVttCue[]>([]);
  const [vnSubUrl, setVnSubUrl] = useState('');
  const [enSubUrl, setEnSubUrl] = useState('');
  const [subReloadNonce, setSubReloadNonce] = useState(0);
  const [isReloadingSubtitles, setIsReloadingSubtitles] = useState(false);
  const [preloadState, setPreloadState] = useState<PreloadVisualState>('idle');
  const preloadStateRef = useRef<PreloadVisualState>('idle');
  preloadStateRef.current = preloadState;
  const preloadedNextRef = useRef<PreloadedNextPackage | null>(null);
  const nextAutoSwitchTriggeredRef = useRef(false);
  const [nextCountdownSec, setNextCountdownSec] = useState<number | null>(null);

  // Seek warning & water-drop banner toast
  const [seekReturnSec, setSeekReturnSec] = useState<number | null>(null);
  const seekReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toastPayload, setToastPayload] = useState<WaterDropToastPayload | null>(null);
  const toastIdRef = useRef(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // HUD & Popovers & Modals
  const [hudVisible, setHudVisible] = useState(true);
  const hudVisibleRef = useRef(true);
  hudVisibleRef.current = hudVisible;
  const hudHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoHiddenInitialHudRef = useRef(false);
  const userInteractedHudRef = useRef(false);

  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [serverModalOpen, setServerModalOpen] = useState(false);
  const [episodeModalOpen, setEpisodeModalOpen] = useState(false);
  const [subSettingsOpen, setSubSettingsOpen] = useState(false);
  const [generalSettingsOpen, setGeneralSettingsOpen] = useState(false);
  const [offlineSheetOpen, setOfflineSheetOpen] = useState(false);
  const [castPopupOpen, setCastPopupOpen] = useState(false);
  const [infoPanel, setInfoPanel] = useState<PlayerPanelType>(null);

  // Sleep timer
  const [sleepTimerValue, setSleepTimerValue] = useState<SleepTimerSettingValue>(null);
  const [sleepSecondsLeft, setSleepSecondsLeft] = useState<number | null>(null);

  // Lifecycle guards & refs
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const prevLockedRef = useRef(isLocked);
  const wasPlayingBeforeLockRef = useRef(false);
  const preBackgroundPlayingRef = useRef<boolean | null>(null);
  const winDimsRef = useRef({ width: winWidth, height: winHeight });
  winDimsRef.current = { width: winWidth, height: winHeight };
  const pipRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialSeekPendingRef = useRef<{ sec: number; done: boolean }>({ sec: 0, done: true });
  const skipNextReloadCodeRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);
  const checkFilePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastServerProgressPushRef = useRef(0);
  const lastActiveSessionWriteRef = useRef(0);
  const lastAutoQueuedSigRef = useRef('');
  const detailEpisodesVideosIdRef = useRef<number>(0);
  const lastLoadedVideosIdRef = useRef<number>(0);
  const userExplicitlyPausedRef = useRef(false);
  const fgStallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeStreamCodeRef = useRef('');
  activeStreamCodeRef.current = activeStreamCode;
  const vnSubUrlRef = useRef('');
  vnSubUrlRef.current = vnSubUrl;
  const enSubUrlRef = useRef('');
  enSubUrlRef.current = enSubUrl;
  const rewoundToastPendingRef = useRef(false);
  const lastTapStageRef = useRef<{ time: number; side: 'left' | 'right' | 'center' }>({
    time: 0,
    side: 'center',
  });
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdActivatedRef = useRef(false);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const resolvedRef = useRef<StreamResolvedData | null>(resolved);
  resolvedRef.current = resolved;

  const isOfflineOnlyMode = Boolean(params?.offlineUri || params?.offlineItem);

  const ensureLiveLocalPort = useCallback(async (forceRestart = false): Promise<number> => {
    const rootDir = getOfflineRootDir();
    const port = forceRestart
      ? await restartOfflineMediaServer(rootDir)
      : await ensureOfflineMediaServer(rootDir);
    if (port > 0) {
      localServerPortRef.current = port;
      setLocalServerPort(port);
    }
    return port;
  }, []);

  const showToast = useCallback(
    (
      title: string,
      subtitle?: string,
      tone: WaterDropToastPayload['tone'] = 'default',
      icon?: WaterDropToastIcon,
      durationSec = 3
    ) => {
      let resolvedTitle = 'Đặng Việt Anh';
      let resolvedSub = subtitle;
      if (resolvedSub && resolvedSub !== 'Đặng Việt Anh') {
        resolvedTitle = title;
      } else {
        resolvedSub = title;
      }
      const nextId = ++toastIdRef.current;
      setToastPayload({
        id: nextId,
        title: resolvedTitle,
        subtitle: resolvedSub,
        tone,
        durationSec,
        icon,
      });
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToastPayload(null), Math.max(1000, durationSec * 1000));
    },
    []
  );

  const clearHudTimer = useCallback(() => {
    if (hudHideTimerRef.current) {
      clearTimeout(hudHideTimerRef.current);
      hudHideTimerRef.current = null;
    }
  }, []);

  const scheduleHudAutoHide = useCallback(
    (delayMs = 3600) => {
      clearHudTimer();
      hudHideTimerRef.current = setTimeout(() => {
        setSpeedMenuOpen(false);
        setMoreMenuOpen(false);
        setHudVisible(false);
      }, delayMs);
    },
    [clearHudTimer]
  );

  const showHudWithTimer = useCallback(
    (delayMs = 3600) => {
      setHudVisible(true);
      scheduleHudAutoHide(delayMs);
    },
    [scheduleHudAutoHide]
  );

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

  // Subscriptions: offline store + loopback server
  useEffect(() => {
    loadOfflineDownloads().then(setOfflineItems).catch(() => {});
    return subscribeOfflineDownloads(setOfflineItems);
  }, []);

  useEffect(() => {
    if (!visible) return;
    ensureOfflineMediaServer(getOfflineRootDir())
      .then((port) => {
        if (port > 0) setLocalServerPort(port);
      })
      .catch(() => {});
  }, [visible]);

  // Keep player staysActiveInBackground synced with PiP setting
  useEffect(() => {
    try {
      playerA.staysActiveInBackground = Boolean(settings.pipEnabled);
      playerB.staysActiveInBackground = Boolean(settings.pipEnabled);
    } catch {}
  }, [playerA, playerB, settings.pipEnabled]);

  // Derive current episode list & next episode seamlessly
  const effectiveEpisodes: EpisodeItem[] = useMemo(() => {
    if (resolved?.episodes && resolved.episodes.length > 0) return resolved.episodes;
    if (detailEpisodes.length > 0) return detailEpisodes;
    if (params?.episodes && params.episodes.length > 0) return params.episodes;
    if (params?.offlineEpisodes && params.offlineEpisodes.length > 0) {
      return params.offlineEpisodes.map((it, idx) => ({
        episodes_id: it.episode_id || idx + 1,
        seasons_id: 0,
        episodes_name: it.episode_title || `Tập ${it.episode_number || idx + 1}`,
        stream_code: it.stream_code,
        player_url: '',
        full_url: '',
        order: it.episode_number || idx + 1,
      }));
    }
    return [];
  }, [resolved?.episodes, detailEpisodes, params?.episodes, params?.offlineEpisodes]);

  const currentNextEpisode = useMemo(() => {
    if (resolved?.next_episode && resolved.next_episode.stream_code !== activeStreamCode) {
      return {
        ep: resolved.next_episode,
        index: resolved.next_episode.index ?? 0,
      };
    }
    if (effectiveEpisodes.length > 1 && activeStreamCode) {
      const idx = effectiveEpisodes.findIndex((e) => e.stream_code === activeStreamCode);
      if (idx >= 0) {
        const parseEpNum = (n?: string) => {
          const m = String(n || '').match(/(\d+(?:\.\d+)?)/);
          return m ? parseFloat(m[1]) : null;
        };
        const firstN = parseEpNum(effectiveEpisodes[0]?.episodes_name);
        const lastN = parseEpNum(effectiveEpisodes[effectiveEpisodes.length - 1]?.episodes_name);
        const isDesc = firstN !== null && lastN !== null && firstN > lastN;
        const nextIdx = isDesc ? idx - 1 : idx + 1;
        if (nextIdx >= 0 && nextIdx < effectiveEpisodes.length) {
          return { ep: effectiveEpisodes[nextIdx], index: nextIdx };
        }
      }
    }
    return null;
  }, [resolved?.next_episode, effectiveEpisodes, activeStreamCode]);

  const matchedOfflineItem = useMemo(() => {
    if (
      params?.offlineItem &&
      params.offlineItem.stream_code === activeStreamCode &&
      (!params.videosId || !params.offlineItem.videos_id || params.offlineItem.videos_id === params.videosId)
    ) {
      return params.offlineItem;
    }
    return findCompletedOfflineItem({
      streamCode: activeStreamCode,
      videosId: params?.videosId,
      episodeId: params?.episodeId,
    });
  }, [params?.offlineItem, params?.videosId, params?.episodeId, activeStreamCode, offlineItems]);

  const downloadingOfflineItem = useMemo(() => {
    return (
      offlineItems.find(
        (i) =>
          (activeStreamCode &&
            i.stream_code === activeStreamCode &&
            (!params?.videosId || !i.videos_id || i.videos_id === params.videosId)) ||
          (params?.videosId &&
            params.episodeId &&
            i.videos_id === params.videosId &&
            i.episode_id === params.episodeId) ||
          (params?.videosId &&
            !params.episodeId &&
            !activeStreamCode &&
            i.videos_id === params.videosId &&
            !i.episode_title)
      ) || null
    );
  }, [offlineItems, activeStreamCode, params?.videosId, params?.episodeId]);

  const syncNativePipSubtitleTrack = useCallback(
    (player: VideoPlayer, enable: boolean) => {
      try {
        if (!enable || (!settingsRef.current.subShowVi && !settingsRef.current.subShowEn)) {
          player.subtitleTrack = null;
          return;
        }
        const pool: SubtitleTrack[] = player.availableSubtitleTracks || [];
        if (pool.length === 0) return;
        const preferEn = !settingsRef.current.subShowVi && settingsRef.current.subShowEn;
        let chosen: SubtitleTrack | null = null;
        if (preferEn) {
          chosen =
            pool.find(
              (t) =>
                (t.language || '').toLowerCase().startsWith('en') ||
                (t.label || '').toLowerCase().includes('eng') ||
                (t.label || '').toLowerCase().includes('anh')
            ) || pool[0];
        } else {
          chosen =
            pool.find(
              (t) =>
                (t.language || '').toLowerCase().startsWith('vi') ||
                (t.label || '').toLowerCase().includes('việt') ||
                (t.label || '').toLowerCase().includes('viet')
            ) || pool[0];
        }
        player.subtitleTrack = chosen || null;
      } catch {}
    },
    []
  );

  // Persist current watch progress to backend + bidirectional offline sync (returns Promise)
  const persistCurrentProgress = useCallback(
    async (forceFlush = false): Promise<void> => {
      if (!params || !activeStreamCode) return;
      const pos = Math.floor(currentTimeRef.current || 0);
      const dur = Math.floor(durationRef.current || 0);
      if (pos < 3) return;

      const jobs: Promise<unknown>[] = [];

      if (matchedOfflineItem?.id) {
        const offId = matchedOfflineItem.id;
        jobs.push(
          saveOfflineResumePosition(offId, pos, dur, {
            flushDisk: forceFlush,
          })
            .then(() => {
              if (forceFlush) {
                return syncOfflineItemProgressToServer(offId);
              }
              return undefined;
            })
            .catch(() => {})
        );
      }

      if (!isOfflineOnlyMode && params.videosId > 0) {
        const { episodeNumber, seasonId } = resolveEpisodeMetaFromParams(
          effectiveEpisodes,
          activeStreamCode,
          params.episodeNumber,
          params.seasonId,
          params.episodeId
        );
        jobs.push(
          saveWatchProgressApi({
            videos_id: params.videosId,
            stream_code: activeStreamCode,
            position_sec: pos,
            duration_sec: dur,
            episode_number: episodeNumber,
            season_id: seasonId,
            title: params.title,
          })
            .then(() => {
              onWatchProgressSaved?.();
            })
            .catch(() => {})
        );
        jobs.push(
          syncOnlineProgressToOffline({
            streamCode: activeStreamCode,
            videosId: params.videosId,
            episodeId: params.episodeId,
            positionSec: pos,
            durationSec: dur,
            flushDisk: forceFlush,
          }).catch(() => {})
        );
      }

      await Promise.all(jobs);
    },
    [params, activeStreamCode, matchedOfflineItem?.id, isOfflineOnlyMode, effectiveEpisodes, onWatchProgressSaved]
  );

  const flushActivePlaybackSessionNow = useCallback(
    (forceSave = false) => {
      if (
        !visible ||
        !params ||
        !activeStreamCodeRef.current ||
        !settingsRef.current.autoResumeOnCrash ||
        userExplicitlyPausedRef.current
      ) {
        return;
      }
      const now = Date.now();
      if (!forceSave && now - lastActiveSessionWriteRef.current < 1800) {
        return;
      }
      lastActiveSessionWriteRef.current = now;
      const { episodeNumber, seasonId } = resolveEpisodeMetaFromParams(
        effectiveEpisodes,
        activeStreamCodeRef.current,
        params.episodeNumber,
        params.seasonId,
        params.episodeId
      );
      void saveActivePlaybackSession({
        active: true,
        updatedAt: now,
        videosId: params.videosId,
        streamCode: activeStreamCodeRef.current,
        episodeId: params.episodeId,
        episodeNumber,
        seasonId,
        title: resolvedRef.current?.title || params.title,
        episodeTitle: activeEpTitle || resolvedRef.current?.episode_title || params.episodeTitle,
        posterUrl: moviePosterMeta.poster || params.posterUrl,
        thumbnailUrl: moviePosterMeta.thumb || params.thumbnailUrl,
        positionSec: Math.max(0, Math.floor(currentTimeRef.current || 0)),
        durationSec: Math.max(0, Math.floor(durationRef.current || 0)),
        wasOfflineMode: isOfflineOnlyMode,
        offlineItemId: matchedOfflineItem?.id,
      });
    },
    [
      visible,
      params,
      effectiveEpisodes,
      activeEpTitle,
      moviePosterMeta,
      isOfflineOnlyMode,
      matchedOfflineItem?.id,
    ]
  );

  // Periodic watch progress save every 10s
  useEffect(() => {
    if (!visible || !activeStreamCode) return;
    const iv = setInterval(() => {
      if (isPlaying && !isLockedRef.current && currentTimeRef.current > 3) {
        const now = Date.now();
        if (now - lastServerProgressPushRef.current >= 9500) {
          lastServerProgressPushRef.current = now;
          void persistCurrentProgress(false);
        }
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [visible, activeStreamCode, isPlaying, persistCurrentProgress]);

  // Load media URL into active AVPlayer
  const playServerOnActiveLayer = useCallback(
    async (
      srv: ServerRuntimeState,
      opts: { seekToSec?: number; serverFileKey: string; vnUrl: string; enUrl: string; title: string }
    ) => {
      const player = getActivePlayer();
      const inactive = getInactivePlayer();
      try {
        inactive.muted = true;
        inactive.pause();
      } catch {}

      let livePort = localServerPortRef.current;
      if (livePort <= 0 || srv.id === '99') {
        const verifiedPort = await ensureLiveLocalPort(false);
        if (verifiedPort > 0) livePort = verifiedPort;
      }

      let resolvedSrvUrl = srv.streamUrl;
      if (srv.id === '99' && livePort > 0 && /^https?:\/\/127\.0\.0\.1:\d+/i.test(resolvedSrvUrl)) {
        resolvedSrvUrl = resolvedSrvUrl.replace(
          /^https?:\/\/127\.0\.0\.1:\d+/i,
          `http://127.0.0.1:${livePort}`
        );
      }

      const wrapped = wrapUrlForIosNativePlayer({
        rawUrl: resolvedSrvUrl,
        format: srv.format,
        serverId: srv.id,
        vnSubUrl: opts.vnUrl,
        enSubUrl: opts.enUrl,
        localServerPort: livePort,
        pipEnabled: settingsRef.current.pipEnabled,
        pipProxyBroken: pipProxyBrokenRef.current,
      });

      if (!wrapped.uri) return;
      activeMediaUrlRef.current = wrapped.uri;
      setActiveServerId(srv.id);
      activeServerIdRef.current = srv.id;
      setIsBuffering(true);

      if (opts.seekToSec && opts.seekToSec > 0) {
        initialSeekPendingRef.current = { sec: opts.seekToSec, done: false };
      }

      try {
        await player.replaceAsync({
          uri: wrapped.uri,
          contentType: wrapped.contentType,
          metadata: { title: opts.title, artist: 'Đặng Việt Anh' },
        });
        player.muted = false;
        player.playbackRate = playbackRate;
        if (!isLockedRef.current) {
          player.play();
        }
      } catch {}
    },
    [ensureLiveLocalPort, getActivePlayer, getInactivePlayer, playbackRate]
  );

  // Start or restart polling for Phiên 11 / Phiên 36 readiness
  const startCheckFilePolling = useCallback(
    (pollOpts: {
      mySeq: number;
      sfk: string;
      targetStartSec: number;
      hasGgdDirect: boolean;
      vnUrl: string;
      enUrl: string;
      movieTitle: string;
    }) => {
      const { mySeq, sfk, targetStartSec, hasGgdDirect, vnUrl, enUrl, movieTitle } = pollOpts;
      if (!sfk) return;
      if (checkFilePollRef.current) {
        clearInterval(checkFilePollRef.current);
        checkFilePollRef.current = null;
      }

      checkFilePollRef.current = setInterval(async () => {
        if (loadSeqRef.current !== mySeq) return;
        const pollRes = await checkServerFileStatus(sfk);
        if (loadSeqRef.current !== mySeq) return;

        let updated: ServerRuntimeState[] = [];
        setServers((prev) => {
          updated = applyCheckFileToServers(prev, sfk, pollRes);
          return updated;
        });

        if (pollRes.status === 'success') {
          if (checkFilePollRef.current) {
            clearInterval(checkFilePollRef.current);
            checkFilePollRef.current = null;
          }
        }

        const curId = activeServerIdRef.current;
        const lockedId = manualLockedServerRef.current;
        const curSrv = updated.find((s) => s.id === curId);

        if (!curId || !curSrv || !isServerPlayable(curSrv)) {
          const firstPlayable = selectOptimalServer(updated, {
            preferOffline: settingsRef.current.preferOfflineWhenOnline,
            hasGgdDirect,
          });
          if (firstPlayable) {
            await playServerOnActiveLayer(firstPlayable, {
              seekToSec: Math.max(targetStartSec, currentTimeRef.current),
              serverFileKey: sfk,
              vnUrl,
              enUrl,
              title: movieTitle,
            });
          }
          return;
        }

        if (
          (curId === '11' || curId === '36') &&
          ((pollRes.status === 'success' && curSrv.previewTag !== '') ||
            (pollRes.preview_30p &&
              pollRes.total_seconds >= 3600 &&
              curSrv.previewTag === '10p'))
        ) {
          const upgradedMedia = buildServer11Or36MediaUrl(curId, sfk, pollRes);
          if (upgradedMedia.url && upgradedMedia.url !== curSrv.streamUrl) {
            await playServerOnActiveLayer(
              {
                ...curSrv,
                streamUrl: upgradedMedia.url,
                format: upgradedMedia.format,
                previewTag: upgradedMedia.previewTag,
              },
              {
                seekToSec: currentTimeRef.current,
                serverFileKey: sfk,
                vnUrl,
                enUrl,
                title: movieTitle,
              }
            );
            if (pollRes.status === 'success') {
              showToast(`${curSrv.label}: Đã nâng cấp luồng đầy đủ 100%`, undefined, 'success', {
                family: 'ionicons',
                name: 'server-outline',
                color: '#34D399',
              });
            }
          }
        } else if (
          settingsRef.current.autoOptimalServer &&
          !lockedId &&
          curId !== '99' &&
          pollRes.status === 'success' &&
          curId !== '11' &&
          curId !== '36'
        ) {
          const better = selectOptimalServer(updated, {
            preferOffline: settingsRef.current.preferOfflineWhenOnline,
            hasGgdDirect,
          });
          if (better && better.id !== curId && (better.pingMs ?? 9999) + 40 < (curSrv.pingMs ?? 9999)) {
            await playServerOnActiveLayer(better, {
              seekToSec: currentTimeRef.current,
              serverFileKey: sfk,
              vnUrl,
              enUrl,
              title: movieTitle,
            });
            showToast(`Đã chuyển sang ${better.label} (${better.pingMs || 0} ms)`, undefined, 'info', {
              family: 'ionicons',
              name: 'server-outline',
              color: '#38BDF8',
            });
          }
        }
      }, 3200);
    },
    [playServerOnActiveLayer, showToast]
  );

  // Core episode loader (online + offline unified)
  const loadEpisodeByCode = useCallback(
    async (
      streamCodeToLoad: string,
      opts?: { episodeTitleHint?: string; offlineOverride?: OfflineDownloadItem | null }
    ) => {
      if (!params || !streamCodeToLoad) return;
      const mySeq = ++loadSeqRef.current;
      offlineRetryAttemptedRef.current = false;
      rewoundToastPendingRef.current = false;
      userExplicitlyPausedRef.current = false;

      if (checkFilePollRef.current) {
        clearInterval(checkFilePollRef.current);
        checkFilePollRef.current = null;
      }

      manualLockedServerRef.current = null;
      erroredServersRef.current = new Set();
      pipProxyBrokenRef.current = false;
      activeMediaUrlRef.current = '';
      preloadedNextRef.current = null;
      nextAutoSwitchTriggeredRef.current = false;
      setPreloadState('idle');
      setNextCountdownSec(null);
      setSeekReturnSec(null);
      setFirstFrameReady(false);
      setIsBuffering(true);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      setDuration(0);
      durationRef.current = 0;
      setBufferedPos(0);
      setActiveStreamCode(streamCodeToLoad);
      if (opts?.episodeTitleHint) setActiveEpTitle(opts.episodeTitleHint);

      hasAutoHiddenInitialHudRef.current = false;
      userInteractedHudRef.current = false;
      setHudVisible(true);

      // Pause both layers cleanly before starting new episode
      try {
        playerA.pause();
        playerB.pause();
      } catch {}

      const localOffline =
        opts?.offlineOverride ||
        findCompletedOfflineItem({
          streamCode: streamCodeToLoad,
          videosId: params.videosId,
          episodeId: params.episodeId,
        });

      // Offline-first branch when opened from Offline Library (resolves non-99 statuses accurately without hanging on "Đang kiểm tra")
      if (isOfflineOnlyMode && localOffline) {
        const synthEps: EpisodeItem[] = (params.offlineEpisodes || []).map((it, idx) => ({
          episodes_id: it.episode_id || idx + 1,
          seasons_id: 0,
          episodes_name: it.episode_title || `Tập ${it.episode_number || idx + 1}`,
          stream_code: it.stream_code,
          player_url: '',
          full_url: '',
          order: it.episode_number || idx + 1,
        }));
        const offIdx = (params.offlineEpisodes || []).findIndex(
          (i) => i.id === localOffline.id
        );
        const nextOff =
          offIdx >= 0 && params.offlineEpisodes && offIdx + 1 < params.offlineEpisodes.length
            ? params.offlineEpisodes[offIdx + 1]
            : null;
        const synthResolved: StreamResolvedData = {
          success: true,
          stream_code: streamCodeToLoad,
          server_file_key: localOffline.server_file_key || '',
          server_movie_title: localOffline.server_movie_title || '',
          title: localOffline.title,
          episode_title: localOffline.episode_title || '',
          can_play_native: true,
          primary_url: localOffline.local_uri,
          stream_type: localOffline.media_format || 'mp4',
          download_mp4_url: '',
          qualities: [],
          subtitles: (localOffline.subtitles || []).map((s) => ({
            label: s.label,
            url: s.local_uri,
            lang: s.lang,
          })),
          skip_intro_sec: localOffline.skip_intro_sec || 0,
          end_credits_sec: localOffline.end_credits_sec || 0,
          next_episode_slug: nextOff?.stream_code || '',
          resume_seconds: localOffline.resume_sec || 0,
          webview_url: '',
          episodes: synthEps,
          next_episode: nextOff
            ? {
                episodes_id: nextOff.episode_id || 0,
                seasons_id: 0,
                episodes_name: nextOff.episode_title || 'Tập tiếp theo',
                stream_code: nextOff.stream_code,
                player_url: '',
                full_url: '',
                order: nextOff.episode_number || 0,
              }
            : null,
        };
        if (loadSeqRef.current !== mySeq) return;
        setResolved(synthResolved);
        setActiveEpTitle(localOffline.episode_title || '');
        setQualityBadge('1080pHD');
        if (localOffline.duration_sec) setDuration(localOffline.duration_sec);
        const livePort = await ensureLiveLocalPort(false);
        if (loadSeqRef.current !== mySeq) return;
        const srvList = buildInitialServerStates({
          serverFileKey: localOffline.server_file_key || '',
          offlineItem: localOffline,
          localServerPort: livePort,
          resolved: synthResolved,
        });
        setServers(srvList);

        const dual = await loadDualSubtitles({
          serverFileKey: localOffline.server_file_key,
          offlineItem: localOffline,
        });
        if (loadSeqRef.current !== mySeq) return;
        setVnCues(dual.vnCues);
        setEnCues(dual.enCues);
        setVnSubUrl(dual.vnUrl);
        setEnSubUrl(dual.enUrl);

        let initialPos = Math.max(localOffline.resume_sec || 0, params.initialResumeSec || 0);
        if (localOffline.duration_sec && localOffline.duration_sec > 60) {
          const safe = computeSafeResumeSec(
            initialPos,
            localOffline.duration_sec,
            synthResolved.end_credits_sec || 0
          );
          if (safe.rewound) {
            initialPos = safe.sec;
            rewoundToastPendingRef.current = true;
            showToast(
              'Đã tự động lùi lại 2 phút',
              'Phát từ vị trí trước đoạn chuyển tập',
              'info',
              { family: 'ionicons', name: 'play-back-circle-outline', color: '#38BDF8' }
            );
          }
        }
        if (initialPos <= 2 && settingsRef.current.autoSkipIntro && synthResolved.skip_intro_sec > 0) {
          initialPos = synthResolved.skip_intro_sec;
          showToast('Đã bỏ qua đoạn giới thiệu', undefined, 'info', {
            family: 'ionicons',
            name: 'play-skip-forward-outline',
            color: '#38BDF8',
          });
        }
        const offSrv = srvList.find((s) => s.id === '99');
        if (offSrv) {
          await playServerOnActiveLayer(offSrv, {
            seekToSec: initialPos,
            serverFileKey: localOffline.server_file_key || '',
            vnUrl: dual.vnUrl,
            enUrl: dual.enUrl,
            title: localOffline.title,
          });
        }

        // Background status resolution so Phiên 11/36/40/3 never remain stuck on "Đang kiểm tra..."
        void (async () => {
          const isOnline = await probeConnectivity(2400);
          if (loadSeqRef.current !== mySeq) return;
          if (!isOnline) {
            setServers((prev) =>
              prev.map((s) =>
                s.id === '99'
                  ? s
                  : {
                      ...s,
                      status: 'error',
                      pingMs: null,
                      pingFailed: true,
                      progressLabel: 'Mất kết nối',
                    }
              )
            );
            return;
          }

          let sfkBg = localOffline.server_file_key || '';
          let onlineRes: StreamResolvedData | null = null;
          if (!sfkBg && params.videosId > 0) {
            onlineRes = await resolveStreamApi(streamCodeToLoad, params.videosId).catch(() => null);
            if (loadSeqRef.current !== mySeq) return;
            if (onlineRes?.server_file_key) {
              sfkBg = onlineRes.server_file_key;
            }
          }
          const [pings, cfRes, ggdRes] = await Promise.all([
            measureAllServerPings(true),
            sfkBg ? checkServerFileStatus(sfkBg) : Promise.resolve(null),
            sfkBg
              ? checkGgdriverApi(sfkBg, onlineRes?.server_movie_title || localOffline.server_movie_title)
              : Promise.resolve({ ggdriver_1: false, ggdriver_2: false, ggdriver_3: false }),
          ]);
          if (loadSeqRef.current !== mySeq) return;
          const mergedResolved: StreamResolvedData = {
            ...synthResolved,
            ...(onlineRes || {}),
            server_file_key: sfkBg,
          };
          setResolved((prev) => (prev && prev.stream_code === streamCodeToLoad ? mergedResolved : prev));
          let updatedList = buildInitialServerStates({
            serverFileKey: sfkBg,
            offlineItem: localOffline,
            localServerPort: localServerPortRef.current || livePort,
            resolved: mergedResolved,
            ggd: ggdRes,
            pings,
            erroredIds: erroredServersRef.current,
          });
          if (cfRes && sfkBg) {
            updatedList = applyCheckFileToServers(updatedList, sfkBg, cfRes);
          }
          setServers(updatedList);
        })();
        return;
      }

      // Online mode (with Local-First Phiên 99 support + full 11/36/40/3 engine)
      try {
        const [resData, serverProgRes, livePort] = await Promise.all([
          resolveStreamApi(streamCodeToLoad, params.videosId),
          params.videosId > 0
            ? fetchWatchProgressApi(streamCodeToLoad, params.videosId).catch(() => null)
            : Promise.resolve(null),
          ensureLiveLocalPort(false),
        ]);
        if (loadSeqRef.current !== mySeq) return;

        setResolved(resData);
        if (resData.episode_title) setActiveEpTitle(resData.episode_title);
        if (resData.movie?.in_wishlist !== undefined) {
          setInWishlist(Boolean(resData.movie.in_wishlist));
        }
        if (resData.movie?.poster_url || resData.movie?.thumbnail_url) {
          setMoviePosterMeta({
            poster: resData.movie?.poster_url || params.posterUrl || '',
            thumb: resData.movie?.thumbnail_url || params.thumbnailUrl || '',
          });
        }
        if (resData.episodes && resData.episodes.length > 0) {
          detailEpisodesVideosIdRef.current = resData.movie?.videos_id || params.videosId;
          setDetailEpisodes(resData.episodes);
        }

        const sfk = resData.server_file_key || localOffline?.server_file_key || '';
        const { vnUrl: autoVnUrl, enUrl: autoEnUrl } = buildSubtitleUrls(sfk);
        const effectiveVnUrl = autoVnUrl || resData.subtitles.find((s) => s.lang === 'vi')?.url || '';
        const effectiveEnUrl = autoEnUrl || resData.subtitles.find((s) => s.lang === 'en')?.url || '';

        // Load subtitles, measure pings, check GGD & Phiên 11/36 in parallel
        const [dualSubs, pings, checkFileRes, apiGgd] = await Promise.all([
          loadDualSubtitles({
            serverFileKey: sfk,
            resolvedSubtitles: resData.subtitles,
            offlineItem: localOffline,
          }),
          measureAllServerPings(Boolean(localOffline)),
          sfk ? checkServerFileStatus(sfk) : Promise.resolve(null),
          sfk &&
          !resData.ggdriver_1 &&
          !resData.ggdriver_2 &&
          !resData.ggdriver_3
            ? checkGgdriverApi(sfk, resData.server_movie_title)
            : Promise.resolve({
                ggdriver_1: Boolean(resData.ggdriver_1),
                ggdriver_2: Boolean(resData.ggdriver_2),
                ggdriver_3: Boolean(resData.ggdriver_3),
              }),
        ]);
        if (loadSeqRef.current !== mySeq) return;

        setVnCues(dualSubs.vnCues);
        setEnCues(dualSubs.enCues);
        setVnSubUrl(effectiveVnUrl);
        setEnSubUrl(effectiveEnUrl);

        let initialServers = buildInitialServerStates({
          serverFileKey: sfk,
          offlineItem: localOffline,
          localServerPort: livePort,
          resolved: resData,
          ggd: apiGgd,
          pings,
          erroredIds: erroredServersRef.current,
        });

        if (checkFileRes) {
          initialServers = applyCheckFileToServers(initialServers, sfk, checkFileRes);
          if (
            sfk &&
            (checkFileRes.status === 'error_file' || checkFileRes.status === 'error_file_log')
          ) {
            void triggerServerPrepare(sfk);
          }
        }
        setServers(initialServers);

        const hasGgdDirect = Boolean(
          apiGgd.ggdriver_1 || apiGgd.ggdriver_2 || apiGgd.ggdriver_3
        );
        const chosen = selectOptimalServer(initialServers, {
          preferOffline: settingsRef.current.preferOfflineWhenOnline,
          hasGgdDirect,
        });

        // Compute best resume position across server + local offline + auto-resume initialResumeSec
        const serverResumeSec =
          serverProgRes &&
          serverProgRes.resume_seconds > (resData.resume_seconds || 0)
            ? serverProgRes.resume_seconds
            : resData.resume_seconds || 0;
        const offlineResumeSec = localOffline?.resume_sec || 0;
        let targetStartSec = Math.max(serverResumeSec, offlineResumeSec, params.initialResumeSec || 0);
        if (
          targetStartSec <= 3 &&
          settingsRef.current.autoSkipIntro &&
          resData.skip_intro_sec > 0
        ) {
          targetStartSec = resData.skip_intro_sec;
          showToast('Đã bỏ qua đoạn giới thiệu', undefined, 'info', {
            family: 'ionicons',
            name: 'play-skip-forward-outline',
            color: '#38BDF8',
          });
        }

        if (chosen) {
          await playServerOnActiveLayer(chosen, {
            seekToSec: targetStartSec,
            serverFileKey: sfk,
            vnUrl: effectiveVnUrl,
            enUrl: effectiveEnUrl,
            title: resData.title || params.title,
          });
          if (sfk) {
            probeVideoQualityLabel(sfk, chosen.id, resData.movie?.video_quality)
              .then((badge) => {
                if (loadSeqRef.current === mySeq) setQualityBadge(badge);
              })
              .catch(() => {});
          }
        } else {
          setFirstFrameReady(true);
          setIsBuffering(false);
        }

        // Poll Phiên 11 / Phiên 36 progress while preparing so user sees live % & auto-upgrades to 100%
        if (sfk && checkFileRes && checkFileRes.status !== 'success') {
          startCheckFilePolling({
            mySeq,
            sfk,
            targetStartSec,
            hasGgdDirect,
            vnUrl: effectiveVnUrl,
            enUrl: effectiveEnUrl,
            movieTitle: resData.title || params.title,
          });
        }
      } catch {
        setFirstFrameReady(true);
        setIsBuffering(false);
        if (onEnterOfflineMode) {
          onEnterOfflineMode();
        } else {
          showAppAlert('Lỗi kết nối', 'Không thể tải dữ liệu phát phim lúc này.');
        }
      }
    },
    [
      params,
      isOfflineOnlyMode,
      ensureLiveLocalPort,
      playerA,
      playerB,
      playServerOnActiveLayer,
      startCheckFilePolling,
      showToast,
      onEnterOfflineMode,
    ]
  );

  // Preload next episode silently into inactive AVPlayer layer at T - outro - 120s
  const preloadNextEpisodeToInactiveLayer = useCallback(async () => {
    if (!currentNextEpisode || preloadStateRef.current !== 'idle') return;
    setPreloadState('loading');
    preloadStateRef.current = 'loading';

    const targetEp = currentNextEpisode.ep;
    const sfkHint = resolvedRef.current?.next_episode_meta?.server_file_key || '';

    try {
      const localNextOff = findCompletedOfflineItem({
        streamCode: targetEp.stream_code,
        videosId: params?.videosId,
        episodeId: targetEp.episodes_id,
      });

      const nextResolved = await resolveStreamApi(targetEp.stream_code, params?.videosId).catch(
        () => null
      );

      const livePort = await ensureLiveLocalPort(false);

      if (localNextOff && localNextOff.local_uri) {
        const offUrl = buildOfflineServerUrl(localNextOff, livePort);
        const dual = await loadDualSubtitles({
          serverFileKey: sfkHint || nextResolved?.server_file_key,
          offlineItem: localNextOff,
        });
        const nextSkip =
          nextResolved?.skip_intro_sec ??
          resolvedRef.current?.next_episode_meta?.skip_intro_sec ??
          localNextOff.skip_intro_sec ??
          0;
        const nextEndCredits =
          nextResolved?.end_credits_sec ??
          resolvedRef.current?.next_episode_meta?.end_credits_sec ??
          localNextOff.end_credits_sec ??
          0;
        const pkg: PreloadedNextPackage = {
          streamCode: targetEp.stream_code,
          episode: targetEp,
          episodeIndex: currentNextEpisode.index,
          resolved: nextResolved || {
            success: true,
            stream_code: targetEp.stream_code,
            can_play_native: true,
            primary_url: offUrl.url,
            stream_type: offUrl.format,
            download_mp4_url: '',
            qualities: [],
            subtitles: [],
            skip_intro_sec: nextSkip,
            end_credits_sec: nextEndCredits,
            next_episode_slug: '',
            resume_seconds: 0,
            webview_url: '',
          },
          vnCues: dual.vnCues,
          enCues: dual.enCues,
          vnUrl: dual.vnUrl,
          enUrl: dual.enUrl,
          serverId: '99',
          serverLabel: 'Phát từ máy',
          streamUrl: offUrl.url,
          qualityLabel: '1080pHD',
          skipIntroSec: nextSkip,
          endCreditsSec: nextEndCredits,
          subHighRaw: nextResolved?.sub_high || '',
          offlineItem: localNextOff,
          servers: buildInitialServerStates({
            serverFileKey: sfkHint || nextResolved?.server_file_key || '',
            offlineItem: localNextOff,
            localServerPort: livePort,
            resolved: nextResolved || undefined,
          }).map((s) =>
            s.id === '99'
              ? s
              : {
                  ...s,
                  status: 'error',
                  pingFailed: true,
                  progressLabel: 'Chưa kiểm tra',
                }
          ),
        };
        preloadedNextRef.current = pkg;
        const inactive = getInactivePlayer();
        inactive.muted = true;
        await inactive.replaceAsync({
          uri: offUrl.url,
          contentType: offUrl.format === 'hls' ? 'hls' : 'progressive',
        });
        return;
      }

      if (!nextResolved) {
        setPreloadState('failed');
        return;
      }

      const nextSfk = nextResolved.server_file_key || sfkHint;
      const [dual, pings, cfRes, ggdRes] = await Promise.all([
        loadDualSubtitles({
          serverFileKey: nextSfk,
          resolvedSubtitles: nextResolved.subtitles,
        }),
        measureAllServerPings(false),
        nextSfk ? checkServerFileStatus(nextSfk) : Promise.resolve(null),
        nextSfk && !nextResolved.ggdriver_1 && !nextResolved.ggdriver_2 && !nextResolved.ggdriver_3
          ? checkGgdriverApi(nextSfk, nextResolved.server_movie_title)
          : Promise.resolve({
              ggdriver_1: Boolean(nextResolved.ggdriver_1),
              ggdriver_2: Boolean(nextResolved.ggdriver_2),
              ggdriver_3: Boolean(nextResolved.ggdriver_3),
            }),
      ]);

      if (nextSfk && cfRes && (cfRes.status === 'error_file' || cfRes.status === 'error_file_log')) {
        void triggerServerPrepare(nextSfk);
      }

      let nextServers = buildInitialServerStates({
        serverFileKey: nextSfk,
        localServerPort: livePort,
        resolved: nextResolved,
        ggd: ggdRes,
        pings,
      });
      if (cfRes) nextServers = applyCheckFileToServers(nextServers, nextSfk, cfRes);

      const best = selectOptimalServer(nextServers, {
        preferOffline: settingsRef.current.preferOfflineWhenOnline,
        hasGgdDirect: Boolean(ggdRes.ggdriver_1 || ggdRes.ggdriver_2 || ggdRes.ggdriver_3),
      });

      if (!best || !best.streamUrl) {
        setPreloadState('failed');
        return;
      }

      const wrapped = wrapUrlForIosNativePlayer({
        rawUrl: best.streamUrl,
        format: best.format,
        serverId: best.id,
        vnSubUrl: dual.vnUrl,
        enSubUrl: dual.enUrl,
        localServerPort: livePort,
        pipEnabled: settingsRef.current.pipEnabled,
        pipProxyBroken: pipProxyBrokenRef.current,
      });

      const pkg: PreloadedNextPackage = {
        streamCode: targetEp.stream_code,
        episode: targetEp,
        episodeIndex: currentNextEpisode.index,
        resolved: nextResolved,
        vnCues: dual.vnCues,
        enCues: dual.enCues,
        vnUrl: dual.vnUrl,
        enUrl: dual.enUrl,
        serverId: best.id,
        serverLabel: best.label,
        streamUrl: wrapped.uri,
        qualityLabel: qualityBadge,
        skipIntroSec: nextResolved.skip_intro_sec || 0,
        endCreditsSec: nextResolved.end_credits_sec || 0,
        subHighRaw: nextResolved.sub_high || '',
        offlineItem: null,
        servers: nextServers,
      };
      preloadedNextRef.current = pkg;

      const inactive = getInactivePlayer();
      inactive.muted = true;
      await inactive.replaceAsync({
        uri: wrapped.uri,
        contentType: wrapped.contentType,
        metadata: { title: nextResolved.title || params?.title || '', artist: 'Đặng Việt Anh' },
      });
    } catch {
      setPreloadState('failed');
    }
  }, [currentNextEpisode, params?.videosId, params?.title, ensureLiveLocalPort, qualityBadge, getInactivePlayer]);

  // Execute seamless 2-layer crossfade switch when preloaded next episode is ready
  const triggerSwitchToNextEpisode = useCallback(() => {
    if (!currentNextEpisode) return;
    persistCurrentProgress(true);
    setNextCountdownSec(null);

    if (settingsRef.current.autoDubNext && !settingsRef.current.subAiVoiceEnabled) {
      void updateSetting('subAiVoiceEnabled', true);
    }

    const pkg = preloadedNextRef.current;
    if (
      pkg &&
      pkg.streamCode === currentNextEpisode.ep.stream_code &&
      preloadStateRef.current === 'ready'
    ) {
      if (checkFilePollRef.current) {
        clearInterval(checkFilePollRef.current);
        checkFilePollRef.current = null;
      }

      const oldLayer = activeLayerRef.current;
      const newLayer: 'A' | 'B' = oldLayer === 'A' ? 'B' : 'A';
      const oldPlayer = oldLayer === 'A' ? playerA : playerB;
      const promotedPlayer = newLayer === 'A' ? playerA : playerB;

      try {
        if (pkg.skipIntroSec > 0 && promotedPlayer.currentTime < pkg.skipIntroSec) {
          promotedPlayer.currentTime = pkg.skipIntroSec;
        }
        promotedPlayer.playbackRate = playbackRate;
        promotedPlayer.muted = false;
        if (!isLockedRef.current) {
          promotedPlayer.play();
        }
      } catch {}

      const durMs = settingsRef.current.transitionEffectEnabled ? 620 : 0;
      Animated.parallel([
        Animated.timing(newLayer === 'A' ? layerAOpacity : layerBOpacity, {
          toValue: 1,
          duration: durMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(oldLayer === 'A' ? layerAOpacity : layerBOpacity, {
          toValue: 0,
          duration: durMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        try {
          oldPlayer.muted = true;
          oldPlayer.pause();
        } catch {}
      });

      activeLayerRef.current = newLayer;
      setActiveLayer(newLayer);
      setResolved(pkg.resolved);
      setActiveStreamCode(pkg.streamCode);
      setActiveEpTitle(pkg.episode.episodes_name);
      setVnCues(pkg.vnCues);
      setEnCues(pkg.enCues);
      setVnSubUrl(pkg.vnUrl);
      setEnSubUrl(pkg.enUrl);
      setServers(pkg.servers);
      setActiveServerId(pkg.serverId);
      activeServerIdRef.current = pkg.serverId;
      activeMediaUrlRef.current = pkg.streamUrl;
      preloadedNextRef.current = null;
      nextAutoSwitchTriggeredRef.current = false;
      userExplicitlyPausedRef.current = false;
      setPreloadState('idle');
      setCurrentTime(pkg.skipIntroSec || 0);
      currentTimeRef.current = pkg.skipIntroSec || 0;
      setDuration(promotedPlayer.duration || 0);
      setFirstFrameReady(true);
      setIsBuffering(false);

      skipNextReloadCodeRef.current = pkg.streamCode;
      if (pkg.offlineItem && onSwitchOfflineItem) {
        onSwitchOfflineItem(pkg.offlineItem);
      } else if (onSwitchEpisode) {
        onSwitchEpisode(pkg.episode, pkg.episodeIndex);
      }
      showToast(`Đang phát ${pkg.episode.episodes_name}`, undefined, 'info', {
        family: 'ionicons',
        name: 'film-outline',
        color: '#FF4D57',
      });
      return;
    }

    // Standard switch if not yet preloaded into Layer 2
    if (pkg?.offlineItem && onSwitchOfflineItem) {
      onSwitchOfflineItem(pkg.offlineItem);
    } else if (onSwitchEpisode) {
      onSwitchEpisode(currentNextEpisode.ep, currentNextEpisode.index);
    } else {
      void loadEpisodeByCode(currentNextEpisode.ep.stream_code, {
        episodeTitleHint: currentNextEpisode.ep.episodes_name,
      });
    }
  }, [
    currentNextEpisode,
    persistCurrentProgress,
    updateSetting,
    playerA,
    playerB,
    playbackRate,
    layerAOpacity,
    layerBOpacity,
    onSwitchOfflineItem,
    onSwitchEpisode,
    loadEpisodeByCode,
    showToast,
  ]);

  // Helper attaching listeners for Layer A and Layer B cleanly
  const handleLayerTimeUpdate = useCallback(
    (layer: 'A' | 'B', pos: number, buf: number) => {
      if (activeLayerRef.current !== layer) return;
      setCurrentTime(pos);
      currentTimeRef.current = pos;
      setBufferedPos(buf);

      if (pos > 2 && !userExplicitlyPausedRef.current) {
        flushActivePlaybackSessionNow(false);
      }

      const dur = durationRef.current;
      if (dur <= 0 || !initialSeekPendingRef.current.done) return;
      const endCredits = resolvedRef.current?.end_credits_sec || 0;

      // Trigger Layer 2 preload at T - endCredits - 120s
      if (
        settingsRef.current.seamlessPreloadEnabled &&
        currentNextEpisode &&
        preloadStateRef.current === 'idle' &&
        pos >= Math.max(5, dur - endCredits - 120)
      ) {
        void preloadNextEpisodeToInactiveLayer();
      }

      // Trigger outro auto-next at T - endCredits (if endCredits > 15s and next ep exists)
      if (
        settingsRef.current.autoPlayNext &&
        currentNextEpisode &&
        !nextAutoSwitchTriggeredRef.current &&
        endCredits > 15 &&
        pos >= dur - endCredits &&
        pos < dur - 2
      ) {
        nextAutoSwitchTriggeredRef.current = true;
        const delaySec = settingsRef.current.nextEpisodeDelaySec || 0;
        if (delaySec <= 0) {
          triggerSwitchToNextEpisode();
        } else {
          setNextCountdownSec(delaySec);
        }
      }
    },
    [currentNextEpisode, flushActivePlaybackSessionNow, preloadNextEpisodeToInactiveLayer, triggerSwitchToNextEpisode]
  );

  // Shared failure recovery for both Player A & Player B (eliminates duplication & self-heals offline socket)
  const handleActivePlayerError = useCallback(async () => {
    // 1. If native HLS PiP proxy failed on an online source, retry direct URL first
    if (
      activeServerIdRef.current !== '99' &&
      activeMediaUrlRef.current.includes('/hls-pip/master.m3u8') &&
      !pipProxyBrokenRef.current
    ) {
      pipProxyBrokenRef.current = true;
      const curSrv = serversRef.current.find((s) => s.id === activeServerIdRef.current);
      if (curSrv) {
        await playServerOnActiveLayer(curSrv, {
          seekToSec: currentTimeRef.current,
          serverFileKey: resolvedRef.current?.server_file_key || '',
          vnUrl: vnSubUrl,
          enUrl: enSubUrl,
          title: params?.title || '',
        });
        return;
      }
    }

    // 2. If offline server ('99') errored (e.g. reclaimed loopback port), force restart socket once
    if (activeServerIdRef.current === '99' && !offlineRetryAttemptedRef.current) {
      offlineRetryAttemptedRef.current = true;
      const freshPort = await ensureLiveLocalPort(true);
      const offlineTarget =
        matchedOfflineItem ||
        findCompletedOfflineItem({
          streamCode: activeStreamCode,
          videosId: params?.videosId,
          episodeId: params?.episodeId,
        });
      const curSrv = serversRef.current.find((s) => s.id === '99');
      if (curSrv && freshPort > 0) {
        const rebuilt = offlineTarget
          ? buildOfflineServerUrl(offlineTarget, freshPort)
          : {
              url: curSrv.streamUrl.replace(
                /^https?:\/\/127\.0\.0\.1:\d+/i,
                `http://127.0.0.1:${freshPort}`
              ),
              format: curSrv.format,
            };
        const healedSrv: ServerRuntimeState = {
          ...curSrv,
          streamUrl: rebuilt.url,
          format: rebuilt.format,
          status: 'ready',
          errored: false,
        };
        setServers((prev) => prev.map((s) => (s.id === '99' ? healedSrv : s)));
        await playServerOnActiveLayer(healedSrv, {
          seekToSec: currentTimeRef.current,
          serverFileKey: resolvedRef.current?.server_file_key || '',
          vnUrl: vnSubUrl,
          enUrl: enSubUrl,
          title: params?.title || '',
        });
        return;
      }
    }

    // 3. Otherwise mark server errored & failover automatically
    if (activeServerIdRef.current) {
      erroredServersRef.current.add(activeServerIdRef.current);
      const nextServers = serversRef.current.map((s) =>
        s.id === activeServerIdRef.current ? { ...s, errored: true, status: 'error' as const } : s
      );
      setServers(nextServers);
      const failover = selectOptimalServer(nextServers, {
        preferOffline: settingsRef.current.preferOfflineWhenOnline,
        hasGgdDirect: Boolean(
          resolvedRef.current?.ggdriver_1 ||
            resolvedRef.current?.ggdriver_2 ||
            resolvedRef.current?.ggdriver_3
        ),
      });
      if (failover) {
        showToast(
          `Chuyển sang ${failover.label}`,
          'Đang tự động khôi phục nguồn phát',
          'warning',
          { family: 'ionicons', name: 'server-outline', color: '#FBBF24' }
        );
        await playServerOnActiveLayer(failover, {
          seekToSec: currentTimeRef.current,
          serverFileKey: resolvedRef.current?.server_file_key || '',
          vnUrl: vnSubUrl,
          enUrl: enSubUrl,
          title: params?.title || '',
        });
        return;
      }
    }
    setIsBuffering(false);
    setFirstFrameReady(true);
  }, [
    activeStreamCode,
    ensureLiveLocalPort,
    matchedOfflineItem,
    params?.episodeId,
    params?.title,
    params?.videosId,
    playServerOnActiveLayer,
    showToast,
    vnSubUrl,
    enSubUrl,
  ]);

  const handleReloadSubtitles = useCallback(async () => {
    if (isReloadingSubtitles) return;
    setIsReloadingSubtitles(true);
    try {
      const sfk = resolvedRef.current?.server_file_key || matchedOfflineItem?.server_file_key || '';
      const dual = await loadDualSubtitles({
        serverFileKey: sfk,
        resolvedSubtitles: resolvedRef.current?.subtitles,
        offlineItem: matchedOfflineItem,
        bustCache: true,
      });
      setVnCues(dual.vnCues);
      setEnCues(dual.enCues);
      setVnSubUrl(dual.vnUrl);
      setEnSubUrl(dual.enUrl);
      setSubReloadNonce((n) => n + 1);
      if (isInPipRef.current) {
        syncNativePipSubtitleTrack(getActivePlayer(), true);
      }
      showToast('Đã nạp lại phụ đề', 'Phụ đề mới đã được tải và đồng bộ', 'success', {
        family: 'ionicons',
        name: 'chatbox-ellipses-outline',
        color: '#34D399',
      });
    } catch {
      showToast('Không thể nạp lại phụ đề', 'Vui lòng thử lại sau giây lát', 'warning', {
        family: 'ionicons',
        name: 'chatbox-ellipses-outline',
        color: '#FBBF24',
      });
    } finally {
      setIsReloadingSubtitles(false);
    }
  }, [
    isReloadingSubtitles,
    matchedOfflineItem,
    getActivePlayer,
    syncNativePipSubtitleTrack,
    showToast,
  ]);

  // Listeners for Player A
  useEffect(() => {
    const sSub = playerA.addListener('statusChange', (ev) => {
      const st = ev.status;
      if (activeLayerRef.current !== 'A') {
        // Inactive Layer A finishing preload
        if (st === 'readyToPlay' && preloadStateRef.current === 'loading') {
          try {
            const pkg = preloadedNextRef.current;
            playerA.muted = true;
            if (pkg && pkg.skipIntroSec > 0) {
              playerA.currentTime = pkg.skipIntroSec;
            }
            playerA.pause();
            setPreloadState('ready');
          } catch {}
        } else if (st === 'error' && preloadStateRef.current === 'loading') {
          setPreloadState('failed');
        }
        return;
      }

      if (st === 'loading') {
        setIsBuffering(true);
      } else if (st === 'readyToPlay') {
        setIsBuffering(false);
        setFirstFrameReady(true);
        const dur = playerA.duration || 0;
        if (dur > 0) setDuration(dur);
        if (!initialSeekPendingRef.current.done && initialSeekPendingRef.current.sec > 0) {
          const endCreds = resolvedRef.current?.end_credits_sec || 0;
          const safe = computeSafeResumeSec(initialSeekPendingRef.current.sec, dur, endCreds);
          initialSeekPendingRef.current.done = true;
          try {
            playerA.currentTime = safe.sec;
          } catch {}
          if (safe.rewound && !rewoundToastPendingRef.current) {
            rewoundToastPendingRef.current = true;
            showToast(
              'Đã tự động lùi lại 2 phút',
              'Phát từ vị trí trước đoạn chuyển tập',
              'info',
              { family: 'ionicons', name: 'play-back-circle-outline', color: '#38BDF8' }
            );
          }
        }
      } else if (st === 'error') {
        void handleActivePlayerError();
      }
    });

    const pSub = playerA.addListener('playingChange', (ev) => {
      if (activeLayerRef.current !== 'A') return;
      setIsPlaying(ev.isPlaying);
      if (ev.isPlaying) {
        userExplicitlyPausedRef.current = false;
        flushActivePlaybackSessionNow(true);
      }
      if (ev.isPlaying && !hasAutoHiddenInitialHudRef.current && !userInteractedHudRef.current) {
        hasAutoHiddenInitialHudRef.current = true;
        scheduleHudAutoHide(450);
      }
    });

    const tSub = playerA.addListener('timeUpdate', (ev) => {
      if (playerA.duration > 0 && activeLayerRef.current === 'A') {
        setDuration(playerA.duration);
      }
      handleLayerTimeUpdate('A', ev.currentTime, Math.max(0, ev.bufferedPosition || 0));
    });

    const eSub = playerA.addListener('playToEnd', () => {
      if (activeLayerRef.current !== 'A') return;
      if (sleepTimerValue === 'end_of_episode') {
        userExplicitlyPausedRef.current = true;
        void clearActivePlaybackSession();
        setSleepTimerValue(null);
        setSleepSecondsLeft(null);
        showAppAlert('Hẹn giờ ngủ', 'Đã phát hết tập phim và tự động dừng.');
        return;
      }
      if (settingsRef.current.autoPlayNext && currentNextEpisode) {
        triggerSwitchToNextEpisode();
      } else {
        userExplicitlyPausedRef.current = true;
        void clearActivePlaybackSession();
      }
    });

    return () => {
      sSub.remove();
      pSub.remove();
      tSub.remove();
      eSub.remove();
    };
  }, [
    playerA,
    sleepTimerValue,
    currentNextEpisode,
    handleActivePlayerError,
    handleLayerTimeUpdate,
    flushActivePlaybackSessionNow,
    scheduleHudAutoHide,
    showToast,
    triggerSwitchToNextEpisode,
  ]);

  // Listeners for Player B
  useEffect(() => {
    const sSub = playerB.addListener('statusChange', (ev) => {
      const st = ev.status;
      if (activeLayerRef.current !== 'B') {
        if (st === 'readyToPlay' && preloadStateRef.current === 'loading') {
          try {
            const pkg = preloadedNextRef.current;
            playerB.muted = true;
            if (pkg && pkg.skipIntroSec > 0) {
              playerB.currentTime = pkg.skipIntroSec;
            }
            playerB.pause();
            setPreloadState('ready');
          } catch {}
        } else if (st === 'error' && preloadStateRef.current === 'loading') {
          setPreloadState('failed');
        }
        return;
      }

      if (st === 'loading') {
        setIsBuffering(true);
      } else if (st === 'readyToPlay') {
        setIsBuffering(false);
        setFirstFrameReady(true);
        const dur = playerB.duration || 0;
        if (dur > 0) setDuration(dur);
        if (!initialSeekPendingRef.current.done && initialSeekPendingRef.current.sec > 0) {
          const endCreds = resolvedRef.current?.end_credits_sec || 0;
          const safe = computeSafeResumeSec(initialSeekPendingRef.current.sec, dur, endCreds);
          initialSeekPendingRef.current.done = true;
          try {
            playerB.currentTime = safe.sec;
          } catch {}
          if (safe.rewound && !rewoundToastPendingRef.current) {
            rewoundToastPendingRef.current = true;
            showToast(
              'Đã tự động lùi lại 2 phút',
              'Phát từ vị trí trước đoạn chuyển tập',
              'info',
              { family: 'ionicons', name: 'play-back-circle-outline', color: '#38BDF8' }
            );
          }
        }
      } else if (st === 'error') {
        void handleActivePlayerError();
      }
    });

    const pSub = playerB.addListener('playingChange', (ev) => {
      if (activeLayerRef.current !== 'B') return;
      setIsPlaying(ev.isPlaying);
      if (ev.isPlaying) {
        userExplicitlyPausedRef.current = false;
        flushActivePlaybackSessionNow(true);
      }
      if (ev.isPlaying && !hasAutoHiddenInitialHudRef.current && !userInteractedHudRef.current) {
        hasAutoHiddenInitialHudRef.current = true;
        scheduleHudAutoHide(450);
      }
    });

    const tSub = playerB.addListener('timeUpdate', (ev) => {
      if (playerB.duration > 0 && activeLayerRef.current === 'B') {
        setDuration(playerB.duration);
      }
      handleLayerTimeUpdate('B', ev.currentTime, Math.max(0, ev.bufferedPosition || 0));
    });

    const eSub = playerB.addListener('playToEnd', () => {
      if (activeLayerRef.current !== 'B') return;
      if (sleepTimerValue === 'end_of_episode') {
        userExplicitlyPausedRef.current = true;
        void clearActivePlaybackSession();
        setSleepTimerValue(null);
        setSleepSecondsLeft(null);
        showAppAlert('Hẹn giờ ngủ', 'Đã phát hết tập phim và tự động dừng.');
        return;
      }
      if (settingsRef.current.autoPlayNext && currentNextEpisode) {
        triggerSwitchToNextEpisode();
      } else {
        userExplicitlyPausedRef.current = true;
        void clearActivePlaybackSession();
      }
    });

    return () => {
      sSub.remove();
      pSub.remove();
      tSub.remove();
      eSub.remove();
    };
  }, [
    playerB,
    sleepTimerValue,
    currentNextEpisode,
    handleActivePlayerError,
    handleLayerTimeUpdate,
    flushActivePlaybackSessionNow,
    scheduleHudAutoHide,
    showToast,
    triggerSwitchToNextEpisode,
  ]);

  // Countdown tick for Next Episode Delay > 0s
  useEffect(() => {
    if (nextCountdownSec === null) return;
    if (nextCountdownSec <= 0) {
      triggerSwitchToNextEpisode();
      return;
    }
    const t = setTimeout(() => {
      setNextCountdownSec((c) => (c !== null ? Math.max(0, c - 1) : null));
    }, 1000);
    return () => clearTimeout(t);
  }, [nextCountdownSec, triggerSwitchToNextEpisode]);

  // Sleep timer countdown (numeric minutes)
  useEffect(() => {
    if (typeof sleepTimerValue !== 'number') {
      setSleepSecondsLeft(null);
      return;
    }
    if (sleepSecondsLeft === null) {
      setSleepSecondsLeft(sleepTimerValue * 60);
      return;
    }
    if (sleepSecondsLeft <= 0) {
      userExplicitlyPausedRef.current = true;
      void clearActivePlaybackSession();
      try {
        getActivePlayer().pause();
      } catch {}
      setSleepTimerValue(null);
      setSleepSecondsLeft(null);
      showAppAlert('Hẹn giờ ngủ', 'Đã hết thời gian hẹn giờ, phim đã được tạm dừng.');
      return;
    }
    const iv = setInterval(() => {
      setSleepSecondsLeft((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
    }, 1000);
    return () => clearInterval(iv);
  }, [sleepTimerValue, sleepSecondsLeft, getActivePlayer]);

  // Pause & resume cleanly across Face ID lock and App backgrounding (keeping PiP alive)
  useEffect(() => {
    const wasLocked = prevLockedRef.current;
    prevLockedRef.current = isLocked;
    if (!visible) return;
    const p = getActivePlayer();

    if (isLocked) {
      if (!wasLocked) {
        wasPlayingBeforeLockRef.current = Boolean(p.playing);
      }
      if (!isInPipRef.current) {
        try {
          p.pause();
        } catch {}
      }
    } else if (wasLocked && wasPlayingBeforeLockRef.current) {
      wasPlayingBeforeLockRef.current = false;
      try {
        p.play();
      } catch {}
    }
  }, [visible, isLocked, getActivePlayer]);

  // Background -> Foreground loopback socket health check & stall recovery watchdog
  const recoverForegroundPlaybackIfNeeded = useCallback(
    async (forceReload = false) => {
      if (!visible || isLockedRef.current || isInPipRef.current) return;
      const p = getActivePlayer();
      const curId = activeServerIdRef.current;
      const curUrl = activeMediaUrlRef.current;
      const usesLoopback =
        curId === '99' || /^https?:\/\/127\.0\.0\.1:\d+/i.test(curUrl);

      if (usesLoopback) {
        let portOk = !forceReload;
        const oldPortMatch = curUrl.match(/^https?:\/\/127\.0\.0\.1:(\d+)/i);
        const oldPort = oldPortMatch ? parseInt(oldPortMatch[1], 10) : 0;
        let freshPort = await ensureLiveLocalPort(forceReload);
        if (portOk && oldPort > 0 && freshPort !== oldPort) {
          portOk = false;
        }
        if (portOk && freshPort > 0) {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 900);
            const pingRes = await fetch(`http://127.0.0.1:${freshPort}/hls-pip/ping`, {
              signal: ctrl.signal,
            });
            clearTimeout(t);
            if (!pingRes.ok) portOk = false;
          } catch {
            portOk = false;
          }
        }
        if (!portOk || forceReload) {
          if (portOk === false && !forceReload) {
            freshPort = await ensureLiveLocalPort(true);
          }
          const curSrv = serversRef.current.find((s) => s.id === curId);
          if (curSrv) {
            const offlineTarget =
              curId === '99'
                ? matchedOfflineItem ||
                  findCompletedOfflineItem({
                    streamCode: activeStreamCodeRef.current,
                    videosId: params?.videosId,
                    episodeId: params?.episodeId,
                  })
                : null;
            const rebuilt =
              curId === '99' && offlineTarget && freshPort > 0
                ? buildOfflineServerUrl(offlineTarget, freshPort)
                : {
                    url: curSrv.streamUrl.replace(
                      /^https?:\/\/127\.0\.0\.1:\d+/i,
                      `http://127.0.0.1:${freshPort}`
                    ),
                    format: curSrv.format,
                  };
            const healedSrv: ServerRuntimeState = {
              ...curSrv,
              streamUrl: rebuilt.url,
              format: rebuilt.format,
              status: 'ready',
              errored: false,
            };
            setServers((prev) => prev.map((s) => (s.id === healedSrv.id ? healedSrv : s)));
            await playServerOnActiveLayer(healedSrv, {
              seekToSec: currentTimeRef.current,
              serverFileKey: resolvedRef.current?.server_file_key || '',
              vnUrl: vnSubUrlRef.current,
              enUrl: enSubUrlRef.current,
              title: resolvedRef.current?.title || params?.title || '',
            });
            return;
          }
        }
      } else if (forceReload && curId) {
        const curSrv = serversRef.current.find((s) => s.id === curId);
        if (curSrv) {
          await playServerOnActiveLayer(curSrv, {
            seekToSec: currentTimeRef.current,
            serverFileKey: resolvedRef.current?.server_file_key || '',
            vnUrl: vnSubUrlRef.current,
            enUrl: enSubUrlRef.current,
            title: resolvedRef.current?.title || params?.title || '',
          });
          return;
        }
      }

      if (!p.playing && !userExplicitlyPausedRef.current) {
        try {
          p.play();
        } catch {}
      }
    },
    [
      visible,
      getActivePlayer,
      ensureLiveLocalPort,
      matchedOfflineItem,
      params?.videosId,
      params?.episodeId,
      params?.title,
      playServerOnActiveLayer,
    ]
  );

  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      const p = getActivePlayer();
      if (nextState === 'background' || nextState === 'inactive') {
        if (fgStallTimerRef.current) {
          clearTimeout(fgStallTimerRef.current);
          fgStallTimerRef.current = null;
        }
        if (preBackgroundPlayingRef.current === null) {
          preBackgroundPlayingRef.current = Boolean(p.playing) && !userExplicitlyPausedRef.current;
        }
        if (!userExplicitlyPausedRef.current) {
          flushActivePlaybackSessionNow(true);
        }
        void persistCurrentProgress(true);
      } else if (nextState === 'active') {
        const prevPlay = preBackgroundPlayingRef.current;
        preBackgroundPlayingRef.current = null;
        if (isLockedRef.current || isInPipRef.current) return;

        void recoverForegroundPlaybackIfNeeded(false);
        if (prevPlay || !userExplicitlyPausedRef.current) {
          const snapshotPos = currentTimeRef.current;
          if (fgStallTimerRef.current) clearTimeout(fgStallTimerRef.current);
          fgStallTimerRef.current = setTimeout(() => {
            fgStallTimerRef.current = null;
            if (
              !visible ||
              isLockedRef.current ||
              userExplicitlyPausedRef.current ||
              isInPipRef.current
            ) {
              return;
            }
            const advanced = Math.abs(currentTimeRef.current - snapshotPos);
            if (advanced < 0.35 && (!p.playing || p.status === 'loading')) {
              void recoverForegroundPlaybackIfNeeded(true);
            }
          }, 3600);
        }
      }
    });
    return () => {
      sub.remove();
      if (fgStallTimerRef.current) {
        clearTimeout(fgStallTimerRef.current);
        fgStallTimerRef.current = null;
      }
    };
  }, [
    visible,
    getActivePlayer,
    flushActivePlaybackSessionNow,
    persistCurrentProgress,
    recoverForegroundPlaybackIfNeeded,
  ]);

  // Network loss inside Player (Item 3):
  // - If active server is '99' (offline file): show toast "Mất kết nối" for 3s and keep playing!
  // - If active server is online (!= '99'): exit player cleanly & switch to Kho Phim Ngoại Tuyến.
  useEffect(() => {
    if (!visible) return;
    const stopMon = startNetworkMonitor(5000);
    const unsub = subscribeNetworkStatus((online) => {
      if (online) return;
      setServers((prev) =>
        prev.map((s) =>
          s.id === '99'
            ? s
            : {
                ...s,
                status: 'error',
                pingMs: null,
                pingFailed: true,
                progressLabel: 'Mất kết nối',
              }
        )
      );
      if (activeServerIdRef.current === '99') {
        showToast('Mất kết nối', 'Đang tiếp tục phát từ bộ nhớ máy', 'warning', {
          family: 'ionicons',
          name: 'cloud-offline-outline',
          color: '#FBBF24',
        });
      } else if (onEnterOfflineMode) {
        userExplicitlyPausedRef.current = true;
        void persistCurrentProgress(false);
        void clearActivePlaybackSession();
        try {
          playerA.pause();
          playerB.pause();
        } catch {}
        onEnterOfflineMode();
      }
    });
    return () => {
      stopMon();
      unsub();
    };
  }, [visible, onEnterOfflineMode, persistCurrentProgress, playerA, playerB, showToast]);

  // Launch / episode-change effect with full teardown on close or movie switch
  const resetPlayerStateCleanly = useCallback(
    (preservePosterForParams?: PlayerLaunchParams | null) => {
      loadSeqRef.current += 1;
      if (checkFilePollRef.current) {
        clearInterval(checkFilePollRef.current);
        checkFilePollRef.current = null;
      }
      if (fgStallTimerRef.current) {
        clearTimeout(fgStallTimerRef.current);
        fgStallTimerRef.current = null;
      }
      try {
        playerA.pause();
        playerB.pause();
      } catch {}
      playerA.replaceAsync(null).catch(() => {});
      playerB.replaceAsync(null).catch(() => {});

      manualLockedServerRef.current = null;
      erroredServersRef.current = new Set();
      pipProxyBrokenRef.current = false;
      activeMediaUrlRef.current = '';
      preloadedNextRef.current = null;
      skipNextReloadCodeRef.current = null;
      lastAutoQueuedSigRef.current = '';
      detailEpisodesVideosIdRef.current = 0;
      userExplicitlyPausedRef.current = false;

      activeLayerRef.current = 'A';
      setActiveLayer('A');
      layerAOpacity.setValue(1);
      layerBOpacity.setValue(0);

      setResolved(null);
      setDetailEpisodes([]);
      setServers([]);
      setActiveServerId(null);
      activeServerIdRef.current = null;
      setActiveStreamCode('');
      setActiveEpTitle('');
      setVnCues([]);
      setEnCues([]);
      setVnSubUrl('');
      setEnSubUrl('');
      setMoviePosterMeta({
        poster: preservePosterForParams?.posterUrl || '',
        thumb: preservePosterForParams?.thumbnailUrl || '',
      });
      setFirstFrameReady(false);
      setIsBuffering(true);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      setDuration(0);
      durationRef.current = 0;
      setBufferedPos(0);
    },
    [playerA, playerB, layerAOpacity, layerBOpacity]
  );

  useEffect(() => {
    if (!visible || !params) {
      lastLoadedVideosIdRef.current = 0;
      resetPlayerStateCleanly(null);
      setServerModalOpen(false);
      setEpisodeModalOpen(false);
      setSubSettingsOpen(false);
      setGeneralSettingsOpen(false);
      setOfflineSheetOpen(false);
      setCastPopupOpen(false);
      setInfoPanel(null);
      setSpeedMenuOpen(false);
      setMoreMenuOpen(false);
      isInPipRef.current = false;
      clearPipRestoreTimer();
      return;
    }

    if (skipNextReloadCodeRef.current === params.streamCode) {
      skipNextReloadCodeRef.current = null;
      return;
    }

    const switchingDifferentMovie =
      lastLoadedVideosIdRef.current !== 0 && lastLoadedVideosIdRef.current !== params.videosId;
    if (switchingDifferentMovie) {
      resetPlayerStateCleanly(params);
    }
    lastLoadedVideosIdRef.current = params.videosId;

    if (!isOfflineOnlyMode) {
      void flushPendingOfflineProgressToServer();
    }

    setMoviePosterMeta({
      poster: params.posterUrl || '',
      thumb: params.thumbnailUrl || '',
    });
    const targetVideosId = params.videosId;
    if (params.episodes && params.episodes.length > 0) {
      detailEpisodesVideosIdRef.current = targetVideosId;
      setDetailEpisodes(params.episodes);
    } else if (!isOfflineOnlyMode && targetVideosId > 0) {
      fetchMovieDetailsApi(targetVideosId)
        .then((res) => {
          if (!res?.movie || res.movie.videos_id !== targetVideosId || lastLoadedVideosIdRef.current !== targetVideosId) {
            return;
          }
          const allEps =
            res.movie.episodes && res.movie.episodes.length > 0
              ? res.movie.episodes
              : res.movie.seasons?.[0]?.episodes || [];
          detailEpisodesVideosIdRef.current = res.movie.videos_id;
          setDetailEpisodes(allEps);
          setMoviePosterMeta({
            poster: res.movie.poster_url || params.posterUrl || '',
            thumb: res.movie.thumbnail_url || params.thumbnailUrl || '',
          });
          setInWishlist(Boolean(res.movie.in_wishlist));
        })
        .catch(() => {});
    }

    void loadEpisodeByCode(params.streamCode, {
      episodeTitleHint: params.episodeTitle,
      offlineOverride: params.offlineItem || null,
    });
  }, [
    visible,
    params?.streamCode,
    params?.videosId,
    isOfflineOnlyMode,
    clearPipRestoreTimer,
    loadEpisodeByCode,
    resetPlayerStateCleanly,
  ]);

  // Auto-download current / next episodes when enabled in settings
  // Strictly guarded against stale resolved/detailEpisodes from previous movies (Item 6)
  useEffect(() => {
    if (!visible || isOfflineOnlyMode || !params?.videosId || !activeStreamCode) return;
    if (!resolved || resolved.stream_code !== activeStreamCode || activeStreamCode !== params.streamCode) {
      return;
    }
    if (resolved.movie?.videos_id && resolved.movie.videos_id !== params.videosId) {
      return;
    }
    const wantCurrent = settings.autoDownloadCurrentOnWatch;
    const rawNextCount = Math.max(0, settings.autoDownloadNextCount || 0);
    if (!wantCurrent && rawNextCount === 0) return;

    const trustedEpisodes =
      resolved.episodes && resolved.episodes.length > 0
        ? resolved.episodes
        : detailEpisodesVideosIdRef.current === params.videosId
          ? detailEpisodes
          : params.episodes || [];

    const isSeriesMovie =
      resolved.movie?.is_tvseries === 1 || trustedEpisodes.length > 1;
    const nextCount = isSeriesMovie ? rawNextCount : 0;

    const sig = `${params.videosId}|${activeStreamCode}|${wantCurrent ? 1 : 0}|${nextCount}|${trustedEpisodes.length}`;
    if (lastAutoQueuedSigRef.current === sig) return;
    lastAutoQueuedSigRef.current = sig;

    const targets =
      trustedEpisodes.length > 0 && isSeriesMovie
        ? getCurrentAndNextEpisodes(trustedEpisodes, activeStreamCode, nextCount)
        : [
            {
              episodes_id: params.episodeId || 0,
              seasons_id: Number(params.seasonId || 0) || 0,
              episodes_name: activeEpTitle || params.episodeTitle || '',
              stream_code: activeStreamCode,
              player_url: '',
              full_url: '',
              order: 1,
            },
          ];

    const filtered = wantCurrent ? targets : targets.filter((t) => t.stream_code !== activeStreamCode);
    if (filtered.length === 0) return;

    const bestPoster =
      moviePosterMeta.poster || resolved.movie?.poster_url || params.posterUrl || moviePosterMeta.thumb || '';
    const bestThumb =
      moviePosterMeta.thumb || resolved.movie?.thumbnail_url || params.thumbnailUrl || bestPoster;

    const requests: OfflineEnqueueParams[] = filtered.map((ep) => {
      const isCur = ep.stream_code === activeStreamCode;
      return {
        videos_id: params.videosId,
        episode_id: ep.episodes_id || 0,
        stream_code: ep.stream_code,
        title: resolved.title || params.title,
        episode_title: isSeriesMovie
          ? ep.episodes_name || (isCur ? activeEpTitle : undefined)
          : undefined,
        server_movie_title: resolved.server_movie_title || undefined,
        server_file_key: isCur ? resolved.server_file_key || undefined : undefined,
        poster_url: bestPoster,
        thumbnail_url: bestThumb,
        preferred_format: settings.offlineDownloadFormat,
        concurrency: settings.offlineDownloadConcurrency,
      };
    });
    void enqueueEpisodeBatch(requests);
  }, [
    visible,
    isOfflineOnlyMode,
    params,
    activeStreamCode,
    activeEpTitle,
    resolved,
    detailEpisodes,
    moviePosterMeta,
    settings.autoDownloadCurrentOnWatch,
    settings.autoDownloadNextCount,
    settings.offlineDownloadFormat,
    settings.offlineDownloadConcurrency,
  ]);

  // Skeleton fade animation (minimum 260ms smooth reveal, max 5s fallback)
  const showPlayerSkeleton = visible && !firstFrameReady;
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
      }
      setRenderSkeleton(true);
      Animated.timing(skeletonOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      const safetyTimer = setTimeout(() => setFirstFrameReady(true), 5200);
      return () => clearTimeout(safetyTimer);
    }

    let cancelled = false;
    const elapsed = skeletonShownAtRef.current > 0 ? Date.now() - skeletonShownAtRef.current : 260;
    const timer = setTimeout(() => {
      if (cancelled) return;
      Animated.timing(skeletonOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) setRenderSkeleton(false);
      });
    }, Math.max(0, 260 - elapsed));

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, showPlayerSkeleton, skeletonOpacity]);

  // Close cleanup
  const handleClose = useCallback(() => {
    void (async () => {
      userExplicitlyPausedRef.current = true;
      void clearActivePlaybackSession();
      clearHudTimer();
      if (checkFilePollRef.current) {
        clearInterval(checkFilePollRef.current);
        checkFilePollRef.current = null;
      }
      if (seekReturnTimerRef.current) clearTimeout(seekReturnTimerRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      try {
        playerA.pause();
        playerB.pause();
      } catch {}
      setServerModalOpen(false);
      setEpisodeModalOpen(false);
      setSubSettingsOpen(false);
      setGeneralSettingsOpen(false);
      setOfflineSheetOpen(false);
      setCastPopupOpen(false);
      setInfoPanel(null);
      try {
        await Promise.race([
          persistCurrentProgress(true),
          new Promise<void>((r) => setTimeout(r, 900)),
        ]);
      } catch {}
      onWatchProgressSaved?.();
      onClose();
    })();
  }, [persistCurrentProgress, clearHudTimer, playerA, playerB, onWatchProgressSaved, onClose]);

  const seekToWithWarning = useCallback(
    (targetSec: number) => {
      const dur = durationRef.current;
      const clamped = dur > 0 ? Math.max(0, Math.min(dur, targetSec)) : Math.max(0, targetSec);
      const prevSec = currentTimeRef.current;
      if (
        settingsRef.current.seekWarningEnabled &&
        Math.abs(clamped - prevSec) > 60
      ) {
        setSeekReturnSec(prevSec);
        if (seekReturnTimerRef.current) clearTimeout(seekReturnTimerRef.current);
        seekReturnTimerRef.current = setTimeout(() => setSeekReturnSec(null), 9000);
      }
      try {
        getActivePlayer().currentTime = clamped;
      } catch {}
    },
    [getActivePlayer]
  );

  // Progress bar PanResponder
  const scrubberPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          userInteractedHudRef.current = true;
          clearHudTimer();
          const bw = barWidthRef.current;
          if (bw <= 0 || durationRef.current <= 0) return;
          setDragRatio(Math.max(0, Math.min(1, e.nativeEvent.locationX / bw)));
        },
        onPanResponderMove: (e) => {
          const bw = barWidthRef.current;
          if (bw <= 0 || durationRef.current <= 0) return;
          setDragRatio(Math.max(0, Math.min(1, e.nativeEvent.locationX / bw)));
        },
        onPanResponderRelease: (e) => {
          const bw = barWidthRef.current;
          const dur = durationRef.current;
          if (bw > 0 && dur > 0) {
            const r = Math.max(0, Math.min(1, e.nativeEvent.locationX / bw));
            seekToWithWarning(r * dur);
          }
          setDragRatio(null);
          showHudWithTimer(3600);
        },
        onPanResponderTerminate: () => {
          setDragRatio(null);
          showHudWithTimer(3600);
        },
      }),
    [clearHudTimer, seekToWithWarning, showHudWithTimer]
  );

  if (!visible || !params) {
    return null;
  }

  const skipIntroSec = resolved?.skip_intro_sec || 0;
  const endCreditsSec = resolved?.end_credits_sec || 0;
  const effectiveRatio =
    dragRatio !== null
      ? dragRatio
      : duration > 0
        ? Math.min(1, Math.max(0, currentTime / duration))
        : 0;
  const progressPct = effectiveRatio * 100;
  const bufferPct = duration > 0 ? Math.min(100, Math.max(0, (bufferedPos / duration) * 100)) : 0;
  const shownClockSec = dragRatio !== null ? dragRatio * duration : currentTime;

  const activeSrvObj = servers.find((s) => s.id === activeServerId);
  const serverBadgeLabel = activeSrvObj?.label || (isOfflineOnlyMode ? 'Phát từ máy' : 'Đang kết nối');
  const durationBadge = duration > 0 ? formatDurationShort(duration) : '';
  const topMetaLine = [durationBadge, qualityBadge, serverBadgeLabel].filter(Boolean).join(' · ');

  const displayTitle =
    resolved?.title || params.title || 'Đang phát phim';
  const epDisplay = activeEpTitle || resolved?.episode_title || params.episodeTitle || '';
  const fullHeaderTitle = epDisplay ? `${displayTitle} · ${epDisplay}` : displayTitle;

  const isContrastActive =
    settings.contrastLevel === 'Cao' || settings.contrastLevel === 'Rất cao';

  const isDownloadedNow = Boolean(
    matchedOfflineItem?.status === 'completed' || downloadingOfflineItem?.status === 'completed'
  );
  const isDownloadingNow = Boolean(
    downloadingOfflineItem &&
      (downloadingOfflineItem.status === 'downloading' ||
        downloadingOfflineItem.status === 'preparing' ||
        downloadingOfflineItem.status === 'queued')
  );
  const serverPreparing = servers.some(
    (s) => (s.id === '11' || s.id === '36') && s.status === 'downloading'
  );

  const showSkipIntroButton =
    skipIntroSec > 5 && currentTime >= 1 && currentTime < skipIntroSec - 2;

  const introPct =
    duration > 0 && skipIntroSec > 0 ? Math.min(98, (skipIntroSec / duration) * 100) : null;
  const outroPct =
    duration > 0 && endCreditsSec > 0 && duration > endCreditsSec
      ? Math.max(2, ((duration - endCreditsSec) / duration) * 100)
      : null;
  const seamlessTriggerSec =
    duration > 0 && settings.seamlessPreloadEnabled && currentNextEpisode
      ? Math.max(5, duration - endCreditsSec - 120)
      : null;
  const seamlessPct =
    seamlessTriggerSec !== null && duration > 0
      ? Math.min(98, Math.max(2, (seamlessTriggerSec / duration) * 100))
      : null;
  const seamlessDotColor =
    preloadState === 'ready'
      ? '#30D158'
      : preloadState === 'failed'
        ? '#FF453A'
        : '#FFD60A';

  const prevPosPct =
    seekReturnSec !== null && duration > 0
      ? Math.min(98, Math.max(2, (seekReturnSec / duration) * 100))
      : null;

  const castPayload: CastMoviePayload = {
    videosId: params.videosId,
    streamCode: activeStreamCode,
    title: displayTitle,
    episode: epDisplay,
    poster: moviePosterMeta.poster || params.posterUrl || '',
    streamUrl: activeSrvObj?.streamUrl || '',
    position: Math.floor(currentTime),
    paused: !isPlaying,
    subHigh: resolved?.sub_high || '',
    subVn: vnSubUrl,
    subEn: enSubUrl,
  };

  const pipSubLangProp =
    !settings.subShowVi && !settings.subShowEn
      ? 'off'
      : !settings.subShowVi && settings.subShowEn
        ? 'en'
        : 'vi';

  const pipSubCuesJson = useMemo(() => {
    if (!settings.subShowVi && !settings.subShowEn) return '';
    const delay = settings.subDelaySec || 0;
    const extend = settings.subExtendSec || 0;
    const vi = settings.subShowVi ? vnCues : [];
    const en = settings.subShowEn ? enCues : [];
    if (vi.length === 0 && en.length === 0) return '';
    const primary = settings.subReverse && en.length > 0 ? en : vi.length > 0 ? vi : en;
    const secondary = primary === vi ? en : vi;
    const rows: { s: number; e: number; t: string }[] = [];
    let secIdx = 0;
    for (let i = 0; i < primary.length; i++) {
      const c = primary[i];
      const s = Math.max(0, Number((c.start + delay).toFixed(2)));
      const e = Math.max(s + 0.25, Number((c.end + delay + extend).toFixed(2)));
      let text = c.text.trim();
      if (secondary.length > 0) {
        while (secIdx < secondary.length && secondary[secIdx].end < c.start - 0.6) {
          secIdx++;
        }
        if (secIdx < secondary.length) {
          const m = secondary[secIdx];
          if (m.start <= c.end + 0.6 && m.end >= c.start - 0.6) {
            const secTxt = m.text.trim();
            if (secTxt && secTxt !== text) {
              text = `${text}\n${secTxt}`;
            }
          }
        }
      }
      if (text) rows.push({ s, e, t: text });
    }
    if (rows.length === 0) return '';
    rows.sort((a, b) => a.s - b.s);
    try {
      return JSON.stringify(rows);
    } catch {
      return '';
    }
  }, [
    settings.subShowVi,
    settings.subShowEn,
    settings.subReverse,
    settings.subDelaySec,
    settings.subExtendSec,
    vnCues,
    enCues,
  ]);

  const holdToastPayload: WaterDropToastPayload | null = holdBoostActive
    ? {
        id: -1,
        title: `Đang tua nhanh ${settings.holdSeekSpeed}x`,
        subtitle: 'Thả tay để trở lại tốc độ phát bình thường',
        tone: 'info',
        durationSec: 0,
        icon: { family: 'ionicons', name: 'flash', color: '#FBBF24' },
      }
    : toastPayload;

  return (
    <View style={styles.playerRoot}>
      <View style={styles.stage}>
        {/* Layer A */}
        <Animated.View
          pointerEvents={activeLayer === 'A' ? 'auto' : 'none'}
          style={[
            styles.layerFill,
            {
              zIndex: activeLayer === 'A' ? 2 : 1,
              opacity: layerAOpacity,
            },
          ]}
        >
          <VideoView
            ref={viewARef}
            player={playerA}
            style={StyleSheet.absoluteFill}
            contentFit={settings.videoFillMode || 'contain'}
            nativeControls={false}
            allowsPictureInPicture={activeLayer === 'A' && settings.pipEnabled}
            startsPictureInPictureAutomatically={activeLayer === 'A' && settings.pipEnabled}
            {...({
              contrastEnhance: isContrastActive,
              pipSubLang: pipSubLangProp,
              pipSubCuesJson,
            } as any)}
            onPictureInPictureStart={() => {
              if (activeLayerRef.current !== 'A') return;
              setIsInPip(true);
              clearPipRestoreTimer();
            }}
            onPictureInPictureStop={() => {
              if (activeLayerRef.current !== 'A') return;
              setIsInPip(false);
              syncNativePipSubtitleTrack(playerA, false);
              scheduleLandscapeRestoreAfterPip();
            }}
          />
        </Animated.View>

        {/* Layer B */}
        <Animated.View
          pointerEvents={activeLayer === 'B' ? 'auto' : 'none'}
          style={[
            styles.layerFill,
            {
              zIndex: activeLayer === 'B' ? 2 : 1,
              opacity: layerBOpacity,
            },
          ]}
        >
          <VideoView
            ref={viewBRef}
            player={playerB}
            style={StyleSheet.absoluteFill}
            contentFit={settings.videoFillMode || 'contain'}
            nativeControls={false}
            allowsPictureInPicture={activeLayer === 'B' && settings.pipEnabled}
            startsPictureInPictureAutomatically={activeLayer === 'B' && settings.pipEnabled}
            {...({
              contrastEnhance: isContrastActive,
              pipSubLang: pipSubLangProp,
              pipSubCuesJson,
            } as any)}
            onPictureInPictureStart={() => {
              if (activeLayerRef.current !== 'B') return;
              setIsInPip(true);
              clearPipRestoreTimer();
            }}
            onPictureInPictureStop={() => {
              if (activeLayerRef.current !== 'B') return;
              setIsInPip(false);
              syncNativePipSubtitleTrack(playerB, false);
              scheduleLandscapeRestoreAfterPip();
            }}
          />
        </Animated.View>

        {/* Low contrast softening scrim when contrastLevel === 'Thấp' */}
        {settings.contrastLevel === 'Thấp' ? (
          <View pointerEvents="none" style={styles.lowContrastScrim} />
        ) : null}

        {/* Interactive video touch surface (tap toggle HUD, double-tap seek, press & hold fast forward) */}
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
          onPressIn={() => {
            holdActivatedRef.current = false;
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            holdTimerRef.current = setTimeout(() => {
              holdActivatedRef.current = true;
              const p = getActivePlayer();
              savedRateBeforeHoldRef.current = p.playbackRate || playbackRate;
              const boostSpeed = settingsRef.current.holdSeekSpeed || 2;
              p.playbackRate = boostSpeed;
              setHoldBoostActive(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }, 380);
          }}
          onPressOut={() => {
            if (holdTimerRef.current) {
              clearTimeout(holdTimerRef.current);
              holdTimerRef.current = null;
            }
            if (holdActivatedRef.current) {
              holdActivatedRef.current = false;
              setHoldBoostActive(false);
              try {
                getActivePlayer().playbackRate = savedRateBeforeHoldRef.current || playbackRate;
              } catch {}
            }
          }}
          onPress={(e) => {
            if (holdActivatedRef.current) return;
            userInteractedHudRef.current = true;
            if (speedMenuOpen || moreMenuOpen) {
              setSpeedMenuOpen(false);
              setMoreMenuOpen(false);
              return;
            }
            const x = e.nativeEvent.locationX;
            const side: 'left' | 'right' | 'center' =
              x < winWidth * 0.28 ? 'left' : x > winWidth * 0.72 ? 'right' : 'center';
            const now = Date.now();
            if (
              side !== 'center' &&
              lastTapStageRef.current.side === side &&
              now - lastTapStageRef.current.time < 280
            ) {
              lastTapStageRef.current = { time: 0, side: 'center' };
              const delta = side === 'left' ? -10 : 10;
              seekToWithWarning(currentTimeRef.current + delta);
              Haptics.selectionAsync();
              showToast(
                delta < 0 ? 'Tua lùi 10 giây' : 'Tua tới 10 giây',
                undefined,
                'info',
                {
                  family: 'ionicons',
                  name: delta < 0 ? 'play-back' : 'play-forward',
                  color: '#FFFFFF',
                }
              );
              return;
            }
            lastTapStageRef.current = { time: now, side };

            if (hudVisibleRef.current) {
              clearHudTimer();
              setHudVisible(false);
            } else {
              showHudWithTimer(3600);
            }
          }}
        />

        {/* Native Dual Subtitle & AI Voice Engine matching subtitleUI.php */}
        <NativeSubtitleOverlay
          vnCues={vnCues}
          enCues={enCues}
          currentTime={currentTime}
          isPlaying={isPlaying}
          isInPip={isInPip}
          subHighRaw={resolved?.sub_high}
          settings={settings}
          episodeSignature={`${params.videosId}|${activeStreamCode}`}
          reloadNonce={subReloadNonce}
        />

        {/* Water-drop dynamic notification banner */}
        <WaterDropToastBanner
          toast={holdToastPayload}
          topOffset={Math.max(insets.top, 8) + 8}
          maxWidth={Math.min(winWidth - 40, 480)}
        />

        {/* Floating Next-Episode Countdown Pill */}
        {nextCountdownSec !== null && currentNextEpisode ? (
          <View style={styles.countdownOverlay}>
            <GlassSurface variant="liquid" radius={40} intensity={34} style={styles.countdownCard}>
              <Text style={styles.countdownTitle}>
                Chuyển sang {currentNextEpisode.ep.episodes_name} sau {nextCountdownSec}s
              </Text>
              <View style={styles.countdownBtns}>
                <BouncyButton
                  style={styles.countdownCancelBtn}
                  onPress={() => setNextCountdownSec(null)}
                >
                  <Text style={styles.countdownBtnTxt}>Hủy</Text>
                </BouncyButton>
                <BouncyButton
                  style={styles.countdownNowBtn}
                  onPress={triggerSwitchToNextEpisode}
                >
                  <Text style={styles.countdownBtnTxt}>Xem ngay</Text>
                </BouncyButton>
              </View>
            </GlassSurface>
          </View>
        ) : null}

        {/* Image 1 Liquid Glass HUD Layer */}
        {hudVisible ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.hudOverlay,
              {
                paddingLeft: 18,
                paddingRight: 18,
                paddingTop: 12,
                paddingBottom: 14,
              },
            ]}
          >
            {/* Top Bar */}
            <View style={styles.topBarRow} pointerEvents="box-none">
              <View style={styles.topLeftGroup}>
                <BouncyButton activeOpacity={0.8} pressScale={0.86} onPress={handleClose}>
                  <GlassSurface variant="liquid" radius={22} intensity={28} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={23} color="#FFF" />
                  </GlassSurface>
                </BouncyButton>
                <View style={styles.titleMetaWrap}>
                  <Text style={styles.hudTitle} numberOfLines={1}>
                    {fullHeaderTitle}
                  </Text>
                  <Text style={styles.hudMeta} numberOfLines={1}>
                    {topMetaLine}
                  </Text>
                </View>
              </View>

              {/* Top-right 6-button Liquid Glass capsule */}
              <GlassSurface variant="liquid" radius={40} intensity={28} style={styles.topRightCapsule}>
                <BouncyButton
                  pressScale={0.86}
                  style={styles.topCapsuleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    clearHudTimer();
                    setServerModalOpen(true);
                  }}
                >
                  <Feather name="server" size={21} color="#FFF" />
                  {serverPreparing ? <View style={styles.prepDot} /> : null}
                </BouncyButton>

                {!isOfflineOnlyMode ? (
                  <BouncyButton
                    pressScale={0.86}
                    style={[
                      styles.topCapsuleBtn,
                      isDownloadedNow && styles.topBtnGreen,
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      clearHudTimer();
                      setOfflineSheetOpen(true);
                    }}
                  >
                    {isDownloadingNow ? (
                      <DownloadingIconAnim />
                    ) : (
                      <Feather
                        name="download"
                        size={21}
                        color={isDownloadedNow ? '#30D158' : '#FFF'}
                      />
                    )}
                  </BouncyButton>
                ) : null}

                <BouncyButton
                  pressScale={0.86}
                  style={styles.topCapsuleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    clearHudTimer();
                    setSubSettingsOpen(true);
                  }}
                >
                  <JwSubtitleIcon size={22} color="#FFF" />
                </BouncyButton>

                {settings.pipEnabled ? (
                  <BouncyButton
                    pressScale={0.86}
                    style={styles.topCapsuleBtn}
                    onPress={async () => {
                      Haptics.selectionAsync();
                      try {
                        if (
                          typeof isPictureInPictureSupported === 'function' &&
                          !isPictureInPictureSupported()
                        ) {
                          showToast('Thiết bị chưa hỗ trợ thu nhỏ khung hình', undefined, 'warning', {
                            family: 'ionicons',
                            name: 'albums-outline',
                            color: '#FBBF24',
                          });
                          return;
                        }
                        const viewRef =
                          activeLayerRef.current === 'A' ? viewARef.current : viewBRef.current;
                        setIsInPip(true);
                        await viewRef?.startPictureInPicture();
                      } catch {
                        setIsInPip(false);
                        syncNativePipSubtitleTrack(getActivePlayer(), false);
                        showToast('Không thể mở thu nhỏ khung hình lúc này', undefined, 'warning', {
                          family: 'ionicons',
                          name: 'albums-outline',
                          color: '#FBBF24',
                        });
                      }
                    }}
                  >
                    <JwPipIcon color="#FFF" />
                  </BouncyButton>
                ) : null}

                <BouncyButton
                  pressScale={0.86}
                  style={styles.topCapsuleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    clearHudTimer();
                    setCastPopupOpen(true);
                  }}
                >
                  <Feather name="cast" size={21} color="#FFF" />
                </BouncyButton>

                <BouncyButton
                  pressScale={0.86}
                  style={styles.topCapsuleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    clearHudTimer();
                    setGeneralSettingsOpen(true);
                  }}
                >
                  <Feather name="settings" size={21} color="#FFF" />
                </BouncyButton>
              </GlassSurface>
            </View>

            {/* Right-Edge Vertical Liquid Glass Capsule */}
            <GlassSurface
              variant="liquid"
              radius={40}
              intensity={28}
              style={[styles.rightSideCapsule, { right: 14 }]}
            >
              <BouncyButton
                pressScale={0.86}
                style={[styles.sideBtn, isContrastActive && styles.sideBtnActiveRed]}
                onPress={() => {
                  Haptics.selectionAsync();
                  const next = isContrastActive ? 'Mặc định' : 'Cao';
                  void updateSetting('contrastLevel', next);
                  showToast(
                    isContrastActive ? 'Tương phản: Mặc định' : 'Đã bật Tăng độ tương phản',
                    undefined,
                    'info',
                    { family: 'ionicons', name: 'contrast', color: '#F472B6' }
                  );
                  showHudWithTimer();
                }}
              >
                <Ionicons name="contrast" size={20} color="#FFF" />
              </BouncyButton>

              <BouncyButton
                pressScale={0.86}
                style={[styles.sideBtn, settings.autoPlayNext && styles.sideBtnActiveRed]}
                onPress={() => {
                  Haptics.selectionAsync();
                  const next = !settings.autoPlayNext;
                  void updateSetting('autoPlayNext', next);
                  showToast(
                    next ? 'Đã bật Tự động chuyển tập' : 'Đã tắt Tự động chuyển tập',
                    undefined,
                    'info',
                    { family: 'ionicons', name: 'play-skip-forward', color: '#34D399' }
                  );
                  showHudWithTimer();
                }}
              >
                <Ionicons name="play-skip-forward" size={19} color="#FFF" />
              </BouncyButton>

              <BouncyButton
                pressScale={0.86}
                style={[
                  styles.sideBtn,
                  settings.videoFillMode === 'cover' && styles.sideBtnActiveRed,
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  const nextMode = settings.videoFillMode === 'cover' ? 'contain' : 'cover';
                  void updateSetting('videoFillMode', nextMode);
                  showToast(
                    nextMode === 'cover' ? 'Tràn viền màn hình' : 'Tỷ lệ màn hình gốc',
                    undefined,
                    'info',
                    {
                      family: 'ionicons',
                      name: nextMode === 'cover' ? 'scan-outline' : 'contract-outline',
                      color: '#60A5FA',
                    }
                  );
                  showHudWithTimer();
                }}
              >
                <Ionicons name="scan-outline" size={19} color="#FFF" />
              </BouncyButton>
            </GlassSurface>

            {/* Center Playback Controls matching Image 1 */}
            <View style={styles.centerControlsRow} pointerEvents="box-none">
              <BouncyButton
                activeOpacity={0.75}
                pressScale={0.84}
                style={styles.centerSeekTouch}
                onPress={() => {
                  userInteractedHudRef.current = true;
                  Haptics.selectionAsync();
                  seekToWithWarning(currentTimeRef.current - 10);
                  showHudWithTimer();
                }}
              >
                <View style={styles.seekRingWrap}>
                  <Ionicons
                    name="refresh-outline"
                    size={42}
                    color="#FFF"
                    style={{ transform: [{ scaleX: -1 }] }}
                  />
                  <Text style={styles.seekRingTxt}>10</Text>
                </View>
              </BouncyButton>

              <BouncyButton
                activeOpacity={0.8}
                pressScale={0.86}
                onPress={() => {
                  userInteractedHudRef.current = true;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const p = getActivePlayer();
                  if (p.playing) {
                    userExplicitlyPausedRef.current = true;
                    void clearActivePlaybackSession();
                    p.pause();
                  } else {
                    userExplicitlyPausedRef.current = false;
                    p.play();
                  }
                  showHudWithTimer();
                }}
              >
                {isBuffering ? (
                  <BufferingSkeletonCenterButton />
                ) : (
                  <GlassSurface
                    variant="liquid"
                    radius={26}
                    intensity={26}
                    style={styles.centerPlayBox}
                  >
                    <Ionicons
                      name={isPlaying ? 'pause' : 'play'}
                      size={40}
                      color="#FFF"
                      style={!isPlaying ? { marginLeft: 3 } : undefined}
                    />
                  </GlassSurface>
                )}
              </BouncyButton>

              <BouncyButton
                activeOpacity={0.75}
                pressScale={0.84}
                style={styles.centerSeekTouch}
                onPress={() => {
                  userInteractedHudRef.current = true;
                  Haptics.selectionAsync();
                  seekToWithWarning(currentTimeRef.current + 10);
                  showHudWithTimer();
                }}
              >
                <View style={styles.seekRingWrap}>
                  <Ionicons name="refresh-outline" size={42} color="#FFF" />
                  <Text style={styles.seekRingTxt}>10</Text>
                </View>
              </BouncyButton>
            </View>

            {/* Bottom Control Section matching Image 1 */}
            <View style={styles.bottomBlock} pointerEvents="box-none">
              {/* Quick Contextual Floating Action Chips above timeline */}
              <View style={styles.floatingChipsRow} pointerEvents="box-none">
                {showSkipIntroButton ? (
                  <BouncyButton
                    activeOpacity={0.85}
                    pressScale={0.88}
                    onPress={() => {
                      Haptics.selectionAsync();
                      seekToWithWarning(skipIntroSec);
                      showToast('Đã bỏ qua giới thiệu', undefined, 'info', {
                        family: 'ionicons',
                        name: 'play-skip-forward-outline',
                        color: '#38BDF8',
                      });
                    }}
                  >
                    <GlassSurface variant="liquid" radius={40} intensity={28} style={styles.quickChip}>
                      <Ionicons name="play-skip-forward" size={14} color="#FFF" />
                      <Text style={styles.quickChipTxt}>Bỏ qua giới thiệu</Text>
                    </GlassSurface>
                  </BouncyButton>
                ) : null}

                {seekReturnSec !== null ? (
                  <BouncyButton
                    activeOpacity={0.85}
                    pressScale={0.88}
                    onPress={() => {
                      const backSec = seekReturnSec;
                      setSeekReturnSec(null);
                      if (backSec !== null) {
                        seekToWithWarning(backSec);
                      }
                    }}
                  >
                    <GlassSurface variant="liquid" radius={40} intensity={28} style={styles.quickChip}>
                      <Ionicons name="return-up-back" size={14} color="#00FFD9" />
                      <Text style={styles.quickChipTxt}>
                        Quay lại vị trí cũ ({formatClock(seekReturnSec)})
                      </Text>
                    </GlassSurface>
                  </BouncyButton>
                ) : null}
              </View>

              {/* Time display row */}
              <View style={styles.timeRow}>
                <Text style={styles.timeReadout}>
                  {formatClock(shownClockSec)} / {formatClock(duration)}
                </Text>
                {sleepTimerValue !== null ? (
                  <Text style={styles.sleepBadge}>
                    Hẹn tắt:{' '}
                    {sleepTimerValue === 'end_of_episode'
                      ? 'Hết tập'
                      : sleepSecondsLeft !== null
                        ? `${Math.ceil(sleepSecondsLeft / 60)}p`
                        : `${sleepTimerValue}p`}
                  </Text>
                ) : null}
              </View>

              {/* Timeline Scrubber with Intro / Seamless / Outro / PrevPos Note Markers */}
              <View
                style={styles.scrubberHit}
                onLayout={(e) => setBarWidth(e.nativeEvent.layout.width || 400)}
                {...scrubberPanResponder.panHandlers}
              >
                {dragRatio !== null ? (() => {
                  const scrubSec = dragRatio * duration;
                  const threshold = Math.max(8, duration * 0.015);
                  let scrubNote = '';
                  if (prevPosPct !== null && seekReturnSec !== null && Math.abs(scrubSec - seekReturnSec) <= threshold) {
                    scrubNote = 'Vị trí đã xem trước đó';
                  } else if (introPct !== null && Math.abs(scrubSec - skipIntroSec) <= threshold) {
                    scrubNote = 'Mở đầu bộ phim';
                  } else if (outroPct !== null && Math.abs(scrubSec - (duration - endCreditsSec)) <= threshold) {
                    scrubNote = 'Kết thúc bộ phim';
                  } else if (seamlessTriggerSec !== null && Math.abs(scrubSec - seamlessTriggerSec) <= threshold) {
                    scrubNote = 'Xem liền mạch';
                  }
                  return (
                    <View
                      pointerEvents="none"
                      style={[styles.scrubTooltipWrap, { left: `${progressPct}%` }]}
                    >
                      <GlassSurface variant="liquid" radius={16} intensity={28} style={styles.scrubTooltip}>
                        <Text style={styles.scrubTooltipTxt}>
                          {scrubNote ? `${formatClock(scrubSec)} · ${scrubNote}` : formatClock(scrubSec)}
                        </Text>
                      </GlassSurface>
                    </View>
                  );
                })() : null}

                <View style={styles.scrubberTrack}>
                  <View style={[styles.scrubberBuffer, { width: `${bufferPct}%` }]} />
                  <View style={[styles.scrubberFill, { width: `${progressPct}%` }]} />
                </View>

                {introPct !== null ? (
                  <View
                    pointerEvents="none"
                    style={[styles.cueMarkerPill, { left: `${introPct}%` }]}
                  />
                ) : null}
                {outroPct !== null ? (
                  <View
                    pointerEvents="none"
                    style={[styles.cueMarkerPill, { left: `${outroPct}%` }]}
                  />
                ) : null}
                {seamlessPct !== null ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.seamlessDotMarker,
                      {
                        left: `${seamlessPct}%`,
                        backgroundColor: seamlessDotColor,
                        shadowColor: seamlessDotColor,
                      },
                    ]}
                  />
                ) : null}
                {prevPosPct !== null ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.cueMarkerPill,
                      { left: `${prevPosPct}%`, backgroundColor: '#00FFD9' },
                    ]}
                  />
                ) : null}

                <View style={[styles.scrubberThumb, { left: `${progressPct}%` }]} />
              </View>

              {/* Bottom Action Pills Row */}
              <View style={styles.bottomActionsRow}>
                <View style={styles.bottomLeftRow}>
                  {currentNextEpisode ? (
                    <BouncyButton
                      activeOpacity={0.82}
                      pressScale={0.86}
                      onPress={() => {
                        userInteractedHudRef.current = true;
                        Haptics.selectionAsync();
                        triggerSwitchToNextEpisode();
                      }}
                    >
                      <GlassSurface variant="liquid" radius={40} intensity={28} style={styles.nextEpPill}>
                        {moviePosterMeta.thumb || moviePosterMeta.poster ? (
                          <Image
                            source={{ uri: moviePosterMeta.thumb || moviePosterMeta.poster }}
                            style={styles.nextEpThumb}
                          />
                        ) : (
                          <View style={[styles.nextEpThumb, { backgroundColor: COLORS.accent }]} />
                        )}
                        <Ionicons name="chevron-forward" size={16} color="#FFF" />
                      </GlassSurface>
                    </BouncyButton>
                  ) : null}

                  <BouncyButton
                    activeOpacity={0.82}
                    pressScale={0.86}
                    onPress={async () => {
                      userInteractedHudRef.current = true;
                      Haptics.selectionAsync();
                      const prev = inWishlist;
                      setInWishlist(!prev);
                      if (params.videosId > 0) {
                        try {
                          const r = await toggleWishlistApi(params.videosId);
                          setInWishlist(Boolean(r.in_wishlist));
                        } catch {}
                      }
                      showToast(
                        !prev ? 'Đã thêm vào danh sách của tôi' : 'Đã xóa khỏi danh sách',
                        undefined,
                        !prev ? 'success' : 'info',
                        {
                          family: 'ionicons',
                          name: !prev ? 'bookmark' : 'bookmark-outline',
                          color: '#F43F5E',
                        }
                      );
                      showHudWithTimer();
                    }}
                  >
                    <GlassSurface variant="liquid" radius={22} intensity={28} style={styles.circleActionBtn}>
                      <Ionicons
                        name={inWishlist ? 'bookmark' : 'bookmark-outline'}
                        size={19}
                        color={inWishlist ? COLORS.accent : '#FFF'}
                      />
                    </GlassSurface>
                  </BouncyButton>

                  {effectiveEpisodes.length > 0 ? (
                    <BouncyButton
                      activeOpacity={0.82}
                      pressScale={0.86}
                      onPress={() => {
                        Haptics.selectionAsync();
                        clearHudTimer();
                        setEpisodeModalOpen(true);
                      }}
                    >
                      <GlassSurface variant="liquid" radius={22} intensity={28} style={styles.circleActionBtn}>
                        <Ionicons name="list" size={20} color="#FFF" />
                      </GlassSurface>
                    </BouncyButton>
                  ) : null}

                  <BouncyButton
                    activeOpacity={0.82}
                    pressScale={0.86}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setReaction((r) => (r === 'like' ? null : 'like'));
                      showHudWithTimer();
                    }}
                  >
                    <GlassSurface variant="liquid" radius={22} intensity={28} style={styles.circleActionBtn}>
                      <Ionicons
                        name={reaction === 'like' ? 'thumbs-up' : 'thumbs-up-outline'}
                        size={19}
                        color={reaction === 'like' ? '#30D158' : '#FFF'}
                      />
                    </GlassSurface>
                  </BouncyButton>

                  <BouncyButton
                    activeOpacity={0.82}
                    pressScale={0.86}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setReaction((r) => (r === 'dislike' ? null : 'dislike'));
                      showHudWithTimer();
                    }}
                  >
                    <GlassSurface variant="liquid" radius={22} intensity={28} style={styles.circleActionBtn}>
                      <Ionicons
                        name={reaction === 'dislike' ? 'thumbs-down' : 'thumbs-down-outline'}
                        size={19}
                        color={reaction === 'dislike' ? '#FF453A' : '#FFF'}
                      />
                    </GlassSurface>
                  </BouncyButton>
                </View>

                <View style={styles.bottomRightCluster}>
                  <BouncyButton
                    activeOpacity={0.82}
                    pressScale={0.86}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setMoreMenuOpen(false);
                      setSpeedMenuOpen((v) => !v);
                      showHudWithTimer(6000);
                    }}
                  >
                    <GlassSurface variant="liquid" radius={40} intensity={28} style={styles.rightPillBtn}>
                      <Ionicons name="play" size={14} color="#FFF" />
                      <Text style={styles.rightPillTxt}>{playbackRate.toFixed(playbackRate % 1 === 0 ? 1 : 2).replace(/\.00$/, '.0')}x</Text>
                    </GlassSurface>
                  </BouncyButton>

                  <BouncyButton
                    activeOpacity={0.82}
                    pressScale={0.86}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSpeedMenuOpen(false);
                      setMoreMenuOpen((v) => !v);
                      showHudWithTimer(6000);
                    }}
                  >
                    <GlassSurface variant="liquid" radius={40} intensity={28} style={styles.rightPillBtn}>
                      <Text style={styles.rightPillTxt}>Tùy chọn khác</Text>
                      <Ionicons name="chevron-down" size={15} color="#FFF" />
                    </GlassSurface>
                  </BouncyButton>
                </View>

                {/* Speed Popover */}
                {speedMenuOpen ? (
                  <GlassSurface variant="liquid" radius={30} intensity={34} style={styles.speedPopover}>
                    {SPEED_OPTIONS.map((rate) => {
                      const active = Math.abs(playbackRate - rate) < 0.01;
                      return (
                        <BouncyButton
                          key={rate}
                          bounciness="gentle"
                          style={[styles.popoverItem, active && styles.popoverItemActive]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setPlaybackRate(rate);
                            try {
                              getActivePlayer().playbackRate = rate;
                            } catch {}
                            setSpeedMenuOpen(false);
                            showHudWithTimer();
                          }}
                        >
                          <Text style={styles.popoverItemTxt}>
                            {rate.toFixed(rate % 1 === 0 ? 1 : 2).replace(/\.00$/, '.0')}x
                          </Text>
                          {active ? <Ionicons name="checkmark" size={16} color="#FFF" /> : null}
                        </BouncyButton>
                      );
                    })}
                  </GlassSurface>
                ) : null}

                {/* More Options Popover — iOS Contextual Glass Sheet matching Image 2 */}
                {moreMenuOpen ? (
                  <View style={styles.morePopover}>
                    <BlurView intensity={34} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
                    <View style={styles.morePopoverFill} />

                    {!isOfflineOnlyMode ? (
                      <BouncyButton
                        bounciness="gentle"
                        activeOpacity={0.75}
                        style={styles.morePopoverRow}
                        onPress={() => {
                          setMoreMenuOpen(false);
                          setOfflineSheetOpen(true);
                        }}
                      >
                        <View style={styles.morePopoverIconBadge}>
                          <Feather name="download" size={18} color="#FFFFFF" />
                        </View>
                        <Text style={styles.morePopoverText}>Tải phim ngoại tuyến</Text>
                      </BouncyButton>
                    ) : null}

                    <BouncyButton
                      bounciness="gentle"
                      activeOpacity={0.75}
                      style={styles.morePopoverRow}
                      onPress={() => {
                        setMoreMenuOpen(false);
                        setInfoPanel('info');
                      }}
                    >
                      <View style={styles.morePopoverIconBadge}>
                        <Feather name="info" size={18} color="#FFFFFF" />
                      </View>
                      <Text style={styles.morePopoverText}>Thông tin phim & Thành viên</Text>
                    </BouncyButton>

                    <BouncyButton
                      bounciness="gentle"
                      activeOpacity={0.75}
                      style={styles.morePopoverRow}
                      onPress={() => {
                        setMoreMenuOpen(false);
                        setCastPopupOpen(true);
                      }}
                    >
                      <View style={styles.morePopoverIconBadge}>
                        <Feather name="tv" size={18} color="#FFFFFF" />
                      </View>
                      <Text style={styles.morePopoverText}>Chiếu lên TV</Text>
                    </BouncyButton>

                    <BouncyButton
                      bounciness="gentle"
                      activeOpacity={0.75}
                      style={styles.morePopoverRow}
                      onPress={() => {
                        setMoreMenuOpen(false);
                        setServerModalOpen(true);
                      }}
                    >
                      <View style={styles.morePopoverIconBadge}>
                        <Feather name="server" size={18} color="#FFFFFF" />
                      </View>
                      <Text style={styles.morePopoverText}>Máy chủ phát phim</Text>
                    </BouncyButton>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        {/* Native iOS Modals (ALL 100% Liquid Glass radius 40, NO border) */}
        <PlayerServerPanelModal
          visible={serverModalOpen}
          onClose={() => {
            setServerModalOpen(false);
            showHudWithTimer();
          }}
          servers={servers}
          activeServerId={activeServerId}
          autoOptimal={settings.autoOptimalServer}
          onToggleAutoOptimal={(next) => {
            void updateSetting('autoOptimalServer', next);
            if (!next && activeServerId) {
              manualLockedServerRef.current = activeServerId;
            } else {
              manualLockedServerRef.current = null;
            }
          }}
          onSelectServer={(id) => {
            void (async () => {
              const target = servers.find((s) => s.id === id);
              if (!target) return;
              manualLockedServerRef.current = id;
              erroredServersRef.current.delete(id);
              const sfk = resolved?.server_file_key || '';

              if (id === '99') {
                offlineRetryAttemptedRef.current = false;
                const freshPort = await ensureLiveLocalPort(true);
                const offlineTarget =
                  matchedOfflineItem ||
                  findCompletedOfflineItem({
                    streamCode: activeStreamCode,
                    videosId: params.videosId,
                    episodeId: params.episodeId,
                  });
                const rebuilt = offlineTarget
                  ? buildOfflineServerUrl(offlineTarget, freshPort)
                  : {
                      url: target.streamUrl.replace(
                        /^https?:\/\/127\.0\.0\.1:\d+/i,
                        `http://127.0.0.1:${freshPort}`
                      ),
                      format: target.format,
                    };
                const refreshedSrv: ServerRuntimeState = {
                  ...target,
                  streamUrl: rebuilt.url,
                  format: rebuilt.format,
                  status: 'ready',
                  errored: false,
                };
                setServers((prev) => prev.map((s) => (s.id === '99' ? refreshedSrv : s)));
                setServerModalOpen(false);
                if (refreshedSrv.streamUrl) {
                  await playServerOnActiveLayer(refreshedSrv, {
                    seekToSec: currentTimeRef.current,
                    serverFileKey: sfk,
                    vnUrl: vnSubUrl,
                    enUrl: enSubUrl,
                    title: displayTitle,
                  });
                  showToast(`Đã chọn ${target.label}`, 'Đang phát từ bộ nhớ thiết bị', 'success', {
                    family: 'ionicons',
                    name: 'phone-portrait-outline',
                    color: '#34D399',
                  });
                }
                return;
              }

              if ((id === '11' || id === '36') && sfk && !target.streamUrl) {
                setServers((prev) =>
                  prev.map((s) =>
                    s.id === id
                      ? {
                          ...s,
                          status: 'downloading',
                          progressLabel: 'Đang chuẩn bị...',
                          errored: false,
                        }
                      : s
                  )
                );
                void triggerServerPrepare(sfk);
                startCheckFilePolling({
                  mySeq: loadSeqRef.current,
                  sfk,
                  targetStartSec: currentTimeRef.current,
                  hasGgdDirect: Boolean(
                    resolvedRef.current?.ggdriver_1 ||
                      resolvedRef.current?.ggdriver_2 ||
                      resolvedRef.current?.ggdriver_3
                  ),
                  vnUrl: vnSubUrl,
                  enUrl: enSubUrl,
                  movieTitle: displayTitle,
                });
                showToast(`Đang chuẩn bị ${target.label}...`, undefined, 'info', {
                  family: 'ionicons',
                  name: 'cloud-download-outline',
                  color: '#38BDF8',
                });
                setServerModalOpen(false);
                return;
              }
              if (target.streamUrl) {
                const clearedSrv: ServerRuntimeState = {
                  ...target,
                  errored: false,
                  status: target.status === 'error' ? 'ready' : target.status,
                };
                setServers((prev) => prev.map((s) => (s.id === id ? clearedSrv : s)));
                setServerModalOpen(false);
                await playServerOnActiveLayer(clearedSrv, {
                  seekToSec: currentTimeRef.current,
                  serverFileKey: sfk,
                  vnUrl: vnSubUrl,
                  enUrl: enSubUrl,
                  title: displayTitle,
                });
                showToast(`Đã chọn ${target.label}`, undefined, 'info', {
                  family: 'ionicons',
                  name: 'server-outline',
                  color: '#60A5FA',
                });
              }
            })();
          }}
          onRefreshPings={async () => {
            setPingRefreshing(true);
            try {
              const sfk = resolvedRef.current?.server_file_key || '';
              const online = await probeConnectivity(2000).catch(() => false);
              const [p, checkRes, ggdRes] = await Promise.all([
                measureAllServerPings(Boolean(matchedOfflineItem)),
                online && sfk ? checkServerFileStatus(sfk) : Promise.resolve(null),
                online && sfk
                  ? checkGgdriverApi(sfk, resolvedRef.current?.server_movie_title)
                  : Promise.resolve(null),
              ]);
              const hasAnyGgd = Boolean(
                ggdRes && (ggdRes.ggdriver_1 || ggdRes.ggdriver_2 || ggdRes.ggdriver_3)
              );
              setServers((prev) => {
                let next = prev.map((s) => {
                  if (s.id === '99') return { ...s, pingMs: p.ping99, pingFailed: false };
                  if (s.id === '11') return { ...s, pingMs: p.ping11, pingFailed: p.ping11 === null };
                  if (s.id === '36') return { ...s, pingMs: p.ping36, pingFailed: p.ping36 === null };
                  if (s.id === '40') {
                    const readyNow = online && (hasAnyGgd || Boolean(s.streamUrl));
                    return {
                      ...s,
                      pingMs: p.ping40,
                      pingFailed: !online,
                      status:
                        !online && s.status === 'checking'
                          ? ('error' as const)
                          : readyNow && s.status === 'checking'
                            ? ('ready' as const)
                            : s.status,
                      progressLabel:
                        !online && s.status === 'checking'
                          ? 'Mất kết nối'
                          : readyNow && s.status === 'checking'
                            ? 'Sẵn sàng'
                            : s.progressLabel,
                    };
                  }
                  if (s.id === '3') {
                    const readyNow = online && Boolean(s.streamUrl);
                    return {
                      ...s,
                      pingMs: p.ping3,
                      pingFailed: !online,
                      status:
                        !online && s.status === 'checking'
                          ? ('error' as const)
                          : readyNow && s.status === 'checking'
                            ? ('ready' as const)
                            : s.status,
                      progressLabel:
                        !online && s.status === 'checking'
                          ? 'Mất kết nối'
                          : readyNow && s.status === 'checking'
                            ? 'Sẵn sàng'
                            : s.progressLabel,
                    };
                  }
                  return s;
                });
                if (checkRes) {
                  next = applyCheckFileToServers(next, sfk, checkRes);
                } else if (!online) {
                  next = next.map((s) =>
                    s.id !== '99' && s.status === 'checking'
                      ? { ...s, status: 'error' as const, progressLabel: 'Mất kết nối' }
                      : s
                  );
                }
                return next;
              });
            } finally {
              setPingRefreshing(false);
            }
          }}
          pingRefreshing={pingRefreshing}
          posterUrl={moviePosterMeta.poster || params.posterUrl}
        />

        <PlayerEpisodeListModal
          visible={episodeModalOpen}
          onClose={() => {
            setEpisodeModalOpen(false);
            showHudWithTimer();
          }}
          userId={user?.user_id || 0}
          movieTitle={displayTitle}
          serverMovieTitle={resolved?.server_movie_title}
          serverTapPhim={resolved?.server_tap_phim}
          currentStreamCode={activeStreamCode}
          posterUrl={moviePosterMeta.poster || params.posterUrl}
          fallbackSeasons={resolved?.seasons}
          fallbackEpisodes={effectiveEpisodes}
          offlineItems={offlineItems}
          onSelectEpisode={(sc, epName, epIndex, seasonId) => {
            persistCurrentProgress(true);
            const matchedEp = effectiveEpisodes.find((e) => e.stream_code === sc) || {
              episodes_id: 0,
              seasons_id: Number(seasonId || 0) || 0,
              episodes_name: epName,
              stream_code: sc,
              player_url: '',
              full_url: '',
              order: epIndex + 1,
            };
            const offMatch = offlineItems.find(
              (o) => o.status === 'completed' && o.stream_code === sc
            );
            if (isOfflineOnlyMode && offMatch && onSwitchOfflineItem) {
              onSwitchOfflineItem(offMatch);
            } else if (onSwitchEpisode) {
              onSwitchEpisode(matchedEp, epIndex);
            } else {
              void loadEpisodeByCode(sc, { episodeTitleHint: epName });
            }
          }}
        />

        <PlayerSubtitleSettingsModal
          visible={subSettingsOpen}
          onClose={() => {
            setSubSettingsOpen(false);
            showHudWithTimer();
          }}
          subHighRaw={resolved?.sub_high}
          onReloadSubtitles={handleReloadSubtitles}
          isReloadingSubtitles={isReloadingSubtitles}
        />

        <PlayerGeneralSettingsModal
          visible={generalSettingsOpen}
          onClose={() => {
            setGeneralSettingsOpen(false);
            showHudWithTimer();
          }}
          preloadState={currentNextEpisode ? preloadState : 'no_data'}
          sleepTimerValue={sleepTimerValue}
          sleepSecondsLeft={sleepSecondsLeft}
          onSelectSleepTimer={(val) => {
            setSleepTimerValue(val);
            const sleepIcon: WaterDropToastIcon = {
              family: 'ionicons',
              name: 'moon-outline',
              color: '#A78BFA',
            };
            if (typeof val === 'number') {
              setSleepSecondsLeft(val * 60);
              showToast(`Hẹn tắt sau ${val} phút`, undefined, 'info', sleepIcon);
            } else if (val === 'end_of_episode') {
              setSleepSecondsLeft(null);
              showToast('Hẹn tắt khi hết tập phim', undefined, 'info', sleepIcon);
            } else {
              setSleepSecondsLeft(null);
              showToast('Đã tắt hẹn giờ ngủ', undefined, 'info', sleepIcon);
            }
          }}
          onReloadPlayer={() => {
            persistCurrentProgress(true);
            void loadEpisodeByCode(activeStreamCode, {
              episodeTitleHint: epDisplay,
              offlineOverride: matchedOfflineItem,
            });
          }}
          onOpenCast={() => setCastPopupOpen(true)}
        />

        <OfflineDownloadSheet
          visible={offlineSheetOpen}
          onClose={() => {
            setOfflineSheetOpen(false);
            showHudWithTimer();
          }}
          videosId={params.videosId}
          title={displayTitle}
          posterUrl={moviePosterMeta.poster || params.posterUrl || ''}
          thumbnailUrl={moviePosterMeta.thumb || params.thumbnailUrl || ''}
          serverMovieTitle={resolved?.server_movie_title}
          currentStreamCode={activeStreamCode}
          currentEpisodeTitle={epDisplay}
          currentEpisodeId={params.episodeId}
          currentServerFileKey={resolved?.server_file_key}
          episodes={effectiveEpisodes}
        />

        <CastModal
          visible={castPopupOpen}
          inlinePopup
          movieToCast={castPayload}
          onCastStarted={() => {
            try {
              getActivePlayer().pause();
            } catch {}
          }}
          onClose={() => {
            setCastPopupOpen(false);
            showHudWithTimer();
          }}
        />

        <PlayerOverlayPanels
          activePanel={infoPanel}
          onClose={() => {
            setInfoPanel(null);
            showHudWithTimer();
          }}
          onSwitchPanel={setInfoPanel}
          title={displayTitle}
          episodeTitle={epDisplay}
          currentStreamCode={activeStreamCode}
          resolved={resolved}
          activeQuality={null}
          onSelectQuality={() => {}}
          onSelectSourceServer={() => {}}
          episodes={effectiveEpisodes}
          seasons={resolved?.seasons || []}
          onSelectEpisode={() => {}}
          activeSubIndex={0}
          onSelectSubtitleIndex={() => {}}
          playbackRate={playbackRate}
          onSelectRate={(rate) => {
            setPlaybackRate(rate);
            try {
              getActivePlayer().playbackRate = rate;
            } catch {}
          }}
          settings={settings}
          onUpdateSetting={(key, val) => updateSetting(key, val)}
          sleepMinutesLeft={
            typeof sleepTimerValue === 'number' ? sleepTimerValue : null
          }
          onSelectSleepTimer={(m) => setSleepTimerValue(m)}
          inWishlist={inWishlist}
          onToggleWishlist={() => {}}
          offlineItem={matchedOfflineItem}
          onDownloadOffline={() => setOfflineSheetOpen(true)}
          onOpenWebPlayer={() => {}}
          onOpenCast={() => setCastPopupOpen(true)}
          user={user}
        />

        {/* Smooth loading skeleton transition */}
        {renderSkeleton || showPlayerSkeleton ? (
          <Animated.View
            pointerEvents={showPlayerSkeleton ? 'auto' : 'none'}
            style={[styles.skeletonOverlay, { opacity: skeletonOpacity }]}
          >
            <PlayerLandscapeSkeleton
              leftInset={18}
              rightInset={18}
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
  playerRoot: {
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
  layerFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#000000',
  },
  lowContrastScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.14)',
    zIndex: 3,
  },
  skeletonOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 60,
    backgroundColor: 'transparent',
  },
  countdownOverlay: {
    position: 'absolute',
    right: 24,
    bottom: 108,
    zIndex: 32,
  },
  countdownCard: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 10,
    maxWidth: 270,
  },
  countdownTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  countdownBtns: {
    flexDirection: 'row',
    gap: 8,
  },
  countdownCancelBtn: {
    flex: 1,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownNowBtn: {
    flex: 1.3,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownBtnTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  hudOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
    justifyContent: 'space-between',
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  topLeftGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleMetaWrap: {
    flex: 1,
    minWidth: 0,
  },
  hudTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  hudMeta: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  topRightCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 8,
  },
  topCapsuleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  topBtnGreen: {
    backgroundColor: 'rgba(48, 209, 88, 0.24)',
  },
  prepDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FFD60A',
  },
  rightSideCapsule: {
    position: 'absolute',
    top: '29%',
    paddingVertical: 6,
    paddingHorizontal: 5,
    gap: 6,
    alignItems: 'center',
    zIndex: 20,
  },
  sideBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBtnActiveRed: {
    backgroundColor: 'rgba(229, 9, 20, 0.92)',
  },
  centerControlsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    transform: [{ translateY: -39 }],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 44,
    zIndex: 16,
  },
  centerSeekTouch: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekRingWrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seekRingTxt: {
    position: 'absolute',
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  centerPlayBox: {
    width: 78,
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBlock: {
    gap: 6,
  },
  floatingChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 0,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  quickChipTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeReadout: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 13.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  sleepBadge: {
    color: COLORS.accentGold,
    fontSize: 12,
    fontWeight: '700',
  },
  scrubberHit: {
    height: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  scrubberTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
    overflow: 'hidden',
  },
  scrubberBuffer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  scrubberFill: {
    height: '100%',
    backgroundColor: '#E50914',
  },
  scrubberThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#E50914',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.45,
    shadowRadius: 3,
  },
  scrubTooltipWrap: {
    position: 'absolute',
    bottom: 26,
    marginLeft: -32,
  },
  scrubTooltip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  scrubTooltipTxt: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cueMarkerPill: {
    position: 'absolute',
    width: 4,
    height: 12,
    borderRadius: 2,
    marginLeft: -2,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  seamlessDotMarker: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  bottomActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    position: 'relative',
  },
  bottomLeftRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  nextEpPill: {
    height: 42,
    paddingLeft: 8,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nextEpThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  circleActionBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomRightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  rightPillBtn: {
    height: 42,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rightPillTxt: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  speedPopover: {
    position: 'absolute',
    right: 128,
    bottom: 50,
    padding: 8,
    gap: 4,
    minWidth: 112,
    zIndex: 35,
  },
  morePopover: {
    position: 'absolute',
    right: 0,
    bottom: 52,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
    minWidth: 256,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    zIndex: 35,
    boxShadow: GLASS_SHADOW,
    elevation: 18,
  },
  morePopoverFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(18, 21, 28, 0.54)',
  },
  morePopoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 13,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 16,
  },
  morePopoverIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  morePopoverText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'left',
    flexShrink: 1,
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
  },
  popoverItemActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.78)',
  },
  popoverItemTxt: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
