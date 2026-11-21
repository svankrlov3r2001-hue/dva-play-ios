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
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from './GlassSurface';
import { COLORS } from '../constants/config';
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
    ? Math.min(760, winWidth - Math.max(36, insets.left + insets.right + 20))
    : Math.min(460, winWidth - 20);

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
        <GlassSurface
          variant="liquid"
          radius={40}
          intensity={85}
          style={[styles.cardWrap, { width: cardWidth }]}
        >
          <View style={styles.inner}>
            {/* Header Bar matching jw.php floating server bar */}
            <View style={styles.headerRow}>
              <View style={styles.titleBlock}>
                <Ionicons name="server-outline" size={19} color={COLORS.accent} />
                <Text style={styles.headerTitle}>Máy chủ phát phim</Text>
              </View>

              <View style={styles.headerRight}>
                <View style={styles.autoPill}>
                  <Text style={styles.autoLabel}>Tối ưu tự động</Text>
                  <Switch
                    value={autoOptimal}
                    trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                    onValueChange={(val) => {
                      Haptics.selectionAsync();
                      onToggleAutoOptimal(val);
                    }}
                  />
                </View>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.iconBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onRefreshPings();
                  }}
                >
                  {pingRefreshing ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Ionicons name="refresh-outline" size={18} color="#FFF" />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.iconBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onClose();
                  }}
                >
                  <Ionicons name="close" size={19} color="#FFF" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Horizontal Server Cards matching jw.php */}
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

                let statusBadge = 'Chưa hỗ trợ';
                let pingTxt = '';
                let pingColor = '#30D158';

                if (!srv.supported) {
                  statusBadge = 'Chưa hỗ trợ';
                } else if (srv.errored) {
                  statusBadge = 'Lỗi phiên';
                  pingColor = '#FF453A';
                } else if (srv.status === 'ready') {
                  statusBadge = srv.id === '99' ? 'Ngoại tuyến 100%' : 'Sẵn sàng';
                } else if (srv.status === 'preview_30p') {
                  statusBadge = `Xem trước 30p (${srv.progress}%)`;
                } else if (srv.status === 'preview_10p') {
                  statusBadge = `Xem trước 10p (${srv.progress}%)`;
                } else if (srv.status === 'downloading') {
                  statusBadge = srv.progressLabel || `Đang xử lý ${srv.progress}%`;
                } else if (srv.status === 'checking') {
                  statusBadge = 'Đang kiểm tra...';
                } else if (srv.status === 'error') {
                  statusBadge = srv.progressLabel || 'Lỗi kết nối';
                }

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
                  <TouchableOpacity
                    key={srv.id}
                    activeOpacity={disabled ? 1 : 0.82}
                    disabled={disabled}
                    style={[
                      styles.serverCard,
                      isActive && styles.serverCardActive,
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
                        blurRadius={18}
                      />
                    ) : null}
                    <View
                      style={[
                        styles.cardTintOverlay,
                        isActive && { backgroundColor: 'rgba(229, 9, 20, 0.34)' },
                      ]}
                    />

                    <View style={styles.cardTopRow}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {srv.label}
                      </Text>
                      {isActive ? (
                        <View style={styles.activeTag}>
                          <Text style={styles.activeTagTxt}>Đang phát</Text>
                        </View>
                      ) : pingTxt ? (
                        <Text style={[styles.pingBadge, { color: pingColor }]}>{pingTxt}</Text>
                      ) : null}
                    </View>

                    <View style={styles.cardMiddle}>
                      <Text style={styles.cardSubtitle} numberOfLines={1}>
                        {srv.subtitle}
                      </Text>
                      <Text
                        style={[
                          styles.cardStatusTxt,
                          playable && { color: '#D8FFE2' },
                          srv.errored && { color: '#FECACA' },
                        ]}
                        numberOfLines={1}
                      >
                        {statusBadge}
                      </Text>
                      {formattedEta && srv.status !== 'ready' ? (
                        <Text style={styles.etaTxt} numberOfLines={1}>
                          Còn {formattedEta}
                        </Text>
                      ) : null}
                    </View>

                    {srv.supported && (srv.status === 'downloading' || srv.status === 'preview_10p' || srv.status === 'preview_30p') ? (
                      <View style={styles.cardProgTrack}>
                        <View
                          style={[
                            styles.cardProgFill,
                            { width: `${Math.max(4, srv.progress)}%` },
                          ]}
                        />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
  },
  cardWrap: {
    borderRadius: 40,
  },
  inner: {
    paddingHorizontal: 22,
    paddingVertical: 18,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  titleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 16.5,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  autoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  autoLabel: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardsScroll: {
    gap: 10,
    paddingBottom: 4,
  },
  serverCard: {
    width: 174,
    height: 112,
    borderRadius: 26,
    overflow: 'hidden',
    padding: 13,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  serverCardActive: {
    shadowColor: '#E50914',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },
  serverCardDisabled: {
    opacity: 0.42,
  },
  cardBgPoster: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.35,
  },
  cardTintOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(12, 14, 20, 0.56)',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  cardTitle: {
    flex: 1,
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  activeTag: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 10,
  },
  activeTagTxt: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  pingBadge: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  cardMiddle: {
    gap: 2,
  },
  cardSubtitle: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 10.5,
  },
  cardStatusTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  etaTxt: {
    color: '#FFD60A',
    fontSize: 10.5,
    fontWeight: '600',
  },
  cardProgTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  cardProgFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
});
