import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { COLORS, GLASS_SHADOW } from '../constants/config';
import { MovieItem } from '../types/models';
import { BouncyButton } from './BouncyButton';
import { GlassSurface } from './GlassSurface';
import { LazyImage } from './LazyImage';

interface Hero3DCarouselProps {
  items: MovieItem[];
  topInset: number;
  isActive?: boolean;
  onPlay: (item: MovieItem) => void;
  onToggleWishlist: (item: MovieItem) => void;
  onOpenDetail: (videosId: number) => void;
}

// 4x4 transparent PNG with subtle cinema halftone dot matrix matching dva-play.css
const CINEMA_DOT_PATTERN_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGUlEQVR4nGNgYGBYxcDAEMCABEAcZQaiAQBSFQFuJf5sUQAAAABJRU5ErkJggg==';

function computeTitleDot(item: MovieItem): string {
  if (item.title_dot && item.title_dot.trim()) {
    return item.title_dot.trim();
  }
  const primary = (item.title_primary || String(item.title || '').split(' - ')[0] || '').trim();
  return primary.replace(/\s+/g, '.');
}

/**
 * Interactive 3D Perspective Hero Carousel:
 * - Default: 5-card fanned 3D deck
 * - After 5s idle: side cards collapse behind center, center poster scales down & docks beside title/meta,
 *   and unblurred full-bleed trailer plays in backdrop with cinema halftone dots overlay.
 */
export function Hero3DCarousel({
  items,
  topInset,
  isActive = true,
  onPlay,
  onToggleWishlist,
  onOpenDetail,
}: Hero3DCarouselProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const [activeIndex, setActiveIndex] = useState(0);
  const [infoHeaderHeight, setInfoHeaderHeight] = useState(112);
  const [isDocked, setIsDocked] = useState(false);
  const [trailerReady, setTrailerReady] = useState(false);
  const [trailerMuted, setTrailerMuted] = useState(true);

  const deckScale = useRef(new Animated.Value(1)).current;
  const infoFade = useRef(new Animated.Value(1)).current;
  const spreadProgress = useRef(new Animated.Value(1)).current; // 1 = fanned deck, 0 = collapsed
  const dockProgress = useRef(new Animated.Value(0)).current; // 0 = centered top deck, 1 = docked right-bottom
  const layoutProgress = useRef(new Animated.Value(0)).current; // non-native driver for right padding
  const trailerOpacity = useRef(new Animated.Value(0)).current;

  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  const countRef = useRef(items.length);
  countRef.current = items.length;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const trailerMutedRef = useRef(trailerMuted);
  trailerMutedRef.current = trailerMuted;
  const hasCollapsedRef = useRef(false);
  const trailerStartSecRef = useRef(0);
  const trailerInitialSeekDoneRef = useRef(false);
  const collapseAnimRef = useRef<Animated.CompositeAnimation | null>(null);
  const sequenceTokenRef = useRef(0);

  const trailerPlayer = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
    p.staysActiveInBackground = false;
  });

  useEffect(() => {
    try {
      trailerPlayer.muted = trailerMuted;
    } catch {}
  }, [trailerMuted, trailerPlayer]);

  const stopTrailerImmediately = useCallback(() => {
    try {
      trailerPlayer.pause();
    } catch {}
    trailerPlayer.replaceAsync(null).catch(() => {});
    trailerOpacity.stopAnimation();
    trailerOpacity.setValue(0);
    setTrailerReady(false);
    trailerInitialSeekDoneRef.current = false;
  }, [trailerOpacity, trailerPlayer]);

  // Listen to trailer player readiness & seek cleanly (only reveal after 5s collapse sequence)
  useEffect(() => {
    const sSub = trailerPlayer.addListener('statusChange', (ev) => {
      if (!isActiveRef.current) return;
      if (ev.status === 'readyToPlay') {
        if (!trailerInitialSeekDoneRef.current) {
          trailerInitialSeekDoneRef.current = true;
          const dur = trailerPlayer.duration || 0;
          const wanted = trailerStartSecRef.current;
          if (wanted > 0 && (dur <= 0 || wanted < dur - 8)) {
            try {
              trailerPlayer.currentTime = wanted;
            } catch {}
          }
        }
        if (!hasCollapsedRef.current) {
          try {
            trailerPlayer.pause();
          } catch {}
          return;
        }
        try {
          trailerPlayer.muted = trailerMutedRef.current;
          trailerPlayer.play();
        } catch {}
        setTrailerReady(true);
        Animated.timing(trailerOpacity, {
          toValue: 1,
          duration: 620,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      } else if (ev.status === 'error') {
        setTrailerReady(false);
        trailerOpacity.setValue(0);
      }
    });

    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        try {
          trailerPlayer.pause();
        } catch {}
      } else if (isActiveRef.current && hasCollapsedRef.current && trailerReady) {
        try {
          trailerPlayer.play();
        } catch {}
      }
    });

    return () => {
      sSub.remove();
      appSub.remove();
    };
  }, [trailerPlayer, trailerOpacity, trailerReady]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  const goToIndex = useCallback(
    (targetIdx: number) => {
      const total = countRef.current;
      if (total <= 0) return;
      const normalized = ((targetIdx % total) + total) % total;
      if (normalized === activeIndexRef.current) return;

      Animated.sequence([
        Animated.timing(infoFade, {
          toValue: 0.4,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(infoFade, {
          toValue: 1,
          duration: 210,
          useNativeDriver: true,
        }),
      ]).start();

      Animated.sequence([
        Animated.timing(deckScale, {
          toValue: 0.96,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.spring(deckScale, {
          toValue: 1,
          tension: 150,
          friction: 14,
          useNativeDriver: true,
        }),
      ]).start();

      setActiveIndex(normalized);
    },
    [deckScale, infoFade]
  );

  // Per-slide 5-second idle lifecycle:
  // t = 0s: reset to 5-card fanned deck
  // t = 5s: collapse side cards -> dock center poster right-bottom -> fade in full-bleed unblurred trailer
  useEffect(() => {
    const token = ++sequenceTokenRef.current;
    if (collapseAnimRef.current) {
      collapseAnimRef.current.stop();
      collapseAnimRef.current = null;
    }
    hasCollapsedRef.current = false;
    setIsDocked(false);
    spreadProgress.setValue(1);
    dockProgress.setValue(0);
    layoutProgress.setValue(0);
    stopTrailerImmediately();

    const activeItem = items[activeIndex];
    if (!isActive || !activeItem || items.length === 0) {
      return undefined;
    }

    let resolvedUrl = '';
    let resolvedContentType: 'hls' | 'progressive' = 'progressive';
    let resolvedStartSec = 200;
    const abortCtrl = new AbortController();

    const resolveTrailerAsync = async () => {
      const titleDot = computeTitleDot(activeItem);
      if (!titleDot) return;
      try {
        const res = await fetch('https://dangvietanh.io.vn/check_file_trailer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: `name_movies=${encodeURIComponent(titleDot)}`,
          signal: abortCtrl.signal,
        });
        if (res.ok) {
          const json: any = await res.json();
          if (json && json.status === 'success') {
            const safeDot = encodeURIComponent(titleDot);
            resolvedUrl = `https://dangvietanh.io.vn/trailer/${safeDot}/${safeDot}.m3u8`;
            resolvedContentType = 'hls';
            resolvedStartSec = 6;
            return;
          }
        }
      } catch {
        if (abortCtrl.signal.aborted) return;
      }
      const fallbackCode =
        activeItem.is_tvseries === 1 ? `${titleDot}.Tập.01` : titleDot;
      resolvedUrl = `https://dangvietanh.io.vn/?code=${encodeURIComponent(fallbackCode)}`;
      resolvedContentType = 'progressive';
      resolvedStartSec = 200;
    };

    const resolverPromise = resolveTrailerAsync();

    // Pre-start buffer cleanly around 4.5s so trailer is ready smoothly as card docks at 5s
    const preloadTimer = setTimeout(() => {
      void (async () => {
        await resolverPromise;
        if (sequenceTokenRef.current !== token || !isActiveRef.current || !resolvedUrl) return;
        trailerStartSecRef.current = resolvedStartSec;
        trailerInitialSeekDoneRef.current = false;
        try {
          await trailerPlayer.replaceAsync({
            uri: resolvedUrl,
            contentType: resolvedContentType,
          });
        } catch {}
      })();
    }, 4400);

    const collapseTimer = setTimeout(() => {
      if (sequenceTokenRef.current !== token || !isActiveRef.current) return;
      hasCollapsedRef.current = true;
      setIsDocked(true);

      const anim = Animated.sequence([
        // Step A: side posters collapse cleanly behind the center poster (Image 9)
        Animated.timing(spreadProgress, {
          toValue: 0,
          duration: 380,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        // Step B: center poster shrinks and slides to the lower-right corner beside title/meta (Image 11)
        Animated.parallel([
          Animated.timing(dockProgress, {
            toValue: 1,
            duration: 540,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(layoutProgress, {
            toValue: 1,
            duration: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        ]),
      ]);
      collapseAnimRef.current = anim;
      anim.start(({ finished }) => {
        if (!finished || sequenceTokenRef.current !== token || !isActiveRef.current) return;
        if (trailerPlayer.status === 'readyToPlay') {
          try {
            trailerPlayer.muted = trailerMutedRef.current;
            trailerPlayer.play();
          } catch {}
          setTrailerReady(true);
          Animated.timing(trailerOpacity, {
            toValue: 1,
            duration: 550,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start();
        }
      });
    }, 5000);

    // Advance slowly to next slide only after generous trailer preview time (34s)
    const nextSlideTimer =
      items.length > 1
        ? setTimeout(() => {
            if (sequenceTokenRef.current === token && isActiveRef.current) {
              goToIndex(activeIndex + 1);
            }
          }, 34000)
        : null;

    return () => {
      abortCtrl.abort();
      clearTimeout(preloadTimer);
      clearTimeout(collapseTimer);
      if (nextSlideTimer) clearTimeout(nextSlideTimer);
      if (collapseAnimRef.current) {
        collapseAnimRef.current.stop();
        collapseAnimRef.current = null;
      }
      stopTrailerImmediately();
    };
  }, [
    activeIndex,
    isActive,
    items,
    spreadProgress,
    dockProgress,
    layoutProgress,
    trailerOpacity,
    trailerPlayer,
    stopTrailerImmediately,
    goToIndex,
  ]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dy) < 28,
        onPanResponderRelease: (_, g) => {
          if (g.dx < -38) {
            Haptics.selectionAsync();
            goToIndex(activeIndexRef.current + 1);
          } else if (g.dx > 38) {
            Haptics.selectionAsync();
            goToIndex(activeIndexRef.current - 1);
          }
        },
      }),
    [goToIndex]
  );

  if (items.length === 0) return null;

  const activeItem = items[activeIndex] || items[0];
  const cardW = Math.min(208, portraitWidth * 0.54);
  const cardH = Math.round(cardW * 1.44);
  const dockScale = 0.48;
  const dockW = Math.round(cardW * dockScale);
  const dockTranslateX = Math.max(
    48,
    Math.round((portraitWidth - 36) / 2 - dockW / 2)
  );
  const dockTranslateY = Math.round(
    (cardH + 22) / 2 + 14 + Math.max(48, infoHeaderHeight * 0.54)
  );

  const getRelativeOffset = (idx: number) => {
    const total = items.length;
    let diff = idx - activeIndex;
    if (diff > total / 2) diff -= total;
    if (diff < -total / 2) diff += total;
    return diff;
  };

  const backSlots = items
    .map((item, idx) => ({ item, idx, rel: getRelativeOffset(idx) }))
    .filter((entry) => entry.rel !== 0 && Math.abs(entry.rel) <= 2)
    .sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));

  const renderBackSlot = (
    item: MovieItem,
    idx: number,
    rel: number,
    slotKey: string
  ) => {
    const isNear = Math.abs(rel) === 1;
    const targetX = isNear ? rel * 76 : rel * 64;
    const targetY = isNear ? 8 : 16;
    const targetScale = isNear ? 0.86 : 0.72;
    const targetSkew = isNear ? -rel * 3.2 : -rel * 4.5;
    const targetOpacity = isNear ? 0.88 : 0.52;
    const zIndex = isNear ? 20 : 10;

    const animTranslateX = spreadProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, targetX],
    });
    const animTranslateY = spreadProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, targetY],
    });
    const animScale = spreadProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.84, targetScale],
    });
    const animSkew = spreadProgress.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', `${targetSkew}deg`],
    });
    const animOpacity = spreadProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, targetOpacity],
    });

    return (
      <Animated.View
        key={slotKey}
        style={[
          styles.deckCardWrap,
          {
            width: cardW,
            height: cardH,
            zIndex,
            opacity: animOpacity,
            transform: [
              { translateX: animTranslateX },
              { translateY: animTranslateY },
              { skewY: animSkew },
              { scale: animScale },
            ],
          },
        ]}
      >
        <BouncyButton
          bounciness="gentle"
          pressScale={0.96}
          activeOpacity={0.92}
          onPress={() => {
            Haptics.selectionAsync();
            goToIndex(idx);
          }}
          style={[styles.deckCard, styles.deckCardSideBorder]}
        >
          <LazyImage
            uri={item.thumbnail_url || item.poster_url}
            style={styles.cardPoster}
            resizeMode="cover"
          />
          <View style={styles.dimOverlay} />
        </BouncyButton>
      </Animated.View>
    );
  };

  const centerTranslateX = dockProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, dockTranslateX],
  });
  const centerTranslateY = dockProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, dockTranslateY],
  });
  const centerScale = dockProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, dockScale],
  });
  const playDotOpacity = dockProgress.interpolate({
    inputRange: [0, 0.35],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const infoRightPadding = layoutProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, dockW + 14],
  });

  const metaPieces = [activeItem.year, activeItem.runtime, activeItem.video_quality || 'FHD'].filter(
    Boolean
  );
  const ratingText = activeItem.imdb_rating ? `${activeItem.imdb_rating}/10` : 'Đang cập nhật';
  const viewText =
    activeItem.total_view && activeItem.total_view > 0
      ? `(${activeItem.total_view.toLocaleString('en-US')} lượt xem)`
      : '';

  return (
    <View style={[styles.shell, { paddingTop: topInset + 104 }]}>
      {/* Fallback ambient blurred poster background before trailer fades in */}
      <Image
        source={{ uri: activeItem.poster_url || activeItem.thumbnail_url }}
        style={styles.backdropImg}
        blurRadius={24}
        resizeMode="cover"
      />

      {/* Full-Bleed UNBLURRED Cinema Trailer Backdrop + Cinema Dot-Matrix Overlay */}
      <Animated.View
        pointerEvents="none"
        style={[styles.trailerBackdropWrap, { opacity: trailerOpacity }]}
      >
        <VideoView
          player={trailerPlayer}
          style={styles.trailerVideoFull}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
        />
        <Image
          source={{ uri: CINEMA_DOT_PATTERN_DATA_URI }}
          resizeMode="repeat"
          style={styles.cinemaDotsOverlay}
        />
      </Animated.View>

      {/* Subtle readability gradient (soft top edge per Image 14, smooth bottom blend) */}
      <LinearGradient
        colors={[
          'rgba(7,9,15,0.22)',
          'rgba(7,9,15,0.06)',
          'rgba(7,9,15,0.34)',
          'rgba(7,9,15,0.82)',
          COLORS.bg,
        ]}
        locations={[0, 0.28, 0.54, 0.82, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {trailerReady ? (
        <View style={[styles.trailerMuteHost, { top: topInset + 108 }]}>
          <BouncyButton
            pressScale={0.86}
            onPress={() => {
              Haptics.selectionAsync();
              setTrailerMuted((m) => !m);
            }}
            accessibilityLabel={trailerMuted ? 'Bật âm thanh trailer' : 'Tắt âm thanh trailer'}
          >
            <GlassSurface variant="liquid" radius={24} intensity={26} style={styles.trailerMutePill}>
              <Ionicons
                name={trailerMuted ? 'volume-mute' : 'volume-high'}
                size={16}
                color="#FFFFFF"
              />
            </GlassSurface>
          </BouncyButton>
        </View>
      ) : null}

      {/* 3D Perspective Poster Card Deck */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.deckArea,
          { height: cardH + 22, transform: [{ scale: deckScale }] },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.deckBackLayer} pointerEvents="box-none">
          {backSlots.map(({ item, idx, rel }) =>
            renderBackSlot(item, idx, rel, `slot_${rel}`)
          )}
        </View>
        <View style={styles.deckFrontLayer} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.deckCardWrap,
              styles.deckCardCenter,
              {
                width: cardW,
                height: cardH,
                zIndex: 120,
                transform: [
                  { translateX: centerTranslateX },
                  { translateY: centerTranslateY },
                  { scale: centerScale },
                ],
              },
            ]}
          >
            <BouncyButton
              bounciness="gentle"
              pressScale={0.95}
              activeOpacity={0.92}
              onPress={() => {
                Haptics.selectionAsync();
                onOpenDetail(activeItem.videos_id);
              }}
              style={[styles.deckCard, styles.deckCardCenterBorder]}
            >
              <LazyImage
                uri={activeItem.thumbnail_url || activeItem.poster_url}
                style={styles.cardPoster}
                resizeMode="cover"
              />
              <Animated.View style={[styles.playDotBtnWrap, { opacity: playDotOpacity }]}>
                <BouncyButton
                  activeOpacity={0.85}
                  pressScale={0.84}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onPlay(activeItem);
                  }}
                  style={styles.playDotBtn}
                >
                  <LinearGradient
                    colors={['#e50914', '#d50055']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.playDotGradient}
                  >
                    <Ionicons name="play" size={20} color="#FFF" style={{ marginLeft: 2 }} />
                  </LinearGradient>
                </BouncyButton>
              </Animated.View>
            </BouncyButton>
          </Animated.View>
        </View>
      </Animated.View>

      {/* Active Info Panel (`.dva-hero-3d-info`) */}
      <Animated.View style={[styles.infoPanel, { opacity: infoFade }]}>
        <Animated.View
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            if (h > 40 && Math.abs(h - infoHeaderHeight) > 3) {
              setInfoHeaderHeight(h);
            }
          }}
          style={[styles.infoHeaderSlot, { paddingRight: infoRightPadding }]}
        >
          <View style={styles.typePill}>
            <Text style={styles.typePillText}>
              {activeItem.is_tvseries === 1 ? 'Phim bộ' : 'Phim lẻ'}
            </Text>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {activeItem.title_primary || activeItem.title}
          </Text>

          <Text style={styles.metaText} numberOfLines={1}>
            {metaPieces.join('  •  ')}
          </Text>

          <View style={styles.ratingRow}>
            <Ionicons name="star" size={14} color={COLORS.accentGold} />
            <Text style={styles.ratingBold}>{ratingText}</Text>
            {viewText ? <Text style={styles.ratingMuted}>{viewText}</Text> : null}
          </View>

          {isDocked ? (
            <BouncyButton
              accessibilityLabel={`Xem chi tiết ${activeItem.title_primary || activeItem.title}`}
              pressScale={0.95}
              onPress={() => {
                Haptics.selectionAsync();
                onOpenDetail(activeItem.videos_id);
              }}
              style={[
                styles.dockedPosterHitbox,
                { width: dockW + 4 },
              ]}
            />
          ) : null}
        </Animated.View>

        {activeItem.description ? (
          <Text style={styles.desc} numberOfLines={3}>
            {activeItem.description}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <BouncyButton
            bounciness="gentle"
            activeOpacity={0.88}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onPlay(activeItem);
            }}
            style={styles.watchNowWrap}
          >
            <LinearGradient
              colors={['#e50914', '#d50055']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.watchNowBtn}
            >
              <Ionicons name="play" size={16} color="#FFF" />
              <Text style={styles.watchNowTxt}>Xem ngay</Text>
            </LinearGradient>
          </BouncyButton>

          <BouncyButton
            activeOpacity={0.82}
            pressScale={0.86}
            onPress={() => onToggleWishlist(activeItem)}
            style={[
              styles.wishlistBtn,
              activeItem.in_wishlist && styles.wishlistBtnActive,
            ]}
          >
            <Ionicons
              name={activeItem.in_wishlist ? 'checkmark' : 'add'}
              size={22}
              color="#FFF"
            />
          </BouncyButton>

          <BouncyButton
            activeOpacity={0.82}
            pressScale={0.86}
            onPress={() => onOpenDetail(activeItem.videos_id)}
            style={styles.wishlistBtn}
          >
            <Ionicons name="information-circle-outline" size={21} color="#FFF" />
          </BouncyButton>
        </View>

        {/* Bottom Nav: Dots left, prev/next arrows right */}
        <View style={styles.navRow}>
          <View style={styles.dotsRow}>
            {items.map((h, i) => (
              <BouncyButton
                key={h.videos_id}
                onPress={() => {
                  Haptics.selectionAsync();
                  goToIndex(i);
                }}
                hitSlop={6}
              >
                <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
              </BouncyButton>
            ))}
          </View>

          <View style={styles.arrowsRow}>
            <BouncyButton
              pressScale={0.84}
              onPress={() => {
                Haptics.selectionAsync();
                goToIndex(activeIndex - 1);
              }}
              style={styles.arrowBtn}
            >
              <Ionicons name="chevron-back" size={18} color="#FFF" />
            </BouncyButton>
            <BouncyButton
              pressScale={0.84}
              onPress={() => {
                Haptics.selectionAsync();
                goToIndex(activeIndex + 1);
              }}
              style={styles.arrowBtn}
            >
              <Ionicons name="chevron-forward" size={18} color="#FFF" />
            </BouncyButton>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    position: 'relative',
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingBottom: 14,
    marginBottom: 0,
  },
  backdropImg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.44,
  },
  trailerBackdropWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  trailerVideoFull: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    transform: [{ scale: 1.04 }],
  },
  cinemaDotsOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.65,
  },
  trailerMuteHost: {
    position: 'absolute',
    right: 16,
    zIndex: 60,
  },
  trailerMutePill: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deckArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 14,
    position: 'relative',
    overflow: 'visible',
    zIndex: 30,
  },
  deckBackLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    overflow: 'visible',
  },
  deckFrontLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    overflow: 'visible',
  },
  deckCardWrap: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  deckCard: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1.5,
    backgroundColor: '#07090F',
  },
  deckCardSideBorder: {
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  deckCardCenterBorder: {
    borderColor: 'rgba(255, 255, 255, 0.48)',
  },
  deckCardCenter: {
    shadowOpacity: 0.88,
    shadowRadius: 26,
    elevation: 24,
  },
  cardPoster: {
    width: '100%',
    height: '100%',
  },
  dimOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7, 9, 15, 0.34)',
  },
  playDotBtnWrap: {
    position: 'absolute',
    right: 12,
    bottom: 12,
  },
  playDotBtn: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#E50914',
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  playDotGradient: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoPanel: {
    alignItems: 'flex-start',
    gap: 8,
    zIndex: 10,
  },
  infoHeaderSlot: {
    width: '100%',
    alignItems: 'flex-start',
    gap: 6,
    position: 'relative',
  },
  dockedPosterHitbox: {
    position: 'absolute',
    right: 0,
    top: -10,
    bottom: -10,
    zIndex: 40,
  },
  typePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  typePillText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '600',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  metaText: {
    color: 'rgba(203, 213, 225, 0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingBold: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  ratingMuted: {
    color: 'rgba(148, 163, 184, 0.9)',
    fontSize: 12.5,
  },
  desc: {
    color: 'rgba(245, 246, 250, 0.78)',
    fontSize: 13,
    lineHeight: 19,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  watchNowWrap: {
    borderRadius: 24,
    overflow: 'hidden',
    boxShadow: GLASS_SHADOW,
  },
  watchNowBtn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  watchNowTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  wishlistBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: GLASS_SHADOW,
  },
  wishlistBtnActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.28)',
    borderColor: 'rgba(229, 9, 20, 0.65)',
  },
  navRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.26)',
  },
  dotActive: {
    width: 22,
    backgroundColor: '#E50914',
  },
  arrowsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  arrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
