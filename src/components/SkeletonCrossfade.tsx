import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { COLORS } from '../constants/config';

interface SkeletonCrossfadeProps {
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** True for dynamic-height modals/sheets so the skeleton sizes the container while loading */
  intrinsicHeight?: boolean;
  /** Keep skeleton pre-mounted in background (default true for main screens, false for intrinsicHeight) */
  keepSkeletonMounted?: boolean;
  fadeDurationMs?: number;
  backgroundColor?: string;
}

/**
 * Smoothly crossfades from a shimmering skeleton placeholder into loaded content
 * without flash or layout jitter.
 */
export function SkeletonCrossfade({
  loading,
  skeleton,
  children,
  style,
  intrinsicHeight = false,
  keepSkeletonMounted = !intrinsicHeight,
  fadeDurationMs = 300,
  backgroundColor = COLORS.bg,
}: SkeletonCrossfadeProps) {
  const [renderSkeleton, setRenderSkeleton] = useState(loading);
  const skeletonOpacity = useRef(new Animated.Value(loading ? 1 : 0)).current;
  const contentOpacity = useRef(new Animated.Value(loading ? 0 : 1)).current;
  const wasLoadingRef = useRef(loading);

  // Immediately reveal skeleton on Frame 0 before commit when loading transitions false -> true
  if (loading && !wasLoadingRef.current) {
    skeletonOpacity.stopAnimation();
    contentOpacity.stopAnimation();
    skeletonOpacity.setValue(1);
    contentOpacity.setValue(0);
  }

  useEffect(() => {
    if (loading) {
      wasLoadingRef.current = true;
      skeletonOpacity.stopAnimation();
      contentOpacity.stopAnimation();
      setRenderSkeleton(true);
      skeletonOpacity.setValue(1);
      contentOpacity.setValue(0);
      return;
    }

    if (wasLoadingRef.current) {
      wasLoadingRef.current = false;
      setRenderSkeleton(true);
      let cancelled = false;
      const rafId = requestAnimationFrame(() => {
        if (cancelled) return;
        skeletonOpacity.stopAnimation();
        contentOpacity.stopAnimation();
        Animated.parallel([
          Animated.timing(skeletonOpacity, {
            toValue: 0,
            duration: fadeDurationMs,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: fadeDurationMs + 40,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished && !cancelled) {
            setRenderSkeleton(false);
          }
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(rafId);
      };
    }

    contentOpacity.setValue(1);
    skeletonOpacity.setValue(0);
    setRenderSkeleton(false);
  }, [loading, fadeDurationMs, skeletonOpacity, contentOpacity]);

  const showSkeleton = keepSkeletonMounted || loading || renderSkeleton;

  if (intrinsicHeight) {
    return (
      <View style={[styles.intrinsicContainer, style]}>
        {!loading ? (
          <Animated.View style={{ opacity: contentOpacity }}>
            {children}
          </Animated.View>
        ) : null}
        {showSkeleton ? (
          <Animated.View
            pointerEvents={loading ? 'auto' : 'none'}
            style={[
              loading ? styles.intrinsicSkeleton : styles.overlay,
              { backgroundColor, opacity: skeletonOpacity },
            ]}
          >
            {skeleton}
          </Animated.View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Animated.View
        pointerEvents={loading ? 'none' : 'auto'}
        style={[styles.fill, { opacity: contentOpacity }]}
      >
        {children}
      </Animated.View>
      {showSkeleton ? (
        <Animated.View
          pointerEvents={loading ? 'auto' : 'none'}
          style={[styles.overlay, { backgroundColor, opacity: skeletonOpacity }]}
        >
          {skeleton}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  fill: {
    flex: 1,
  },
  intrinsicContainer: {
    position: 'relative',
    overflow: 'hidden',
  },
  intrinsicSkeleton: {
    width: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 5,
  },
});
