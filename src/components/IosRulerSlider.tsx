import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { BouncyButton } from './BouncyButton';
import { COLORS } from '../constants/config';

export interface IosRulerSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  majorStep: number;
  defaultValue?: number;
  valueText: string;
  formatTickLabel?: (val: number) => string;
  onChange: (nextVal: number) => void;
  onReset?: () => void;
  resetLabel?: string;
  tickSpacing?: number;
  accentColor?: string;
  staggerLabels?: boolean;
}

function roundToStepPrecision(val: number, step: number): number {
  const decimals = step < 1 ? (String(step).split('.')[1]?.length || 2) : 0;
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function isMultipleOf(val: number, divisor: number): boolean {
  if (divisor <= 0) return false;
  const ratio = val / divisor;
  return Math.abs(ratio - Math.round(ratio)) < 0.015;
}

/**
 * iOS Camera-style horizontal ruler tick dial slider tuned to DVA Play Liquid Glass Dark UI.
 */
export function IosRulerSlider({
  label,
  value,
  min,
  max,
  step,
  majorStep,
  defaultValue,
  valueText,
  formatTickLabel,
  onChange,
  onReset,
  resetLabel = 'Mặc định',
  tickSpacing = 14,
  accentColor = COLORS.accent,
  staggerLabels = false,
}: IosRulerSliderProps) {
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const isUserInteractingRef = useRef(false);
  const lastEmittedRef = useRef<number>(value);
  const didInitialScrollRef = useRef(false);

  const ticks = useMemo(() => {
    const count = Math.max(1, Math.round((max - min) / step) + 1);
    const arr: {
      val: number;
      isMajor: boolean;
      isMid: boolean;
      label: string;
      labelPos: 'top' | 'bottom' | 'none';
    }[] = [];
    let majorCount = 0;
    for (let i = 0; i < count; i++) {
      const v = roundToStepPrecision(Math.min(max, min + i * step), step);
      const isMajor = isMultipleOf(v, majorStep) || (majorStep === step);
      const isMid = !isMajor && isMultipleOf(v, majorStep / 2);
      const tickLbl = isMajor
        ? formatTickLabel
          ? formatTickLabel(v)
          : String(Math.round(v * 100) / 100)
        : '';
      let labelPos: 'top' | 'bottom' | 'none' = 'none';
      if (tickLbl) {
        if (!staggerLabels) {
          labelPos = 'top';
        } else {
          labelPos = majorCount % 2 === 0 ? 'top' : 'bottom';
          majorCount += 1;
        }
      }
      arr.push({ val: v, isMajor, isMid, label: tickLbl, labelPos });
    }
    return arr;
  }, [min, max, step, majorStep, formatTickLabel, staggerLabels]);

  const valueToOffset = useCallback(
    (v: number) => {
      const clamped = Math.max(min, Math.min(max, v));
      const idx = Math.round((clamped - min) / step);
      return Math.max(0, idx * tickSpacing);
    },
    [min, max, step, tickSpacing]
  );

  // Sync ruler scroll position on initial layout & external value updates (e.g., reset button)
  useEffect(() => {
    if (containerWidth <= 0) return;
    if (isUserInteractingRef.current) return;
    const x = valueToOffset(value);
    const shouldAnimate = didInitialScrollRef.current;
    didInitialScrollRef.current = true;
    lastEmittedRef.current = roundToStepPrecision(value, step);
    const raf = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x, animated: shouldAnimate });
    });
    return () => cancelAnimationFrame(raf);
  }, [containerWidth, value, valueToOffset, step]);

  const handleScrollOffset = useCallback(
    (x: number, fromUser: boolean) => {
      if (!fromUser) return;
      const rawIdx = Math.round(x / tickSpacing);
      const clampedIdx = Math.max(0, Math.min(ticks.length - 1, rawIdx));
      const nextVal = ticks[clampedIdx]?.val ?? min;
      if (Math.abs(nextVal - lastEmittedRef.current) > 0.0005) {
        lastEmittedRef.current = nextVal;
        void Haptics.selectionAsync().catch(() => {});
        onChange(nextVal);
      }
    },
    [tickSpacing, ticks, min, onChange]
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleScrollOffset(e.nativeEvent.contentOffset.x, isUserInteractingRef.current);
    },
    [handleScrollOffset]
  );

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleScrollOffset(e.nativeEvent.contentOffset.x, true);
      isUserInteractingRef.current = false;
    },
    [handleScrollOffset]
  );

  const handleTapTick = useCallback(
    (idx: number) => {
      const nextVal = ticks[idx]?.val ?? min;
      lastEmittedRef.current = nextVal;
      void Haptics.selectionAsync().catch(() => {});
      onChange(nextVal);
      scrollRef.current?.scrollTo({ x: idx * tickSpacing, animated: true });
    },
    [ticks, min, onChange, tickSpacing]
  );

  const showReset =
    defaultValue !== undefined && Math.abs(value - defaultValue) > 0.001 && Boolean(onReset);
  const sidePad = containerWidth > 0 ? Math.max(0, containerWidth / 2 - tickSpacing / 2) : 120;
  const decorativeBetween = majorStep === step;

  return (
    <View style={styles.wrapper}>
      <View style={styles.headerRow}>
        <Text style={styles.labelText}>{label}</Text>
        <View style={styles.rightMetaRow}>
          {showReset ? (
            <BouncyButton
              onPress={onReset}
              activeOpacity={0.75}
              style={styles.resetPill}
            >
              <Feather name="rotate-ccw" size={11} color="rgba(255,255,255,0.78)" />
              <Text style={styles.resetText}>{resetLabel}</Text>
            </BouncyButton>
          ) : null}
          <View style={[styles.valueBadge, { borderColor: `${accentColor}66`, backgroundColor: `${accentColor}26` }]}>
            <Text style={styles.valueText}>{valueText}</Text>
          </View>
        </View>
      </View>

      <View
        style={[styles.capsule, staggerLabels && styles.capsuleStaggered]}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0 && Math.abs(w - containerWidth) > 2) {
            setContainerWidth(w);
          }
        }}
      >
        {containerWidth > 0 ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            bounces={false}
            decelerationRate="fast"
            snapToInterval={tickSpacing}
            snapToAlignment="start"
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              isUserInteractingRef.current = true;
            }}
            onScroll={onScroll}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={(e) => {
              // If velocity is 0, no momentum phase runs, so settle immediately
              const vx = e.nativeEvent.velocity?.x ?? 0;
              if (Math.abs(vx) < 0.05) {
                onScrollEnd(e);
              }
            }}
            contentContainerStyle={{
              paddingHorizontal: sidePad,
              alignItems: staggerLabels ? 'center' : 'flex-end',
            }}
          >
            {ticks.map((item, idx) => {
              const isSelected = Math.abs(item.val - value) < step * 0.45;
              const isNear = Math.abs(item.val - value) <= majorStep * 1.1;
              const barEl = (
                <View style={styles.tickTrackRow}>
                  <View
                    style={[
                      styles.tickBar,
                      item.isMajor
                        ? styles.tickBarMajor
                        : item.isMid
                          ? styles.tickBarMid
                          : styles.tickBarMinor,
                      isSelected && { backgroundColor: '#FFFFFF' },
                    ]}
                  />
                </View>
              );

              if (staggerLabels) {
                return (
                  <TouchableOpacity
                    key={idx}
                    activeOpacity={0.8}
                    onPress={() => handleTapTick(idx)}
                    style={[styles.tickColStaggered, { width: tickSpacing }]}
                  >
                    <View style={styles.tickLabelSlotTop}>
                      {item.labelPos === 'top' ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.tickLabel,
                            styles.tickLabelStagger,
                            isSelected && styles.tickLabelSelected,
                            !isSelected && isNear && styles.tickLabelNear,
                          ]}
                        >
                          {item.label}
                        </Text>
                      ) : null}
                    </View>

                    {barEl}

                    <View style={styles.tickLabelSlotBottom}>
                      {item.labelPos === 'bottom' ? (
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.tickLabel,
                            styles.tickLabelStagger,
                            isSelected && styles.tickLabelSelected,
                            !isSelected && isNear && styles.tickLabelNear,
                          ]}
                        >
                          {item.label}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              }

              return (
                <TouchableOpacity
                  key={idx}
                  activeOpacity={0.8}
                  onPress={() => handleTapTick(idx)}
                  style={[styles.tickCol, { width: tickSpacing }]}
                >
                  {item.label ? (
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.tickLabel,
                        isSelected && styles.tickLabelSelected,
                        !isSelected && isNear && styles.tickLabelNear,
                      ]}
                    >
                      {item.label}
                    </Text>
                  ) : (
                    <View style={styles.tickLabelSpacer} />
                  )}

                  {barEl}

                  {decorativeBetween && idx < ticks.length - 1 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        styles.decorativeTicksWrap,
                        { left: tickSpacing * 0.5, width: tickSpacing },
                      ]}
                    >
                      <View style={styles.decTickSmall} />
                      <View style={styles.decTickMid} />
                      <View style={styles.decTickSmall} />
                    </View>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {/* Edge fade gradients */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(10, 13, 20, 0.96)', 'rgba(10, 13, 20, 0)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.leftFade}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(10, 13, 20, 0)', 'rgba(10, 13, 20, 0.96)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.rightFade}
        />

        {/* Fixed glowing center needle + crimson triangle pointer */}
        {staggerLabels ? (
          <View pointerEvents="none" style={styles.centerOverlayStaggered}>
            <View style={styles.centerNeedleStaggered} />
            <View
              style={[
                styles.centerTriangle,
                styles.centerTriangleStaggered,
                { borderBottomColor: accentColor },
              ]}
            />
          </View>
        ) : (
          <View pointerEvents="none" style={styles.centerOverlay}>
            <View style={styles.centerNeedle} />
            <View style={[styles.centerTriangle, { borderBottomColor: accentColor }]} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  labelText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '700',
  },
  rightMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  resetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  resetText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: '600',
  },
  valueBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3.5,
    borderRadius: 99,
    borderWidth: 1,
  },
  valueText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  capsule: {
    height: 74,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(10, 13, 20, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    justifyContent: 'center',
    position: 'relative',
  },
  capsuleStaggered: {
    height: 94,
  },
  tickCol: {
    height: 72,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 9,
    position: 'relative',
  },
  tickColStaggered: {
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
  },
  tickLabelSlotTop: {
    height: 22,
    width: 44,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 4,
    overflow: 'visible',
  },
  tickLabelSlotBottom: {
    height: 22,
    width: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 4,
    overflow: 'visible',
  },
  tickLabel: {
    color: 'rgba(255,255,255,0.34)',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
    textAlign: 'center',
    minWidth: 36,
  },
  tickLabelStagger: {
    marginBottom: 0,
    minWidth: 42,
  },
  tickLabelNear: {
    color: 'rgba(255,255,255,0.68)',
  },
  tickLabelSelected: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '900',
  },
  tickLabelSpacer: {
    height: 20,
  },
  tickTrackRow: {
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tickBar: {
    borderRadius: 1.5,
  },
  tickBarMajor: {
    width: 2,
    height: 21,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  tickBarMid: {
    width: 1.5,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  tickBarMinor: {
    width: 1,
    height: 9,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
  decorativeTicksWrap: {
    position: 'absolute',
    top: 35,
    height: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  decTickSmall: {
    width: 1,
    height: 7,
    borderRadius: 0.5,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  decTickMid: {
    width: 1.5,
    height: 12,
    borderRadius: 0.75,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  leftFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 40,
  },
  rightFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 40,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  centerOverlayStaggered: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  centerNeedle: {
    width: 3,
    height: 26,
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    marginBottom: 4,
  },
  centerNeedleStaggered: {
    position: 'absolute',
    top: 34,
    width: 3,
    height: 24,
    borderRadius: 1.5,
    backgroundColor: '#FFFFFF',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  centerTriangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 5.5,
    borderRightWidth: 5.5,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  centerTriangleStaggered: {
    position: 'absolute',
    bottom: 3,
  },
});
