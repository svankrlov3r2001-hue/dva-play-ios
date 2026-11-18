import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface SplashOverlayProps {
  visible: boolean;
  dismissing: boolean;
  statusText: string;
  hasError: boolean;
  onRetry: () => void;
}

/**
 * Minimum 3-second startup connection UX matching
 * dva-play/src/renderer/splash.html & splashManager.js.
 */
export function SplashOverlay({
  visible,
  dismissing,
  statusText,
  hasError,
  onRetry,
}: SplashOverlayProps) {
  const cardScale = useRef(new Animated.Value(0.92)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(-240)).current;
  const dotPulse = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 1,
        duration: 460,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, overlayOpacity, cardScale]);

  useEffect(() => {
    if (!dismissing) return;
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: 1.04,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [dismissing, overlayOpacity, cardScale]);

  useEffect(() => {
    if (!visible) return;
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerX, {
          toValue: 260,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerX, {
          toValue: -240,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 0.45,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    shimmerLoop.start();
    pulseLoop.start();

    return () => {
      shimmerLoop.stop();
      pulseLoop.stop();
    };
  }, [visible, shimmerX, dotPulse]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents={dismissing ? 'none' : 'auto'}
      style={[styles.overlay, { opacity: overlayOpacity }]}
    >
      {/* Radial ambient crimson & rose glows matching splash.html */}
      <LinearGradient
        colors={['rgba(229, 9, 20, 0.18)', 'transparent']}
        start={{ x: 0.15, y: 0.15 }}
        end={{ x: 0.75, y: 0.75 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(213, 0, 85, 0.14)']}
        start={{ x: 0.25, y: 0.25 }}
        end={{ x: 0.9, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View style={[styles.cardWrap, { transform: [{ scale: cardScale }] }]}>
        <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.cardTint} />
        <View style={styles.cardInner}>
          <Image
            source={require('../../assets/splash-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={styles.title}>Đặng Việt Anh</Text>

          <View style={[styles.statusPill, hasError && styles.statusPillError]}>
            <Animated.View
              style={[
                styles.shimmerSweep,
                { transform: [{ translateX: shimmerX }, { skewX: '-18deg' }] },
              ]}
            >
              <LinearGradient
                colors={[
                  'rgba(255,255,255,0)',
                  'rgba(255,255,255,0.16)',
                  'rgba(255,255,255,0)',
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>

            <Animated.View
              style={[
                styles.statusDot,
                {
                  backgroundColor: hasError ? '#fbbf24' : '#e50914',
                  opacity: dotPulse,
                  transform: [{ scale: dotPulse }],
                },
              ]}
            />
            <Text style={styles.statusText} numberOfLines={2}>
              {statusText || 'Đang kết nối...'}
            </Text>
          </View>

          {hasError ? (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.retryBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onRetry();
              }}
            >
              <Text style={styles.retryText}>Thử lại ngay</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>

      <Text style={styles.hint}>
        Đang đồng bộ không gian phim Đặng Việt Anh
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 9999,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  cardWrap: {
    width: Math.min(SCREEN_WIDTH - 48, 360),
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    shadowColor: '#000',
    shadowOpacity: 0.58,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 18 },
    elevation: 16,
  },
  cardTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  cardInner: {
    paddingVertical: 44,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  logo: {
    width: 108,
    height: 108,
    borderRadius: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  statusPill: {
    position: 'relative',
    overflow: 'hidden',
    minWidth: 196,
    maxWidth: 290,
    minHeight: 42,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusPillError: {
    borderColor: 'rgba(251, 191, 36, 0.45)',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
  },
  shimmerSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 110,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 13.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 2,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(229, 9, 20, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.65)',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  hint: {
    position: 'absolute',
    bottom: 44,
    color: 'rgba(245, 246, 250, 0.48)',
    fontSize: 12.5,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
