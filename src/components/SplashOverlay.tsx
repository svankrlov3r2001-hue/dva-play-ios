import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/config';
import { AmbientAppBackground } from './AmbientAppBackground';

interface SplashOverlayProps {
  visible: boolean;
  dismissing: boolean;
  statusText: string;
  hasError: boolean;
  offlineCount?: number;
  onRetry: () => void;
  onOpenOfflineMode?: () => void;
}

/**
 * Clean borderless startup connection splash matching DVA Play ambient UX.
 */
export function SplashOverlay({
  visible,
  dismissing,
  statusText,
  hasError,
  offlineCount = 0,
  onRetry,
  onOpenOfflineMode,
}: SplashOverlayProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const contentScale = useRef(new Animated.Value(0.92)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const shimmerX = useRef(new Animated.Value(-240)).current;
  const dotPulse = useRef(new Animated.Value(0.65)).current;

  useEffect(() => {
    if (!visible || dismissing) return;
    overlayOpacity.stopAnimation();
    contentScale.stopAnimation();
    overlayOpacity.setValue(0);
    contentScale.setValue(0.92);
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.timing(contentScale, {
        toValue: 1,
        duration: 460,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, dismissing, overlayOpacity, contentScale]);

  useEffect(() => {
    if (!dismissing) return;
    Animated.parallel([
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
      Animated.timing(contentScale, {
        toValue: 1.04,
        duration: 420,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [dismissing, overlayOpacity, contentScale]);

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
      <AmbientAppBackground />

      <Animated.View
        style={[
          styles.contentWrap,
          { width: Math.min(portraitWidth - 48, 360), transform: [{ scale: contentScale }] },
        ]}
      >
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
          <View style={styles.errorActions}>
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

            {onOpenOfflineMode ? (
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.offlineBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onOpenOfflineMode();
                }}
              >
                <Ionicons name="cloud-offline-outline" size={17} color="#FFFFFF" />
                <Text style={styles.offlineBtnText}>
                  {offlineCount > 0
                    ? `Xem phim ngoại tuyến (${offlineCount})`
                    : 'Mở kho phim ngoại tuyến'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </Animated.View>
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
  contentWrap: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  logo: {
    width: 112,
    height: 112,
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
  errorActions: {
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  retryBtn: {
    paddingHorizontal: 22,
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
  offlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  offlineBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
});
