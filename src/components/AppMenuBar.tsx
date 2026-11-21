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

export type AppTabKey = 'home' | 'explore' | 'search' | 'library';

export interface AppMenuTabItem {
  key: AppTabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}

const MENU_ITEMS: AppMenuTabItem[] = [
  { key: 'home', label: 'Trang chủ', icon: 'home-outline', activeIcon: 'home' },
  { key: 'explore', label: 'Khám phá', icon: 'compass-outline', activeIcon: 'compass' },
  { key: 'search', label: 'Tìm kiếm', icon: 'search-outline', activeIcon: 'search' },
  { key: 'library', label: 'Tủ phim', icon: 'bookmark-outline', activeIcon: 'bookmark' },
];

const ACTIVE_ACCENT_COLOR = '#FF3B4E';

interface AppMenuBarProps {
  activeTab: AppTabKey;
  bottomInset: number;
  onSelectTab: (tab: AppTabKey) => void;
}

/**
 * Compact 4-item iOS Liquid Glass Floating Tab Bar with sliding spring pill
 * and finger-drag scrubbing.
 */
export function AppMenuBar({ activeTab, bottomInset, onSelectTab }: AppMenuBarProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const barWidth = Math.min(portraitWidth - 28, 420);
  const innerPad = 5;
  const [measuredWidth, setMeasuredWidth] = useState(barWidth);

  useEffect(() => {
    setMeasuredWidth((prev) => (Math.abs(prev - barWidth) > 1 ? barWidth : prev));
  }, [barWidth]);

  const itemWidth = Math.max(48, (measuredWidth - innerPad * 2) / MENU_ITEMS.length);

  const activeIndex = Math.max(
    0,
    MENU_ITEMS.findIndex((t) => t.key === activeTab)
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
          toValue: 1.16,
          duration: 145,
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
        onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 && Math.abs(gesture.dy) < 28,
        onPanResponderGrant: () => {
          setIsDragging(true);
          startLeftRef.current = innerPad + activeIndexRef.current * itemWidthRef.current;
          hoverIndexRef.current = activeIndexRef.current;
          setHoverIndex(activeIndexRef.current);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Animated.spring(indicatorScale, {
            toValue: 1.2,
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
            Math.min(MENU_ITEMS.length - 1, Math.floor(center / w))
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
            Math.min(MENU_ITEMS.length - 1, Math.floor(center / w))
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

          const chosen = MENU_ITEMS[idx];
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
    <View
      pointerEvents="box-none"
      style={[styles.outerWrap, { bottom: Math.max(10, bottomInset - 6) }]}
    >
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
          {MENU_ITEMS.map((item, idx) => {
            const isActive = activeTab === item.key;
            const isHovered = isDragging && hoverIndex === idx;
            const highlighted = isHovered || (!isDragging && isActive);

            return (
              <BouncyButton
                key={item.key}
                activeOpacity={0.85}
                pressScale={0.86}
                style={[styles.menuItem, { width: itemWidth }]}
                onPress={() => {
                  Haptics.selectionAsync();
                  onSelectTab(item.key);
                }}
              >
                <View
                  style={[
                    styles.iconBox,
                    highlighted && styles.iconActive,
                    isHovered && styles.iconDragHover,
                  ]}
                >
                  <Ionicons
                    name={highlighted ? item.activeIcon : item.icon}
                    size={22}
                    color={highlighted ? ACTIVE_ACCENT_COLOR : '#F1F5F9'}
                  />
                </View>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    highlighted && styles.labelActive,
                    isHovered && styles.labelDragHover,
                  ]}
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
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 200,
  },
  menuBar: {
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    boxShadow: GLASS_SHADOW,
    elevation: 18,
  },
  glassClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 32,
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
    top: 5,
    bottom: 5,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  indicatorPill: {
    width: '94%',
    height: '100%',
    borderRadius: 27,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  indicatorPillDragging: {
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    borderColor: 'rgba(255, 255, 255, 0.28)',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.22,
    shadowRadius: 12,
  },
  itemsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    zIndex: 3,
  },
  menuItem: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    marginBottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActive: {
    transform: [{ translateY: -1 }],
  },
  iconDragHover: {
    transform: [{ translateY: -3 }, { scale: 1.14 }],
  },
  label: {
    color: 'rgba(241, 245, 249, 0.82)',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  labelActive: {
    color: ACTIVE_ACCENT_COLOR,
    fontWeight: '700',
  },
  labelDragHover: {
    color: ACTIVE_ACCENT_COLOR,
    fontWeight: '700',
    transform: [{ translateY: 2 }, { scale: 1.05 }],
  },
});
