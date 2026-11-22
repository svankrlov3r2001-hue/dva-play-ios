import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView, BlurTint } from 'expo-blur';
import { COLORS, GLASS_SHADOW, RADII } from '../constants/config';

interface WaterDropPopupViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  visible?: boolean;
  from?: 'center' | 'top' | 'bottom';
  triggerKey?: string | number;
}

export function WaterDropPopupView({
  children,
  style,
  visible = true,
  from = 'center',
  triggerKey,
}: WaterDropPopupViewProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scaleX = useRef(new Animated.Value(0.76)).current;
  const scaleY = useRef(new Animated.Value(1.16)).current;
  const translateY = useRef(
    new Animated.Value(from === 'top' ? -18 : from === 'bottom' ? 18 : 10)
  ).current;

  useEffect(() => {
    if (!visible) return;
    const startY = from === 'top' ? -18 : from === 'bottom' ? 18 : 10;
    opacity.stopAnimation();
    scaleX.stopAnimation();
    scaleY.stopAnimation();
    translateY.stopAnimation();

    opacity.setValue(0);
    scaleX.setValue(0.76);
    scaleY.setValue(1.16);
    translateY.setValue(startY);

    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 190,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        stiffness: 170,
        damping: 12.5,
        mass: 1.05,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(scaleX, {
          toValue: 1.055,
          duration: 185,
          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
          useNativeDriver: true,
        }),
        Animated.spring(scaleX, {
          toValue: 1,
          stiffness: 185,
          damping: 8.2,
          mass: 1.05,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(scaleY, {
          toValue: 0.945,
          duration: 185,
          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
          useNativeDriver: true,
        }),
        Animated.spring(scaleY, {
          toValue: 1,
          stiffness: 185,
          damping: 8.2,
          mass: 1.05,
          useNativeDriver: true,
        }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, [visible, from, triggerKey, opacity, scaleX, scaleY, translateY]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateY }, { scaleX }, { scaleY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
  tint?: BlurTint;
  variant?: 'default' | 'liquid';
  noShadow?: boolean;
}

export function GlassSurface({
  children,
  style,
  contentStyle,
  intensity = 28,
  radius = RADII.lg,
  tint = 'systemUltraThinMaterialDark',
  variant = 'default',
  noShadow = false,
}: GlassSurfaceProps) {
  const iosIntensity = Math.max(12, Math.min(intensity, 32));
  const androidIntensity = Math.max(16, Math.min(intensity, 42));
  const resolvedIntensity = Platform.OS === 'ios' ? iosIntensity : androidIntensity;

  if (variant === 'liquid') {
    return (
      <View
        style={[
          styles.liquidOuter,
          !noShadow && styles.glassShadow,
          { borderRadius: radius },
          style,
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, overflow: 'hidden' },
          ]}
        >
          <BlurView
            intensity={resolvedIntensity}
            tint="systemUltraThinMaterialDark"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius,
                backgroundColor: 'rgba(20, 20, 20, 0.2)',
              },
            ]}
          />
        </View>
        {contentStyle ? <View style={contentStyle}>{children}</View> : children}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.outer,
        !noShadow && styles.glassShadow,
        { borderRadius: radius },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, overflow: 'hidden' },
        ]}
      >
        <BlurView
          intensity={resolvedIntensity}
          tint={tint}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              backgroundColor: COLORS.glass,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: COLORS.glassBorder,
            },
          ]}
        />
      </View>
      {contentStyle ? <View style={contentStyle}>{children}</View> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    overflow: 'hidden',
  },
  liquidOuter: {
    overflow: 'visible',
  },
  glassShadow: {
    boxShadow: GLASS_SHADOW,
    elevation: 16,
  },
});
