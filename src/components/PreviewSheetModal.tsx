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
import { MovieItem, PopupInfo } from '../types/models';
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
  onPlay: (params: { videosId: number; streamCode: string; episodeId?: number; title: string }) => void;
  onOpenDetail: (videosId: number) => void;
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
  const trailerOpacity = useRef(new Animated.Value(0)).current;

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (isOpen) {
      backdropOpacity.setValue(0);
      sheetTranslateY.setValue(320);
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(sheetTranslateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      backdropOpacity.stopAnimation();
      sheetTranslateY.stopAnimation();
      backdropOpacity.setValue(0);
      sheetTranslateY.setValue(320);
      try {
        player.pause();
      } catch {}
    }
  }, [isOpen, backdropOpacity, sheetTranslateY, player]);

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  // Phase 1: Load movie metadata ONLY (never blocked by trailer check or video buffering)
  useEffect(() => {
    if (!visible || !videosId) {
      setLoading(false);
      setInfo(null);
      setTrailerActive(false);
      trailerOpacity.setValue(0);
      try {
        player.pause();
      } catch {}
      return;
    }

    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setInWishlist(Boolean(initialMovie?.in_wishlist));
    setTrailerActive(false);
    trailerOpacity.setValue(0);
    setIsMuted(true);

    (async () => {
      try {
        const res = await fetchPopupInfoApi(videosId);
        if (cancelled) return;
        setInfo(res);
        setInWishlist(Boolean(res.in_wishlist));
      } catch {
        // Keep modal resilient even if request fails
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, videosId, initialMovie?.in_wishlist, player, trailerOpacity]);

  // Phase 2: Load & fade-in trailer asynchronously after movie metadata is ready
  useEffect(() => {
    if (!isOpen || !videosId || !info || info.videos_id !== videosId) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 3500);

    (async () => {
      let chosenTrailer = info.url_trailer_fallback;
      let isHls = false;

      if (info.title_dot) {
        try {
          const chk = await fetch('https://dangvietanh.io.vn/check_file_trailer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: info.title_dot }),
            signal: controller.signal,
          });
          if (chk.ok) {
            const cJson = await chk.json();
            if (cJson && (cJson.exists || cJson.status === 'ok' || cJson.url)) {
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

      if (cancelled || !chosenTrailer) return;

      try {
        await player.replaceAsync({
          uri: chosenTrailer,
          contentType: isHls ? 'hls' : 'progressive',
        });
        if (!cancelled) {
          player.muted = true;
          player.play();
          setTrailerActive(true);
          Animated.timing(trailerOpacity, {
            toValue: 1,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }
      } catch {
        // Keep image backdrop cleanly
      }
    })();

    return () => {
      cancelled = true;
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
            { maxHeight: maxSheetHeight, transform: [{ translateY: sheetTranslateY }] },
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
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        try {
                          player.pause();
                        } catch {}
                        onClose();
                        onPlay({
                          videosId: info.videos_id,
                          streamCode: info.movies_url_getlink,
                          episodeId: info.episode_id,
                          title: info.title,
                        });
                      }}
                    >
                      <Ionicons name="play" size={20} color="#FFF" />
                      <Text style={styles.playBtnText}>
                        {info.viewed_information || 'Xem ngay'}
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
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
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
