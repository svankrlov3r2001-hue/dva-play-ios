import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import {
  EdgeInsets,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AmbientAppBackground } from './src/components/AmbientAppBackground';
import { AppAlertHost } from './src/components/AppAlertModal';
import { AppMenuBar, AppTabKey } from './src/components/AppMenuBar';
import { AppUpdateModal } from './src/components/AppUpdateModal';
import { GlassSurface } from './src/components/GlassSurface';
import { PreviewSheetModal } from './src/components/PreviewSheetModal';
import { SplashOverlay } from './src/components/SplashOverlay';
import {
  COLORS,
  SPLASH_MIN_DURATION_MS,
} from './src/constants/config';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SettingsProvider, useSettings } from './src/context/SettingsContext';
import { AccountSettingsScreen } from './src/screens/AccountSettingsScreen';
import { CastModal } from './src/screens/CastModal';
import { ExploreScreen } from './src/screens/ExploreScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MovieDetailScreen } from './src/screens/MovieDetailScreen';
import { PlayerLaunchParams, PlayerModal } from './src/screens/PlayerModal';
import { QuickLoginQrModal } from './src/screens/QuickLoginQrModal';
import { SearchScreen } from './src/screens/SearchScreen';
import {
  ActivePlaybackSession,
  clearActivePlaybackSession,
  loadActivePlaybackSession,
} from './src/services/activeSessionService';
import { checkAuthStatusApi } from './src/services/api';
import {
  enforceOfflineRetentionPolicy,
  findCompletedOfflineItem,
  flushPendingOfflineProgressToServer,
  getOfflineRootDir,
  loadOfflineDownloads,
  pullOnlineProgressForOfflineItems,
  resumeBackgroundQueueIfNeeded,
  setOfflineRuntimePolicy,
  subscribeOfflineDownloads,
} from './src/services/downloadService';
import { ensureOfflineMediaServer } from './src/services/localMediaServer';
import {
  probeConnectivity,
  startNetworkMonitor,
  subscribeAutoOfflineRequest,
  subscribeNetworkStatus,
} from './src/services/networkService';
import {
  checkAndFetchOtaCombinedAsync,
  runSilentBackgroundOtaSync,
} from './src/services/otaService';
import {
  EpisodeItem,
  MovieItem,
  OfflineDownloadItem,
  VersionManifest,
} from './src/types/models';

type PlayerTransitionPhase = 'idle' | 'hiding' | 'rotating' | 'active' | 'closing';

function RootAppContent() {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const portraitHeight = Math.max(winWidth, winHeight);
  const [portraitInsets, setPortraitInsets] = useState<EdgeInsets>(insets);

  useEffect(() => {
    if (winWidth < winHeight) {
      setPortraitInsets((prev) =>
        prev.top === insets.top &&
        prev.bottom === insets.bottom &&
        prev.left === insets.left &&
        prev.right === insets.right
          ? prev
          : insets
      );
    }
  }, [winWidth, winHeight, insets]);

  const activePortraitInsets = winWidth < winHeight ? insets : portraitInsets;

  const { settings, loaded: settingsLoaded } = useSettings();
  const {
    user,
    bootstrapping,
    authTransition,
    isLocked,
    lockPromptVisible,
    lockSeq,
    unlockWithBiometrics,
    attemptAutoUnlockWithBiometrics,
    logout,
    refreshUser,
  } = useAuth();

  // Minimum 3s Startup Connection Splash state matching dva-play/src/main/splashManager.js
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashDismissing, setSplashDismissing] = useState(false);
  const [splashMinDone, setSplashMinDone] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [splashError, setSplashError] = useState(false);
  const [splashStatusText, setSplashStatusText] = useState('Đang kết nối...');
  const [offlineModeActive, setOfflineModeActive] = useState(false);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const offlineModeActiveRef = useRef(false);
  offlineModeActiveRef.current = offlineModeActive;
  const [watchProgressRevision, setWatchProgressRevision] = useState(0);
  const bumpWatchProgressRevision = useCallback(() => {
    setWatchProgressRevision((v) => v + 1);
  }, []);
  const [biometricUnlockedEarly, setBiometricUnlockedEarly] = useState(false);
  const [pendingAutoResume, setPendingAutoResume] = useState<ActivePlaybackSession | null>(null);
  const [autoResumeChecked, setAutoResumeChecked] = useState(false);
  const autoResumeConsumedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<AppTabKey>('home');
  const [accountOpen, setAccountOpen] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewMovie, setPreviewMovie] = useState<MovieItem | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [playerParams, setPlayerParams] = useState<PlayerLaunchParams | null>(null);
  const [playerPhase, setPlayerPhase] = useState<PlayerTransitionPhase>('idle');
  const playerPhaseRef = useRef<PlayerTransitionPhase>(playerPhase);
  playerPhaseRef.current = playerPhase;
  const splashVisibleRef = useRef(splashVisible);
  splashVisibleRef.current = splashVisible;
  const portraitOpacity = useRef(new Animated.Value(1)).current;
  const queuedPlayerParamsRef = useRef<PlayerLaunchParams | null>(null);
  const pendingAfterRestoreRef = useRef<(() => void) | undefined>(undefined);
  const hidingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hidingRafRef = useRef<number | null>(null);
  const rotatingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotatingStableRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingStableRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRafRef = useRef<number | null>(null);
  const [castVisible, setCastVisible] = useState(false);
  const [quickLoginQrVisible, setQuickLoginQrVisible] = useState(false);
  const [updateManifest, setUpdateManifest] = useState<VersionManifest | null>(null);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);
  const startupUpdateCheckedRef = useRef(false);
  const [castMovie, setCastMovie] = useState<{
    videosId: number;
    streamCode: string;
    title: string;
  } | null>(null);

  const enterOfflineMode = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    offlineModeActiveRef.current = true;
    setOfflineModeActive(true);
    setSplashError(false);
    setServerReady(true);
  }, []);

  const probeServerConnection = useCallback(async () => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      await checkAuthStatusApi();
      setSplashError(false);
      setSplashStatusText('Đang kết nối...');
      setServerReady(true);
    } catch {
      if (offlineModeActiveRef.current) return;
      await probeConnectivity(2000).catch(() => false);
      if (offlineModeActiveRef.current) return;
      setSplashStatusText('Đang chuyển sang Kho Phim Ngoại Tuyến...');
      enterOfflineMode();
    }
  }, [enterOfflineMode]);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    loadActivePlaybackSession()
      .then((s) => {
        setPendingAutoResume(s);
        setAutoResumeChecked(true);
      })
      .catch(() => {
        setAutoResumeChecked(true);
      });
    loadOfflineDownloads()
      .then((items) => {
        setOfflineItems(items);
        ensureOfflineMediaServer(getOfflineRootDir()).catch(() => {});
        return resumeBackgroundQueueIfNeeded();
      })
      .catch(() => {});
    const unsubDl = subscribeOfflineDownloads(setOfflineItems);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        ensureOfflineMediaServer(getOfflineRootDir()).catch(() => {});
        resumeBackgroundQueueIfNeeded().catch(() => {});
      }
    });
    return () => {
      unsubDl();
      appStateSub.remove();
    };
  }, []);

  useEffect(() => {
    const stopMonitor = startNetworkMonitor(5000);
    const unsubAutoOffline = subscribeAutoOfflineRequest(() => {
      if (!offlineModeActiveRef.current && playerPhaseRef.current === 'idle') {
        enterOfflineMode();
      }
    });
    const unsubNet = subscribeNetworkStatus((online) => {
      if (
        !online &&
        !offlineModeActiveRef.current &&
        playerPhaseRef.current === 'idle' &&
        !splashVisibleRef.current
      ) {
        enterOfflineMode();
      }
    });
    return () => {
      stopMonitor();
      unsubAutoOffline();
      unsubNet();
    };
  }, [enterOfflineMode]);

  useEffect(() => {
    if (!settingsLoaded) return;
    const policy = {
      storageLimitGb: settings.offlineStorageLimitGb,
      autoDeleteEnabled: settings.offlineAutoDeleteEnabled,
      autoDeleteDays: settings.offlineAutoDeleteDays,
      antiStallEnabled: settings.offlineAntiStallEnabled,
    };
    setOfflineRuntimePolicy(policy);
    enforceOfflineRetentionPolicy(policy).catch(() => {});
  }, [
    settingsLoaded,
    settings.offlineStorageLimitGb,
    settings.offlineAutoDeleteEnabled,
    settings.offlineAutoDeleteDays,
    settings.offlineAntiStallEnabled,
  ]);

  useEffect(() => {
    if (!serverReady || !user || offlineModeActive) return;
    const runBidirectionalSync = () => {
      flushPendingOfflineProgressToServer()
        .then(() => pullOnlineProgressForOfflineItems())
        .catch(() => {});
    };
    runBidirectionalSync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        runBidirectionalSync();
      }
    });
    return () => sub.remove();
  }, [serverReady, user, offlineModeActive]);

  useEffect(() => {
    const minTimer = setTimeout(() => {
      setSplashMinDone(true);
    }, SPLASH_MIN_DURATION_MS);

    probeServerConnection();
    runSilentBackgroundOtaSync().catch(() => {});

    return () => {
      clearTimeout(minTimer);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [probeServerConnection]);

  useEffect(() => {
    if (
      startupUpdateCheckedRef.current ||
      bootstrapping ||
      !serverReady ||
      splashVisible ||
      splashDismissing ||
      !user ||
      offlineModeActive ||
      isLocked ||
      playerPhase !== 'idle'
    ) {
      return;
    }
    startupUpdateCheckedRef.current = true;
    let active = true;
    (async () => {
      try {
        const res = await checkAndFetchOtaCombinedAsync();
        if (!active) return;
        if (!res.canDirectInstall || !res.ipaAvailable || !res.directInstallReady || !res.manifest) {
          return;
        }
        const dismissedCode = await SecureStore.getItemAsync('dva_dismissed_update_code').catch(
          () => null
        );
        if (!active || dismissedCode === String(res.manifest.versionCode)) {
          return;
        }
        setUpdateManifest(res.manifest);
        setUpdateModalVisible(true);
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, [
    bootstrapping,
    serverReady,
    splashVisible,
    splashDismissing,
    user,
    offlineModeActive,
    isLocked,
    playerPhase,
  ]);

  const prevAuthTransitionRef = useRef<'login' | 'logout' | null>(null);

  useEffect(() => {
    const fastAutoResumeReady = Boolean(
      settingsLoaded &&
        autoResumeChecked &&
        settings.autoResumeOnCrash &&
        pendingAutoResume?.active &&
        !autoResumeConsumedRef.current
    );
    const connectionReady = offlineModeActive || (serverReady && !bootstrapping);
    const waitRuleSatisfied =
      splashMinDone ||
      biometricUnlockedEarly ||
      fastAutoResumeReady ||
      offlineModeActive ||
      lockPromptVisible;
    if (
      splashVisible &&
      !splashDismissing &&
      !authTransition &&
      (!isLocked || lockPromptVisible) &&
      connectionReady &&
      waitRuleSatisfied
    ) {
      setSplashDismissing(true);
    }
  }, [
    splashVisible,
    splashDismissing,
    authTransition,
    splashMinDone,
    serverReady,
    bootstrapping,
    offlineModeActive,
    isLocked,
    lockPromptVisible,
    biometricUnlockedEarly,
    settingsLoaded,
    autoResumeChecked,
    settings.autoResumeOnCrash,
    pendingAutoResume,
  ]);

  useEffect(() => {
    if (authTransition === 'login' || authTransition === 'logout') {
      setSplashError(false);
      setSplashStatusText(authTransition === 'login' ? 'Đang đăng nhập' : 'Đang đăng xuất');
      setSplashDismissing(false);
      setSplashVisible(true);
      if (authTransition === 'logout') {
        setAccountOpen(false);
        setPreviewId(null);
        setPreviewMovie(null);
        setDetailId(null);
        setCastVisible(false);
        setActiveTab('home');
      }
    } else if (prevAuthTransitionRef.current !== null && authTransition === null) {
      setSplashDismissing(true);
    }
    prevAuthTransitionRef.current = authTransition;
  }, [authTransition]);

  useEffect(() => {
    if (!splashDismissing || !splashVisible) return;
    const t = setTimeout(() => {
      setSplashVisible(false);
      setSplashDismissing(false);
    }, 440);
    return () => clearTimeout(t);
  }, [splashDismissing, splashVisible]);

  const lastAttemptedLockSeqRef = useRef(-1);

  useEffect(() => {
    if (!isLocked) {
      lastAttemptedLockSeqRef.current = -1;
      return;
    }
    if (!user) {
      return;
    }
    if (lastAttemptedLockSeqRef.current === lockSeq) {
      return;
    }

    const triggerScan = () => {
      if (lastAttemptedLockSeqRef.current === lockSeq) return;
      lastAttemptedLockSeqRef.current = lockSeq;
      attemptAutoUnlockWithBiometrics()
        .then((ok) => {
          if (ok && splashVisibleRef.current) {
            setBiometricUnlockedEarly(true);
          }
        })
        .catch(() => {});
    };

    if (AppState.currentState === 'background') {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          sub.remove();
          setTimeout(triggerScan, 80);
        }
      });
      return () => sub.remove();
    }

    const t = setTimeout(triggerScan, 80);
    return () => clearTimeout(t);
  }, [
    user,
    isLocked,
    lockSeq,
    attemptAutoUnlockWithBiometrics,
  ]);

  const handleOpenPreview = (item: MovieItem) => {
    Haptics.selectionAsync();
    setPreviewMovie(item);
    setPreviewId(item.videos_id);
  };

  const clearTransitionTimers = useCallback(() => {
    if (hidingRafRef.current !== null) {
      cancelAnimationFrame(hidingRafRef.current);
      hidingRafRef.current = null;
    }
    if (hidingTimerRef.current) {
      clearTimeout(hidingTimerRef.current);
      hidingTimerRef.current = null;
    }
    if (rotatingFallbackRef.current) {
      clearTimeout(rotatingFallbackRef.current);
      rotatingFallbackRef.current = null;
    }
    if (rotatingStableRef.current) {
      clearTimeout(rotatingStableRef.current);
      rotatingStableRef.current = null;
    }
    if (closingRafRef.current !== null) {
      cancelAnimationFrame(closingRafRef.current);
      closingRafRef.current = null;
    }
    if (closingFallbackRef.current) {
      clearTimeout(closingFallbackRef.current);
      closingFallbackRef.current = null;
    }
    if (closingStableRef.current) {
      clearTimeout(closingStableRef.current);
      closingStableRef.current = null;
    }
  }, []);

  const activateQueuedPlayer = useCallback(() => {
    if (rotatingFallbackRef.current) {
      clearTimeout(rotatingFallbackRef.current);
      rotatingFallbackRef.current = null;
    }
    if (rotatingStableRef.current) {
      clearTimeout(rotatingStableRef.current);
      rotatingStableRef.current = null;
    }
    const next = queuedPlayerParamsRef.current;
    queuedPlayerParamsRef.current = null;
    if (next) {
      setPlayerParams(next);
      setPlayerPhase('active');
    } else {
      portraitOpacity.setValue(1);
      setPlayerPhase('idle');
    }
  }, [portraitOpacity]);

  const finishClosingToPortrait = useCallback(() => {
    if (closingFallbackRef.current) {
      clearTimeout(closingFallbackRef.current);
      closingFallbackRef.current = null;
    }
    if (closingStableRef.current) {
      clearTimeout(closingStableRef.current);
      closingStableRef.current = null;
    }
    const afterCb = pendingAfterRestoreRef.current;
    pendingAfterRestoreRef.current = undefined;
    if (afterCb) afterCb();
    portraitOpacity.stopAnimation();
    portraitOpacity.setValue(0);
    setPlayerPhase('idle');
    requestAnimationFrame(() => {
      Animated.timing(portraitOpacity, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [portraitOpacity]);

  const launchPlayerWithCurtain = useCallback(
    (nextParams: PlayerLaunchParams) => {
      clearTransitionTimers();
      pendingAfterRestoreRef.current = undefined;
      queuedPlayerParamsRef.current = nextParams;
      setPreviewId(null);
      setPreviewMovie(null);
      setPlayerParams(null);
      portraitOpacity.stopAnimation();
      portraitOpacity.setValue(0);
      setPlayerPhase('hiding');
    },
    [clearTransitionTimers, portraitOpacity]
  );

  const closePlayerWithCurtain = useCallback(
    (afterRestore?: () => void) => {
      clearTransitionTimers();
      queuedPlayerParamsRef.current = null;
      pendingAfterRestoreRef.current = afterRestore;
      setPlayerParams(null);
      portraitOpacity.stopAnimation();
      portraitOpacity.setValue(0);
      setPlayerPhase('closing');
      closingRafRef.current = requestAnimationFrame(() => {
        closingRafRef.current = null;
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      });
    },
    [clearTransitionTimers, portraitOpacity]
  );

  // Step 1 -> 2: Wait for display:none black frame to paint before locking LANDSCAPE
  useEffect(() => {
    if (playerPhase !== 'hiding') return;
    hidingRafRef.current = requestAnimationFrame(() => {
      hidingRafRef.current = null;
      hidingTimerRef.current = setTimeout(() => {
        hidingTimerRef.current = null;
        setPlayerPhase('rotating');
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      }, 90);
    });
    return () => {
      if (hidingRafRef.current !== null) {
        cancelAnimationFrame(hidingRafRef.current);
        hidingRafRef.current = null;
      }
      if (hidingTimerRef.current) {
        clearTimeout(hidingTimerRef.current);
        hidingTimerRef.current = null;
      }
    };
  }, [playerPhase]);

  // Step 2 -> 3: Fallback guard while waiting for landscape dimensions
  useEffect(() => {
    if (playerPhase !== 'rotating') return;
    rotatingFallbackRef.current = setTimeout(() => {
      activateQueuedPlayer();
    }, 520);
    return () => {
      if (rotatingFallbackRef.current) {
        clearTimeout(rotatingFallbackRef.current);
        rotatingFallbackRef.current = null;
      }
    };
  }, [playerPhase, activateQueuedPlayer]);

  // Step 2 -> 3: Mount PlayerModal only after landscape bounds settle
  useEffect(() => {
    if (playerPhase !== 'rotating') return;
    if (winWidth > winHeight) {
      if (rotatingStableRef.current) clearTimeout(rotatingStableRef.current);
      rotatingStableRef.current = setTimeout(() => {
        activateQueuedPlayer();
      }, 60);
    }
    return () => {
      if (rotatingStableRef.current) {
        clearTimeout(rotatingStableRef.current);
        rotatingStableRef.current = null;
      }
    };
  }, [playerPhase, winWidth, winHeight, activateQueuedPlayer]);

  // Closing fallback guard while waiting for portrait dimensions
  useEffect(() => {
    if (playerPhase !== 'closing') return;
    closingFallbackRef.current = setTimeout(() => {
      finishClosingToPortrait();
    }, 520);
    return () => {
      if (closingFallbackRef.current) {
        clearTimeout(closingFallbackRef.current);
        closingFallbackRef.current = null;
      }
    };
  }, [playerPhase, finishClosingToPortrait]);

  // Closing -> idle: Reveal portrait stage only after portrait bounds settle
  useEffect(() => {
    if (playerPhase !== 'closing') return;
    if (winWidth < winHeight) {
      if (closingStableRef.current) clearTimeout(closingStableRef.current);
      closingStableRef.current = setTimeout(() => {
        finishClosingToPortrait();
      }, 80);
    }
    return () => {
      if (closingStableRef.current) {
        clearTimeout(closingStableRef.current);
        closingStableRef.current = null;
      }
    };
  }, [playerPhase, winWidth, winHeight, finishClosingToPortrait]);

  useEffect(() => {
    return () => {
      clearTransitionTimers();
    };
  }, [clearTransitionTimers]);

  const handlePlayDirect = (item: MovieItem) => {
    if (item.stream_code) {
      launchPlayerWithCurtain({
        videosId: item.videos_id,
        streamCode: item.stream_code,
        title: item.title,
        posterUrl: item.poster_url,
        thumbnailUrl: item.thumbnail_url,
      });
    } else {
      setDetailId(item.videos_id);
    }
  };

  useEffect(() => {
    if (!settingsLoaded || !autoResumeChecked || autoResumeConsumedRef.current) return;
    if (!settings.autoResumeOnCrash || !pendingAutoResume || !pendingAutoResume.active) {
      return;
    }
    const connectionReady = offlineModeActive || (serverReady && !bootstrapping && Boolean(user));
    if (!connectionReady || isLocked || playerPhase !== 'idle') {
      return;
    }

    autoResumeConsumedRef.current = true;
    const session = pendingAutoResume;
    setPendingAutoResume(null);

    const matchedOffline = findCompletedOfflineItem({
      streamCode: session.streamCode,
      videosId: session.videosId,
      episodeId: session.episodeId,
    });
    if (offlineModeActive && !matchedOffline) {
      void clearActivePlaybackSession();
      return;
    }

    launchPlayerWithCurtain({
      videosId: session.videosId,
      streamCode: session.streamCode,
      episodeId: session.episodeId,
      episodeNumber: session.episodeNumber,
      seasonId: session.seasonId,
      title: session.title,
      episodeTitle: session.episodeTitle,
      posterUrl: session.posterUrl,
      thumbnailUrl: session.thumbnailUrl,
      initialResumeSec: session.positionSec,
      ...(matchedOffline
        ? { offlineUri: matchedOffline.local_uri, offlineItem: matchedOffline }
        : {}),
    });
    if (splashVisibleRef.current) {
      setSplashDismissing(true);
    }
  }, [
    settingsLoaded,
    autoResumeChecked,
    settings.autoResumeOnCrash,
    pendingAutoResume,
    offlineModeActive,
    serverReady,
    bootstrapping,
    user,
    isLocked,
    playerPhase,
    launchPlayerWithCurtain,
  ]);

  const handlePlayOffline = (
    offline: OfflineDownloadItem,
    seriesEpisodes?: OfflineDownloadItem[]
  ) => {
    launchPlayerWithCurtain({
      videosId: offline.videos_id,
      streamCode: offline.stream_code,
      episodeId: offline.episode_id,
      title: offline.title,
      episodeTitle: offline.episode_title,
      offlineUri: offline.local_uri,
      offlineItem: offline,
      offlineEpisodes: seriesEpisodes,
    });
  };

  const handleSwitchOfflineItem = (offline: OfflineDownloadItem) => {
    setPlayerParams((prev) =>
      prev
        ? {
            ...prev,
            streamCode: offline.stream_code,
            episodeId: offline.episode_id,
            title: offline.title,
            episodeTitle: offline.episode_title,
            offlineUri: offline.local_uri,
            offlineItem: offline,
          }
        : null
    );
  };

  const handleSwitchEpisode = (ep: EpisodeItem, epIndex: number) => {
    setPlayerParams((prev) =>
      prev
        ? {
            ...prev,
            streamCode: ep.stream_code,
            episodeId: ep.episodes_id,
            episodeNumber: epIndex + 1,
            seasonId: String(ep.seasons_id),
            episodeTitle: ep.episodes_name,
          }
        : null
    );
  };

  const handleClosePlayer = useCallback(() => {
    closePlayerWithCurtain();
  }, [closePlayerWithCurtain]);

  const handleEnterOfflineModeFromPlayer = useCallback(() => {
    closePlayerWithCurtain(() => enterOfflineMode());
  }, [closePlayerWithCurtain, enterOfflineMode]);

  const renderLockOverlay = () => {
    if (!isLocked) return null;
    return (
      <View style={[styles.lockOverlay, !lockPromptVisible && styles.lockOverlayScanning]}>
        {lockPromptVisible ? (
          <>
            <AmbientAppBackground />
            <GlassSurface variant="liquid" intensity={85} radius={40} style={styles.lockCard}>
              <Ionicons name="lock-closed" size={42} color={COLORS.accent} />
              <Text style={styles.lockTitle}>Đã khóa bằng Face ID</Text>
              <Text style={styles.lockSub}>Xác thực để tiếp tục xem phim trên Đặng Việt Anh</Text>
              <TouchableOpacity style={styles.unlockBtn} onPress={unlockWithBiometrics}>
                <Ionicons name="scan-outline" size={20} color="#FFF" />
                <Text style={styles.unlockTxt}>Mở khóa ngay</Text>
              </TouchableOpacity>
              {!offlineModeActive ? (
                <TouchableOpacity
                  onPress={() => {
                    if (playerPhase !== 'idle' || playerParams !== null) {
                      clearTransitionTimers();
                      queuedPlayerParamsRef.current = null;
                      pendingAfterRestoreRef.current = undefined;
                      setPlayerParams(null);
                      setPlayerPhase('idle');
                      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
                    }
                    logout();
                  }}
                  style={{ marginTop: 14 }}
                >
                  <Text style={styles.logoutLink}>Đăng xuất tài khoản</Text>
                </TouchableOpacity>
              ) : null}
            </GlassSurface>
          </>
        ) : (
          <TouchableOpacity
            activeOpacity={1}
            style={StyleSheet.absoluteFill}
            onPress={() => {
              attemptAutoUnlockWithBiometrics().catch(() => {});
            }}
          />
        )}
      </View>
    );
  };

  const renderMainContent = () => {
    const hidePortraitStage = playerPhase !== 'idle';

    if (offlineModeActive) {
      return (
        <View style={[styles.root, hidePortraitStage && { backgroundColor: '#000000' }]}>
          <SafeAreaInsetsContext.Provider value={activePortraitInsets}>
            <Animated.View
              style={[
                styles.portraitStage,
                {
                  width: portraitWidth,
                  height: portraitHeight,
                  display: hidePortraitStage ? 'none' : 'flex',
                  opacity: portraitOpacity,
                },
              ]}
              pointerEvents={hidePortraitStage ? 'none' : 'auto'}
            >
              <AmbientAppBackground />
              <View style={styles.screenArea}>
                <LibraryScreen
                  offlineOnlyMode
                  watchProgressRevision={watchProgressRevision}
                  onOpenPreview={() => {}}
                  onPlayOffline={handlePlayOffline}
                  onReconnectOnline={() => {
                    offlineModeActiveRef.current = false;
                    setOfflineModeActive(false);
                    setServerReady(false);
                    setSplashError(false);
                    setSplashStatusText('Đang kết nối lại...');
                    setSplashDismissing(false);
                    setSplashVisible(true);
                    probeServerConnection();
                    refreshUser().catch(() => {});
                  }}
                />
              </View>
            </Animated.View>
          </SafeAreaInsetsContext.Provider>

          <PlayerModal
            visible={playerPhase === 'active' && playerParams !== null}
            params={playerParams}
            onClose={handleClosePlayer}
            onSwitchOfflineItem={handleSwitchOfflineItem}
            onWatchProgressSaved={bumpWatchProgressRevision}
          />

          {renderLockOverlay()}
        </View>
      );
    }

    if (bootstrapping) {
      return (
        <View style={styles.root}>
          <AmbientAppBackground />
        </View>
      );
    }

    if (!user) {
      return <LoginScreen />;
    }

    return (
      <View style={[styles.root, hidePortraitStage && { backgroundColor: '#000000' }]}>
        <SafeAreaInsetsContext.Provider value={activePortraitInsets}>
          <Animated.View
            style={[
              styles.portraitStage,
              {
                width: portraitWidth,
                height: portraitHeight,
                display: hidePortraitStage ? 'none' : 'flex',
                opacity: portraitOpacity,
              },
            ]}
            pointerEvents={hidePortraitStage ? 'none' : 'auto'}
          >
            <AmbientAppBackground />
            <View style={styles.screenArea}>
              {activeTab === 'home' ? (
                <HomeScreen
                  isFocused={
                    activeTab === 'home' &&
                    playerPhase === 'idle' &&
                    !detailId &&
                    !previewId &&
                    !accountOpen &&
                    !castVisible &&
                    !quickLoginQrVisible &&
                    !isLocked &&
                    !splashVisible
                  }
                  watchProgressRevision={watchProgressRevision}
                  onOpenPreview={handleOpenPreview}
                  onOpenDetail={(id) => setDetailId(id)}
                  onPlayDirect={handlePlayDirect}
                  onOpenCast={() => {
                    setCastMovie(null);
                    setCastVisible(true);
                  }}
                  onOpenQuickLoginQr={() => setQuickLoginQrVisible(true)}
                  onOpenAccount={() => setAccountOpen(true)}
                  onNavigateExplore={() => setActiveTab('explore')}
                />
              ) : null}

              {activeTab === 'explore' ? (
                <ExploreScreen onOpenPreview={handleOpenPreview} />
              ) : null}

              {activeTab === 'search' ? (
                <SearchScreen
                  onOpenPreview={handleOpenPreview}
                  onOpenDetail={(id) => setDetailId(id)}
                />
              ) : null}

              {activeTab === 'library' ? (
                <LibraryScreen
                  watchProgressRevision={watchProgressRevision}
                  onOpenPreview={handleOpenPreview}
                  onPlayOffline={handlePlayOffline}
                />
              ) : null}
            </View>

            {/* Bottom Liquid Glass Menu Bar ported from `_L8j7Tt_app_container` */}
            <AppMenuBar
              activeTab={activeTab}
              bottomInset={activePortraitInsets.bottom}
              onSelectTab={setActiveTab}
            />

            {/* Global In-Tree Overlays */}
            <MovieDetailScreen
              visible={detailId !== null}
              videosId={detailId}
              obscuredByPlayer={hidePortraitStage || playerParams !== null}
              watchProgressRevision={watchProgressRevision}
              onClose={() => setDetailId(null)}
              onPlay={(p) => launchPlayerWithCurtain(p)}
              onOpenCastWithMovie={(m) => {
                setCastMovie(m);
                setCastVisible(true);
              }}
              onSelectRelated={(newId) => setDetailId(newId)}
            />

            <PreviewSheetModal
              visible={previewId !== null}
              videosId={previewId}
              initialMovie={previewMovie}
              obscuredByPlayer={hidePortraitStage || playerParams !== null}
              onClose={() => {
                setPreviewId(null);
                setPreviewMovie(null);
              }}
              onPlay={(p) =>
                launchPlayerWithCurtain({
                  videosId: p.videosId,
                  streamCode: p.streamCode,
                  episodeId: p.episodeId,
                  title: p.title,
                  posterUrl: p.posterUrl,
                  thumbnailUrl: p.thumbnailUrl,
                })
              }
              onOpenDetail={(id) => setDetailId(id)}
            />

            <AccountSettingsScreen
              visible={accountOpen}
              onClose={() => setAccountOpen(false)}
              onOpenCast={() => {
                setCastMovie(null);
                setCastVisible(true);
              }}
            />

            <CastModal
              visible={castVisible}
              movieToCast={castMovie}
              onClose={() => setCastVisible(false)}
            />

            <QuickLoginQrModal
              visible={quickLoginQrVisible}
              onClose={() => setQuickLoginQrVisible(false)}
            />
          </Animated.View>
        </SafeAreaInsetsContext.Provider>

        <PlayerModal
          visible={playerPhase === 'active' && playerParams !== null}
          params={playerParams}
          onClose={handleClosePlayer}
          onSwitchEpisode={handleSwitchEpisode}
          onSwitchOfflineItem={handleSwitchOfflineItem}
          onEnterOfflineMode={handleEnterOfflineModeFromPlayer}
          onWatchProgressSaved={bumpWatchProgressRevision}
        />

        {renderLockOverlay()}
      </View>
    );
  };

  const completedOfflineCount = offlineItems.filter((i) => i.status === 'completed').length;

  return (
    <View style={[styles.root, playerPhase !== 'idle' && { backgroundColor: '#000000' }]}>
      <StatusBar hidden={playerPhase !== 'idle'} style="light" />
      {renderMainContent()}
      <AppUpdateModal
        visible={updateModalVisible && playerPhase === 'idle' && !isLocked && !splashVisible}
        manifest={updateManifest}
        onDismiss={() => {
          setUpdateModalVisible(false);
          if (updateManifest?.versionCode) {
            SecureStore.setItemAsync(
              'dva_dismissed_update_code',
              String(updateManifest.versionCode)
            ).catch(() => {});
          }
        }}
      />
      <SplashOverlay
        visible={splashVisible}
        dismissing={splashDismissing}
        statusText={splashStatusText}
        hasError={splashError}
        offlineCount={completedOfflineCount}
        onRetry={() => {
          setSplashError(false);
          setSplashStatusText('Đang kết nối lại...');
          probeServerConnection();
        }}
        onOpenOfflineMode={() => {
          if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
          }
          offlineModeActiveRef.current = true;
          setOfflineModeActive(true);
          setSplashError(false);
          setSplashDismissing(true);
        }}
      />
      <AppAlertHost />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AuthProvider>
          <RootAppContent />
        </AuthProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  portraitStage: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: COLORS.bg,
    overflow: 'hidden',
  },
  screenArea: {
    flex: 1,
  },
  lockOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 99999,
    elevation: 99999,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockOverlayScanning: {
    backgroundColor: 'transparent',
  },
  lockCard: {
    width: '100%',
    maxWidth: 380,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  lockTitle: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  lockSub: {
    color: COLORS.muted,
    fontSize: 13.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 18,
  },
  unlockTxt: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  logoutLink: {
    color: COLORS.muted,
    fontSize: 13.5,
    fontWeight: '600',
  },
});
