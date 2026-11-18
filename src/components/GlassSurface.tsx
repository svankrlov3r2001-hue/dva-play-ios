import React from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { COLORS, RADII } from '../constants/config';

interface GlassSurfaceProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
  tint?: 'dark' | 'light' | 'default' | 'systemMaterialDark' | 'systemUltraThinMaterialDark';
}

export function GlassSurface({
  children,
  style,
  intensity = 48,
  radius = RADII.lg,
  tint = 'dark',
}: GlassSurfaceProps) {
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
      {children}
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
});
