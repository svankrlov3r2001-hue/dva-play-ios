import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS, RADII } from '../constants/config';

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
  tint?: 'dark' | 'light' | 'default' | 'systemMaterialDark' | 'systemUltraThinMaterialDark';
  variant?: 'default' | 'liquid';
}

export function GlassSurface({
  children,
  style,
  contentStyle,
  intensity = 48,
  radius = RADII.lg,
  tint = 'dark',
  variant = 'default',
}: GlassSurfaceProps) {
  if (variant === 'liquid') {
    return (
      <View style={[styles.liquidOuter, { borderRadius: radius }, style]}>
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, overflow: 'hidden' },
          ]}
        >
          <BlurView
            intensity={Platform.OS === 'ios' ? intensity : 78}
            tint="systemUltraThinMaterialDark"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(20, 20, 20, 0.2)' },
            ]}
          />
        </View>
        {contentStyle ? <View style={contentStyle}>{children}</View> : children}
      </View>
    );
  }

  return (
    <View style={[styles.outer, { borderRadius: radius }, style]}>
      <BlurView
        intensity={Platform.OS === 'ios' ? intensity : 70}
        tint={tint}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
      <View
        pointerEvents="none"
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
      {contentStyle ? <View style={contentStyle}>{children}</View> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 18,
    elevation: 8,
  },
  liquidOuter: {
    overflow: 'visible',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 25,
    elevation: 20,
  },
});
