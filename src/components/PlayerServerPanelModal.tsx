import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BouncyButton } from './BouncyButton';
import { GlassSurface, WaterDropPopupView } from './GlassSurface';
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
  manualLocked?: boolean;
  onToggleAutoOptimal: (next: boolean) => void;
  onSelectServer: (id: BackupServerId) => void;
  onRefreshPings: () => void;
  pingRefreshing: boolean;
  posterUrl?: string;
}

/**
 * Compact sleek borderless Liquid Glass server switcher for the iOS player.
 */
export function PlayerServerPanelModal({
  visible,
  onClose,
  servers,
  activeServerId,
  autoOptimal,
  manualLocked = false,
  onToggleAutoOptimal,
  onSelectServer,
  onRefreshPings,
  pingRefreshing,
}: PlayerServerPanelModalProps) {
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;
  const cardWidth = Math.min(width - 24, 672);
  const cardMaxHeight = Math.min(height - 32, 238);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeServerLabel = activeServer?.label || 'Tự chọn';
  const isAutoEffective = autoOptimal && !manualLocked;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.backdrop,
          { paddingTop: isLandscape ? 66 : 96 },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <WaterDropPopupView visible={visible} from="top">
          <GlassSurface
            variant="liquid"
            radius={40}
            intensity={28}
            style={[styles.sheetCard, { width: cardWidth, maxHeight: cardMaxHeight }]}
          >
          <View style={styles.inner}>
            {/* Sleek Single-Line Header */}
            <View style={styles.headerRow}>
              <View style={styles.titleCluster}>
                <View style={styles.headerIconDot}>
                  <Ionicons name="server-outline" size={16} color="#FF4D57" />
                </View>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    Máy chủ phát phim
                  </Text>
                  <Text style={styles.headerSubtitle} numberOfLines={1}>
                    Đang chọn: {activeServerLabel}
                    {manualLocked ? ' (Thủ công)' : isAutoEffective ? ' • Tự tối ưu' : ''}
                  </Text>
                </View>
              </View>

              <View style={styles.headerRight}>
                <BouncyButton
                  bounciness="gentle"
                  activeOpacity={0.8}
                  style={[styles.autoToggleBtn, isAutoEffective && styles.autoToggleBtnActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onToggleAutoOptimal(!isAutoEffective);
                  }}
                >
                  <View
                    style={[
                      styles.autoDot,
                      { backgroundColor: isAutoEffective ? '#30D158' : 'rgba(255,255,255,0.4)' },
                    ]}
                  />
                  <Text style={[styles.autoBtnTxt, isAutoEffective && styles.autoBtnTxtActive]}>
                    Tự tối ưu
                  </Text>
                </BouncyButton>

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
                    <Feather name="refresh-cw" size={14} color="#FFFFFF" />
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
                  <Ionicons name="close" size={17} color="#FFFFFF" />
                </BouncyButton>
              </View>
            </View>

            {/* Compact Server Cards */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16, marginVertical: -8 }}
              contentContainerStyle={[
                styles.cardsScroll,
                { paddingHorizontal: 16, paddingVertical: 8 },
              ]}
            >
              {servers.map((srv) => {
                const isActive = srv.id === activeServerId;
                const playable = isServerPlayable(srv);
                const disabled = !srv.supported;
                const formattedEta = formatVietnameseEta(srv.etaText);
                const isErrored = Boolean(srv.errored || srv.status === 'error');

                let statusText = 'Chưa hỗ trợ';
                let statusColor = 'rgba(255,255,255,0.68)';
                let statusDotColor = '#8E8E93';

                if (!srv.supported) {
                  statusText = 'Chưa hỗ trợ';
                } else if (srv.errored || srv.status === 'error') {
                  statusText = 'Lỗi • Thử lại';
                  statusColor = '#FF8A80';
                  statusDotColor = '#FF453A';
                } else if (srv.status === 'ready') {
                  statusText = isActive ? 'Đang phát' : 'Sẵn sàng';
                  statusColor = isActive ? '#FFFFFF' : '#30D158';
                  statusDotColor = isActive ? '#FFFFFF' : '#30D158';
                } else if (srv.status === 'preview_30p') {
                  statusText = `Xem 30p (${srv.progress}%)`;
                  statusColor = '#FFD60A';
                  statusDotColor = '#FFD60A';
                } else if (srv.status === 'preview_10p') {
                  statusText = `Xem 10p (${srv.progress}%)`;
                  statusColor = '#FFD60A';
                  statusDotColor = '#FFD60A';
                } else if (srv.status === 'downloading') {
                  statusText = formattedEta
                    ? `${srv.progress}% • ${formattedEta}`
                    : `Đang tải ${srv.progress}%`;
                  statusColor = '#FDE68A';
                  statusDotColor = '#FF9F0A';
                } else if (srv.status === 'checking') {
                  statusText = 'Đang kiểm tra';
                  statusColor = 'rgba(255,255,255,0.72)';
                  statusDotColor = '#9CA3AF';
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
                    pingTxt = 'Chậm';
                    pingColor = '#FF453A';
                  }
                }

                return (
                  <BouncyButton
                    key={srv.id}
                    bounciness="gentle"
                    activeOpacity={disabled ? 1 : 0.82}
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
                    {/* Row 1: Icon + Full Unclipped Title */}
                    <View style={styles.cardTopRow}>
                      <Ionicons
                        name={srv.id === '99' ? 'phone-portrait-outline' : 'cloud-outline'}
                        size={14}
                        color={isActive ? '#FFFFFF' : 'rgba(255,255,255,0.75)'}
                      />
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {srv.label}
                      </Text>
                    </View>

                    {/* Row 2: 1-line Subtitle */}
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {srv.subtitle}
                    </Text>

                    {/* Row 3: Compact Status Left + Ping Right */}
                    <View style={styles.cardFooter}>
                      <View style={styles.cardStatusRow}>
                        <View style={styles.statusCluster}>
                          {isErrored ? (
                            <Feather name="rotate-cw" size={11} color="#FF8A80" />
                          ) : playable && isActive ? (
                            <Ionicons name="checkmark-circle" size={12} color="#FFFFFF" />
                          ) : (
                            <View style={[styles.statusDot, { backgroundColor: statusDotColor }]} />
                          )}
                          <Text
                            style={[styles.cardStatusTxt, { color: statusColor }]}
                            numberOfLines={1}
                          >
                            {statusText}
                          </Text>
                        </View>

                        {pingTxt ? (
                          <Text style={[styles.pingTxt, { color: pingColor }]} numberOfLines={1}>
                            {pingTxt}
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
                              { width: `${Math.max(6, srv.progress)}%` },
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
        </GlassSurface>
        </WaterDropPopupView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  sheetCard: {
    borderRadius: 40,
    elevation: 18,
  },
  inner: {
    paddingTop: 18,
    paddingBottom: 18,
    paddingHorizontal: 22,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  headerIconDot: {
    width: 30,
    height: 30,
    borderRadius: 11,
    backgroundColor: 'rgba(229, 9, 20, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.58)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  autoToggleBtn: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  autoToggleBtnActive: {
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
  },
  autoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  autoBtnTxt: {
    color: 'rgba(255, 255, 255, 0.78)',
    fontSize: 12,
    fontWeight: '600',
  },
  autoBtnTxtActive: {
    color: '#B7F7C8',
    fontWeight: '700',
  },
  circleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardsScroll: {
    gap: 10,
    paddingVertical: 2,
  },
  serverCard: {
    width: 156,
    minHeight: 88,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 13,
    paddingVertical: 11,
    justifyContent: 'space-between',
  },
  serverCardActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.26)',
  },
  serverCardError: {
    backgroundColor: 'rgba(255, 69, 58, 0.14)',
  },
  serverCardDisabled: {
    opacity: 0.44,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  cardSubtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 4,
  },
  cardFooter: {
    marginTop: 8,
    gap: 5,
  },
  cardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  statusCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  cardStatusTxt: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  pingTxt: {
    fontSize: 10.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  cardProgTrack: {
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  cardProgFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FF9F0A',
  },
});
