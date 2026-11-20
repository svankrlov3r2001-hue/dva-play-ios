import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../components/GlassSurface';
import { LazyImage } from '../components/LazyImage';
import { MovieCard } from '../components/MovieCard';
import { COLORS, RADII } from '../constants/config';
import { deleteWatchedMovieApi, fetchLibraryApi } from '../services/api';
import {
  cancelOfflineDownload,
  exportOfflineToFiles,
  extractEpisodeNumberFromName,
  formatBytes,
  loadOfflineDownloads,
  pauseOfflineDownload,
  removeOfflineDownload,
  resumeOfflineDownload,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import { MovieItem, OfflineDownloadItem } from '../types/models';

interface LibraryScreenProps {
  onOpenPreview: (item: MovieItem) => void;
  onPlayOffline: (item: OfflineDownloadItem, seriesEpisodes?: OfflineDownloadItem[]) => void;
  offlineOnlyMode?: boolean;
  onReconnectOnline?: () => void;
}

interface OfflineSeriesGroup {
  kind: 'series';
  videos_id: number;
  title: string;
  thumb: string;
  totalBytes: number;
  completedCount: number;
  episodes: OfflineDownloadItem[];
}

interface OfflineSingleEntry {
  kind: 'single';
  item: OfflineDownloadItem;
}

type OfflineListEntry = OfflineSeriesGroup | OfflineSingleEntry;

export function LibraryScreen({
  onOpenPreview,
  onPlayOffline,
  offlineOnlyMode = false,
  onReconnectOnline,
}: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const gridCardWidth = Math.floor((portraitWidth - 32 - 20) / 3);

  const [tab, setTab] = useState<'wishlist' | 'watched' | 'offline'>(
    offlineOnlyMode ? 'offline' : 'wishlist'
  );
  const [wishlist, setWishlist] = useState<MovieItem[]>([]);
  const [watched, setWatched] = useState<MovieItem[]>([]);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [openedSeriesId, setOpenedSeriesId] = useState<number | null>(null);
  const [loading, setLoading] = useState(!offlineOnlyMode);
  const [refreshing, setRefreshing] = useState(false);

  const activeTab = offlineOnlyMode ? 'offline' : tab;

  const loadLibrary = useCallback(
    async (isRefresh = false) => {
      if (offlineOnlyMode) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetchLibraryApi();
        setWishlist(res.wishlist || []);
        setWatched(res.watched || []);
      } catch {
      } finally {
        setLoading(false);
        setRefreshing(false);
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

  const handleRemoveWatched = (item: MovieItem) => {
    Haptics.selectionAsync();
    Alert.alert(
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
    Alert.alert('Xóa phim Offline?', `Xóa "${item.title}${item.episode_title ? ` - ${item.episode_title}` : ''}" khỏi bộ nhớ máy?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: () => removeOfflineDownload(item.id),
      },
    ]);
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
        const firstThumb =
          sorted.find((s) => s.local_poster_uri || s.thumbnail_url || s.poster_url);
        result.push({
          kind: 'series',
          videos_id: vid,
          title: sorted[0].title,
          thumb:
            firstThumb?.local_poster_uri ||
            firstThumb?.thumbnail_url ||
            firstThumb?.poster_url ||
            '',
          totalBytes: sorted.reduce((acc, s) => acc + (s.size_bytes || 0), 0),
          completedCount: sorted.filter((s) => s.status === 'completed').length,
          episodes: sorted,
        });
      } else {
        result.push({ kind: 'single', item: sorted[0] });
      }
    }
    return result;
  }, [libraryDisplayItems]);

  const openedSeriesGroup = useMemo(
    () =>
      openedSeriesId !== null
        ? (groupedOfflineEntries.find(
            (e) => e.kind === 'series' && e.videos_id === openedSeriesId
          ) as OfflineSeriesGroup | undefined) || null
        : null,
    [groupedOfflineEntries, openedSeriesId]
  );

  const totalOfflineBytes = offlineItems.reduce((acc, it) => acc + (it.size_bytes || 0), 0);

  const renderThumb = (item: OfflineDownloadItem) => {
    if (item.local_poster_uri) {
      return (
        <Image
          source={{ uri: item.local_poster_uri }}
          style={styles.offlineThumb}
          resizeMode="cover"
        />
      );
    }
    if (offlineOnlyMode) {
      return (
        <View style={[styles.offlineThumb, styles.offlineThumbFallback]}>
          <Ionicons name="film-outline" size={22} color={COLORS.muted} />
        </View>
      );
    }
    return (
      <LazyImage
        uri={item.thumbnail_url || item.poster_url}
        style={styles.offlineThumb}
        resizeMode="cover"
      />
    );
  };

  const renderOfflineCard = (
    item: OfflineDownloadItem,
    seriesList?: OfflineDownloadItem[]
  ) => {
    const resumePct =
      item.duration_sec && item.duration_sec > 0 && item.resume_sec
        ? Math.min(100, Math.round((item.resume_sec / item.duration_sec) * 100))
        : 0;
    const isHls =
      item.media_format === 'hls' || item.local_uri.toLowerCase().includes('.m3u8');
    const playableGroup = seriesList
      ? seriesList.filter((e) => e.status === 'completed')
      : undefined;

    return (
      <GlassSurface intensity={42} radius={RADII.md} style={styles.offlineCard}>
        {renderThumb(item)}
        <View style={{ flex: 1 }}>
          <View style={styles.titleFormatRow}>
            <Text style={styles.offlineTitle} numberOfLines={1}>
              {item.episode_title && seriesList ? item.episode_title : item.title}
            </Text>
            {item.status === 'completed' ? (
              <View style={styles.fmtBadge}>
                <Text style={styles.fmtBadgeTxt}>{isHls ? 'HLS' : 'MP4'}</Text>
              </View>
            ) : null}
          </View>
          {item.episode_title && !seriesList ? (
            <Text style={styles.offlineSub} numberOfLines={1}>
              {item.episode_title}
            </Text>
          ) : null}
          <Text style={styles.offlineMeta} numberOfLines={1}>
            {item.status === 'completed'
              ? `Sẵn sàng ngoại tuyến • ${formatBytes(item.size_bytes)}`
              : item.status === 'paused'
                ? `Tạm dừng ${item.progress}% • ${formatBytes(item.size_bytes)}`
                : item.error_message || 'Tải thất bại'}
          </Text>
          {item.status === 'completed' && resumePct > 0 ? (
            <View style={styles.dlTrack}>
              <View style={[styles.dlFill, { width: `${resumePct}%` }]} />
            </View>
          ) : null}
        </View>
        <View style={styles.offlineActions}>
          {item.status === 'completed' ? (
            <>
              <TouchableOpacity
                style={styles.playCircle}
                onPress={() => onPlayOffline(item, playableGroup)}
              >
                <Ionicons name="play" size={16} color="#FFF" />
              </TouchableOpacity>
              {!isHls ? (
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={() =>
                    exportOfflineToFiles(item.local_uri).catch((err) => {
                      Alert.alert('Thông báo', err?.message || 'Không thể chia sẻ tệp.');
                    })
                  }
                >
                  <Ionicons name="share-outline" size={16} color="#FFF" />
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <TouchableOpacity
              style={styles.actionCircle}
              onPress={() => resumeOfflineDownload(item.id)}
            >
              <Ionicons name="refresh" size={16} color="#5AC8FA" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.actionCircle}
            onPress={() => handleDeleteOffline(item)}
          >
            <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
          </TouchableOpacity>
        </View>
      </GlassSurface>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>
        {offlineOnlyMode ? 'Kho Phim Ngoại Tuyến' : 'Tủ phim của tôi'}
      </Text>

      {offlineOnlyMode ? (
        <GlassSurface intensity={48} radius={18} style={styles.offlineModeBanner}>
          <View style={styles.offlineBannerLeft}>
            <Ionicons name="cloud-offline-outline" size={18} color="#FBBF24" />
            <View style={{ flex: 1 }}>
              <Text style={styles.offlineBannerTitle}>Không có kết nối mạng</Text>
              <Text style={styles.offlineBannerSub}>
                Chỉ hiển thị các phim &amp; tập đã tải sẵn trên máy
              </Text>
            </View>
          </View>
          {onReconnectOnline ? (
            <TouchableOpacity
              style={styles.reconnectBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onReconnectOnline();
              }}
            >
              <Ionicons name="refresh" size={14} color="#FFF" />
              <Text style={styles.reconnectTxt}>Kết nối lại</Text>
            </TouchableOpacity>
          ) : null}
        </GlassSurface>
      ) : (
        <GlassSurface intensity={52} radius={18} style={styles.segmentWrap}>
          {(
            [
              { key: 'wishlist', label: `Yêu thích (${wishlist.length})` },
              { key: 'watched', label: `Đang xem (${watched.length})` },
              { key: 'offline', label: `Offline (${offlineItems.length})` },
            ] as const
          ).map((seg) => (
            <TouchableOpacity
              key={seg.key}
              style={[styles.segmentBtn, activeTab === seg.key && styles.segmentBtnActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setOpenedSeriesId(null);
                setTab(seg.key);
              }}
            >
              <Text style={[styles.segmentText, activeTab === seg.key && styles.segmentTextActive]}>
                {seg.label}
              </Text>
            </TouchableOpacity>
          ))}
        </GlassSurface>
      )}

      {activeTab === 'offline' ? (
        <FlatList
          key={`library-offline-${openedSeriesGroup ? openedSeriesGroup.videos_id : 'root'}`}
          data={
            openedSeriesGroup
              ? openedSeriesGroup.episodes.map((ep) => ({
                  kind: 'single' as const,
                  item: ep,
                }))
              : groupedOfflineEntries
          }
          keyExtractor={(entry, idx) =>
            entry.kind === 'series'
              ? `series_${entry.videos_id}_${idx}`
              : `${entry.item.id}_${idx}`
          }
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + (offlineOnlyMode ? 32 : 110),
          }}
          ListHeaderComponent={
            <View style={{ gap: 10, marginBottom: 10 }}>
              {openedSeriesGroup ? (
                <TouchableOpacity
                  style={styles.seriesBackHeader}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setOpenedSeriesId(null);
                  }}
                >
                  <Ionicons name="arrow-back" size={18} color="#FFF" />
                  <Text style={styles.seriesBackTitle} numberOfLines={1}>
                    {openedSeriesGroup.title} ({openedSeriesGroup.episodes.length} tập)
                  </Text>
                </TouchableOpacity>
              ) : null}

              {!offlineOnlyMode && activeDownloads.length > 0 ? (
                <View style={{ gap: 8 }}>
                  <Text style={styles.queueHeading}>
                    Đang tải &amp; Hàng chờ ({activeDownloads.length})
                  </Text>
                  {activeDownloads.map((dl) => (
                    <GlassSurface
                      key={dl.id}
                      intensity={48}
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
                          {dl.status === 'downloading' ? (
                            <TouchableOpacity
                              style={styles.actionCircle}
                              onPress={() => pauseOfflineDownload(dl.id)}
                            >
                              <Ionicons name="pause" size={15} color="#FFF" />
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            style={styles.actionCircle}
                            onPress={() => cancelOfflineDownload(dl.id)}
                          >
                            <Ionicons name="close" size={16} color="#FCA5A5" />
                          </TouchableOpacity>
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
                <Text style={styles.storageInfo}>
                  Đã sử dụng {formatBytes(totalOfflineBytes)} bộ nhớ trong ứng dụng
                </Text>
              ) : null}
            </View>
          }
          renderItem={({ item: entry }) => {
            if (entry.kind === 'series') {
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setOpenedSeriesId(entry.videos_id);
                  }}
                >
                  <GlassSurface intensity={42} radius={RADII.md} style={styles.offlineCard}>
                    {entry.thumb && !offlineOnlyMode ? (
                      <LazyImage
                        uri={entry.thumb}
                        style={styles.offlineThumb}
                        resizeMode="cover"
                      />
                    ) : entry.thumb && entry.thumb.startsWith('file://') ? (
                      <Image
                        source={{ uri: entry.thumb }}
                        style={styles.offlineThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.offlineThumb, styles.offlineThumbFallback]}>
                        <Ionicons name="albums-outline" size={22} color={COLORS.muted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.offlineTitle} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <Text style={styles.offlineMeta}>
                        {entry.completedCount}/{entry.episodes.length} tập •{' '}
                        {formatBytes(entry.totalBytes)}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                  </GlassSurface>
                </TouchableOpacity>
              );
            }
            return renderOfflineCard(
              entry.item,
              openedSeriesGroup?.episodes
            );
          }}
          ListEmptyComponent={
            activeDownloads.length === 0 ? (
              <View style={styles.emptyBox}>
                <Ionicons name="cloud-download-outline" size={44} color={COLORS.muted} />
                <Text style={styles.emptyText}>Chưa có phim nào được tải Offline.</Text>
              </View>
            ) : undefined
          }
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      ) : activeTab === 'wishlist' ? (
        <FlatList
          key="library-wishlist-grid"
          data={wishlist}
          numColumns={3}
          initialNumToRender={9}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews
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
          key="library-watched-list"
          data={watched}
          keyExtractor={(item, idx) => `watched_${item.videos_id}_${idx}`}
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
                layout="watched"
                width={portraitWidth - 32}
                fullWidth
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
  storageInfo: {
    color: COLORS.muted,
    fontSize: 12.5,
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
  offlineThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
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
  fmtBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  fmtBadgeTxt: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
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
