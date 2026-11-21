import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { GlassSurface } from './GlassSurface';

export interface WaterDropToastPayload {
  id: number;
  title: string;
  subtitle?: string;
  tone?: 'default' | 'success' | 'warning' | 'info';
  durationSec?: number;
}

interface WaterDropToastBannerProps {
  toast: WaterDropToastPayload | null;
  topOffset: number;
  maxWidth?: number;
}

const SPRING_DROP_EASING = Easing.bezier(0.34, 1.56, 0.64, 1);

/**
 * Replicates click_notification_9Hz3Tb4Kd0Ly3Mv from jw.php:
 * 3-column borderless Liquid Glass capsule (icon box, title+subtitle, countdown)
 * with 800ms waterDrop enter and 700ms waterRetract exit keyframes.
 */
export function WaterDropToastBanner({
  toast,
  topOffset,
  maxWidth = 400,
}: WaterDropToastBannerProps) {
  const [rendered, setRendered] = useState<WaterDropToastPayload | null>(toast);
  const [countdownSec, setCountdownSec] = useState<number>(toast?.durationSec ?? 3);

  const translateY = useRef(new Animated.Value(-48)).current;
  const scaleX = useRef(new Animated.Value(0.5)).current;
  const scaleY = useRef(new Animated.Value(1.2)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const toastKey = toast ? toast.id : null;
  const durationSec = toast?.durationSec ?? 3;

  useEffect(() => {
    if (toast && durationSec > 0) {
      setCountdownSec(durationSec);
      const timer = setInterval(() => {
        setCountdownSec((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
    setCountdownSec(0);
    return undefined;
  }, [toastKey, durationSec]);

  useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }

    if (toast) {
      setRendered(toast);
      translateY.setValue(-48);
      scaleX.setValue(0.5);
      scaleY.setValue(1.2);
      opacity.setValue(0);

      // click_notification_9Hz3Tb4Kd0Ly3Mv_waterDrop (800ms)
      const enterAnim = Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 320,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 20,
            duration: 320,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 1.1,
            duration: 320,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 0.9,
            duration: 320,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -10,
            duration: 160,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 0.95,
            duration: 160,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 1.05,
            duration: 160,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: 5,
            duration: 160,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 1.02,
            duration: 160,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 0.98,
            duration: 160,
            easing: SPRING_DROP_EASING,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: 0,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 1,
            duration: 160,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]);
      animRef.current = enterAnim;
      enterAnim.start();
      return;
    }

    if (!toast && rendered) {
      // click_notification_9Hz3Tb4Kd0Ly3Mv_waterRetract (700ms)
      const exitAnim = Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 210,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 15,
            duration: 210,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 1.1,
            duration: 210,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 0.9,
            duration: 210,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 490,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: -48,
            duration: 490,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleX, {
            toValue: 0.4,
            duration: 490,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleY, {
            toValue: 1.5,
            duration: 490,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]);
      animRef.current = exitAnim;
      exitAnim.start(({ finished }) => {
        if (finished) setRendered(null);
      });
    }
  }, [toastKey, rendered === null]);

  if (!rendered) return null;

  const isContinuous = (rendered.durationSec ?? 3) === 0;
  const countdownText = isContinuous
    ? 'Đang giữ'
    : `Còn ${String(Math.max(0, countdownSec)).padStart(2, '0')} giây`;

  return (
    <View pointerEvents="none" style={[styles.hostWrap, { top: topOffset }]}>
      <Animated.View
        style={[
          styles.animWrap,
          {
            maxWidth,
            opacity,
            transform: [{ translateY }, { scaleX }, { scaleY }],
          },
        ]}
      >
        <GlassSurface
          variant="liquid"
          radius={28}
          intensity={28}
          style={styles.pillContainer}
        >
          <View style={styles.rowContent}>
            <View style={styles.iconBox}>
              <Image
                source={require('../../assets/splash-logo.png')}
                style={styles.logoImg}
                resizeMode="contain"
              />
            </View>

            <View style={styles.textCol}>
              <Text style={styles.titleTxt} numberOfLines={1}>
                {rendered.title}
              </Text>
              {rendered.subtitle ? (
                <Text style={styles.subtitleTxt} numberOfLines={3}>
                  {rendered.subtitle}
                </Text>
              ) : null}
            </View>

            <View style={styles.timeCol}>
              <Text
                style={[styles.countdownTxt, isContinuous && styles.countdownContinuous]}
                numberOfLines={1}
              >
                {countdownText}
              </Text>
            </View>
          </View>
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hostWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 80,
  },
  animWrap: {
    minWidth: 270,
    alignSelf: 'center',
  },
  pillContainer: {
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#323232',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImg: {
    width: 24,
    height: 24,
  },
  textCol: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  titleTxt: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 17,
  },
  subtitleTxt: {
    color: 'rgba(255, 255, 255, 0.84)',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 16.5,
  },
  timeCol: {
    marginLeft: 6,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  countdownTxt: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 11.5,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  countdownContinuous: {
    color: '#FF9F0A',
    fontWeight: '600',
  },
});
