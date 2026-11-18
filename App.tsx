import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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

function RootAppContent() {
  const insets = useSafeAreaInsets();
  const { user, bootstrapping, isLocked, unlockWithBiometrics, logout } = useAuth();

  // Minimum 3s Startup Connection Splash state matching dva-play/src/main/splashManager.js
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashDismissing, setSplashDismissing] = useState(false);
  const [splashMinDone, setSplashMinDone] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [splashError, setSplashError] = useState(false);
  const [splashStatusText, setSplashStatusText] = useState('Đang kết nối...');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeTab, setActiveTab] = useState<AppTabKey>('home');
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [playerParams, setPlayerParams] = useState<PlayerLaunchParams | null>(null);
  const [playerLaunchCurtain, setPlayerLaunchCurtain] = useState(false);
  const launchCurtainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeCurtainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    if (splashVisible && !splashDismissing && splashMinDone && serverReady && !bootstrapping) {
      setSplashDismissing(true);
      const t = setTimeout(() => {
        setSplashVisible(false);
      }, 440);
      return () => clearTimeout(t);
    }
  }, [splashVisible, splashDismissing, splashMinDone, serverReady, bootstrapping]);

  useEffect(() => {
    if (!splashVisible && user && isLocked) {
      unlockWithBiometrics().catch(() => {});
    }
  }, [splashVisible, user, isLocked, unlockWithBiometrics]);

  const handleOpenPreview = (item: MovieItem) => {
    Haptics.selectionAsync();
    setPreviewId(item.videos_id);
  };

  const launchPlayerWithCurtain = useCallback((nextParams: PlayerLaunchParams) => {
    if (launchCurtainTimerRef.current) clearTimeout(launchCurtainTimerRef.current);
    if (closeCurtainTimerRef.current) clearTimeout(closeCurtainTimerRef.current);
    setPlayerLaunchCurtain(true);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    // Keep opaque dark curtain up until portrait -> landscape transition settles before presenting PlayerModal
    launchCurtainTimerRef.current = setTimeout(() => {
      setPlayerParams(nextParams);
    }, 160);
  }, []);

  const closePlayerWithCurtain = useCallback((afterRestore?: () => void) => {
    if (launchCurtainTimerRef.current) clearTimeout(launchCurtainTimerRef.current);
    if (closeCurtainTimerRef.current) clearTimeout(closeCurtainTimerRef.current);
    setPlayerLaunchCurtain(true);
    setPlayerParams(null);
    closeCurtainTimerRef.current = setTimeout(() => {
      setPlayerLaunchCurtain(false);
      if (afterRestore) afterRestore();
    }, 440);
  }, []);

  useEffect(() => {
    return () => {
      if (launchCurtainTimerRef.current) clearTimeout(launchCurtainTimerRef.current);
      if (closeCurtainTimerRef.current) clearTimeout(closeCurtainTimerRef.current);
    };
  }, []);

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
      return <View style={styles.root} />;
    }

    if (!user) {
      return <LoginScreen />;
    }

    if (isLocked) {
      return (
        <View style={styles.lockContainer}>
          <GlassSurface intensity={55} radius={30} style={styles.lockCard}>
            <Ionicons name="lock-closed" size={42} color={COLORS.accent} />
            <Text style={styles.lockTitle}>Đã khóa bằng Face ID</Text>
            <Text style={styles.lockSub}>Xác thực để tiếp tục xem phim trên Đặng Việt Anh</Text>
            <TouchableOpacity style={styles.unlockBtn} onPress={unlockWithBiometrics}>
              <Ionicons name="scan-outline" size={20} color="#FFF" />
              <Text style={styles.unlockTxt}>Mở khóa ngay</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={logout} style={{ marginTop: 14 }}>
              <Text style={styles.logoutLink}>Đăng xuất tài khoản</Text>
            </TouchableOpacity>
          </GlassSurface>
        </View>
      );
    }

    return (
      <View style={styles.root}>
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

          {activeTab === 'account' ? (
            <AccountSettingsScreen
              onOpenCast={() => {
                setCastMovie(null);
                setCastVisible(true);
              }}
            />
          ) : null}
        </View>

        {/* Bottom Liquid Glass Menu Bar ported from `_L8j7Tt_app_container` */}
        <AppMenuBar
          activeTab={activeTab}
          bottomInset={insets.bottom}
          onSelectTab={setActiveTab}
        />

        {/* Global Modals */}
        <PreviewSheetModal
          visible={previewId !== null}
          videosId={previewId}
          obscuredByPlayer={playerLaunchCurtain || playerParams !== null}
          onClose={() => setPreviewId(null)}
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

        <MovieDetailScreen
          visible={detailId !== null}
          videosId={detailId}
          obscuredByPlayer={playerLaunchCurtain || playerParams !== null}
          onClose={() => setDetailId(null)}
          onPlay={(p) => launchPlayerWithCurtain(p)}
          onOpenCastWithMovie={(m) => {
            setCastMovie(m);
            setCastVisible(true);
          }}
          onSelectRelated={(newId) => setDetailId(newId)}
        />

        <PlayerModal
          visible={playerParams !== null}
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

        <CastModal
          visible={castVisible}
          movieToCast={castMovie}
          onClose={() => setCastVisible(false)}
        />
      </View>
    );
  };

  return (
    <View style={styles.root}>
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
      {playerLaunchCurtain ? <View style={styles.playerLaunchCurtain} /> : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AuthProvider>
          <StatusBar style="light" />
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
  screenArea: {
    flex: 1,
  },
  playerLaunchCurtain: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: COLORS.bg,
    zIndex: 9999,
  },
  lockContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockCard: {
    width: '100%',
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
