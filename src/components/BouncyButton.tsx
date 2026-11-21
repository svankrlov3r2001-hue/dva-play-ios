import React, { useRef } from 'react';
import {
  AccessibilityRole,
  Animated,
  GestureResponderEvent,
  Insets,
  Pressable,
  StyleProp,
  ViewStyle,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface BouncyButtonProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
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
 * Interactive pressable button with springy elastic bounce-back animation on tap.
 */
export function BouncyButton({
  children,
  style,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  disabled = false,
  activeOpacity = 0.92,
  pressScale,
  bounciness = 'snappy',
  hitSlop,
  accessibilityLabel,
  accessibilityRole,
  testID,
}: BouncyButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const pressInAtRef = useRef(0);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  const isGentle = bounciness === 'gentle';
  const effectiveScale = pressScale ?? (isGentle ? 0.95 : 0.88);
  const reboundConfig = isGentle
    ? { stiffness: 320, damping: 12, mass: 0.75 }
    : { stiffness: 380, damping: 10, mass: 0.7 };

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
      Animated.spring(scale, {
        toValue: effectiveScale,
        stiffness: 480,
        damping: 24,
        mass: 0.65,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: activeOpacity,
        duration: 70,
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

    const reboundSpring = Animated.spring(scale, {
      toValue: 1,
      stiffness: reboundConfig.stiffness,
      damping: reboundConfig.damping,
      mass: reboundConfig.mass,
      useNativeDriver: true,
    });

    const scaleAnim =
      elapsed < 75
        ? Animated.sequence([
            Animated.timing(scale, {
              toValue: effectiveScale,
              duration: 50,
              useNativeDriver: true,
            }),
            reboundSpring,
          ])
        : reboundSpring;

    const anim = Animated.parallel([
      scaleAnim,
      Animated.timing(opacity, {
        toValue: 1,
        duration: 130,
        useNativeDriver: true,
      }),
    ]);
    animRef.current = anim;
    anim.start();
    onPressOut?.(e);
  };

  const animatedStyle = {
    opacity,
    transform: [{ scale }],
  } as Animated.WithAnimatedValue<StyleProp<ViewStyle>>;

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      testID={testID}
      style={[style as Animated.WithAnimatedValue<StyleProp<ViewStyle>>, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
