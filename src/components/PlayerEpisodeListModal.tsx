import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BouncyButton } from './BouncyButton';
import { GlassSurface, WaterDropPopupView } from './GlassSurface';
import { COLORS } from '../constants/config';
import { EpisodeItem, OfflineDownloadItem, SeasonItem } from '../types/models';

const API_URL = 'https://api.dangvietanh.com/api/get_episode_list_api';
const IMAGE_BASE_URL = 'https://image.s1dangvietanh.io.vn/image.php';

export interface ApiEpisodeItem {
  stream_key: string;
  episode_name: string;
  video_name: string;
  poster_url: string;
  watched_status: string;
  remaining_time: string;
  percent_watched: number;
  is_watching: boolean;
  seasons_id?: string | number;
}

export interface ApiSeasonItem {
  seasons_id: string | number;
  seasons_name: string;
}

interface PlayerEpisodeListModalProps {
  visible: boolean;
  onClose: () => void;
  userId: number;
  movieTitle: string;
  serverMovieTitle?: string;
  serverTapPhim?: string;
  currentStreamCode: string;
  posterUrl?: string;
  fallbackSeasons?: SeasonItem[];
  fallbackEpisodes?: EpisodeItem[];
  offlineItems?: OfflineDownloadItem[];
  onSelectEpisode: (streamCode: string, epName: string, epIndex: number, seasonId?: string) => void;
}

function getSeasonNumber(season: ApiSeasonItem): number {
  const name = String(season.seasons_name || '');
  const m = name.match(/\d+/);
  if (m) return parseInt(m[0], 10);
  const idNum = parseInt(String(season.seasons_id || '0'), 10);
  return isNaN(idNum) ? 0 : idNum;
}

function formatSeasonName(rawName: string, fallbackIdx: number): string {
  const name = String(rawName || '').trim();
  if (!name) return `Mùa ${String(fallbackIdx).padStart(2, '0')}`;
  return name.replace(/(^|[^\d])(\d)(?!\d)/g, '$10$2');
}

function getCandidateImageUrls(
  rawTitle: string,
  titleVa: string,
  seasonNum: number,
  epName: string,
  fallbackPoster: string
): string[] {
  const urls: string[] = [];
  const raw = String(rawTitle || '').trim();
  const tapMatch = epName.match(/Tập\s*(\d+)/i) || epName.match(/(\d+)/);
  const tapNumber = tapMatch?.[1];

  if (raw && tapNumber) {
    const yearMatch =
      raw.match(/\b(19\d{2}|20\d{2})\b/) || String(titleVa || '').match(/\b(19\d{2}|20\d{2})\b/);
    const year = yearMatch ? yearMatch[1] : '';
    const rootTitle = raw
      .replace(/\.(?:Mùa|Mua)\.?\d+/gi, '')
      .replace(/\.(?:19|20)\d{2}(?=\.|$)/g, '')
      .trim()
      .replace(/\.+$/, '');
    const seasonFormatted = String(Math.max(1, seasonNum)).padStart(2, '0');
    const codes: string[] = [];
    if (seasonNum <= 1) {
      const hasMua = /\.(?:Mùa|Mua)\.?0?1(?:\.|$)/i.test(raw);
      if (hasMua) {
        if (year) codes.push(`${rootTitle}.Mùa.01.${year}.Tập.${tapNumber}`);
        codes.push(`${rootTitle}.Mùa.01.Tập.${tapNumber}`);
        if (year) codes.push(`${rootTitle}.${year}.Tập.${tapNumber}`);
        codes.push(`${rootTitle}.Tập.${tapNumber}`);
      } else {
        if (year) codes.push(`${rootTitle}.${year}.Tập.${tapNumber}`);
        if (year) codes.push(`${rootTitle}.Mùa.01.${year}.Tập.${tapNumber}`);
        codes.push(`${rootTitle}.Mùa.01.Tập.${tapNumber}`);
        codes.push(`${rootTitle}.Tập.${tapNumber}`);
      }
    } else {
      if (year) codes.push(`${rootTitle}.Mùa.${seasonFormatted}.${year}.Tập.${tapNumber}`);
      codes.push(`${rootTitle}.Mùa.${seasonFormatted}.Tập.${tapNumber}`);
    }
    Array.from(new Set(codes)).forEach((c) => {
      urls.push(`${IMAGE_BASE_URL}?code=${encodeURIComponent(c)}`);
    });
  }
  if (fallbackPoster) urls.push(fallbackPoster);
  return urls;
}

function EpisodeCardThumb({
  candidates,
  percentWatched,
  isOfflineReady,
  isWatching,
}: {
  candidates: string[];
  percentWatched: number;
  isOfflineReady: boolean;
  isWatching: boolean;
}) {
  const [idx, setIdx] = useState(0);
  const sig = candidates.join('|');

  useEffect(() => {
    setIdx(0);
  }, [sig]);

  const currentUri = candidates[idx] || '';

  return (
    <View style={styles.thumbBox}>
      {currentUri ? (
        <Image
          source={{ uri: currentUri }}
          style={styles.thumbImg}
          resizeMode="cover"
          onError={() => {
            if (idx + 1 < candidates.length) {
              setIdx(idx + 1);
            }
          }}
        />
      ) : (
        <View style={[styles.thumbImg, styles.thumbPlaceholder]}>
          <Ionicons name="film-outline" size={24} color="rgba(255,255,255,0.4)" />
        </View>
      )}

      <View style={styles.playOverlay}>
        <View style={[styles.playCircle, isWatching && { backgroundColor: 'rgba(229, 9, 20, 0.85)' }]}>
          <Ionicons name={isWatching ? 'volume-high' : 'play'} size={16} color="#FFF" />
        </View>
      </View>

      {isOfflineReady ? (
        <View style={styles.offlineBadge}>
          <Ionicons name="checkmark-circle" size={14} color="#30D158" />
        </View>
      ) : null}

      {percentWatched > 0 ? (
        <View style={styles.cardProgTrack}>
          <View
            style={[
              styles.cardProgFill,
              { width: `${Math.min(100, Math.max(4, percentWatched))}%` },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

export function PlayerEpisodeListModal({
  visible,
  onClose,
  userId,
  movieTitle,
  serverMovieTitle,
  serverTapPhim,
  currentStreamCode,
  posterUrl = '',
  fallbackSeasons = [],
  fallbackEpisodes = [],
  offlineItems = [],
  onSelectEpisode,
}: PlayerEpisodeListModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;

  const [loading, setLoading] = useState(false);
  const [episodes, setEpisodes] = useState<ApiEpisodeItem[]>([]);
  const [seasons, setSeasons] = useState<ApiSeasonItem[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [watchingSeasonId, setWatchingSeasonId] = useState<string | null>(null);
  const [seasonPopupOpen, setSeasonPopupOpen] = useState(false);
  const [headerTitle, setHeaderTitle] = useState(movieTitle);
  const [resolvedPoster, setResolvedPoster] = useState(posterUrl);

  const listRef = useRef<FlatList<ApiEpisodeItem> | null>(null);

  const seedFromFallback = useCallback(
    (targetSeasonId: string | null) => {
      if (fallbackSeasons.length > 0) {
        const mappedSeasons: ApiSeasonItem[] = fallbackSeasons.map((s) => ({
          seasons_id: s.seasons_id,
          seasons_name: s.seasons_name,
        }));
        setSeasons(mappedSeasons);
        const target =
          (targetSeasonId
            ? fallbackSeasons.find((s) => String(s.seasons_id) === String(targetSeasonId))
            : fallbackSeasons.find((s) =>
                s.episodes.some((e) => e.stream_code === currentStreamCode)
              )) || fallbackSeasons[0];
        if (target) {
          setSelectedSeasonId(String(target.seasons_id));
          setEpisodes(
            target.episodes.map((e) => ({
              stream_key: e.stream_code,
              episode_name: e.episodes_name,
              video_name: movieTitle,
              poster_url: posterUrl,
              watched_status: e.stream_code === currentStreamCode ? 'Đang xem...' : '',
              remaining_time: '',
              percent_watched: 0,
              is_watching: e.stream_code === currentStreamCode,
              seasons_id: target.seasons_id,
            }))
          );
          return;
        }
      }
      if (fallbackEpisodes.length > 0) {
        setEpisodes(
          fallbackEpisodes.map((e) => ({
            stream_key: e.stream_code,
            episode_name: e.episodes_name,
            video_name: movieTitle,
            poster_url: posterUrl,
            watched_status: e.stream_code === currentStreamCode ? 'Đang xem...' : '',
            remaining_time: '',
            percent_watched: 0,
            is_watching: e.stream_code === currentStreamCode,
            seasons_id: e.seasons_id,
          }))
        );
      }
    },
    [fallbackSeasons, fallbackEpisodes, currentStreamCode, movieTitle, posterUrl]
  );

  const loadEpisodes = useCallback(
    async (targetSeasonId: string | null = null) => {
      setLoading(true);
      try {
        const form = new FormData();
        form.append('user_id', String(userId || ''));
        form.append('episode_list_name_D8c4Mb5Xw0Cc1Wh', movieTitle || '');
        form.append('episode_list_slug_D8c4Mb5Xw0Cc1Wh', currentStreamCode || '');
        form.append(
          'episode_list_name_o_D8c4Mb5Xw0Cc1Wh',
          serverMovieTitle || movieTitle || ''
        );
        form.append('episode_list_name_tap_D8c4Mb5Xw0Cc1Wh', serverTapPhim || '01');
        if (targetSeasonId) {
          form.append('seasons_id', targetSeasonId);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7500);
        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            body: form,
            signal: controller.signal,
          });
          const json: any = await res.json();
          if (json?.status === 'success' && Array.isArray(json.data)) {
            const list: ApiEpisodeItem[] = json.data;
            const rawSeasons: ApiSeasonItem[] = Array.isArray(json.seasons) ? json.seasons : [];
            const sortedSeasons = [...rawSeasons].sort(
              (a, b) => getSeasonNumber(a) - getSeasonNumber(b)
            );
            setEpisodes(list);
            setSeasons(sortedSeasons);
            setSelectedSeasonId(json.current_season_id ? String(json.current_season_id) : null);
            setWatchingSeasonId(json.watching_season_id ? String(json.watching_season_id) : null);
            if (list[0]?.video_name) setHeaderTitle(list[0].video_name);
            if (list[0]?.poster_url) setResolvedPoster(list[0].poster_url);
            return;
          }
        } finally {
          clearTimeout(timer);
        }
        seedFromFallback(targetSeasonId);
      } catch {
        seedFromFallback(targetSeasonId);
      } finally {
        setLoading(false);
      }
    },
    [
      userId,
      movieTitle,
      currentStreamCode,
      serverMovieTitle,
      serverTapPhim,
      seedFromFallback,
    ]
  );

  useEffect(() => {
    if (!visible) {
      setSeasonPopupOpen(false);
      return;
    }
    setHeaderTitle(movieTitle);
    setResolvedPoster(posterUrl);
    void loadEpisodes(null);
  }, [visible, movieTitle, posterUrl, loadEpisodes]);

  const activeSeasonNum = useMemo(() => {
    if (seasons.length > 0 && selectedSeasonId) {
      const hit = seasons.find((s) => String(s.seasons_id) === String(selectedSeasonId));
      if (hit) {
        const n = getSeasonNumber(hit);
        if (n > 0) return n;
      }
    }
    const m = String(serverMovieTitle || '').match(/\.(?:Mùa|Mua)\.?(\d+)/i);
    if (m?.[1]) return parseInt(m[1], 10);
    return 1;
  }, [seasons, selectedSeasonId, serverMovieTitle]);

  const activeSeasonLabel = useMemo(() => {
    if (seasons.length === 0) return '';
    const idx = seasons.findIndex((s) => String(s.seasons_id) === String(selectedSeasonId));
    const chosen = idx >= 0 ? seasons[idx] : seasons[0];
    return formatSeasonName(chosen.seasons_name, Math.max(1, idx + 1));
  }, [seasons, selectedSeasonId]);

  const watchingIndex = useMemo(
    () =>
      episodes.findIndex(
        (e) => e.is_watching || (currentStreamCode && e.stream_key === currentStreamCode)
      ),
    [episodes, currentStreamCode]
  );

  const numCols = isLandscape ? (winWidth >= 880 ? 3 : 2) : 2;

  const scrollToWatching = useCallback(async () => {
    Haptics.selectionAsync();
    if (watchingIndex >= 0) {
      const rowIdx = Math.floor(watchingIndex / numCols);
      try {
        listRef.current?.scrollToIndex({
          index: Math.max(0, Math.min(episodes.length - 1, rowIdx * numCols)),
          animated: true,
          viewPosition: 0.3,
        });
      } catch {}
    } else if (watchingSeasonId && watchingSeasonId !== selectedSeasonId) {
      await loadEpisodes(watchingSeasonId);
    }
  }, [watchingIndex, numCols, episodes.length, watchingSeasonId, selectedSeasonId, loadEpisodes]);

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(820, winWidth - Math.max(36, insets.left + insets.right + 20))
    : Math.min(460, winWidth - 20);
  const cardHeight = isLandscape
    ? Math.min(358, winHeight - 16)
    : Math.min(winHeight * 0.84, 660);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <WaterDropPopupView visible={visible} from="center">
          <GlassSurface
            variant="liquid"
            radius={40}
            intensity={34}
            style={[styles.cardWrap, { width: cardWidth, height: cardHeight }]}
          >
            <View style={styles.splitRow}>
              {/* Left Sidebar matching danh_sach_tap */}
              <View style={[styles.sidebar, isLandscape ? { width: '30%' } : { width: '36%' }]}>
                <View pointerEvents="none" style={styles.sidebarBgClip}>
                  {resolvedPoster ? (
                    <Image
                      source={{ uri: resolvedPoster }}
                      style={styles.sidebarBgImg}
                      blurRadius={22}
                    />
                  ) : null}
                  <View style={styles.sidebarBgTint} />
                </View>

              <View style={styles.sidebarTop}>
                <Text style={styles.sidebarTag}>DANH SÁCH TẬP</Text>
                <Text style={styles.movieTitle} numberOfLines={3}>
                  {headerTitle || movieTitle}
                </Text>

                {seasons.length > 0 ? (
                  <BouncyButton
                    activeOpacity={0.8}
                    style={styles.seasonBtn}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSeasonPopupOpen(true);
                    }}
                  >
                    <Ionicons name="albums-outline" size={16} color="#FFF" />
                    <Text style={styles.seasonBtnTxt} numberOfLines={1}>
                      {activeSeasonLabel}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color="rgba(255,255,255,0.75)" />
                  </BouncyButton>
                ) : null}
              </View>

              <View style={styles.sidebarBtns}>
                {watchingIndex >= 0 || watchingSeasonId ? (
                  <BouncyButton
                    bounciness="gentle"
                    activeOpacity={0.8}
                    style={styles.sideActionBtn}
                    onPress={scrollToWatching}
                  >
                    <Ionicons name="locate-outline" size={16} color="#FFF" />
                    <Text style={styles.sideActionTxt} numberOfLines={1}>
                      Tập đang xem
                    </Text>
                  </BouncyButton>
                ) : null}

                <BouncyButton
                  bounciness="gentle"
                  activeOpacity={0.8}
                  style={styles.sideActionBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    void loadEpisodes(selectedSeasonId);
                  }}
                >
                  <Ionicons name="refresh-outline" size={16} color="#FFF" />
                  <Text style={styles.sideActionTxt}>Tải lại</Text>
                </BouncyButton>

                <BouncyButton
                  bounciness="gentle"
                  activeOpacity={0.8}
                  style={[styles.sideActionBtn, styles.sideCloseBtn]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onClose();
                  }}
                >
                  <Ionicons name="close" size={17} color="#FFF" />
                  <Text style={styles.sideActionTxt}>Đóng</Text>
                </BouncyButton>
              </View>
            </View>

            {/* Right Episodes Grid */}
            <View style={styles.gridPane}>
              {loading && episodes.length === 0 ? (
                <View style={styles.centerState}>
                  <ActivityIndicator size="large" color={COLORS.accent} />
                  <Text style={styles.stateTxt}>Đang tải danh sách tập...</Text>
                </View>
              ) : episodes.length === 0 ? (
                <View style={styles.centerState}>
                  <Ionicons name="film-outline" size={32} color="rgba(255,255,255,0.45)" />
                  <Text style={styles.stateTxt}>Chưa có tập phim nào trong mùa này.</Text>
                </View>
              ) : (
                <FlatList
                  ref={listRef}
                  key={`ep-grid-${numCols}`}
                  data={episodes}
                  numColumns={numCols}
                  removeClippedSubviews={false}
                  style={{ marginHorizontal: -10, marginTop: -8 }}
                  keyExtractor={(item, index) => `${item.stream_key}-${index}`}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.gridContent,
                    { paddingHorizontal: 10, paddingTop: 8 },
                  ]}
                  columnWrapperStyle={numCols > 1 ? styles.gridRow : undefined}
                  onScrollToIndexFailed={(info) => {
                    listRef.current?.scrollToOffset({
                      offset: info.averageItemLength * info.index,
                      animated: true,
                    });
                  }}
                  renderItem={({ item, index }) => {
                    const isWatching = Boolean(
                      item.is_watching || (currentStreamCode && item.stream_key === currentStreamCode)
                    );
                    const isOffline = offlineItems.some(
                      (off) =>
                        off.status === 'completed' && off.stream_code === item.stream_key
                    );
                    const thumbCandidates = getCandidateImageUrls(
                      serverMovieTitle || '',
                      headerTitle || movieTitle,
                      activeSeasonNum,
                      item.episode_name,
                      item.poster_url || resolvedPoster
                    );

                    return (
                      <BouncyButton
                        bounciness="gentle"
                        activeOpacity={0.82}
                        style={[
                          styles.epCard,
                          isWatching && styles.epCardWatching,
                        ]}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          onSelectEpisode(
                            item.stream_key,
                            item.episode_name,
                            index,
                            item.seasons_id ? String(item.seasons_id) : selectedSeasonId || undefined
                          );
                          onClose();
                        }}
                      >
                        <EpisodeCardThumb
                          candidates={thumbCandidates}
                          percentWatched={item.percent_watched || 0}
                          isOfflineReady={isOffline}
                          isWatching={isWatching}
                        />
                        <View style={styles.epMeta}>
                          <Text
                            style={[styles.epName, isWatching && { color: '#FF6B72' }]}
                            numberOfLines={1}
                          >
                            {item.episode_name}
                          </Text>
                          {isWatching ? (
                            <Text style={styles.epStatusWatching} numberOfLines={1}>
                              Đang xem...
                            </Text>
                          ) : item.watched_status ? (
                            <Text style={styles.epStatusSub} numberOfLines={1}>
                              {item.watched_status}
                            </Text>
                          ) : null}
                          {item.remaining_time ? (
                            <Text style={styles.epRemaining} numberOfLines={1}>
                              {item.remaining_time}
                            </Text>
                          ) : null}
                        </View>
                      </BouncyButton>
                    );
                  }}
                />
              )}
            </View>
          </View>

          {/* Season Selector Sub-Popup (Liquid Glass, no border) */}
          {seasonPopupOpen ? (
            <View style={styles.seasonOverlay}>
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setSeasonPopupOpen(false)}
              />
              <WaterDropPopupView visible={seasonPopupOpen} from="center">
                <GlassSurface variant="liquid" radius={40} intensity={34} style={styles.seasonPopupCard}>
                  <View style={styles.seasonPopupHeader}>
                    <Text style={styles.seasonPopupTitle}>Chọn mùa phim</Text>
                    <BouncyButton
                      style={styles.seasonCloseBtn}
                      onPress={() => setSeasonPopupOpen(false)}
                    >
                      <Ionicons name="close" size={18} color="#FFF" />
                    </BouncyButton>
                  </View>
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    style={{ maxHeight: 220, marginHorizontal: -12 }}
                    contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                  >
                    {seasons.map((season, sIdx) => {
                      const sId = String(season.seasons_id);
                      const isSelected = sId === String(selectedSeasonId);
                      const sLabel = formatSeasonName(season.seasons_name, sIdx + 1);
                      return (
                        <BouncyButton
                          key={sId}
                          bounciness="gentle"
                          activeOpacity={0.8}
                          style={[
                            styles.seasonItem,
                            isSelected && styles.seasonItemSelected,
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setSeasonPopupOpen(false);
                            if (sId !== String(selectedSeasonId)) {
                              setSelectedSeasonId(sId);
                              void loadEpisodes(sId);
                            }
                          }}
                        >
                          <Ionicons
                            name={isSelected ? 'checkmark-circle' : 'tv-outline'}
                            size={18}
                            color={isSelected ? COLORS.accent : 'rgba(255,255,255,0.72)'}
                          />
                          <Text
                            style={[
                              styles.seasonItemTxt,
                              isSelected && { color: '#FFF', fontWeight: '800' },
                            ]}
                          >
                            {sLabel}
                          </Text>
                        </BouncyButton>
                      );
                    })}
                  </ScrollView>
                </GlassSurface>
              </WaterDropPopupView>
            </View>
          ) : null}
        </GlassSurface>
        </WaterDropPopupView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  cardWrap: {
    borderRadius: 40,
  },
  splitRow: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: 40,
  },
  sidebar: {
    padding: 18,
    justifyContent: 'space-between',
    position: 'relative',
  },
  sidebarBgClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopLeftRadius: 40,
    borderBottomLeftRadius: 40,
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  sidebarBgImg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.28,
  },
  sidebarBgTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(10, 12, 18, 0.55)',
  },
  sidebarTop: {
    gap: 8,
  },
  sidebarTag: {
    color: COLORS.accent,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  movieTitle: {
    color: '#FFF',
    fontSize: 15.5,
    fontWeight: '800',
    lineHeight: 21,
  },
  seasonBtn: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  seasonBtnTxt: {
    flex: 1,
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  sidebarBtns: {
    gap: 8,
  },
  sideActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sideCloseBtn: {
    backgroundColor: 'rgba(229, 9, 20, 0.78)',
  },
  sideActionTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  gridPane: {
    flex: 1,
    padding: 14,
  },
  gridContent: {
    gap: 10,
    paddingBottom: 14,
  },
  gridRow: {
    gap: 10,
  },
  epCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 22,
    overflow: 'hidden',
  },
  epCardWatching: {
    backgroundColor: 'rgba(229, 9, 20, 0.22)',
  },
  thumbBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    position: 'relative',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 10,
    padding: 2,
  },
  cardProgTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3.5,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  cardProgFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  epMeta: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    gap: 2,
  },
  epName: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  epStatusWatching: {
    color: '#FF8A90',
    fontSize: 11,
    fontWeight: '700',
  },
  epStatusSub: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11,
  },
  epRemaining: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 10.5,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  stateTxt: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 13,
    textAlign: 'center',
  },
  seasonOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 20,
  },
  seasonPopupCard: {
    width: 280,
    maxWidth: '90%',
    padding: 20,
    borderRadius: 40,
  },
  seasonPopupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  seasonPopupTitle: {
    color: '#FFF',
    fontSize: 15.5,
    fontWeight: '800',
  },
  seasonCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  seasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  seasonItemSelected: {
    backgroundColor: 'rgba(229, 9, 20, 0.25)',
  },
  seasonItemTxt: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13.5,
    fontWeight: '600',
  },
});
