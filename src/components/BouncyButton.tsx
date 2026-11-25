import React, { useRef } from 'react';
import {
  AccessibilityRole,
  Animated,
  GestureResponderEvent,
  Insets,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface BouncyButtonProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  delayLongPress?: number;
  onPressIn?: (event: GestureResponderEvent) => void;
  onPressOut?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  activeOpacity?: number;
  pressScale?: number;
  bounciness?: 'snappy' | 'gentle';
  hitSlop?: Insets | number;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  testID?: string;
}

/**
 * Interactive pressable button with slow liquid water-drop elastic bounce-back animation on tap.
 * Preserves caller transforms & opacity so outer layout animations/3D transforms are never overwritten.
 */
export function BouncyButton({
  children,
  style,
  onPress,
  onLongPress,
  delayLongPress,
  onPressIn,
  onPressOut,
  disabled = false,
  activeOpacity = 0.9,
  pressScale,
  bounciness = 'snappy',
  hitSlop,
  accessibilityLabel,
  accessibilityRole,
  testID,
}: BouncyButtonProps) {
  const scaleX = useRef(new Animated.Value(1)).current;
  const scaleY = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const pressInAtRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const isGentle = bounciness === 'gentle';
  const baseScale = pressScale ?? (isGentle ? 0.92 : 0.84);
  const targetScaleX = Math.min(0.97, baseScale + 0.028);
  const targetScaleY = Math.max(0.75, baseScale - 0.025);

  const stopActiveAnim = () => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }
  };

  const handlePressIn = (e: GestureResponderEvent) => {
    if (disabled) return;
    pressInAtRef.current = Date.now();
    stopActiveAnim();

    const anim = Animated.parallel([
      Animated.spring(scaleX, {
        toValue: targetScaleX,
        stiffness: 300,
        damping: 18,
        mass: 0.92,
        useNativeDriver: true,
      }),
      Animated.spring(scaleY, {
        toValue: targetScaleY,
        stiffness: 300,
        damping: 18,
        mass: 0.92,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: activeOpacity,
        duration: 85,
        useNativeDriver: true,
      }),
    ]);
    animRef.current = anim;
    anim.start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    stopActiveAnim();
    const elapsed = Date.now() - pressInAtRef.current;

    const reboundX = Animated.spring(scaleX, {
      toValue: 1,
      stiffness: isGentle ? 175 : 205,
      damping: isGentle ? 7.6 : 6.6,
      mass: isGentle ? 1.12 : 1.05,
      velocity: isGentle ? 2.4 : 3.2,
      useNativeDriver: true,
    });
    const reboundY = Animated.spring(scaleY, {
      toValue: 1,
      stiffness: isGentle ? 160 : 185,
      damping: isGentle ? 7.0 : 6.2,
      mass: isGentle ? 1.18 : 1.12,
      velocity: isGentle ? 3.0 : 3.8,
      useNativeDriver: true,
    });

    const scaleAnim =
      elapsed < 95
        ? Animated.sequence([
            Animated.parallel([
              Animated.timing(scaleX, {
                toValue: targetScaleX,
                duration: 60,
                useNativeDriver: true,
              }),
              Animated.timing(scaleY, {
                toValue: targetScaleY,
                duration: 60,
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([reboundX, reboundY]),
          ])
        : Animated.parallel([reboundX, reboundY]);

    const anim = Animated.parallel([
      scaleAnim,
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]);
    animRef.current = anim;
    anim.start();
    onPressOut?.(e);
  };

  const flatStyle = (StyleSheet.flatten(style) || {}) as ViewStyle;
  const { transform: callerTransformRaw, opacity: callerOpacityRaw, ...restStyle } = flatStyle;
  const callerTransform = Array.isArray(callerTransformRaw) ? callerTransformRaw : [];
  const callerOpacity = typeof callerOpacityRaw === 'number' ? callerOpacityRaw : 1;

  const computedOpacity =
    callerOpacity === 1
      ? opacity
      : opacity.interpolate({
          inputRange: [0, 1],
          outputRange: [0, callerOpacity],
        });

  const animatedStyle = {
    opacity: computedOpacity,
    transform: [...callerTransform, { scaleX }, { scaleY }],
  } as Animated.WithAnimatedValue<StyleProp<ViewStyle>>;

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      testID={testID}
      style={[restStyle, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
