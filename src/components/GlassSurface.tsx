import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView, BlurTint } from 'expo-blur';
import { COLORS, GLASS_SHADOW, RADII } from '../constants/config';

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
