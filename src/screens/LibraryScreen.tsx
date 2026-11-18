import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../components/GlassSurface';
import { MovieCard } from '../components/MovieCard';
import { COLORS, RADII } from '../constants/config';
import { deleteWatchedMovieApi, fetchLibraryApi } from '../services/api';
import {
  exportOfflineToFiles,
  formatBytes,
  loadOfflineDownloads,
  removeOfflineDownload,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import { MovieItem, OfflineDownloadItem } from '../types/models';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_CARD_WIDTH = Math.floor((SCREEN_WIDTH - 32 - 20) / 3);

interface LibraryScreenProps {
  onOpenPreview: (item: MovieItem) => void;
  onPlayOffline: (item: OfflineDownloadItem) => void;
}

export function LibraryScreen({ onOpenPreview, onPlayOffline }: LibraryScreenProps) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'wishlist' | 'watched' | 'offline'>('wishlist');
  const [wishlist, setWishlist] = useState<MovieItem[]>([]);
  const [watched, setWatched] = useState<MovieItem[]>([]);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadLibrary = useCallback(async (isRefresh = false) => {
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
  }, []);

  useEffect(() => {
    loadLibrary();
    loadOfflineDownloads().then(setOfflineItems);
    const unsub = subscribeOfflineDownloads(setOfflineItems);
    return unsub;
  }, [loadLibrary]);

  const handleRemoveWatched = async (item: MovieItem) => {
    try {
      await deleteWatchedMovieApi(item.videos_id);
      setWatched((prev) => prev.filter((w) => w.videos_id !== item.videos_id));
    } catch {}
  };

  const handleDeleteOffline = (item: OfflineDownloadItem) => {
    Alert.alert('Xóa phim Offline?', `Xóa "${item.title}" khỏi bộ nhớ máy?`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: () => removeOfflineDownload(item.id),
      },
    ]);
  };

  const totalOfflineBytes = offlineItems.reduce((acc, it) => acc + (it.size_bytes || 0), 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>Tủ phim của tôi</Text>

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
            style={[styles.segmentBtn, tab === seg.key && styles.segmentBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setTab(seg.key);
            }}
          >
            <Text style={[styles.segmentText, tab === seg.key && styles.segmentTextActive]}>
              {seg.label}
            </Text>
          </TouchableOpacity>
        ))}
      </GlassSurface>

      {tab === 'offline' ? (
        <FlatList
          data={offlineItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 110,
          }}
          ListHeaderComponent={
            offlineItems.length > 0 ? (
              <Text style={styles.storageInfo}>
                Đã sử dụng {formatBytes(totalOfflineBytes)} bộ nhớ trong ứng dụng
              </Text>
            ) : undefined
          }
          renderItem={({ item }) => (
            <GlassSurface intensity={42} radius={RADII.md} style={styles.offlineCard}>
              <Image
                source={{ uri: item.thumbnail_url || item.poster_url }}
                style={styles.offlineThumb}
                resizeMode="cover"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.offlineTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.episode_title ? (
                  <Text style={styles.offlineSub} numberOfLines={1}>
                    {item.episode_title}
                  </Text>
                ) : null}
                <Text style={styles.offlineMeta}>
                  {item.status === 'downloading'
                    ? `Đang tải ${item.progress}% (${formatBytes(item.size_bytes)})`
                    : item.status === 'completed'
                    ? `Sẵn sàng Offline • ${formatBytes(item.size_bytes)}`
                    : 'Tải thất bại'}
                </Text>
                {item.status === 'downloading' ? (
                  <View style={styles.dlTrack}>
                    <View style={[styles.dlFill, { width: `${item.progress}%` }]} />
                  </View>
                ) : null}
              </View>
              <View style={styles.offlineActions}>
                {item.status === 'completed' ? (
                  <>
                    <TouchableOpacity
                      style={styles.playCircle}
                      onPress={() => onPlayOffline(item)}
                    >
                      <Ionicons name="play" size={16} color="#FFF" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionCircle}
                      onPress={() => exportOfflineToFiles(item.local_uri).catch(() => {})}
                    >
                      <Ionicons name="share-outline" size={16} color="#FFF" />
                    </TouchableOpacity>
                  </>
                ) : null}
                <TouchableOpacity
                  style={styles.actionCircle}
                  onPress={() => handleDeleteOffline(item)}
                >
                  <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
                </TouchableOpacity>
              </View>
            </GlassSurface>
          )}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="cloud-download-outline" size={44} color={COLORS.muted} />
              <Text style={styles.emptyText}>Chưa có phim nào được tải Offline.</Text>
            </View>
          }
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      ) : tab === 'wishlist' ? (
        <FlatList
          data={wishlist}
          numColumns={3}
          keyExtractor={(item) => String(item.videos_id)}
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
              <MovieCard item={item} layout="vertical" width={GRID_CARD_WIDTH} onPress={onOpenPreview} />
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
          data={watched}
          keyExtractor={(item) => String(item.videos_id)}
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
                width={SCREEN_WIDTH - 32}
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
    backgroundColor: COLORS.bg,
  },
  title: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 12,
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
    marginBottom: 10,
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
  offlineTitle: {
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
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
