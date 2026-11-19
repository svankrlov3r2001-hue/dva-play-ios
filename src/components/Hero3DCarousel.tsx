import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/config';
import { MovieItem } from '../types/models';
import { LazyImage } from './LazyImage';

interface Hero3DCarouselProps {
  items: MovieItem[];
  topInset: number;
  onPlay: (item: MovieItem) => void;
  onToggleWishlist: (item: MovieItem) => void;
  onOpenDetail: (videosId: number) => void;
}

/**
 * Interactive 3D Perspective Hero Carousel ported smoothly to iOS
 * matching `.dva-hero-3d-shell` in W:\public_html\dva_play\index.php.
 */
export function Hero3DCarousel({
  items,
  topInset,
  onPlay,
  onToggleWishlist,
  onOpenDetail,
}: Hero3DCarouselProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const [activeIndex, setActiveIndex] = useState(0);
  const deckScale = useRef(new Animated.Value(1)).current;
  const infoFade = useRef(new Animated.Value(1)).current;

  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;
  const countRef = useRef(items.length);
  countRef.current = items.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [items.length]);

  // Smooth auto-advance matching DVA Play
  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => {
      goToIndex((activeIndexRef.current + 1) % items.length);
    }, 6500);
    return () => clearInterval(t);
  }, [items.length]);

  const goToIndex = (targetIdx: number) => {
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
  };

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
    []
  );

  if (items.length === 0) return null;

  const activeItem = items[activeIndex] || items[0];
  const cardW = Math.min(208, portraitWidth * 0.54);
  const cardH = Math.round(cardW * 1.44);

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

  const renderCardSlot = (
    item: MovieItem,
    idx: number,
    rel: number,
    slotKey: string
  ) => {
    const isCenter = rel === 0;
    const isNear = Math.abs(rel) === 1;
    const translateX = rel === 0 ? 0 : isNear ? rel * 76 : rel * 64;
    const translateY = rel === 0 ? 0 : isNear ? 8 : 16;
    const scale = rel === 0 ? 1 : isNear ? 0.86 : 0.72;
    const skewY = rel === 0 ? '0deg' : isNear ? `${-rel * 3.2}deg` : `${-rel * 4.5}deg`;
    const opacity = rel === 0 ? 1 : isNear ? 0.88 : 0.52;
    const zIndex = rel === 0 ? 100 : isNear ? 20 : 10;

    return (
      <TouchableOpacity
        key={slotKey}
        activeOpacity={0.92}
        onPress={() => {
          Haptics.selectionAsync();
          if (isCenter) {
            onOpenDetail(item.videos_id);
          } else {
            goToIndex(idx);
          }
        }}
        style={[
          styles.deckCard,
          isCenter && styles.deckCardCenter,
          {
            width: cardW,
            height: cardH,
            zIndex,
            opacity,
            borderColor: isCenter
              ? 'rgba(255, 255, 255, 0.48)'
              : 'rgba(255, 255, 255, 0.16)',
            transform: [
              { translateX },
              { translateY },
              { skewY },
              { scale },
            ],
          },
        ]}
      >
        <LazyImage
          uri={item.thumbnail_url || item.poster_url}
          style={styles.cardPoster}
          resizeMode="cover"
        />
        {!isCenter ? <View style={styles.dimOverlay} /> : null}
        {isCenter ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onPlay(item);
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
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    );
  };

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
      {/* Blurred full-bleed ambient poster background blending smoothly into app background */}
      <Image
        source={{ uri: activeItem.poster_url || activeItem.thumbnail_url }}
        style={styles.backdropImg}
        blurRadius={22}
        resizeMode="cover"
      />
      <View pointerEvents="none" style={styles.bottomBlurBand}>
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
      </View>
      <LinearGradient
        colors={[
          'rgba(7,9,15,0.42)',
          'rgba(7,9,15,0.18)',
          'rgba(12,9,16,0.52)',
          'rgba(12,9,16,0.82)',
          'rgba(12,9,16,0.34)',
          'transparent',
        ]}
        locations={[0, 0.32, 0.62, 0.80, 0.92, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* 3D Perspective Poster Card Deck: Back layer renders side cards, Front layer always renders Center Active Card on top */}
      <Animated.View
        style={[
          styles.deckArea,
          { height: cardH + 22, transform: [{ scale: deckScale }] },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.deckBackLayer} pointerEvents="box-none">
          {backSlots.map(({ item, idx, rel }) =>
            renderCardSlot(item, idx, rel, `slot_${rel}`)
          )}
        </View>
        <View style={styles.deckFrontLayer} pointerEvents="box-none">
          {renderCardSlot(activeItem, activeIndex, 0, 'slot_active')}
        </View>
      </Animated.View>

      {/* Active Info Panel (`.dva-hero-3d-info`) */}
      <Animated.View style={[styles.infoPanel, { opacity: infoFade }]}>
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

        {activeItem.description ? (
          <Text style={styles.desc} numberOfLines={3}>
            {activeItem.description}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <TouchableOpacity
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
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.82}
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
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.82}
            onPress={() => onOpenDetail(activeItem.videos_id)}
            style={styles.wishlistBtn}
          >
            <Ionicons name="information-circle-outline" size={21} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Bottom Nav: Dots left, prev/next arrows right */}
        <View style={styles.navRow}>
          <View style={styles.dotsRow}>
            {items.map((h, i) => (
              <TouchableOpacity
                key={h.videos_id}
                onPress={() => {
                  Haptics.selectionAsync();
                  goToIndex(i);
                }}
                hitSlop={6}
              >
                <View style={[styles.dot, i === activeIndex && styles.dotActive]} />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.arrowsRow}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                goToIndex(activeIndex - 1);
              }}
              style={styles.arrowBtn}
            >
              <Ionicons name="chevron-back" size={18} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                goToIndex(activeIndex + 1);
              }}
              style={styles.arrowBtn}
            >
              <Ionicons name="chevron-forward" size={18} color="#FFF" />
            </TouchableOpacity>
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
    paddingBottom: 18,
    marginBottom: 0,
  },
  backdropImg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 28,
    left: 0,
    opacity: 0.44,
  },
  bottomBlurBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 92,
  },
  deckArea: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 14,
    position: 'relative',
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
  },
  deckCard: {
    position: 'absolute',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1.5,
    backgroundColor: '#07090F',
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
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
  playDotBtn: {
    position: 'absolute',
    right: 12,
    bottom: 12,
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
