import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/config';

/**
 * Ambient dark liquid glass background synchronized with DVA Play
 * (`W:\public_html\dva_play\assets\css\dva-play.css` & `splash.html`).
 */
export function AmbientAppBackground() {
  return (
    <View pointerEvents="none" style={styles.root}>
      <LinearGradient
        colors={['rgba(229, 9, 20, 0.20)', 'rgba(213, 0, 85, 0.08)', 'transparent']}
        locations={[0, 0.34, 0.72]}
        start={{ x: 0.08, y: 0.04 }}
        end={{ x: 0.78, y: 0.62 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(213, 0, 85, 0.08)', 'rgba(213, 0, 85, 0.16)']}
        locations={[0.25, 0.68, 1]}
        start={{ x: 0.2, y: 0.25 }}
        end={{ x: 0.94, y: 0.96 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['transparent', 'rgba(15, 23, 42, 0.32)', 'transparent']}
        start={{ x: 0.5, y: 0.15 }}
        end={{ x: 0.5, y: 0.85 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: COLORS.bg,
  },
});
