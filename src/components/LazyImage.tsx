import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  ImageResizeMode,
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { COLORS } from '../constants/config';

const MAX_CACHE_URIS = 400;
const loadedUriCache = new Set<string>();

function rememberLoadedUri(uri: string) {
  if (!uri) return;
  if (loadedUriCache.has(uri)) return;
  if (loadedUriCache.size >= MAX_CACHE_URIS) {
    const oldest = loadedUriCache.values().next().value;
    if (oldest) loadedUriCache.delete(oldest);
  }
  loadedUriCache.add(uri);
}

interface LazyImageProps {
  uri?: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  resizeMode?: ImageResizeMode;
  blurRadius?: number;
  enabled?: boolean;
}

export function LazyImage({
  uri,
  style,
  containerStyle,
  resizeMode = 'cover',
  blurRadius,
  enabled = true,
}: LazyImageProps) {
  const safeUri = uri || '';
  const isCached = Boolean(safeUri && loadedUriCache.has(safeUri));
  const opacity = useRef(new Animated.Value(isCached ? 1 : 0)).current;
  const activeUriRef = useRef(safeUri);
  const loadedForCurrentRef = useRef(isCached);
  const hasErrorRef = useRef(false);

  if (activeUriRef.current !== safeUri) {
    activeUriRef.current = safeUri;
    const cachedNow = Boolean(safeUri && loadedUriCache.has(safeUri));
    loadedForCurrentRef.current = cachedNow;
    hasErrorRef.current = false;
    opacity.stopAnimation();
    opacity.setValue(cachedNow ? 1 : 0);
  }

  useEffect(() => {
    if (!enabled || !safeUri) {
      loadedForCurrentRef.current = false;
      hasErrorRef.current = false;
      opacity.stopAnimation();
      opacity.setValue(0);
      return;
    }
    if (loadedUriCache.has(safeUri)) {
      loadedForCurrentRef.current = true;
      opacity.setValue(1);
    }
  }, [enabled, safeUri, opacity]);

  const handleError = () => {
    hasErrorRef.current = true;
  };

  const handleLoaded = () => {
    if (!safeUri || hasErrorRef.current || loadedForCurrentRef.current) return;
    loadedForCurrentRef.current = true;
    rememberLoadedUri(safeUri);
    opacity.stopAnimation();
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  return (
    <View
      pointerEvents="none"
      style={[styles.placeholder, style as StyleProp<ViewStyle>, containerStyle]}
    >
      {enabled && safeUri ? (
        <Animated.Image
          key={safeUri}
          source={{ uri: safeUri }}
          resizeMode={resizeMode}
          blurRadius={blurRadius}
          onError={handleError}
          onLoad={handleLoaded}
          onLoadEnd={handleLoaded}
          style={[StyleSheet.absoluteFill, { opacity }]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    overflow: 'hidden',
    backgroundColor: COLORS.cardPlaceholder,
  },
});
