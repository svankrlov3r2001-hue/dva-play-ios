import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageStyle,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { showAppAlert } from '../components/AppAlertModal';
import { BouncyButton } from '../components/BouncyButton';
import { GlassSurface } from '../components/GlassSurface';
import { COLORS, GLASS_SHADOW, RADII } from '../constants/config';
import {
  cacheOfflineMovieMeta,
  extractEpisodeNumberFromName,
  formatBytes,
  formatEpisodeDisplayTitle,
  loadOfflineDownloads,
  loadOfflineMovieMeta,
  removeOfflineDownload,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import {
  EpisodeItem,
  OfflineDownloadItem,
  OfflineLocalStarItem,
  OfflineMovieMeta,
  SeasonItem,
} from '../types/models';

const DEFAULT_POSTER_ASSET = require('../../assets/default-poster2.png');

interface LocalImageProps {
  localUri?: string;
  remoteUri?: string;
  offlineOnlyMode?: boolean;
  style: StyleProp<ImageStyle>;
}

function LocalFirstImage({
  localUri,
  remoteUri,
  offlineOnlyMode = false,
  style,
}: LocalImageProps) {
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
        onError={() => setStage(remoteUri && !offlineOnlyMode ? 'remote' : 'fallback')}
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

function StarAvatarImage({
  star,
  offlineOnlyMode,
}: {
  star: OfflineLocalStarItem;
  offlineOnlyMode: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const uri = star.local_image_uri || (!offlineOnlyMode ? star.image_url : '');
  if (!uri || failed) {
    return (
      <View style={[styles.starAvatar, styles.starAvatarFallback]}>
        <Ionicons name="person" size={26} color={COLORS.muted} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.starAvatar}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

interface OfflineMovieDetailScreenProps {
  visible: boolean;
  videosId: number | null;
  offlineOnlyMode?: boolean;
  watchProgressRevision?: number;
  onClose: () => void;
  onPlayOffline: (item: OfflineDownloadItem, seriesEpisodes?: OfflineDownloadItem[]) => void;
}

function formatRemainingMinutesText(resumeSec?: number, durationSec?: number): string {
  if (!durationSec || durationSec <= 0 || !resumeSec || resumeSec <= 0) return '';
  const remMin = Math.max(0, Math.round((durationSec - resumeSec) / 60));
  if (remMin <= 1) return 'Sắp hết';
  return `Còn ${remMin} phút`;
}

function formatCompactSeconds(sec?: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  if (s <= 0) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(rem)}` : `${pad(m)}:${pad(rem)}`;
}

export function OfflineMovieDetailScreen({
  visible,
  videosId,
  offlineOnlyMode = false,
  watchProgressRevision = 0,
  onClose,
  onPlayOffline,
}: OfflineMovieDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [meta, setMeta] = useState<OfflineMovieMeta | null>(null);
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<'episodes' | 'cast'>('episodes');
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setSelectedSeasonIdx(0);
      setActiveTab('episodes');
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
  }, [visible, videosId, enterAnim]);

  useEffect(() => {
    loadOfflineDownloads()
      .then((list) => {
        setOfflineItems(list);
        setItemsLoaded(true);
      })
      .catch(() => {
        setOfflineItems([]);
        setItemsLoaded(true);
      });
    return subscribeOfflineDownloads((list) => {
      setOfflineItems(list);
      setItemsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!visible || !videosId) {
      setMeta(null);
      return;
    }
    let active = true;
    loadOfflineMovieMeta(videosId)
      .then((m) => {
        if (!active) return;
        setMeta(m);
        if (
          !offlineOnlyMode &&
          (!m || !m.local_backdrop_uri || !m.local_poster_uri || m.episodes.length === 0)
        ) {
          void cacheOfflineMovieMeta(videosId)
            .then((fresh) => {
              if (active && fresh) setMeta(fresh);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [visible, videosId, offlineOnlyMode, watchProgressRevision]);

  const movieDownloads = useMemo(() => {
    if (!videosId) return [];
    return offlineItems
      .filter((it) => it.videos_id === videosId)
      .sort((a, b) => {
        const na = a.episode_number || extractEpisodeNumberFromName(a.episode_title);
        const nb = b.episode_number || extractEpisodeNumberFromName(b.episode_title);
        if (na && nb) return na - nb;
        return a.created_at.localeCompare(b.created_at);
      });
  }, [offlineItems, videosId]);

  const completedDownloads = useMemo(
    () => movieDownloads.filter((it) => it.status === 'completed'),
    [movieDownloads]
  );

  // Close automatically if user deletes all episodes of this movie
  useEffect(() => {
    if (visible && itemsLoaded && videosId && movieDownloads.length === 0) {
      onClose();
    }
  }, [visible, itemsLoaded, videosId, movieDownloads.length, onClose]);

  const isSeries = useMemo(() => {
    if (meta?.is_tvseries === 1) return true;
    if (meta && meta.episodes.length > 1) return true;
    return movieDownloads.length > 1 || movieDownloads.some((d) => Boolean(d.episode_title));
  }, [meta, movieDownloads]);

  const seasonsList: SeasonItem[] = useMemo(() => {
    if (meta?.seasons && meta.seasons.length > 0) return meta.seasons;
    return [];
  }, [meta]);

  const seasonEpisodes: EpisodeItem[] = useMemo(() => {
    if (seasonsList[selectedSeasonIdx]?.episodes?.length) {
      return seasonsList[selectedSeasonIdx].episodes;
    }
    if (meta?.episodes && meta.episodes.length > 0) {
      return meta.episodes;
    }
    return movieDownloads.map((dl, idx) => ({
      episodes_id: dl.episode_id || idx + 1,
      seasons_id: 0,
      episodes_name:
        dl.episode_title ||
        (dl.episode_number ? `Tập ${String(dl.episode_number).padStart(2, '0')}` : `Tập ${idx + 1}`),
      stream_code: dl.stream_code,
      player_url: '',
      full_url: '',
      order: dl.episode_number || idx + 1,
    }));
  }, [seasonsList, selectedSeasonIdx, meta, movieDownloads]);

  const findDownloadedForEpisode = (ep: EpisodeItem): OfflineDownloadItem | undefined => {
    const byCode = completedDownloads.find(
      (d) => d.stream_code && ep.stream_code && d.stream_code === ep.stream_code
    );
    if (byCode) return byCode;
    if (ep.episodes_id) {
      const byId = completedDownloads.find((d) => d.episode_id && d.episode_id === ep.episodes_id);
      if (byId) return byId;
    }
    const epNum = extractEpisodeNumberFromName(ep.episodes_name);
    if (epNum > 0) {
      return completedDownloads.find(
        (d) => (d.episode_number || extractEpisodeNumberFromName(d.episode_title)) === epNum
      );
    }
    return undefined;
  };

  const getEpisodeProgress = (ep: EpisodeItem, dl?: OfflineDownloadItem): number => {
    if (dl && dl.duration_sec && dl.duration_sec > 0 && dl.resume_sec && dl.resume_sec > 0) {
      return Math.min(100, Math.max(1, Math.round((dl.resume_sec / dl.duration_sec) * 100)));
    }
    const metaProg = ep.stream_code ? meta?.episode_progress?.[ep.stream_code] : undefined;
    if (metaProg) {
      if (metaProg.progress_percent > 0) return Math.min(100, metaProg.progress_percent);
      if (metaProg.duration_sec > 0 && metaProg.resume_sec > 0) {
        return Math.min(100, Math.max(1, Math.round((metaProg.resume_sec / metaProg.duration_sec) * 100)));
      }
    }
    return 0;
  };

  const latestWatchedDownload = useMemo(() => {
    const watched = completedDownloads
      .filter((d) => (d.resume_sec || 0) > 2)
      .sort((a, b) => (b.resume_updated_at || 0) - (a.resume_updated_at || 0));
    return watched[0] || completedDownloads[0] || null;
  }, [completedDownloads]);

  const primarySummary = useMemo(() => {
    const target = latestWatchedDownload;
    if (!target) {
      return {
        label: 'Xem ngay',
        progressLabel: '',
        remainLabel: '',
        progressPct: 0,
      };
    }
    const hasResume = Boolean(target.resume_sec && target.resume_sec > 2);
    const pct =
      target.duration_sec && target.duration_sec > 0 && target.resume_sec
        ? Math.min(100, Math.max(1, Math.round((target.resume_sec / target.duration_sec) * 100)))
        : 0;
    if (isSeries) {
      const epName =
        formatEpisodeDisplayTitle(target.episode_title) ||
        (target.episode_number ? `Tập ${target.episode_number}` : 'Tập 01');
      return {
        label: hasResume ? `Xem tiếp ${epName}` : `Xem ${epName}`,
        progressLabel: hasResume ? `Xem tiếp ${epName}` : '',
        remainLabel: formatRemainingMinutesText(target.resume_sec, target.duration_sec) || (pct > 0 ? `${pct}%` : ''),
        progressPct: pct,
      };
    }
    const compact = formatCompactSeconds(target.resume_sec);
    return {
      label: hasResume && compact ? `Xem tiếp ${compact}` : 'Xem ngay',
      progressLabel: hasResume && compact ? `Xem tiếp ${compact}` : '',
      remainLabel: formatRemainingMinutesText(target.resume_sec, target.duration_sec) || (pct > 0 ? `${pct}%` : ''),
      progressPct: pct,
    };
  }, [latestWatchedDownload, isSeries]);

  const handleConfirmDeleteEpisode = (dl: OfflineDownloadItem, epTitle: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    showAppAlert(
      'Xóa phim ngoại tuyến?',
      `Xóa "${meta?.title || dl.title}${epTitle ? ` - ${epTitle}` : ''}" khỏi bộ nhớ máy?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: () => {
            void removeOfflineDownload(dl.id);
          },
        },
      ],
      { skipHaptic: true }
    );
  };

  if (!visible || !videosId) return null;

  const sampleItem = movieDownloads[0];
  const displayTitle = meta?.title || sampleItem?.title || 'Phim ngoại tuyến';
  const localPoster = meta?.local_poster_uri || sampleItem?.local_poster_uri;
  const localBackdrop = meta?.local_backdrop_uri || localPoster;
  const remotePoster = meta?.thumbnail_url || sampleItem?.thumbnail_url || sampleItem?.poster_url;
  const remoteBackdrop = meta?.poster_url || sampleItem?.poster_url || remotePoster;
  const totalBytes = movieDownloads.reduce((sum, it) => sum + (it.size_bytes || 0), 0);

  const castGroups = meta
    ? [
        { title: 'Diễn viên', items: meta.star_list || [] },
        { title: 'Đạo diễn', items: meta.director_list || [] },
        { title: 'Biên kịch', items: meta.writer_list || [] },
      ].filter((g) => g.items.length > 0)
    : [];

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
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
      >
        {/* Hero Backdrop matching MovieDetailScreen */}
        <View style={styles.heroBox}>
          <LocalFirstImage
            localUri={localBackdrop}
            remoteUri={remoteBackdrop}
            offlineOnlyMode={offlineOnlyMode}
            style={styles.heroImg}
          />
          <LinearGradient
            colors={['rgba(7,9,15,0.45)', 'rgba(7,9,15,0.2)', 'rgba(10,11,18,0.88)']}
            locations={[0, 0.4, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={[styles.topBar, { top: insets.top + 8 }]}>
            <BouncyButton
              style={styles.roundGlassBtn}
              onPress={() => {
                Haptics.selectionAsync();
                onClose();
              }}
            >
              <Ionicons name="arrow-back" size={21} color="#FFF" />
            </BouncyButton>
          </View>

          <View style={styles.posterSummary}>
            <LocalFirstImage
              localUri={localPoster}
              remoteUri={remotePoster}
              offlineOnlyMode={offlineOnlyMode}
              style={styles.miniPoster}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.movieTitle}>{displayTitle}</Text>
              <View style={styles.badgeRow}>
                {meta?.imdb_rating ? (
                  <View style={styles.imdbPill}>
                    <Ionicons name="star" size={12} color={COLORS.accentGold} />
                    <Text style={styles.imdbText}>{meta.imdb_rating}</Text>
                  </View>
                ) : null}
                {meta?.year ? <Text style={styles.metaSmall}>{meta.year}</Text> : null}
                {meta?.runtime ? <Text style={styles.metaSmall}>{meta.runtime}</Text> : null}
                <View style={styles.qualPill}>
                  <Text style={styles.qualText}>{meta?.video_quality || 'Ngoại tuyến'}</Text>
                </View>
                <View style={styles.epStatusPill}>
                  <Text style={styles.epStatusText}>
                    {isSeries
                      ? `${completedDownloads.length}/${seasonEpisodes.length || movieDownloads.length} Tập`
                      : formatBytes(totalBytes)}
                  </Text>
                </View>
              </View>
              {meta?.genres && meta.genres.length > 0 ? (
                <Text style={styles.genreLine} numberOfLines={2}>
                  {meta.genres.map((g) => g.name).join(' • ')}
                </Text>
              ) : (
                <Text style={styles.genreLine}>
                  Đã tải ngoại tuyến • {formatBytes(totalBytes)}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Watch Progress */}
        {primarySummary.progressPct > 0 ? (
          <View style={styles.progressBox}>
            <View style={styles.progressRow}>
              <Text style={styles.progressTxt}>{primarySummary.progressLabel}</Text>
              <Text style={styles.progressRemain}>{primarySummary.remainLabel}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${primarySummary.progressPct}%` },
                ]}
              />
            </View>
          </View>
        ) : null}

        {/* Primary Play Button (NO quickActionRow per user spec) */}
        <View style={styles.actionsSection}>
          <BouncyButton
            bounciness="gentle"
            activeOpacity={0.86}
            disabled={!latestWatchedDownload}
            style={[styles.playBtn, !latestWatchedDownload && { opacity: 0.45 }]}
            onPress={() => {
              if (!latestWatchedDownload) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onPlayOffline(latestWatchedDownload, completedDownloads);
            }}
          >
            <Ionicons name="play" size={20} color="#FFF" />
            <Text
              style={styles.playBtnText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {primarySummary.label}
            </Text>
          </BouncyButton>
        </View>

        {/* Detail Tabs (ONLY Episodes/Synopsis & Cast — NO Liên quan) */}
        <View style={styles.tabsRow}>
          {(
            [
              {
                key: 'episodes',
                label: isSeries ? 'Tập phim & Nội dung' : 'Nội dung',
              },
              { key: 'cast', label: 'Diễn viên' },
            ] as const
          ).map((t) => (
            <BouncyButton
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
            </BouncyButton>
          ))}
        </View>

        {activeTab === 'episodes' ? (
          <View style={styles.tabBody}>
            <Text style={styles.descText}>
              {meta?.description || 'Phim đã lưu trên thiết bị để xem ngoại tuyến không cần mạng.'}
            </Text>

            {isSeries ? (
              <View style={styles.episodesWrap}>
                {seasonsList.length > 1 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ overflow: 'visible' }}
                    contentContainerStyle={[styles.seasonRow, { overflow: 'visible' }]}
                  >
                    {seasonsList.map((s, idx) => (
                      <BouncyButton
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
                      </BouncyButton>
                    ))}
                  </ScrollView>
                ) : null}

                <View style={styles.epHeadingRow}>
                  <Text style={[styles.subHeading, { marginBottom: 0 }]}>
                    Danh sách tập ({seasonEpisodes.length})
                  </Text>
                  <View style={styles.epStatusPill}>
                    <Text style={styles.epStatusText}>
                      {`${completedDownloads.length}/${seasonEpisodes.length} Đã tải`}
                    </Text>
                  </View>
                </View>

                <Text style={styles.hintSub}>
                  Chạm tập sáng để xem ngoại tuyến • Giữ lâu để xóa tập đã tải
                </Text>

                <View style={styles.epGrid}>
                  {seasonEpisodes.map((ep, idx) => {
                    const dl = findDownloadedForEpisode(ep);
                    const isDownloaded = Boolean(dl);
                    const isCurrentResume =
                      Boolean(dl && latestWatchedDownload && dl.id === latestWatchedDownload.id);
                    const pct = getEpisodeProgress(ep, dl);
                    const label =
                      formatEpisodeDisplayTitle(ep.episodes_name) ||
                      ep.episodes_name ||
                      `Tập ${idx + 1}`;

                    return (
                      <BouncyButton
                        key={`${ep.episodes_id}_${ep.stream_code}_${idx}`}
                        disabled={!isDownloaded}
                        style={[
                          styles.epBtn,
                          isCurrentResume && isDownloaded && styles.epBtnActive,
                          !isDownloaded && styles.epBtnDimmed,
                        ]}
                        onPress={() => {
                          if (!dl) return;
                          Haptics.selectionAsync();
                          onPlayOffline(dl, completedDownloads);
                        }}
                        onLongPress={
                          dl ? () => handleConfirmDeleteEpisode(dl, label) : undefined
                        }
                        delayLongPress={360}
                      >
                        <Text
                          style={[
                            styles.epTxt,
                            isDownloaded && styles.epTxtBright,
                            isCurrentResume && isDownloaded && { color: '#FFF' },
                            !isDownloaded && styles.epTxtDimmed,
                          ]}
                          numberOfLines={1}
                        >
                          {label}
                        </Text>
                        {pct > 0 ? (
                          <View style={styles.epProgTrack}>
                            <View
                              style={[
                                styles.epProgFill,
                                isCurrentResume && isDownloaded && { backgroundColor: '#FFFFFF' },
                                { width: `${pct}%` },
                              ]}
                            />
                          </View>
                        ) : null}
                      </BouncyButton>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.tabBody}>
            {castGroups.length === 0 ? (
              <Text style={styles.emptySmall}>
                Chưa có thông tin diễn viên / đạo diễn được lưu ngoại tuyến.
              </Text>
            ) : (
              castGroups.map((grp) => (
                <View key={grp.title} style={{ marginBottom: 18 }}>
                  <Text style={styles.subHeading}>{grp.title}</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ overflow: 'visible' }}
                    contentContainerStyle={{ overflow: 'visible' }}
                  >
                    {grp.items.map((star, idx) => (
                      <GlassSurface
                        key={`${grp.title}_${star.id}_${idx}`}
                        intensity={26}
                        radius={18}
                        style={styles.starCard}
                      >
                        <StarAvatarImage star={star} offlineOnlyMode={offlineOnlyMode} />
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
        )}
      </ScrollView>
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
    zIndex: 520,
    backgroundColor: COLORS.bg,
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
    backgroundColor: 'rgba(20, 22, 28, 0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: GLASS_SHADOW,
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
  epStatusPill: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
  },
  epStatusText: {
    color: '#FFFFFF',
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
    marginBottom: 18,
  },
  playBtn: {
    height: 50,
    paddingHorizontal: 14,
    borderRadius: RADII.md,
    backgroundColor: COLORS.accent,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
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
  epHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  hintSub: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: -4,
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  epBtnActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  epBtnDimmed: {
    opacity: 0.34,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  epTxt: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  epTxtBright: {
    color: '#FFFFFF',
  },
  epTxtDimmed: {
    color: 'rgba(255,255,255,0.55)',
  },
  epProgTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  epProgFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
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
  starAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
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
