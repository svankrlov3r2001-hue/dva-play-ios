import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { GlassSurface } from '../components/GlassSurface';
import { MovieCard } from '../components/MovieCard';
import { OfflineDownloadSheet } from '../components/OfflineDownloadSheet';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { MovieDetailSkeleton } from '../components/SkeletonLoaders';
import { COLORS, RADII } from '../constants/config';
import {
  fetchMovieDetailsApi,
  toggleWishlistApi,
} from '../services/api';
import {
  loadOfflineDownloads,
  subscribeOfflineDownloads,
  syncOnlineProgressToOffline,
} from '../services/downloadService';
import {
  EpisodeItem,
  MovieDetail,
  MovieItem,
  OfflineDownloadItem,
  SourceItem,
} from '../types/models';

interface MovieDetailScreenProps {
  visible: boolean;
  videosId: number | null;
  onClose: () => void;
  onPlay: (params: {
    videosId: number;
    streamCode: string;
    episodeId?: number;
    episodeNumber?: number;
    seasonId?: string;
    title: string;
    episodeTitle?: string;
    episodes?: EpisodeItem[];
  }) => void;
  onOpenCastWithMovie: (params: {
    videosId: number;
    streamCode: string;
    title: string;
  }) => void;
  onSelectRelated: (videosId: number) => void;
  obscuredByPlayer?: boolean;
}

export function MovieDetailScreen({
  visible,
  videosId,
  onClose,
  onPlay,
  onOpenCastWithMovie,
  onSelectRelated,
  obscuredByPlayer = false,
}: MovieDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [related, setRelated] = useState<MovieItem[]>([]);
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<'episodes' | 'cast' | 'related'>('episodes');
  const [inWishlist, setInWishlist] = useState(false);
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [offlineSheetOpen, setOfflineSheetOpen] = useState(false);
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      enterAnim.setValue(0);
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      enterAnim.stopAnimation();
      enterAnim.setValue(0);
    }
  }, [visible, enterAnim]);

  const loadDetails = useCallback(async (id: number) => {
    setLoading(true);
    setMovie(null);
    setSelectedSeasonIdx(0);
    setActiveTab('episodes');
    try {
      const res = await fetchMovieDetailsApi(id);
      setMovie(res.movie);
      setRelated(res.related || []);
      setInWishlist(Boolean(res.movie?.in_wishlist));
      if (
        res.movie?.watch_history?.resume_seconds > 2 &&
        res.movie.watch_history.last_stream_code
      ) {
        void syncOnlineProgressToOffline({
          streamCode: res.movie.watch_history.last_stream_code,
          videosId: res.movie.videos_id,
          episodeId: res.movie.watch_history.last_episode_id,
          positionSec: res.movie.watch_history.resume_seconds,
          flushDisk: true,
        });
      }
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message || 'Không thể tải chi tiết phim.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOfflineDownloads().then(setOfflineItems);
    return subscribeOfflineDownloads(setOfflineItems);
  }, []);

  useEffect(() => {
    if (visible && videosId) {
      loadDetails(videosId);
    } else if (!visible) {
      setMovie(null);
    }
  }, [visible, videosId, loadDetails]);

  const handleWishlist = async () => {
    if (!movie) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await toggleWishlistApi(movie.videos_id);
      setInWishlist(res.in_wishlist);
    } catch {}
  };

  const currentSeason = movie?.seasons?.[selectedSeasonIdx];
  const seasonEpisodes = currentSeason?.episodes || movie?.episodes || [];

  const handleOpenOfflineSheet = () => {
    if (!movie) return;
    Haptics.selectionAsync();
    setOfflineSheetOpen(true);
  };

  const handlePlayPrimary = () => {
    if (!movie) return;
    const hist = movie.watch_history;
    const targetCode = hist?.last_stream_code || movie.stream_code;
    const targetEpId = hist?.last_episode_id || movie.episodes?.[0]?.episodes_id || 0;
    const matchedEpIdx = movie.episodes.findIndex((e) => e.stream_code === targetCode);

    onPlay({
      videosId: movie.videos_id,
      streamCode: targetCode,
      episodeId: targetEpId,
      episodeNumber: matchedEpIdx >= 0 ? matchedEpIdx + 1 : 1,
      seasonId: currentSeason ? String(currentSeason.seasons_id) : '',
      title: movie.title,
      episodeTitle: matchedEpIdx >= 0 ? movie.episodes[matchedEpIdx].episodes_name : undefined,
      episodes: movie.episodes,
    });
  };

  const offlineStatusForMovie = offlineItems.find(
    (o) => movie && o.videos_id === movie.videos_id
  );

  const castGroups = movie
    ? [
        { title: 'Diễn viên', items: movie.star_list || [] },
        { title: 'Đạo diễn', items: movie.director_list || [] },
        { title: 'Biên kịch', items: movie.writer_list || [] },
      ].filter((g) => g.items.length > 0)
    : [];

  if (!visible) {
    return null;
  }

  const translateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [48, 0],
  });

  return (
    <Animated.View
      style={[
        styles.overlayRoot,
        { opacity: enterAnim, transform: [{ translateY }] },
      ]}
    >
      <AmbientAppBackground />
      <View style={styles.container}>
        <SkeletonCrossfade
          loading={loading || !movie}
          backgroundColor="transparent"
          skeleton={
            <View style={{ flex: 1 }}>
              <MovieDetailSkeleton topInset={insets.top} active={visible && (loading || !movie)} />
              <TouchableOpacity
                onPress={onClose}
                style={[styles.floatingBack, { top: insets.top + 10, zIndex: 20 }]}
              >
                <Ionicons name="arrow-back" size={22} color="#FFF" />
              </TouchableOpacity>
            </View>
          }
        >
          {movie ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
          >
            {/* Backdrop Banner */}
            <View style={styles.heroBox}>
              <Image
                source={{ uri: movie.poster_url || movie.thumbnail_url }}
                style={styles.heroImg}
                resizeMode="cover"
              />
              <LinearGradient
                colors={['rgba(7,9,15,0.45)', 'rgba(7,9,15,0.2)', 'rgba(10,11,18,0.88)']}
                locations={[0, 0.4, 1]}
                style={StyleSheet.absoluteFill}
              />

              <View style={[styles.topBar, { top: insets.top + 8 }]}>
                <TouchableOpacity style={styles.roundGlassBtn} onPress={onClose}>
                  <Ionicons name="arrow-back" size={21} color="#FFF" />
                </TouchableOpacity>
              </View>

              <View style={styles.posterSummary}>
                <Image
                  source={{ uri: movie.thumbnail_url || movie.poster_url }}
                  style={styles.miniPoster}
                  resizeMode="cover"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.movieTitle}>{movie.title}</Text>
                  <View style={styles.badgeRow}>
                    {movie.imdb_rating ? (
                      <View style={styles.imdbPill}>
                        <Ionicons name="star" size={12} color={COLORS.accentGold} />
                        <Text style={styles.imdbText}>{movie.imdb_rating}</Text>
                      </View>
                    ) : null}
                    {movie.year ? <Text style={styles.metaSmall}>{movie.year}</Text> : null}
                    {movie.runtime ? <Text style={styles.metaSmall}>{movie.runtime}</Text> : null}
                    <View style={styles.qualPill}>
                      <Text style={styles.qualText}>{movie.video_quality || 'HD'}</Text>
                    </View>
                  </View>
                  {movie.genres.length > 0 ? (
                    <Text style={styles.genreLine} numberOfLines={2}>
                      {movie.genres.map((g) => g.name).join(' • ')}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Watch Progress */}
            {movie.watch_history && movie.watch_history.progress_percent > 0 ? (
              <View style={styles.progressBox}>
                <View style={styles.progressRow}>
                  <Text style={styles.progressTxt}>
                    {movie.watch_history.viewed_information}
                  </Text>
                  <Text style={styles.progressRemain}>
                    {movie.watch_history.time_remaining || `${movie.watch_history.progress_percent}%`}
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${movie.watch_history.progress_percent}%` },
                    ]}
                  />
                </View>
              </View>
            ) : null}

            {/* Primary Actions */}
            <View style={styles.actionsSection}>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.playBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  handlePlayPrimary();
                }}
              >
                <Ionicons name="play" size={20} color="#FFF" />
                <Text style={styles.playBtnText}>
                  {movie.watch_history?.viewed_information || 'Xem ngay'}
                </Text>
              </TouchableOpacity>

              <View style={styles.quickActionRow}>
                <TouchableOpacity style={styles.quickBtn} onPress={handleWishlist}>
                  <Ionicons
                    name={inWishlist ? 'bookmark' : 'bookmark-outline'}
                    size={21}
                    color={inWishlist ? COLORS.accent : '#FFF'}
                  />
                  <Text style={styles.quickBtnLabel}>
                    {inWishlist ? 'Đã lưu' : 'Yêu thích'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={handleOpenOfflineSheet}
                >
                  <Ionicons
                    name={
                      offlineStatusForMovie?.status === 'completed'
                        ? 'checkmark-circle'
                        : offlineStatusForMovie?.status === 'downloading' ||
                            offlineStatusForMovie?.status === 'preparing' ||
                            offlineStatusForMovie?.status === 'queued'
                          ? 'cloud-download'
                          : 'cloud-download-outline'
                    }
                    size={21}
                    color={
                      offlineStatusForMovie?.status === 'completed'
                        ? COLORS.success
                        : offlineStatusForMovie?.status === 'downloading'
                          ? '#5AC8FA'
                          : '#FFF'
                    }
                  />
                  <Text style={styles.quickBtnLabel}>
                    {offlineStatusForMovie?.status === 'downloading' ||
                    offlineStatusForMovie?.status === 'preparing'
                      ? `${offlineStatusForMovie.progress}%`
                      : offlineStatusForMovie?.status === 'queued'
                        ? 'Chờ tải'
                        : offlineStatusForMovie?.status === 'completed'
                          ? 'Đã tải'
                          : 'Tải ngoại tuyến'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.quickBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onOpenCastWithMovie({
                      videosId: movie.videos_id,
                      streamCode: movie.stream_code,
                      title: movie.title,
                    });
                  }}
                >
                  <Ionicons name="tv-outline" size={21} color="#FFF" />
                  <Text style={styles.quickBtnLabel}>DVA Cast</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Detail Tabs */}
            <View style={styles.tabsRow}>
              {(
                [
                  {
                    key: 'episodes',
                    label: movie.is_tvseries === 1 ? 'Tập phim & Nội dung' : 'Nội dung & Server',
                  },
                  { key: 'cast', label: 'Diễn viên' },
                  { key: 'related', label: 'Liên quan' },
                ] as const
              ).map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.tabPill, activeTab === t.key && styles.tabPillActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setActiveTab(t.key);
                  }}
                >
                  <Text style={[styles.tabTxt, activeTab === t.key && styles.tabTxtActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {activeTab === 'episodes' ? (
              <View style={styles.tabBody}>
                <Text style={styles.descText}>
                  {movie.description || 'Chưa có mô tả cho bộ phim này.'}
                </Text>

                {movie.is_tvseries === 1 && movie.seasons.length > 0 ? (
                  <View style={styles.episodesWrap}>
                    {movie.seasons.length > 1 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.seasonRow}
                      >
                        {movie.seasons.map((s, idx) => (
                          <TouchableOpacity
                            key={s.seasons_id}
                            style={[
                              styles.seasonChip,
                              selectedSeasonIdx === idx && styles.seasonChipActive,
                            ]}
                            onPress={() => setSelectedSeasonIdx(idx)}
                          >
                            <Text
                              style={[
                                styles.seasonTxt,
                                selectedSeasonIdx === idx && styles.seasonTxtActive,
                              ]}
                            >
                              {s.seasons_name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    ) : null}

                    <Text style={styles.subHeading}>
                      Danh sách tập ({seasonEpisodes.length})
                    </Text>
                    <View style={styles.epGrid}>
                      {seasonEpisodes.map((ep, idx) => {
                        const isActive = movie.watch_history?.last_stream_code === ep.stream_code;
                        return (
                          <TouchableOpacity
                            key={ep.episodes_id}
                            style={[styles.epBtn, isActive && styles.epBtnActive]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              onPlay({
                                videosId: movie.videos_id,
                                streamCode: ep.stream_code,
                                episodeId: ep.episodes_id,
                                episodeNumber: idx + 1,
                                seasonId: String(ep.seasons_id),
                                title: movie.title,
                                episodeTitle: ep.episodes_name,
                                episodes: movie.episodes,
                              });
                            }}
                          >
                            <Text style={[styles.epTxt, isActive && { color: '#FFF' }]} numberOfLines={1}>
                              {ep.episodes_name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ) : movie.sources.length > 0 ? (
                  <View style={styles.episodesWrap}>
                    <Text style={styles.subHeading}>Chọn máy chủ phát</Text>
                    <View style={styles.epGrid}>
                      {movie.sources.map((src: SourceItem) => (
                        <TouchableOpacity
                          key={src.video_file_id}
                          style={styles.epBtn}
                          onPress={() => {
                            Haptics.selectionAsync();
                            onPlay({
                              videosId: movie.videos_id,
                              streamCode: src.stream_code,
                              title: movie.title,
                            });
                          }}
                        >
                          <Text style={styles.epTxt} numberOfLines={1}>
                            {src.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}

            {activeTab === 'cast' ? (
              <View style={styles.tabBody}>
                {castGroups.length === 0 ? (
                  <Text style={styles.emptySmall}>Chưa có thông tin diễn viên / đạo diễn.</Text>
                ) : (
                  castGroups.map((grp) => (
                    <View key={grp.title} style={{ marginBottom: 18 }}>
                      <Text style={styles.subHeading}>{grp.title}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {grp.items.map((star, idx) => (
                          <GlassSurface
                            key={`${grp.title}_${star.id}_${idx}`}
                            intensity={38}
                            radius={18}
                            style={styles.starCard}
                          >
                            <Image
                              source={{ uri: star.image_url }}
                              style={styles.starAvatar}
                              resizeMode="cover"
                            />
                            <Text style={styles.starName} numberOfLines={2}>
                              {star.name}
                            </Text>
                            <Text style={styles.starRole}>{grp.title}</Text>
                          </GlassSurface>
                        ))}
                      </ScrollView>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            {activeTab === 'related' ? (
              <View style={styles.tabBody}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {related.map((rel) => (
                    <MovieCard
                      key={rel.videos_id}
                      item={rel}
                      layout="vertical"
                      onPress={(it) => onSelectRelated(it.videos_id)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </ScrollView>
          ) : null}
        </SkeletonCrossfade>
        {obscuredByPlayer ? <View style={styles.playerLaunchVeil} /> : null}
        {movie ? (
          <OfflineDownloadSheet
            visible={offlineSheetOpen}
            onClose={() => setOfflineSheetOpen(false)}
            videosId={movie.videos_id}
            title={movie.title}
            posterUrl={movie.poster_url}
            thumbnailUrl={movie.thumbnail_url}
            currentStreamCode={
              movie.watch_history?.last_stream_code ||
              seasonEpisodes[0]?.stream_code ||
              movie.stream_code
            }
            currentEpisodeTitle={seasonEpisodes[0]?.episodes_name}
            currentEpisodeId={seasonEpisodes[0]?.episodes_id}
            episodes={seasonEpisodes}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 500,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  playerLaunchVeil: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#000000',
    zIndex: 999,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingBack: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBox: {
    height: 360,
    position: 'relative',
    justifyContent: 'flex-end',
  },
  heroImg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  roundGlassBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterSummary: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  miniPoster: {
    width: 102,
    height: 150,
    borderRadius: 18,
    backgroundColor: COLORS.cardPlaceholder,
  },
  movieTitle: {
    color: '#FFF',
    fontSize: 21,
    fontWeight: '800',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  imdbPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(251,191,36,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  imdbText: {
    color: COLORS.accentGold,
    fontSize: 12,
    fontWeight: '700',
  },
  metaSmall: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  qualPill: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 7,
  },
  qualText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  genreLine: {
    color: COLORS.muted,
    fontSize: 12,
  },
  progressBox: {
    marginHorizontal: 16,
    marginBottom: 14,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressTxt: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  progressRemain: {
    color: COLORS.muted,
    fontSize: 12,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  actionsSection: {
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 18,
  },
  playBtn: {
    height: 50,
    borderRadius: RADII.md,
    backgroundColor: COLORS.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  quickActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: RADII.md,
    paddingVertical: 10,
  },
  quickBtn: {
    alignItems: 'center',
    gap: 4,
    minWidth: 80,
  },
  quickBtnLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  tabPillActive: {
    backgroundColor: COLORS.accent,
  },
  tabTxt: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTxtActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  tabBody: {
    paddingHorizontal: 16,
  },
  descText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 18,
  },
  episodesWrap: {
    gap: 10,
  },
  seasonRow: {
    gap: 8,
    marginBottom: 4,
  },
  seasonChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  seasonChipActive: {
    backgroundColor: '#FFF',
  },
  seasonTxt: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  seasonTxtActive: {
    color: '#07090F',
    fontWeight: '700',
  },
  subHeading: {
    color: '#FFF',
    fontSize: 15.5,
    fontWeight: '700',
    marginBottom: 10,
  },
  epGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  epBtn: {
    minWidth: '22%',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  epBtnActive: {
    backgroundColor: COLORS.accent,
  },
  epTxt: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  emptySmall: {
    color: COLORS.muted,
    fontSize: 13.5,
  },
  starCard: {
    width: 104,
    padding: 10,
    alignItems: 'center',
    marginRight: 10,
  },
  starAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.cardPlaceholder,
    marginBottom: 8,
  },
  starName: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  starRole: {
    color: COLORS.muted,
    fontSize: 10.5,
    marginTop: 2,
  },
});
