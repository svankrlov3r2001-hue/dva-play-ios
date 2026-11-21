import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BouncyButton } from './BouncyButton';
import { COLORS, GLASS_SHADOW } from '../constants/config';
import {
  BackupServerId,
  formatVietnameseEta,
  isServerPlayable,
  ServerRuntimeState,
} from '../services/playerServerService';

interface PlayerServerPanelModalProps {
  visible: boolean;
  onClose: () => void;
  servers: ServerRuntimeState[];
  activeServerId: BackupServerId | null;
  autoOptimal: boolean;
  onToggleAutoOptimal: (next: boolean) => void;
  onSelectServer: (id: BackupServerId) => void;
  onRefreshPings: () => void;
  pingRefreshing: boolean;
  posterUrl?: string;
}

/**
 * Native iOS Liquid Glass video source switcher modal.
 */
export function PlayerServerPanelModal({
  visible,
  onClose,
  servers,
  activeServerId,
  autoOptimal,
  onToggleAutoOptimal,
  onSelectServer,
  onRefreshPings,
  pingRefreshing,
  posterUrl = '',
}: PlayerServerPanelModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(780, winWidth - Math.max(36, insets.left + insets.right + 20))
    : Math.min(460, winWidth - 20);

  const activeServerLabel =
    servers.find((s) => s.id === activeServerId)?.label || 'Chưa chọn máy chủ';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={[styles.sheetContainer, { width: cardWidth }]}>
          <BlurView intensity={34} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
          <View style={styles.sheetDarkTint} />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.sheetTopSheen}
          />

          <View style={styles.inner}>
            {/* Header Row */}
            <View style={styles.headerRow}>
              <View style={styles.titleCluster}>
                <View style={styles.headerIconBadge}>
                  <Feather name="hard-drive" size={17} color={COLORS.accent} />
                </View>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.headerTitle}>Máy chủ phát phim</Text>
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    Đang phát: {activeServerLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.headerRight}>
                <View style={styles.autoPill}>
                  <Text style={styles.autoLabel}>Tự tối ưu</Text>
                  <Switch
                    value={autoOptimal}
                    trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                    thumbColor="#FFFFFF"
                    style={styles.compactSwitch}
                    onValueChange={(val) => {
                      Haptics.selectionAsync();
                      onToggleAutoOptimal(val);
                    }}
                  />
                </View>

                <BouncyButton
                  activeOpacity={0.78}
                  style={styles.circleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onRefreshPings();
                  }}
                >
                  {pingRefreshing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Feather name="refresh-cw" size={16} color="#FFFFFF" />
                  )}
                </BouncyButton>

                <BouncyButton
                  activeOpacity={0.78}
                  style={styles.circleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onClose();
                  }}
                >
                  <Ionicons name="close" size={19} color="#FFFFFF" />
                </BouncyButton>
              </View>
            </View>

            {/* Server Cards Row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.cardsScroll}
            >
              {servers.map((srv) => {
                const isActive = srv.id === activeServerId;
                const playable = isServerPlayable(srv);
                const disabled = !srv.supported;
                const formattedEta = formatVietnameseEta(srv.etaText);
                const isErrored = Boolean(srv.errored || srv.status === 'error');

                let statusBadge = 'Chưa hỗ trợ';
                let statusColor = 'rgba(255,255,255,0.72)';
                let statusDotColor = '#8E8E93';

                if (!srv.supported) {
                  statusBadge = 'Chưa hỗ trợ';
                } else if (srv.errored) {
                  statusBadge = 'Lỗi phiên • Thử lại';
                  statusColor = '#FF8A80';
                  statusDotColor = '#FF453A';
                } else if (srv.status === 'ready') {
                  statusBadge =
                    isActive
                      ? 'Đang phát'
                      : srv.id === '99'
                        ? 'Ngoại tuyến 100%'
                        : 'Sẵn sàng';
                  statusColor = isActive ? '#FFFFFF' : '#B7F7C8';
                  statusDotColor = '#30D158';
                } else if (srv.status === 'preview_30p') {
                  statusBadge = `Xem trước 30p (${srv.progress}%)`;
                  statusColor = '#FFD60A';
                  statusDotColor = '#FFD60A';
                } else if (srv.status === 'preview_10p') {
                  statusBadge = `Xem trước 10p (${srv.progress}%)`;
                  statusColor = '#FFD60A';
                  statusDotColor = '#FFD60A';
                } else if (srv.status === 'downloading') {
                  statusBadge = srv.progressLabel || `Đang xử lý ${srv.progress}%`;
                  statusColor = '#FDE68A';
                  statusDotColor = '#FF9F0A';
                } else if (srv.status === 'checking') {
                  statusBadge = 'Đang kiểm tra...';
                  statusColor = 'rgba(255,255,255,0.75)';
                  statusDotColor = '#9CA3AF';
                } else if (srv.status === 'error') {
                  statusBadge = srv.progressLabel || 'Lỗi kết nối • Thử lại';
                  statusColor = '#FF8A80';
                  statusDotColor = '#FF453A';
                }

                let pingTxt = '';
                let pingColor = '#30D158';
                if (srv.supported) {
                  if (srv.id === '99') {
                    pingTxt = '1 ms';
                    pingColor = '#30D158';
                  } else if (srv.pingMs !== null && !srv.pingFailed) {
                    pingTxt = `${srv.pingMs} ms`;
                    pingColor =
                      srv.pingMs <= 180 ? '#30D158' : srv.pingMs <= 500 ? '#FFD60A' : '#FF9F0A';
                  } else if (srv.pingFailed) {
                    pingTxt = 'Timeout';
                    pingColor = '#FF453A';
                  }
                }

                return (
                  <BouncyButton
                    key={srv.id}
                    bounciness="gentle"
                    activeOpacity={disabled ? 1 : 0.8}
                    disabled={disabled}
                    style={[
                      styles.serverCard,
                      isActive && styles.serverCardActive,
                      isErrored && !isActive && styles.serverCardError,
                      disabled && styles.serverCardDisabled,
                    ]}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onSelectServer(srv.id);
                    }}
                  >
                    {posterUrl ? (
                      <Image
                        source={{ uri: posterUrl }}
                        style={styles.cardBgPoster}
                        blurRadius={24}
                      />
                    ) : null}
                    <View
                      style={[
                        styles.cardGlassLayer,
                        isActive && styles.cardGlassLayerActive,
                      ]}
                    />

                    {/* Card Top: Server Title + Ping / Live Pill */}
                    <View style={styles.cardTopRow}>
                      <View style={styles.cardNameWrap}>
                        <Ionicons
                          name={srv.id === '99' ? 'phone-portrait-outline' : 'cloud-outline'}
                          size={14}
                          color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.72)'}
                        />
                        <Text style={styles.cardTitle} numberOfLines={1}>
                          {srv.label}
                        </Text>
                      </View>

                      {isActive ? (
                        <View style={styles.activePill}>
                          <View style={styles.activePulseDot} />
                          <Text style={styles.activePillTxt}>Đang phát</Text>
                        </View>
                      ) : pingTxt ? (
                        <View style={styles.pingPill}>
                          <View style={[styles.pingDot, { backgroundColor: pingColor }]} />
                          <Text style={[styles.pingBadge, { color: pingColor }]}>{pingTxt}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Card Description */}
                    <Text style={styles.cardSubtitle} numberOfLines={2}>
                      {srv.subtitle}
                    </Text>

                    {/* Footer Status + Progress */}
                    <View style={styles.cardFooter}>
                      <View style={styles.cardDivider} />
                      <View style={styles.cardStatusRow}>
                        {isErrored ? (
                          <Feather name="rotate-cw" size={12} color="#FF8A80" />
                        ) : playable && isActive ? (
                          <Ionicons name="checkmark-circle" size={13} color="#FFFFFF" />
                        ) : (
                          <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
                        )}
                        <Text
                          style={[styles.cardStatusTxt, { color: statusColor }]}
                          numberOfLines={1}
                        >
                          {statusBadge}
                        </Text>
                        {formattedEta && srv.status !== 'ready' ? (
                          <Text style={styles.etaTxt} numberOfLines={1}>
                            • {formattedEta}
                          </Text>
                        ) : null}
                      </View>

                      {srv.supported &&
                      (srv.status === 'downloading' ||
                        srv.status === 'preview_10p' ||
                        srv.status === 'preview_30p') ? (
                        <View style={styles.cardProgTrack}>
                          <View
                            style={[
                              styles.cardProgFill,
                              { width: `${Math.max(5, srv.progress)}%` },
                            ]}
                          />
                        </View>
                      ) : null}
                    </View>
                  </BouncyButton>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  sheetContainer: {
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    boxShadow: GLASS_SHADOW,
    elevation: 18,
  },
  sheetDarkTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(14, 17, 25, 0.54)',
  },
  sheetTopSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 18,
  },
  inner: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flexShrink: 1,
  },
  headerIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(229, 9, 20, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.36)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.58)',
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    paddingLeft: 12,
    paddingRight: 6,
    height: 36,
  },
  autoLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  compactSwitch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  circleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardsScroll: {
    gap: 10,
    paddingVertical: 2,
  },
  serverCard: {
    width: 186,
    height: 124,
    borderRadius: 20,
    overflow: 'hidden',
    padding: 13,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  serverCardActive: {
    borderColor: 'rgba(229, 9, 20, 0.82)',
    borderWidth: 1.5,
    shadowColor: '#E50914',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  serverCardError: {
    borderColor: 'rgba(255, 69, 58, 0.35)',
  },
  serverCardDisabled: {
    opacity: 0.4,
  },
  cardBgPoster: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.18,
  },
  cardGlassLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(18, 22, 32, 0.72)',
  },
  cardGlassLayerActive: {
    backgroundColor: 'rgba(130, 12, 22, 0.42)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
  },
  activePulseDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FFFFFF',
  },
  activePillTxt: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  pingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 99,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  pingDot: {
    width: 5.5,
    height: 5.5,
    borderRadius: 3,
  },
  pingBadge: {
    fontSize: 10.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cardSubtitle: {
    color: 'rgba(255, 255, 255, 0.56)',
    fontSize: 11,
    lineHeight: 15,
  },
  cardFooter: {
    gap: 6,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  cardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.5,
  },
  cardStatusTxt: {
    fontSize: 11.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  etaTxt: {
    color: '#FFD60A',
    fontSize: 10.5,
    fontWeight: '600',
  },
  cardProgTrack: {
    height: 3.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    overflow: 'hidden',
  },
  cardProgFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 2,
  },
});
