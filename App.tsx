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
import { StatusBar } from 'expo-status-bar';
import {
  EdgeInsets,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { AmbientAppBackground } from './src/components/AmbientAppBackground';
import { AppMenuBar, AppTabKey } from './src/components/AppMenuBar';
import { GlassSurface } from './src/components/GlassSurface';
import { PreviewSheetModal } from './src/components/PreviewSheetModal';
import { SplashOverlay } from './src/components/SplashOverlay';
import {
  COLORS,
  SPLASH_AUTO_RETRY_MS,
  SPLASH_MIN_DURATION_MS,
} from './src/constants/config';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { AccountSettingsScreen } from './src/screens/AccountSettingsScreen';
import { CastModal } from './src/screens/CastModal';
import { ExploreScreen } from './src/screens/ExploreScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MovieDetailScreen } from './src/screens/MovieDetailScreen';
import { PlayerLaunchParams, PlayerModal } from './src/screens/PlayerModal';
import { SearchScreen } from './src/screens/SearchScreen';
import { checkAuthStatusApi } from './src/services/api';
import { runSilentBackgroundOtaSync } from './src/services/otaService';
import { EpisodeItem, MovieItem, OfflineDownloadItem } from './src/types/models';

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
  } = useAuth();

  // Minimum 3s Startup Connection Splash state matching dva-play/src/main/splashManager.js
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashDismissing, setSplashDismissing] = useState(false);
  const [splashMinDone, setSplashMinDone] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [splashError, setSplashError] = useState(false);
  const [splashStatusText, setSplashStatusText] = useState('Đang kết nối...');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<AppTabKey>('home');
  const [accountOpen, setAccountOpen] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewMovie, setPreviewMovie] = useState<MovieItem | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [playerParams, setPlayerParams] = useState<PlayerLaunchParams | null>(null);
  const [playerPhase, setPlayerPhase] = useState<PlayerTransitionPhase>('idle');
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
  const [castMovie, setCastMovie] = useState<{
    videosId: number;
    streamCode: string;
    title: string;
  } | null>(null);

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
      setServerReady(false);
      setSplashError(true);
      setSplashStatusText('Lỗi kết nối tới máy chủ., Đang thử lại...');
      retryTimerRef.current = setTimeout(() => {
        probeServerConnection();
      }, SPLASH_AUTO_RETRY_MS);
    }
  }, []);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

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

  const prevAuthTransitionRef = useRef<'login' | 'logout' | null>(null);

  useEffect(() => {
    if (
      splashVisible &&
      !splashDismissing &&
      !authTransition &&
      splashMinDone &&
      serverReady &&
      !bootstrapping
    ) {
      setSplashDismissing(true);
    }
  }, [splashVisible, splashDismissing, authTransition, splashMinDone, serverReady, bootstrapping]);

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
    if ((splashVisible && !splashDismissing) || !user) {
      return;
    }
    if (lastAttemptedLockSeqRef.current === lockSeq) {
      return;
    }

    const triggerScan = () => {
      if (lastAttemptedLockSeqRef.current === lockSeq) return;
      lastAttemptedLockSeqRef.current = lockSeq;
      attemptAutoUnlockWithBiometrics().catch(() => {});
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
    splashVisible,
    splashDismissing,
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
      });
    } else {
      setDetailId(item.videos_id);
    }
  };

  const handlePlayOffline = (offline: OfflineDownloadItem) => {
    launchPlayerWithCurtain({
      videosId: offline.videos_id,
      streamCode: offline.stream_code,
      episodeId: offline.episode_id,
      title: offline.title,
      episodeTitle: offline.episode_title,
      offlineUri: offline.local_uri,
    });
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

  const renderMainContent = () => {
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

    const hidePortraitStage = playerPhase !== 'idle';

    return (
      <View style={styles.root}>
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
                  onOpenPreview={handleOpenPreview}
                  onOpenDetail={(id) => setDetailId(id)}
                  onPlayDirect={handlePlayDirect}
                  onOpenCast={() => {
                    setCastMovie(null);
                    setCastVisible(true);
                  }}
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
          </Animated.View>
        </SafeAreaInsetsContext.Provider>

        <PlayerModal
          visible={playerPhase === 'active' && playerParams !== null}
          params={playerParams}
          onClose={() => closePlayerWithCurtain()}
          onSwitchEpisode={handleSwitchEpisode}
          onOpenCast={() => {
            if (playerParams) {
              setCastMovie({
                videosId: playerParams.videosId,
                streamCode: playerParams.streamCode,
                title: playerParams.title,
              });
            }
            closePlayerWithCurtain(() => setCastVisible(true));
          }}
        />

        {isLocked ? (
          <View style={[styles.lockOverlay, !lockPromptVisible && styles.lockOverlayScanning]}>
            {lockPromptVisible ? (
              <>
                <AmbientAppBackground />
                <GlassSurface intensity={55} radius={30} style={styles.lockCard}>
                  <Ionicons name="lock-closed" size={42} color={COLORS.accent} />
                  <Text style={styles.lockTitle}>Đã khóa bằng Face ID</Text>
                  <Text style={styles.lockSub}>Xác thực để tiếp tục xem phim trên Đặng Việt Anh</Text>
                  <TouchableOpacity style={styles.unlockBtn} onPress={unlockWithBiometrics}>
                    <Ionicons name="scan-outline" size={20} color="#FFF" />
                    <Text style={styles.unlockTxt}>Mở khóa ngay</Text>
                  </TouchableOpacity>
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
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden={playerPhase !== 'idle'} style="light" />
      {renderMainContent()}
      <SplashOverlay
        visible={splashVisible}
        dismissing={splashDismissing}
        statusText={splashStatusText}
        hasError={splashError}
        onRetry={() => {
          setSplashError(false);
          setSplashStatusText('Đang kết nối lại...');
          probeServerConnection();
        }}
      />
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
