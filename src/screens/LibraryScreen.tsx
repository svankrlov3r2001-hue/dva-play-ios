import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ImageStyle,
  RefreshControl,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppAlert } from '../components/AppAlertModal';
import { BouncyButton } from '../components/BouncyButton';
import { GlassSurface } from '../components/GlassSurface';
import { LibrarySegmentBar } from '../components/LibrarySegmentBar';
import { MovieCard } from '../components/MovieCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { ExploreGridSkeleton } from '../components/SkeletonLoaders';
import { COLORS, RADII } from '../constants/config';
import { useSettings } from '../context/SettingsContext';
import { deleteWatchedMovieApi, fetchLibraryApi } from '../services/api';
import {
  cancelOfflineDownload,
  extractEpisodeNumberFromName,
  formatBytes,
  loadOfflineDownloads,
  pauseOfflineDownload,
  removeOfflineDownload,
  restartOfflineDownload,
  resumeBackgroundQueueIfNeeded,
  resumeOfflineDownload,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import {
  getLastKnownOnline,
  isNetworkError,
  probeConnectivity,
  reportNetworkFailure,
  startNetworkMonitor,
  subscribeNetworkStatus,
} from '../services/networkService';
import { MovieItem, OfflineDownloadItem } from '../types/models';

const DEFAULT_POSTER_ASSET = require('../../assets/default-poster2.png');

interface OfflinePosterImageProps {
  localUri?: string;
  remoteUri?: string;
  offlineOnlyMode?: boolean;
  style: StyleProp<ImageStyle>;
}

function OfflinePosterImage({
  localUri,
  remoteUri,
  offlineOnlyMode = false,
  style,
}: OfflinePosterImageProps) {
  const initialStage: 'local' | 'remote' | 'fallback' = localUri
    ? 'local'
    : remoteUri && !offlineOnlyMode
      ? 'remote'
      : 'fallback';
  const [stage, setStage] = useState<'local' | 'remote' | 'fallback'>(initialStage);

  useEffect(() => {
    setStage(
      localUri
        ? 'local'
        : remoteUri && !offlineOnlyMode
          ? 'remote'
          : 'fallback'
    );
  }, [localUri, remoteUri, offlineOnlyMode]);

  if (stage === 'local' && localUri) {
    return (
      <Image
        source={{ uri: localUri }}
        style={style}
        resizeMode="cover"
        onError={() => {
          setStage(remoteUri && !offlineOnlyMode ? 'remote' : 'fallback');
        }}
      />
    );
  }
  if (stage === 'remote' && remoteUri && !offlineOnlyMode) {
    return (
      <Image
        source={{ uri: remoteUri }}
        style={style}
        resizeMode="cover"
        onError={() => setStage('fallback')}
      />
    );
  }
  return <Image source={DEFAULT_POSTER_ASSET} style={style} resizeMode="cover" />;
}

interface LibraryScreenProps {
  onOpenPreview: (item: MovieItem) => void;
  onOpenOfflineDetail: (videosId: number) => void;
  onPlayOffline: (item: OfflineDownloadItem, seriesEpisodes?: OfflineDownloadItem[]) => void;
  offlineOnlyMode?: boolean;
  onReconnectOnline?: () => void;
  watchProgressRevision?: number;
}

interface OfflineSeriesGroup {
  kind: 'series';
  videos_id: number;
  title: string;
  localThumb: string;
  remoteThumb: string;
  totalBytes: number;
  completedCount: number;
  episodes: OfflineDownloadItem[];
  resumePct: number;
}

interface OfflineSingleEntry {
  kind: 'single';
  item: OfflineDownloadItem;
}

type OfflineListEntry = OfflineSeriesGroup | OfflineSingleEntry;

export function LibraryScreen({
  onOpenPreview,
  onOpenOfflineDetail,
  onPlayOffline,
  offlineOnlyMode = false,
  onReconnectOnline,
  watchProgressRevision = 0,
}: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const gridCardWidth = Math.floor((portraitWidth - 32 - 20) / 3);

  const [tab, setTab] = useState<'wishlist' | 'watched' | 'offline'>(
    offlineOnlyMode ? 'offline' : 'wishlist'
  );
  const [wishlist, setWishlist] = useState<MovieItem[]>([]);
  const [watched, setWatched] = useState<MovieItem[]>([]);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [loading, setLoading] = useState(!offlineOnlyMode);
  const [refreshing, setRefreshing] = useState(false);
  const [networkRestored, setNetworkRestored] = useState(false);

  const activeTab = offlineOnlyMode ? 'offline' : tab;

  const loadLibrary = useCallback(
    async (isRefresh = false, silent = false) => {
      if (offlineOnlyMode) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (!silent) {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
      }
      try {
        const res = await fetchLibraryApi();
        setWishlist(res.wishlist || []);
        setWatched(res.watched || []);
      } catch (err) {
        if (isNetworkError(err)) {
          void reportNetworkFailure();
        }
      } finally {
        if (!silent) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [offlineOnlyMode]
  );

  useEffect(() => {
    loadLibrary();
    loadOfflineDownloads()
      .then(setOfflineItems)
      .catch(() => setOfflineItems([]));
    return subscribeOfflineDownloads(setOfflineItems);
  }, [loadLibrary]);

  useEffect(() => {
    if (watchProgressRevision > 0 && !offlineOnlyMode) {
      void loadLibrary(false, true);
    }
  }, [watchProgressRevision, offlineOnlyMode, loadLibrary]);

  useEffect(() => {
    if (activeTab === 'offline' && !offlineOnlyMode) {
      void resumeBackgroundQueueIfNeeded(true).catch(() => {});
    }
  }, [activeTab, offlineOnlyMode]);

  useEffect(() => {
    if (!offlineOnlyMode) {
      setNetworkRestored(false);
      return;
    }
    setNetworkRestored(getLastKnownOnline());
    const unsub = subscribeNetworkStatus((online) => {
      setNetworkRestored(online);
    });
    const stopMonitor = startNetworkMonitor(4000);
    void probeConnectivity(2400).then((ok) => setNetworkRestored(ok));
    return () => {
      unsub();
      stopMonitor();
    };
  }, [offlineOnlyMode]);

  const handleRemoveWatched = (item: MovieItem) => {
    Haptics.selectionAsync();
    showAppAlert(
      'Xóa khỏi Đang xem?',
      `Bạn muốn xóa "${item.title_primary || item.title}" khỏi danh sách Đang xem?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteWatchedMovieApi(item.videos_id);
              setWatched((prev) => prev.filter((w) => w.videos_id !== item.videos_id));
            } catch {}
          },
        },
      ]
    );
  };

  const handleDeleteOffline = (item: OfflineDownloadItem) => {
    Haptics.selectionAsync();
    showAppAlert(
      'Xóa phim ngoại tuyến?',
      `Xóa "${item.title}${item.episode_title ? ` - ${item.episode_title}` : ''}" khỏi bộ nhớ máy?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: () => removeOfflineDownload(item.id),
        },
      ]
    );
  };

  const handleDeleteSeriesGroup = (group: OfflineSeriesGroup) => {
    Haptics.selectionAsync();
    showAppAlert(
      'Xóa toàn bộ bộ phim?',
      `Xóa tất cả ${group.episodes.length} tập đã tải của "${group.title}" khỏi bộ nhớ máy?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa tất cả',
          style: 'destructive',
          onPress: async () => {
            for (const ep of group.episodes) {
              await removeOfflineDownload(ep.id);
            }
          },
        },
      ]
    );
  };

  const activeDownloads = useMemo(
    () =>
      offlineItems.filter(
        (i) =>
          i.status === 'downloading' ||
          i.status === 'preparing' ||
          i.status === 'queued'
      ),
    [offlineItems]
  );

  const libraryDisplayItems = useMemo(() => {
    return offlineItems.filter(
      (i) =>
        i.status === 'completed' ||
        i.status === 'paused' ||
        i.status === 'failed'
    );
  }, [offlineItems]);

  const groupedOfflineEntries = useMemo<OfflineListEntry[]>(() => {
    const byVideo = new Map<number, OfflineDownloadItem[]>();
    for (const it of libraryDisplayItems) {
      const list = byVideo.get(it.videos_id) || [];
      list.push(it);
      byVideo.set(it.videos_id, list);
    }

    const result: OfflineListEntry[] = [];
    for (const [vid, eps] of byVideo.entries()) {
      const sorted = [...eps].sort((a, b) => {
        const na = a.episode_number || extractEpisodeNumberFromName(a.episode_title);
        const nb = b.episode_number || extractEpisodeNumberFromName(b.episode_title);
        if (na && nb) return na - nb;
        return a.created_at.localeCompare(b.created_at);
      });
      const isSeriesGroup =
        sorted.length > 1 || sorted.some((e) => Boolean(e.episode_title));
      if (isSeriesGroup) {
        const localItem = sorted.find((s) => Boolean(s.local_poster_uri));
        const remoteItem = sorted.find((s) => Boolean(s.thumbnail_url || s.poster_url));
        const latestWatched = [...sorted]
          .filter((s) => s.duration_sec && s.duration_sec > 0 && s.resume_sec && s.resume_sec > 0)
          .sort((a, b) => (b.resume_updated_at || 0) - (a.resume_updated_at || 0))[0];
        const resumePct =
          latestWatched && latestWatched.duration_sec
            ? Math.min(100, Math.round(((latestWatched.resume_sec || 0) / latestWatched.duration_sec) * 100))
            : 0;
        result.push({
          kind: 'series',
          videos_id: vid,
          title: sorted[0].title,
          localThumb: localItem?.local_poster_uri || '',
          remoteThumb: remoteItem?.thumbnail_url || remoteItem?.poster_url || '',
          totalBytes: sorted.reduce((acc, s) => acc + (s.size_bytes || 0), 0),
          completedCount: sorted.filter((s) => s.status === 'completed').length,
          episodes: sorted,
          resumePct,
        });
      } else {
        result.push({ kind: 'single', item: sorted[0] });
      }
    }
    return result;
  }, [libraryDisplayItems]);

  const totalOfflineBytes = offlineItems.reduce((acc, it) => acc + (it.size_bytes || 0), 0);
  const storageLimitGb = Math.max(10, Math.min(100, settings.offlineStorageLimitGb || 20));
  const storagePct = Math.min(
    100,
    totalOfflineBytes > 0
      ? Math.max(2, Math.round((totalOfflineBytes / (storageLimitGb * 1024 * 1024 * 1024)) * 100))
      : 0
  );

  const renderOfflineGridCard = (entry: OfflineListEntry) => {
    const isSeries = entry.kind === 'series';
    const title = isSeries ? entry.title : entry.item.title;
    const localUri = isSeries ? entry.localThumb : entry.item.local_poster_uri;
    const remoteUri = isSeries
      ? entry.remoteThumb
      : entry.item.thumbnail_url || entry.item.poster_url;
    const totalBytes = isSeries ? entry.totalBytes : entry.item.size_bytes;
    const isCompleted = isSeries ? entry.completedCount > 0 : entry.item.status === 'completed';
    const statusDotColor = isCompleted
      ? '#30D158'
      : !isSeries && entry.item.status === 'paused'
        ? '#FF9F0A'
        : '#FF453A';
    const resumePct = isSeries
      ? entry.resumePct
      : entry.item.duration_sec && entry.item.duration_sec > 0 && entry.item.resume_sec
        ? Math.min(100, Math.round((entry.item.resume_sec / entry.item.duration_sec) * 100))
        : 0;
    const leftBadgeText = isSeries ? `${entry.completedCount}/${entry.episodes.length}` : 'Ngoại tuyến';
    const rightBadgeText = formatBytes(totalBytes);
    const subLabel = isSeries
      ? `${entry.completedCount}/${entry.episodes.length} tập • ${formatBytes(totalBytes)}`
      : entry.item.status === 'completed'
        ? formatBytes(totalBytes)
        : entry.item.status === 'paused'
          ? entry.item.waiting_for_wifi
            ? 'Đang chờ Wi-Fi'
            : `Tạm dừng ${entry.item.progress}%`
          : 'Lỗi tải • Chạm thử lại';

    const handleCardPress = () => {
      Haptics.selectionAsync();
      if (isSeries) {
        onOpenOfflineDetail(entry.videos_id);
        return;
      }
      if (entry.item.status === 'completed') {
        if (entry.item.videos_id > 0) {
          onOpenOfflineDetail(entry.item.videos_id);
        } else {
          onPlayOffline(entry.item);
        }
      } else {
        void restartOfflineDownload(entry.item.id);
      }
    };

    const handleCardDelete = () => {
      if (isSeries) {
        handleDeleteSeriesGroup(entry);
      } else {
        handleDeleteOffline(entry.item);
      }
    };

    return (
      <BouncyButton
        bounciness="gentle"
        activeOpacity={0.86}
        onPress={handleCardPress}
        style={{ width: gridCardWidth, marginBottom: 16 }}
      >
        <View style={[styles.posterCardBox, { height: Math.round(gridCardWidth * 1.48) }]}>
          <OfflinePosterImage
            localUri={localUri}
            remoteUri={remoteUri}
            offlineOnlyMode={offlineOnlyMode}
            style={styles.posterFill}
          />
          <LinearGradient
            colors={['transparent', 'rgba(7,9,15,0.82)']}
            style={styles.posterBottomScrim}
          />

          {/* Top-left availability dot */}
          <View style={styles.posterStatusPill}>
            <View style={[styles.posterStatusDot, { backgroundColor: statusDotColor }]} />
          </View>

          {/* Top-right delete button */}
          <BouncyButton
            onPress={handleCardDelete}
            hitSlop={6}
            style={styles.gridRemoveBtn}
            accessibilityLabel="Xóa khỏi Ngoại tuyến"
          >
            <Ionicons name="close" size={14} color="#FFFFFF" />
          </BouncyButton>

          {/* Bottom split badge matching Dang xem cards */}
          <View style={[styles.floatingSplitBadgesCenter, resumePct > 0 && { bottom: 12 }]}>
            <View style={styles.splitSubHalf}>
              <Text style={styles.splitPillText}>{leftBadgeText}</Text>
            </View>
            <LinearGradient
              colors={['#e50914', '#d50055']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.splitEpHalf}
            >
              <Text style={styles.splitPillText}>{rightBadgeText}</Text>
            </LinearGradient>
          </View>

          {resumePct > 0 ? (
            <View style={styles.posterProgTrack}>
              <LinearGradient
                colors={['#e50914', '#d50055']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.posterProgFill, { width: `${resumePct}%` }]}
              />
            </View>
          ) : null}
        </View>

        <Text style={styles.posterTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.posterSub} numberOfLines={1}>
          {subLabel}
        </Text>
      </BouncyButton>
    );
  };

  const renderOfflineHeader = () => (
    <View style={{ gap: 10, marginBottom: 12 }}>
      {!offlineOnlyMode && activeDownloads.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.queueHeading}>
            Đang tải &amp; Hàng chờ ({activeDownloads.length})
          </Text>
          {activeDownloads.map((dl) => (
            <GlassSurface
              key={dl.id}
              intensity={28}
              radius={RADII.md}
              style={styles.activeDlCard}
            >
              <View style={styles.activeDlTop}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.offlineTitle} numberOfLines={1}>
                    {dl.title}
                    {dl.episode_title ? ` • ${dl.episode_title}` : ''}
                  </Text>
                  <Text style={styles.activeDlSub} numberOfLines={1}>
                    {dl.status_text || `Đang tải ${dl.progress}%`}
                  </Text>
                </View>
                <View style={styles.offlineActions}>
                  <BouncyButton
                    style={styles.actionCircle}
                    onPress={() => {
                      Haptics.selectionAsync();
                      void restartOfflineDownload(dl.id);
                    }}
                    accessibilityLabel="Khởi động lại liên kết tải"
                  >
                    <Feather name="refresh-cw" size={14} color="#93C5FD" />
                  </BouncyButton>
                  {dl.status === 'downloading' ? (
                    <BouncyButton
                      style={styles.actionCircle}
                      onPress={() => pauseOfflineDownload(dl.id)}
                    >
                      <Ionicons name="pause" size={15} color="#FFFFFF" />
                    </BouncyButton>
                  ) : dl.status === 'queued' ? (
                    <BouncyButton
                      style={styles.actionCircle}
                      onPress={() => pauseOfflineDownload(dl.id)}
                    >
                      <Ionicons name="pause" size={15} color="#FFFFFF" />
                    </BouncyButton>
                  ) : (
                    <BouncyButton
                      style={styles.actionCircle}
                      onPress={() => resumeOfflineDownload(dl.id)}
                    >
                      <Ionicons name="play" size={15} color="#FFFFFF" />
                    </BouncyButton>
                  )}
                  <BouncyButton
                    style={styles.actionCircle}
                    onPress={() => cancelOfflineDownload(dl.id)}
                  >
                    <Ionicons name="close" size={16} color="#FCA5A5" />
                  </BouncyButton>
                </View>
              </View>
              <View style={styles.dlTrack}>
                <View
                  style={[
                    styles.dlFillBlue,
                    { width: `${Math.max(4, dl.progress)}%` },
                  ]}
                />
              </View>
            </GlassSurface>
          ))}
        </View>
      ) : null}

      {offlineItems.length > 0 ? (
        <View style={styles.storageSummaryCard}>
          <View style={styles.storageSummaryTop}>
            <Text style={styles.storageInfo}>
              Đã sử dụng {formatBytes(totalOfflineBytes)} / {storageLimitGb} GB
            </Text>
            <Text style={styles.storagePctTxt}>{storagePct}%</Text>
          </View>
          <View style={styles.storageBarTrack}>
            <LinearGradient
              colors={['#32ADE6', '#0A84FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.storageBarFill, { width: `${storagePct}%` }]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>
        {offlineOnlyMode ? 'Kho Phim Ngoại Tuyến' : 'Tủ phim của tôi'}
      </Text>

      {offlineOnlyMode ? (
        <GlassSurface intensity={28} radius={18} style={styles.offlineModeBanner}>
          <View style={styles.offlineBannerLeft}>
            <Ionicons
              name={networkRestored ? 'wifi' : 'cloud-offline-outline'}
              size={18}
              color={networkRestored ? '#34D399' : '#FBBF24'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.offlineBannerTitle}>
                {networkRestored ? 'Đã kết nối lại mạng' : 'Không có kết nối mạng'}
              </Text>
              <Text style={styles.offlineBannerSub}>
                {networkRestored
                  ? 'Kết nối mạng đã sẵn sàng, bấm Kết nối lại để tiếp tục'
                  : 'Chỉ hiển thị các phim & tập đã tải sẵn trên máy'}
              </Text>
            </View>
          </View>
          {onReconnectOnline ? (
            <BouncyButton
              style={[
                styles.reconnectBtn,
                networkRestored && styles.reconnectBtnRestored,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onReconnectOnline();
              }}
            >
              <Ionicons name="refresh" size={14} color="#FFF" />
              <Text style={styles.reconnectTxt}>Kết nối lại</Text>
            </BouncyButton>
          ) : null}
        </GlassSurface>
      ) : (
        <LibrarySegmentBar
          activeTab={activeTab}
          wishlistCount={wishlist.length}
          watchedCount={watched.length}
          offlineCount={offlineItems.length}
          onSelectTab={(nextTab) => setTab(nextTab)}
        />
      )}

      {activeTab === 'offline' ? (
        <FlatList
          key="library-offline-grid-3"
          data={groupedOfflineEntries}
          numColumns={3}
          initialNumToRender={9}
          maxToRenderPerBatch={6}
          windowSize={5}
          keyExtractor={(entry, idx) =>
            entry.kind === 'series'
              ? `series_${entry.videos_id}_${idx}`
              : `${entry.item.id}_${idx}`
          }
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + (offlineOnlyMode ? 32 : 110),
          }}
          ListHeaderComponent={renderOfflineHeader}
          renderItem={({ item: entry }) => renderOfflineGridCard(entry)}
          ListEmptyComponent={
            activeDownloads.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cloud-download-outline" size={44} color={COLORS.muted} />
                <Text style={styles.emptyText}>Chưa có phim nào được tải ngoại tuyến.</Text>
              </View>
            ) : undefined
          }
        />
      ) : (
        <SkeletonCrossfade
          loading={loading}
          backgroundColor="transparent"
          skeleton={
            <View style={{ paddingTop: 14 }}>
              <ExploreGridSkeleton
                cardWidth={gridCardWidth}
                active={loading}
              />
            </View>
          }
        >
          {activeTab === 'wishlist' ? (
            <FlatList
              key="library-wishlist-grid"
              data={wishlist}
              numColumns={3}
              initialNumToRender={9}
              maxToRenderPerBatch={6}
              windowSize={5}
              removeClippedSubviews={false}
              keyExtractor={(item, idx) => `wish_${item.videos_id}_${idx}`}
              columnWrapperStyle={styles.gridRow}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => loadLibrary(true)}
                  tintColor={COLORS.accent}
                />
              }
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: insets.bottom + 110,
              }}
              renderItem={({ item }) => (
                <View style={{ marginBottom: 16 }}>
                  <MovieCard item={item} layout="grid" width={gridCardWidth} onPress={onOpenPreview} />
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Ionicons name="bookmark-outline" size={44} color={COLORS.muted} />
                  <Text style={styles.emptyText}>Danh sách yêu thích đang trống.</Text>
                </View>
              }
            />
          ) : (
            <FlatList
              key="library-watched-grid"
              data={watched}
              numColumns={3}
              initialNumToRender={9}
              maxToRenderPerBatch={6}
              windowSize={5}
              removeClippedSubviews={false}
              keyExtractor={(item, idx) => `watched_${item.videos_id}_${idx}`}
              columnWrapperStyle={styles.gridRow}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => loadLibrary(true)}
                  tintColor={COLORS.accent}
                />
              }
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: insets.bottom + 110,
              }}
              renderItem={({ item }) => (
                <View style={{ marginBottom: 16 }}>
                  <MovieCard
                    item={item}
                    layout="grid"
                    width={gridCardWidth}
                    onPress={onOpenPreview}
                    onRemoveWatched={handleRemoveWatched}
                  />
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Ionicons name="time-outline" size={44} color={COLORS.muted} />
                  <Text style={styles.emptyText}>Bạn chưa có lịch sử phim đang xem.</Text>
                </View>
              }
            />
          )}
        </SkeletonCrossfade>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  offlineModeBanner: {
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  offlineBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  offlineBannerTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  offlineBannerSub: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: 1,
  },
  reconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  reconnectBtnRestored: {
    backgroundColor: '#10B981',
  },
  reconnectTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  segmentWrap: {
    marginHorizontal: 16,
    flexDirection: 'row',
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 14,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: COLORS.accent,
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridRow: {
    gap: 10,
  },
  emptyBox: {
    alignItems: 'center',
    marginTop: 64,
    gap: 10,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 14,
    textAlign: 'center',
  },
  storageSummaryCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
    gap: 6,
  },
  storageSummaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  storageInfo: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    fontWeight: '600',
  },
  storagePctTxt: {
    color: '#93C5FD',
    fontSize: 11.5,
    fontWeight: '700',
  },
  storageBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  storageBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  posterCardBox: {
    width: '100%',
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.cardPlaceholder,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    position: 'relative',
    marginBottom: 8,
  },
  posterFill: {
    width: '100%',
    height: '100%',
  },
  posterBottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
  },
  posterStatusPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  posterStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  gridRemoveBtn: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  floatingSplitBadgesCenter: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    flexDirection: 'row',
    borderRadius: 99,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.68)',
    borderWidth: 0.75,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  splitSubHalf: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  splitEpHalf: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    justifyContent: 'center',
  },
  splitPillText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  posterProgTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3.5,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  posterProgFill: {
    height: '100%',
  },
  posterTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  posterSub: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: 2,
  },
  queueHeading: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  seriesBackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  seriesBackTitle: {
    flex: 1,
    color: '#FFF',
    fontSize: 15.5,
    fontWeight: '700',
  },
  activeDlCard: {
    padding: 12,
    gap: 6,
  },
  activeDlTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeDlSub: {
    color: '#5AC8FA',
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
  offlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    marginBottom: 12,
  },
  offlineThumb: {
    width: 54,
    height: 76,
    borderRadius: 10,
    backgroundColor: COLORS.cardPlaceholder,
  },
  titleFormatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  offlineTitle: {
    flexShrink: 1,
    color: '#FFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  offlineSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  offlineMeta: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
  },
  dlTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginTop: 6,
    overflow: 'hidden',
  },
  dlFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  dlFillBlue: {
    height: '100%',
    backgroundColor: '#5AC8FA',
  },
  offlineActions: {
    flexDirection: 'row',
    gap: 6,
  },
  playCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
