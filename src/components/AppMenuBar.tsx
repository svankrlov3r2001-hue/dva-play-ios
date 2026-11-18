import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type AppTabKey = 'home' | 'explore' | 'search' | 'library' | 'account';

export interface AppMenuTabItem {
  key: AppTabKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const MENU_ITEMS: AppMenuTabItem[] = [
  { key: 'home', label: 'Trang chủ', icon: 'home' },
  { key: 'explore', label: 'Khám phá', icon: 'compass' },
  { key: 'search', label: 'Tìm kiếm', icon: 'search' },
  { key: 'library', label: 'Tủ phim', icon: 'bookmark' },
  { key: 'account', label: 'Tài khoản', icon: 'person' },
];

interface AppMenuBarProps {
  activeTab: AppTabKey;
  bottomInset: number;
  onSelectTab: (tab: AppTabKey) => void;
}

/**
 * Native iOS Liquid Glass Menu Bar ported faithfully from `_L8j7Tt_app_container`
 * (`_L8j7Tt_menu_bar` & `_L8j7Tt_active_indicator`) in default/index.php.
 * Supports smooth spring indicator slides, scale bounce, AND interactive finger drag scrubbing.
 */
export function AppMenuBar({ activeTab, bottomInset, onSelectTab }: AppMenuBarProps) {
  const barWidth = Math.min(SCREEN_WIDTH - 20, 460);
  const innerPad = 10;
  const [measuredWidth, setMeasuredWidth] = useState(barWidth);
  const itemWidth = Math.max(40, (measuredWidth - innerPad * 2) / MENU_ITEMS.length);

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

  // Slide & bounce indicator when activeTab or width changes (when not dragging)
  useEffect(() => {
    if (isDragging) return;
    const targetLeft = innerPad + activeIndex * itemWidth;

    Animated.parallel([
      Animated.spring(indicatorLeft, {
        toValue: targetLeft,
        tension: 120,
        friction: 15,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(indicatorScale, {
          toValue: 1.26,
          duration: 165,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(indicatorScale, {
          toValue: 1,
          tension: 140,
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
            toValue: 1.32,
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
            tension: 140,
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
            tension: 140,
            friction: 12,
            useNativeDriver: true,
          }).start();
        },
      }),
    [indicatorLeft, indicatorScale]
  );

  const handleBarLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - measuredWidth) > 1) {
      setMeasuredWidth(w);
    }
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.outerWrap, { bottom: Math.max(10, bottomInset) }]}
    >
      <View
        onLayout={handleBarLayout}
        style={[styles.menuBar, { width: barWidth }]}
        {...panResponder.panHandlers}
      >
        {/* Rounded pill background clipped cleanly inside borderRadius 40 */}
        <View style={styles.glassClip} pointerEvents="none">
          <BlurView intensity={68} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.glassTint} />
          <LinearGradient
            colors={[
              'rgba(255,255,255,0.14)',
              'rgba(255,255,255,0.02)',
              'rgba(255,255,255,0.12)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.rimBorder}
          />
        </View>

        {/* `_L8j7Tt_active_indicator`: Sliding frosted capsule */}
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

        {/* Menu Items matching `_L8j7Tt_menu_item` */}
        <View style={[styles.itemsRow, { paddingHorizontal: innerPad }]}>
          {MENU_ITEMS.map((item, idx) => {
            const isActive = activeTab === item.key;
            const isHovered = isDragging && hoverIndex === idx;
            const highlighted = isHovered || (!isDragging && isActive);

            return (
              <TouchableOpacity
                key={item.key}
                activeOpacity={0.85}
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
                    name={item.icon}
                    size={22}
                    color={highlighted ? '#FFFFFF' : '#8E8E93'}
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
              </TouchableOpacity>
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
    height: 76,
    borderRadius: 40,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.56,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  glassClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  glassTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(20, 20, 20, 0.42)',
  },
  rimBorder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.25,
  },
  indicatorWrap: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  indicatorPill: {
    width: '96%',
    height: '100%',
    borderRadius: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  indicatorPillDragging: {
    backgroundColor: 'rgba(255, 255, 255, 0.19)',
    borderColor: 'rgba(255, 255, 255, 0.24)',
    shadowColor: '#FFFFFF',
    shadowOpacity: 0.22,
    shadowRadius: 14,
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
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActive: {
    transform: [{ translateY: -2 }],
  },
  iconDragHover: {
    transform: [{ translateY: -4 }, { scale: 1.2 }],
  },
  label: {
    color: '#8E8E93',
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  labelActive: {
    color: '#FFFFFF',
  },
  labelDragHover: {
    color: '#FFFFFF',
    transform: [{ translateY: 3 }, { scale: 1.08 }],
  },
});
