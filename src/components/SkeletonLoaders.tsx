import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, RADII } from '../constants/config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function useShimmerProgress(): Animated.Value {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    progress.setValue(0);
    const anim = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1350,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [progress]);
  return progress;
}

export function SkeletonBox({
  progress,
  width,
  height,
  radius = 14,
  style,
}: {
  progress: Animated.Value;
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-180, 320],
  });

  return (
    <View
      style={[
        styles.skBase,
        width !== undefined ? { width } : null,
        height !== undefined ? { height } : null,
        { borderRadius: radius },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.skSweep,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.06)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/**
 * Category / Tab switch skeleton ported from W:\public_html\dva_play\index.php (.dva-sk-hero + cards)
 */
export function HomeHubSkeleton({ topInset }: { topInset: number }) {
  const progress = useShimmerProgress();
  const cardW = Math.min(208, SCREEN_WIDTH * 0.54);
  const cardH = Math.round(cardW * 1.44);

  return (
    <View style={[styles.hubContainer, { paddingTop: topInset + 114 }]}>
      {/* Hero 3D Perspective Deck Skeleton */}
      <View style={[styles.skHeroStage, { height: cardH + 16 }]}>
        <SkeletonBox
          progress={progress}
          width={cardW}
          height={cardH}
          radius={26}
          style={[
            styles.skHeroSide,
            { opacity: 0.45, transform: [{ translateX: -94 }, { translateY: 12 }, { scale: 0.78 }] },
          ]}
        />
        <SkeletonBox
          progress={progress}
          width={cardW}
          height={cardH}
          radius={26}
          style={[
            styles.skHeroSide,
            { opacity: 0.45, transform: [{ translateX: 94 }, { translateY: 12 }, { scale: 0.78 }] },
          ]}
        />
        <SkeletonBox
          progress={progress}
          width={cardW}
          height={cardH}
          radius={28}
          style={styles.skHeroCenter}
        />
      </View>

      {/* Hero Info Skeleton */}
      <View style={styles.skHeroInfo}>
        <SkeletonBox progress={progress} width={76} height={22} radius={RADII.pill} />
        <SkeletonBox progress={progress} width="78%" height={26} radius={10} />
        <SkeletonBox progress={progress} width="46%" height={15} radius={8} />
        <SkeletonBox progress={progress} width="94%" height={12} radius={6} />
        <SkeletonBox progress={progress} width="82%" height={12} radius={6} />
        <View style={styles.rowGap10}>
          <SkeletonBox progress={progress} width={132} height={44} radius={RADII.pill} />
          <SkeletonBox progress={progress} width={44} height={44} radius={22} />
          <SkeletonBox progress={progress} width={44} height={44} radius={22} />
        </View>
      </View>

      {/* Section 1: 16:9 Watched / Landscape Row Skeleton */}
      <View style={styles.skSection}>
        <SkeletonBox progress={progress} width={150} height={18} radius={8} />
        <View style={styles.rowGap12}>
          {[0, 1, 2].map((idx) => (
            <View key={`land-${idx}`} style={{ width: 205, gap: 8 }}>
              <SkeletonBox progress={progress} width={205} height={116} radius={20} />
              <SkeletonBox progress={progress} width="80%" height={14} radius={6} />
              <SkeletonBox progress={progress} width="52%" height={11} radius={6} />
            </View>
          ))}
        </View>
      </View>

      {/* Section 2: Vertical Poster Row Skeleton */}
      <View style={styles.skSection}>
        <SkeletonBox progress={progress} width={190} height={18} radius={8} />
        <View style={styles.rowGap12}>
          {[0, 1, 2, 3].map((idx) => (
            <View key={`vert-${idx}`} style={{ width: 126, gap: 8 }}>
              <SkeletonBox progress={progress} width={126} height={186} radius={20} />
              <SkeletonBox progress={progress} width="84%" height={13} radius={6} />
              <SkeletonBox progress={progress} width="56%" height={10} radius={5} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * 3-column catalog grid skeleton for ExploreScreen filter switches
 */
export function ExploreGridSkeleton({ cardWidth }: { cardWidth: number }) {
  const progress = useShimmerProgress();
  const cardH = Math.round(cardWidth * 1.48);

  return (
    <View style={styles.gridWrap}>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((idx) => (
        <View key={idx} style={{ width: cardWidth, gap: 6, marginBottom: 14 }}>
          <SkeletonBox progress={progress} width={cardWidth} height={cardH} radius={16} />
          <SkeletonBox progress={progress} width="82%" height={12} radius={6} />
        </View>
      ))}
    </View>
  );
}

/**
 * Sheet skeleton matching Image 2 ("Đang tải thông tin phim...")
 */
export function PreviewSheetSkeleton() {
  const progress = useShimmerProgress();
  return (
    <View style={styles.previewWrap}>
      <SkeletonBox progress={progress} width="64%" height={28} radius={10} />
      <View style={styles.rowGap10}>
        <SkeletonBox progress={progress} width={96} height={18} radius={9} />
        <SkeletonBox progress={progress} width={44} height={18} radius={9} />
        <SkeletonBox progress={progress} width={60} height={18} radius={9} />
      </View>
      <View style={{ gap: 8, marginTop: 4 }}>
        <SkeletonBox progress={progress} width="96%" height={13} radius={6} />
        <SkeletonBox progress={progress} width="90%" height={13} radius={6} />
        <SkeletonBox progress={progress} width="68%" height={13} radius={6} />
      </View>
      <View style={[styles.rowGap10, { marginTop: 10 }]}>
        <SkeletonBox progress={progress} width={150} height={46} radius={18} style={{ flex: 1 }} />
        <SkeletonBox progress={progress} width={46} height={46} radius={18} />
        <SkeletonBox progress={progress} width={92} height={46} radius={18} />
      </View>
    </View>
  );
}

/**
 * Full-screen MovieDetail skeleton
 */
export function MovieDetailSkeleton({ topInset }: { topInset: number }) {
  const progress = useShimmerProgress();
  return (
    <View style={styles.detailWrap}>
      <SkeletonBox progress={progress} width="100%" height={260} radius={0} />
      <View style={[styles.detailBody, { marginTop: -56 }]}>
        <View style={styles.rowGap12}>
          <SkeletonBox progress={progress} width={100} height={146} radius={16} />
          <View style={{ flex: 1, gap: 10, justifyContent: 'flex-end' }}>
            <SkeletonBox progress={progress} width="85%" height={24} radius={8} />
            <SkeletonBox progress={progress} width="62%" height={15} radius={7} />
            <View style={styles.rowGap8}>
              <SkeletonBox progress={progress} width={52} height={22} radius={11} />
              <SkeletonBox progress={progress} width={48} height={22} radius={11} />
              <SkeletonBox progress={progress} width={58} height={22} radius={11} />
            </View>
          </View>
        </View>
        <SkeletonBox progress={progress} width="100%" height={48} radius={18} style={{ marginTop: 8 }} />
        <View style={styles.rowGap12}>
          <SkeletonBox progress={progress} width={88} height={54} radius={14} style={{ flex: 1 }} />
          <SkeletonBox progress={progress} width={88} height={54} radius={14} style={{ flex: 1 }} />
          <SkeletonBox progress={progress} width={88} height={54} radius={14} style={{ flex: 1 }} />
        </View>
        <View style={{ gap: 8, marginTop: 6 }}>
          <SkeletonBox progress={progress} width="95%" height={13} radius={6} />
          <SkeletonBox progress={progress} width="88%" height={13} radius={6} />
          <SkeletonBox progress={progress} width="70%" height={13} radius={6} />
        </View>
        <View style={styles.rowGap10}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBox key={i} progress={progress} width={72} height={40} radius={12} />
          ))}
        </View>
      </View>
      <View style={{ height: topInset }} />
    </View>
  );
}

/**
 * Landscape Player HUD Skeleton mirroring #dva-app-hud / Image 6
 */
export function PlayerLandscapeSkeleton({
  leftInset,
  rightInset,
}: {
  leftInset: number;
  rightInset: number;
}) {
  const progress = useShimmerProgress();
  return (
    <View
      style={[
        styles.playerWrap,
        {
          paddingLeft: Math.max(20, leftInset + 10),
          paddingRight: Math.max(20, rightInset + 10),
          paddingTop: 14,
          paddingBottom: 16,
        },
      ]}
    >
      {/* Top Bar Skeleton */}
      <View style={styles.playerTop}>
        <View style={styles.rowGap12}>
          <SkeletonBox progress={progress} width={42} height={42} radius={21} />
          <View style={{ gap: 6 }}>
            <SkeletonBox progress={progress} width={220} height={18} radius={8} />
            <SkeletonBox progress={progress} width={116} height={12} radius={6} />
          </View>
        </View>
        <SkeletonBox progress={progress} width={196} height={48} radius={24} />
      </View>

      {/* Right Vertical Capsule Skeleton */}
      <View style={[styles.playerSide, { right: Math.max(16, rightInset + 10) }]}>
        <SkeletonBox progress={progress} width={46} height={136} radius={23} />
      </View>

      {/* True Vertical & Horizontal Center Controls Skeleton */}
      <View pointerEvents="none" style={styles.playerCenterWrap}>
        <View style={styles.playerCenterRow}>
          <SkeletonBox progress={progress} width={54} height={54} radius={27} />
          <SkeletonBox progress={progress} width={74} height={74} radius={26} />
          <SkeletonBox progress={progress} width={54} height={54} radius={27} />
        </View>
      </View>

      {/* Bottom Scrubber & Icon Pills Skeleton */}
      <View style={styles.playerBottom}>
        <SkeletonBox progress={progress} width={92} height={14} radius={7} />
        <SkeletonBox progress={progress} width="100%" height={6} radius={3} />
        <View style={styles.playerActionsRow}>
          <View style={styles.rowGap10}>
            <SkeletonBox progress={progress} width={68} height={38} radius={19} />
            <SkeletonBox progress={progress} width={44} height={38} radius={19} />
            <SkeletonBox progress={progress} width={44} height={38} radius={19} />
            <SkeletonBox progress={progress} width={44} height={38} radius={19} />
            <SkeletonBox progress={progress} width={44} height={38} radius={19} />
          </View>
          <View style={styles.rowGap10}>
            <SkeletonBox progress={progress} width={66} height={38} radius={19} />
            <SkeletonBox progress={progress} width={118} height={38} radius={19} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skBase: {
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.065)',
  },
  skSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 140,
  },
  hubContainer: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 18,
  },
  skHeroStage: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  skHeroSide: {
    position: 'absolute',
  },
  skHeroCenter: {
    zIndex: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  skHeroInfo: {
    gap: 10,
  },
  skSection: {
    gap: 12,
    marginTop: 6,
  },
  rowGap8: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowGap10: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowGap12: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  previewWrap: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 12,
  },
  detailWrap: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  detailBody: {
    paddingHorizontal: 16,
    gap: 14,
  },
  playerWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#07090F',
    justifyContent: 'space-between',
    zIndex: 32,
  },
  playerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playerSide: {
    position: 'absolute',
    top: '32%',
  },
  playerCenterWrap: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    transform: [{ translateY: -37 }],
  },
  playerCenterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 44,
  },
  playerBottom: {
    gap: 10,
  },
  playerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
