import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/config';
import { fetchPopupInfoApi, toggleWishlistApi } from '../services/api';
import { isNetworkError, reportNetworkFailure } from '../services/networkService';
import { MovieItem, PopupInfo, ServerEpisodeStatus } from '../types/models';

function getServerEpisodeBadgeStyle(status?: ServerEpisodeStatus) {
  if (status === 'incomplete') {
    return {
      box: styles.epStatusIncomplete,
      text: styles.epStatusTextLight,
    };
  }
  if (status === 'upcoming') {
    return {
      box: styles.epStatusUpcoming,
      text: styles.epStatusTextDark,
    };
  }
  return {
    box: styles.epStatusComplete,
    text: styles.epStatusTextLight,
  };
}
import { AmbientAppBackground } from './AmbientAppBackground';
import { BouncyButton } from './BouncyButton';
import { GlassSurface } from './GlassSurface';
import { SkeletonCrossfade } from './SkeletonCrossfade';
import { PreviewSheetSkeleton } from './SkeletonLoaders';

interface PreviewSheetModalProps {
  visible: boolean;
  videosId: number | null;
  initialMovie?: MovieItem | null;
  obscuredByPlayer?: boolean;
  onClose: () => void;
  onPlay: (params: {
    videosId: number;
    streamCode: string;
    episodeId?: number;
    title: string;
    posterUrl?: string;
    thumbnailUrl?: string;
  }) => void;
  onOpenDetail: (videosId: number) => void;
}

function formatCompactResumeText(raw?: string): string {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  if (!/giờ|phút|giây/i.test(txt)) return txt;
  const hMatch = txt.match(/(\d+)\s*giờ/i);
  const mMatch = txt.match(/(\d+)\s*phút/i);
  const sMatch = txt.match(/(\d+)\s*giây/i);
  const h = hMatch ? parseInt(hMatch[1], 10) : 0;
  const m = mMatch ? parseInt(mMatch[1], 10) : 0;
  const s = sMatch ? parseInt(sMatch[1], 10) : 0;
  const pad = (n: number) => String(Math.max(0, n)).padStart(2, '0');
  const formatted = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return txt
    .replace(/(?:\d+\s*giờ\s*|\d+\s*phút\s*|\d+\s*giây\s*)+/gi, formatted)
    .replace(/\s+/g, ' ')
    .trim();
}

export function PreviewSheetModal({
  visible,
  videosId,
  initialMovie = null,
  obscuredByPlayer = false,
  onClose,
  onPlay,
  onOpenDetail,
}: PreviewSheetModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const maxSheetHeight = Math.round(Math.max(winWidth, winHeight) * 0.84);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<PopupInfo | null>(null);
  const [inWishlist, setInWishlist] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [trailerActive, setTrailerActive] = useState(false);

  const isOpen = visible && !obscuredByPlayer;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(360)).current;
  const sheetScaleX = useRef(new Animated.Value(0.92)).current;
  const sheetScaleY = useRef(new Animated.Value(1.06)).current;
  const trailerOpacity = useRef(new Animated.Value(0)).current;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const activeTokenRef = useRef(0);
  const targetStartSecRef = useRef(200);
  const seekAppliedRef = useRef(false);
  const revealedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialWishlistRef = useRef(Boolean(initialMovie?.in_wishlist));
  initialWishlistRef.current = Boolean(initialMovie?.in_wishlist);
  const loadedVideosIdRef = useRef<number | null>(null);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    const sSub = player.addListener('statusChange', (ev) => {
      if (ev.status === 'readyToPlay') {
        const dur = player.duration || 0;
        const startSec = dur > 15 && dur <= 205 ? Math.floor(dur * 0.25) : 200;
        targetStartSecRef.current = startSec;
        if (!seekAppliedRef.current) {
          seekAppliedRef.current = true;
          try {
            player.currentTime = startSec;
          } catch {}
        }
        try {
          player.muted = isMutedRef.current;
          player.play();
        } catch {}
      }
    });

    const tSub = player.addListener('timeUpdate', (ev) => {
      if (revealedRef.current) return;
      const minExpected = Math.max(0, targetStartSecRef.current - 8);
      if (ev.currentTime >= minExpected) {
        revealedRef.current = true;
        setTrailerActive(true);
        Animated.timing(trailerOpacity, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }
    });

    return () => {
      sSub.remove();
      tSub.remove();
    };
  }, [player, trailerOpacity]);

  useEffect(() => {
    if (isOpen) {
      backdropOpacity.stopAnimation();
      sheetTranslateY.stopAnimation();
      sheetScaleX.stopAnimation();
      sheetScaleY.stopAnimation();
      backdropOpacity.setValue(0);
      sheetTranslateY.setValue(240);
      sheetScaleX.setValue(0.92);
      sheetScaleY.setValue(1.06);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 210,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          stiffness: 175,
          damping: 14,
          mass: 1.05,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(sheetScaleX, {
            toValue: 1.025,
            duration: 175,
            easing: Easing.bezier(0.34, 1.56, 0.64, 1),
            useNativeDriver: true,
          }),
          Animated.spring(sheetScaleX, {
            toValue: 1,
            stiffness: 190,
            damping: 8.5,
            mass: 1.05,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(sheetScaleY, {
            toValue: 0.975,
            duration: 175,
            easing: Easing.bezier(0.34, 1.56, 0.64, 1),
            useNativeDriver: true,
          }),
          Animated.spring(sheetScaleY, {
            toValue: 1,
            stiffness: 190,
            damping: 8.5,
            mass: 1.05,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    } else {
      backdropOpacity.stopAnimation();
      sheetTranslateY.stopAnimation();
      sheetScaleX.stopAnimation();
      sheetScaleY.stopAnimation();
      backdropOpacity.setValue(0);
      sheetTranslateY.setValue(240);
      sheetScaleX.setValue(0.92);
      sheetScaleY.setValue(1.06);
      setTrailerActive(false);
      trailerOpacity.setValue(0);
      seekAppliedRef.current = false;
      revealedRef.current = false;
      try {
        player.pause();
      } catch {}
      player.replaceAsync(null).catch(() => {});
    }
  }, [isOpen, backdropOpacity, sheetTranslateY, sheetScaleX, sheetScaleY, player, trailerOpacity]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  // Phase 1: Load movie metadata ONLY (never blocked by trailer check or video buffering)
  useEffect(() => {
    if (!visible || !videosId) {
      loadedVideosIdRef.current = null;
      activeTokenRef.current += 1;
      setLoading(false);
      setInfo(null);
      setTrailerActive(false);
      trailerOpacity.setValue(0);
      seekAppliedRef.current = false;
      revealedRef.current = false;
      try {
        player.pause();
      } catch {}
      player.replaceAsync(null).catch(() => {});
      return;
    }

    if (loadedVideosIdRef.current === videosId) {
      return;
    }
    loadedVideosIdRef.current = videosId;

    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setInWishlist(initialWishlistRef.current);
    setTrailerActive(false);
    trailerOpacity.setValue(0);
    seekAppliedRef.current = false;
    revealedRef.current = false;
    setIsMuted(true);

    (async () => {
      try {
        const res = await fetchPopupInfoApi(videosId);
        if (cancelled) return;
        setInfo(res);
        setInWishlist(Boolean(res.in_wishlist));
      } catch (err) {
        if (!cancelled && isNetworkError(err)) {
          onCloseRef.current();
          void reportNetworkFailure();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, videosId, player, trailerOpacity]);

  // Phase 2: Load & seek trailer >= 200s asynchronously after movie metadata is ready
  useEffect(() => {
    if (!isOpen || !videosId || !info || info.videos_id !== videosId) {
      return;
    }

    const token = ++activeTokenRef.current;
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 3500);

    seekAppliedRef.current = false;
    revealedRef.current = false;
    setTrailerActive(false);
    trailerOpacity.setValue(0);

    (async () => {
      let chosenTrailer = info.url_trailer_fallback;
      let isHls = false;

      if (info.title_dot) {
        try {
          const chk = await fetch('https://dangvietanh.io.vn/check_file_trailer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `name_movies=${encodeURIComponent(info.title_dot)}`,
            signal: controller.signal,
          });
          if (chk.ok) {
            const cJson: any = await chk.json();
            if (cJson && (cJson.status === 'success' || cJson.exists || cJson.status === 'ok')) {
              chosenTrailer = info.url_trailer_hls || info.url_trailer_stream;
              isHls = true;
            }
          }
        } catch {
          // Timeout or network issue: silently keep fallback MP4 or backdrop poster
        } finally {
          clearTimeout(timeoutId);
        }
      } else {
        clearTimeout(timeoutId);
      }

      if (cancelled || activeTokenRef.current !== token || !chosenTrailer) return;

      try {
        await player.replaceAsync({
          uri: chosenTrailer,
          contentType: isHls ? 'hls' : 'progressive',
        });
      } catch {
        // Keep image backdrop cleanly
      }
    })();

    return () => {
      cancelled = true;
      activeTokenRef.current += 1;
      clearTimeout(timeoutId);
      controller.abort();
      try {
        player.pause();
      } catch {}
    };
  }, [isOpen, videosId, info, player, trailerOpacity]);

  const handleToggleWishlist = async () => {
    if (!videosId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await toggleWishlistApi(videosId);
      setInWishlist(res.in_wishlist);
    } catch {}
  };

  const progressPct = parseInt(String(info?.viewed_rate || '0').replace('%', ''), 10) || 0;
  const imdbVal = parseFloat(String(info?.imdb_rating || '0')) || 0;
  const starCount = Math.max(0, Math.min(5, Math.round(imdbVal / 2)));
  const previewBackdropUri =
    info?.image_poster_image || initialMovie?.poster_url || initialMovie?.thumbnail_url || '';

  if (!isOpen) {
    return null;
  }

  return (
    <View style={styles.overlayRoot}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheetAnimWrap,
            {
              maxHeight: maxSheetHeight,
              transform: [
                { translateY: sheetTranslateY },
                { scaleX: sheetScaleX },
                { scaleY: sheetScaleY },
              ],
            },
          ]}
        >
          <GlassSurface
            intensity={34}
            radius={34}
            style={[
              styles.sheet,
              { maxHeight: maxSheetHeight, paddingBottom: Math.max(24, insets.bottom + 14) },
            ]}
          >
            <View pointerEvents="none" style={styles.sheetAmbientWrap}>
              <AmbientAppBackground />
            </View>
            <View style={styles.handleBar} />

            {/* Backdrop / Live Trailer Header with seamless ::before-style bottom fade */}
            <View style={styles.mediaBox}>
              {previewBackdropUri ? (
                <Image
                  source={{ uri: previewBackdropUri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              ) : null}

              {trailerActive ? (
                <Animated.View style={[StyleSheet.absoluteFill, { opacity: trailerOpacity }]}>
                  <VideoView
                    player={player}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    nativeControls={false}
                  />
                </Animated.View>
              ) : null}

              <LinearGradient
                colors={[
                  'rgba(7,9,15,0.16)',
                  'rgba(7,9,15,0)',
                  'rgba(7,9,15,0.40)',
                  'rgba(7,9,15,0.82)',
                  COLORS.bg,
                ]}
                locations={[0, 0.34, 0.54, 0.82, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />

              <BouncyButton style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color="#FFF" />
              </BouncyButton>

              {trailerActive ? (
                <BouncyButton
                  style={styles.muteBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setIsMuted((m) => !m);
                  }}
                >
                  <Ionicons
                    name={isMuted ? 'volume-mute' : 'volume-high'}
                    size={18}
                    color="#FFF"
                  />
                </BouncyButton>
              ) : null}
            </View>

            <LinearGradient
              colors={[COLORS.bg, 'rgba(7,9,15,0.68)', 'rgba(7,9,15,0)']}
              locations={[0, 0.42, 1]}
              style={styles.mediaBottomBridge}
              pointerEvents="none"
            />

            <SkeletonCrossfade
              loading={loading || !info}
              intrinsicHeight
              backgroundColor="transparent"
              skeleton={<PreviewSheetSkeleton active={isOpen && (loading || !info)} />}
            >
              {info ? (
                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.content}
                >
                  {info.image_name && info.image_name !== 'false' ? (
                    <Image
                      source={{ uri: info.image_name }}
                      style={styles.logoTitleImg}
                      resizeMode="contain"
                    />
                  ) : (
                    <Text style={styles.titleText}>{info.title}</Text>
                  )}

                  <View style={styles.metaRow}>
                    <View style={styles.starsRow}>
                      {[0, 1, 2, 3, 4].map((idx) => (
                        <Ionicons
                          key={idx}
                          name={idx < starCount ? 'star' : 'star-outline'}
                          size={15}
                          color={COLORS.accentGold}
                        />
                      ))}
                      {imdbVal > 0 ? (
                        <Text style={styles.imdbText}>{imdbVal.toFixed(1)}</Text>
                      ) : null}
                    </View>
                    {info.release ? (
                      <Text style={styles.metaText}>{info.release.slice(0, 4)}</Text>
                    ) : null}
                    {info.runtime ? <Text style={styles.metaText}>{info.runtime}</Text> : null}
                    <View style={styles.qualityPill}>
                      <Text style={styles.qualityText}>{info.video_quality || 'HD'}</Text>
                    </View>
                    {info.server_episode_label ? (() => {
                      const epBadge = getServerEpisodeBadgeStyle(info.server_episode_status);
                      return (
                        <View style={[styles.epStatusPill, epBadge.box]}>
                          <Text style={[styles.epStatusText, epBadge.text]}>
                            {info.server_episode_label}
                          </Text>
                        </View>
                      );
                    })() : null}
                  </View>

                  {progressPct > 0 || info.time_remaining ? (
                    <View style={styles.progressSection}>
                      <View style={styles.progressHeader}>
                        <Text style={styles.progressLabel}>Tiến độ xem</Text>
                        <Text style={styles.progressRemain}>
                          {info.time_remaining || `${progressPct}%`}
                        </Text>
                      </View>
                      <View style={styles.progressBarBg}>
                        <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
                      </View>
                    </View>
                  ) : null}

                  <Text style={styles.descText} numberOfLines={4}>
                    {info.description || 'Thưởng thức nội dung chất lượng cao trên Đặng Việt Anh.'}
                  </Text>

                  <View style={styles.actionRow}>
                    <BouncyButton
                      bounciness="gentle"
                      activeOpacity={0.88}
                      style={styles.playBtn}
                      onPress={() => {
                        if (!info || info.videos_id !== videosId) return;
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        try {
                          player.pause();
                        } catch {}
                        onClose();
                        if (!info.movies_url_getlink) {
                          onOpenDetail(info.videos_id);
                          return;
                        }
                        onPlay({
                          videosId: info.videos_id,
                          streamCode: info.movies_url_getlink,
                          episodeId: info.episode_id,
                          title: info.title,
                          posterUrl: info.image_poster_image || initialMovie?.poster_url || '',
                          thumbnailUrl: info.image_video_thumb || initialMovie?.thumbnail_url || '',
                        });
                      }}
                    >
                      <Ionicons name="play" size={20} color="#FFF" />
                      <Text
                        style={styles.playBtnText}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                      >
                        {formatCompactResumeText(info.viewed_information) || 'Xem ngay'}
                      </Text>
                    </BouncyButton>

                    <BouncyButton
                      style={styles.iconActionBtn}
                      onPress={handleToggleWishlist}
                    >
                      <Ionicons
                        name={inWishlist ? 'bookmark' : 'bookmark-outline'}
                        size={20}
                        color={inWishlist ? COLORS.accent : '#FFF'}
                      />
                    </BouncyButton>

                    <BouncyButton
                      style={styles.detailBtn}
                      onPress={() => {
                        Haptics.selectionAsync();
                        onClose();
                        onOpenDetail(info.videos_id);
                      }}
                    >
                      <Ionicons name="information-circle-outline" size={20} color="#FFF" />
                      <Text style={styles.detailBtnText}>Chi tiết</Text>
                    </BouncyButton>
                  </View>
                </ScrollView>
              ) : null}
            </SkeletonCrossfade>
          </GlassSurface>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 600,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheetAnimWrap: {
    width: '100%',
  },
  sheet: {
    backgroundColor: 'rgba(13, 10, 16, 0.72)',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  sheetAmbientWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    overflow: 'hidden',
    opacity: 0.72,
  },
  handleBar: {
    alignSelf: 'center',
    width: 42,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginTop: 10,
    marginBottom: 8,
    zIndex: 10,
  },
  mediaBox: {
    width: '100%',
    height: 215,
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    position: 'relative',
    overflow: 'hidden',
  },
  mediaBottomBridge: {
    height: 36,
    marginBottom: -36,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  muteBtn: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  logoTitleImg: {
    width: 210,
    height: 54,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  titleText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  imdbText: {
    color: COLORS.accentGold,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  metaText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  qualityPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  qualityText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  epStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  epStatusIncomplete: {
    backgroundColor: 'rgba(220, 38, 38, 0.88)',
    borderColor: 'rgba(255, 130, 130, 0.45)',
  },
  epStatusComplete: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
  },
  epStatusUpcoming: {
    backgroundColor: 'rgba(250, 204, 21, 0.94)',
    borderColor: 'rgba(254, 240, 138, 0.78)',
  },
  epStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  epStatusTextLight: {
    color: '#FFFFFF',
  },
  epStatusTextDark: {
    color: '#18181B',
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  progressLabel: {
    color: COLORS.muted,
    fontSize: 12,
  },
  progressRemain: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  descText: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playBtn: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  iconActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBtn: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
