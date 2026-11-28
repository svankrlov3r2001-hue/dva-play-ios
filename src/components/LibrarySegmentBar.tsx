import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BouncyButton } from './BouncyButton';
import { GLASS_SHADOW } from '../constants/config';

export type LibraryTabKey = 'wishlist' | 'watched' | 'offline';

interface LibrarySegmentBarProps {
  activeTab: LibraryTabKey;
  wishlistCount: number;
  watchedCount: number;
  offlineCount: number;
  onSelectTab: (tab: LibraryTabKey) => void;
}

const ACTIVE_ACCENT_COLOR = '#FF3B4E';

export function LibrarySegmentBar({
  activeTab,
  wishlistCount,
  watchedCount,
  offlineCount,
  onSelectTab,
}: LibrarySegmentBarProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const barWidth = Math.min(portraitWidth - 32, 460);
  const innerPad = 4;
  const [measuredWidth, setMeasuredWidth] = useState(barWidth);

  useEffect(() => {
    setMeasuredWidth((prev) => (Math.abs(prev - barWidth) > 1 ? barWidth : prev));
  }, [barWidth]);

  const items = useMemo(
    () =>
      [
        {
          key: 'wishlist' as const,
          label: `Yêu thích (${wishlistCount})`,
          icon: 'heart-outline' as const,
          activeIcon: 'heart' as const,
        },
        {
          key: 'watched' as const,
          label: `Đang xem (${watchedCount})`,
          icon: 'time-outline' as const,
          activeIcon: 'time' as const,
        },
        {
          key: 'offline' as const,
          label: `Ngoại tuyến (${offlineCount})`,
          icon: 'cloud-done-outline' as const,
          activeIcon: 'cloud-done' as const,
        },
      ] as const,
    [wishlistCount, watchedCount, offlineCount]
  );

  const itemWidth = Math.max(70, (measuredWidth - innerPad * 2) / items.length);
  const activeIndex = Math.max(
    0,
    items.findIndex((t) => t.key === activeTab)
  );

  const indicatorLeft = useRef(new Animated.Value(innerPad + activeIndex * itemWidth)).current;
  const indicatorScale = useRef(new Animated.Value(1)).current;
  const [isDragging, setIsDragging] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const hoverIndexRef = useRef<number | null>(null);
  const startLeftRef = useRef(0);
  const itemWidthRef = useRef(itemWidth);
  itemWidthRef.current = itemWidth;
  const measuredWidthRef = useRef(measuredWidth);
  measuredWidthRef.current = measuredWidth;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onSelectTabRef = useRef(onSelectTab);
  onSelectTabRef.current = onSelectTab;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (isDragging) return;
    const targetLeft = innerPad + activeIndex * itemWidth;

    Animated.parallel([
      Animated.spring(indicatorLeft, {
        toValue: targetLeft,
        tension: 135,
        friction: 15,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(indicatorScale, {
          toValue: 1.1,
          duration: 135,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(indicatorScale, {
          toValue: 1,
          tension: 150,
          friction: 12,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [activeIndex, itemWidth, isDragging, indicatorLeft, indicatorScale]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 6 && Math.abs(gesture.dy) < 28,
        onPanResponderGrant: () => {
          setIsDragging(true);
          startLeftRef.current = innerPad + activeIndexRef.current * itemWidthRef.current;
          hoverIndexRef.current = activeIndexRef.current;
          setHoverIndex(activeIndexRef.current);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.spring(indicatorScale, {
            toValue: 1.14,
            tension: 180,
            friction: 14,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderMove: (_, gesture) => {
          const w = itemWidthRef.current;
          const maxLeft = measuredWidthRef.current - innerPad - w;
          const rawLeft = startLeftRef.current + gesture.dx;
          const clamped = Math.max(innerPad, Math.min(maxLeft, rawLeft));
          indicatorLeft.setValue(clamped);

          const center = clamped + w / 2 - innerPad;
          const idx = Math.max(
            0,
            Math.min(itemsRef.current.length - 1, Math.floor(center / w))
          );
          if (idx !== hoverIndexRef.current) {
            hoverIndexRef.current = idx;
            setHoverIndex(idx);
            Haptics.selectionAsync();
          }
        },
        onPanResponderRelease: (_, gesture) => {
          const w = itemWidthRef.current;
          const maxLeft = measuredWidthRef.current - innerPad - w;
          const finalLeft = Math.max(
            innerPad,
            Math.min(maxLeft, startLeftRef.current + gesture.dx)
          );
          const center = finalLeft + w / 2 - innerPad;
          const idx = Math.max(
            0,
            Math.min(itemsRef.current.length - 1, Math.floor(center / w))
          );

          setIsDragging(false);
          setHoverIndex(null);
          hoverIndexRef.current = null;

          Animated.spring(indicatorScale, {
            toValue: 1,
            tension: 150,
            friction: 12,
            useNativeDriver: true,
          }).start();

          const chosen = itemsRef.current[idx];
          if (chosen) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelectTabRef.current(chosen.key);
          }
        },
        onPanResponderTerminate: () => {
          setIsDragging(false);
          setHoverIndex(null);
          hoverIndexRef.current = null;
          Animated.spring(indicatorScale, {
            toValue: 1,
            tension: 150,
            friction: 12,
            useNativeDriver: true,
          }).start();
        },
      }),
    [indicatorLeft, indicatorScale]
  );

  const handleBarLayout = (e: LayoutChangeEvent) => {
    const w = Math.min(e.nativeEvent.layout.width, barWidth);
    if (w > 0 && Math.abs(w - measuredWidth) > 1) {
      setMeasuredWidth(w);
    }
  };

  return (
    <View style={styles.outerWrap}>
      <View
        onLayout={handleBarLayout}
        style={[styles.menuBar, { width: barWidth }]}
        {...panResponder.panHandlers}
      >
        <View style={styles.glassClip} pointerEvents="none">
          <BlurView intensity={32} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
          <View style={styles.glassTint} />
          <LinearGradient
            colors={[
              'rgba(255,255,255,0.20)',
              'rgba(255,255,255,0.03)',
              'rgba(255,255,255,0.14)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.rimBorder}
          />
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicatorWrap,
            {
              left: indicatorLeft,
              width: itemWidth,
            },
          ]}
        >
          <Animated.View
            style={[
              styles.indicatorPill,
              isDragging && styles.indicatorPillDragging,
              { transform: [{ scale: indicatorScale }] },
            ]}
          />
        </Animated.View>

        <View style={[styles.itemsRow, { paddingHorizontal: innerPad }]}>
          {items.map((item, idx) => {
            const isActive = activeTab === item.key;
            const isHovered = isDragging && hoverIndex === idx;
            const highlighted = isHovered || (!isDragging && isActive);

            return (
              <BouncyButton
                key={item.key}
                activeOpacity={0.85}
                pressScale={0.92}
                style={[styles.menuItem, { width: itemWidth }]}
                onPress={() => {
                  Haptics.selectionAsync();
                  onSelectTab(item.key);
                }}
              >
                <Ionicons
                  name={highlighted ? item.activeIcon : item.icon}
                  size={15}
                  color={highlighted ? ACTIVE_ACCENT_COLOR : '#F1F5F9'}
                  style={styles.iconSpacing}
                />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  style={[styles.label, highlighted && styles.labelActive]}
                >
                  {item.label}
                </Text>
              </BouncyButton>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrap: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  menuBar: {
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    boxShadow: GLASS_SHADOW,
    elevation: 12,
  },
  glassClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 23,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  glassTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(16, 18, 24, 0.36)',
  },
  rimBorder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.28,
  },
  indicatorWrap: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  indicatorPill: {
    width: '96%',
    height: '100%',
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  indicatorPillDragging: {
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    zIndex: 3,
  },
  menuItem: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  iconSpacing: {
    marginRight: 4,
  },
  label: {
    color: 'rgba(241, 245, 249, 0.84)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  labelActive: {
    color: ACTIVE_ACCENT_COLOR,
    fontWeight: '700',
  },
});
