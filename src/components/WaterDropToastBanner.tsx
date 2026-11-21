import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

export interface WaterDropToastPayload {
  id: number;
  title: string;
  subtitle?: string;
  tone?: 'default' | 'success' | 'warning' | 'info';
}

interface WaterDropToastBannerProps {
  toast: WaterDropToastPayload | null;
  topOffset: number;
  maxWidth?: number;
}

const TONE_COLORS: Record<NonNullable<WaterDropToastPayload['tone']>, string> = {
  default: '#E50914',
  success: '#30D158',
  warning: '#FF9F0A',
  info: '#0A84FF',
};

/**
 * Wide iOS Liquid Glass dynamic toast notification banner with water-drop spring animation.
 */
export function WaterDropToastBanner({
  toast,
  topOffset,
  maxWidth = 390,
}: WaterDropToastBannerProps) {
  const [rendered, setRendered] = useState<WaterDropToastPayload | null>(toast);
  const translateY = useRef(new Animated.Value(-84)).current;
  const scaleX = useRef(new Animated.Value(0.76)).current;
  const scaleY = useRef(new Animated.Value(0.58)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const toastKey = toast ? toast.id : null;

  useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }

    if (toast) {
      setRendered(toast);
      translateY.setValue(-82);
      scaleX.setValue(0.76);
      scaleY.setValue(0.56);
      opacity.setValue(0);

      const enterAnim = Animated.sequence([
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: 7,
            duration: 195,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 1.055,
            duration: 195,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 1.045,
            duration: 195,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(translateY, {
            toValue: 0,
            friction: 7,
            tension: 120,
            useNativeDriver: true,
          }),
          Animated.spring(scaleX, {
            toValue: 1,
            friction: 7,
            tension: 120,
            useNativeDriver: true,
          }),
          Animated.spring(scaleY, {
            toValue: 1,
            friction: 7,
            tension: 120,
            useNativeDriver: true,
          }),
        ]),
      ]);
      animRef.current = enterAnim;
      enterAnim.start();
    } else if (rendered) {
      const exitAnim = Animated.parallel([
        Animated.timing(translateY, {
          toValue: -74,
          duration: 210,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scaleX, {
          toValue: 0.84,
          duration: 210,
          useNativeDriver: true,
        }),
        Animated.timing(scaleY, {
          toValue: 0.72,
          duration: 210,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 190,
          useNativeDriver: true,
        }),
      ]);
      animRef.current = exitAnim;
      exitAnim.start(({ finished }) => {
        if (finished) {
          setRendered(null);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastKey]);

  if (!rendered) return null;

  const toneColor = TONE_COLORS[rendered.tone || 'default'];
  const subtitle = rendered.subtitle || 'Đặng Việt Anh';

  return (
    <View pointerEvents="none" style={[styles.anchorWrap, { top: topOffset }]}>
      <Animated.View
        style={[
          styles.bannerCard,
          { maxWidth },
          {
            opacity,
            transform: [{ translateY }, { scaleX }, { scaleY }],
          },
        ]}
      >
        <BlurView intensity={75} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.glassFill} />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.topSheen}
        />

        <View style={styles.iconWrap}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.appIcon}
            resizeMode="cover"
          />
          <View style={[styles.toneDot, { backgroundColor: toneColor }]} />
        </View>

        <View style={styles.textCol}>
          <Text numberOfLines={1} style={styles.titleText}>
            {rendered.title}
          </Text>
          <Text numberOfLines={1} style={styles.subtitleText}>
            {subtitle}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  anchorWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 90,
    elevation: 90,
  },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 276,
    width: '88%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.55,
    shadowRadius: 24,
  },
  glassFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(18, 22, 32, 0.7)',
  },
  topSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 15,
  },
  iconWrap: {
    width: 38,
    height: 38,
    position: 'relative',
    flexShrink: 0,
  },
  appIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  toneDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 1.5,
    borderColor: '#121620',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  titleText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.15,
  },
  subtitleText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
});
