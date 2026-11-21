import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GlassSurface } from './GlassSurface';
import { APP_VERSION, COLORS } from '../constants/config';
import { triggerDirectP12InstallNow } from '../services/otaService';
import { VersionManifest } from '../types/models';

export interface AppUpdateModalProps {
  visible: boolean;
  manifest: VersionManifest | null;
  onDismiss: () => void;
}

export function AppUpdateModal({ visible, manifest, onDismiss }: AppUpdateModalProps) {
  const { width: winWidth } = useWindowDimensions();
  const [installing, setInstalling] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!visible || !manifest) {
    return null;
  }

  const cardWidth = Math.min(400, Math.max(300, winWidth - 36));
  const latestChanges = manifest.history?.[0]?.changes || [];

  const handleInstallPress = async () => {
    if (installing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setInstalling(true);
    setStatusMsg(null);
    try {
      await triggerDirectP12InstallNow();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatusMsg({
        ok: true,
        text: 'Đã gửi yêu cầu cài đặt tới iPhone. Nhấn Cài đặt trên hộp thoại hệ thống để cập nhật.',
      });
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setStatusMsg({
        ok: false,
        text: err?.message || 'Không thể khởi chạy trình cập nhật lúc này. Vui lòng thử lại sau.',
      });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={['portrait']}
      onRequestClose={() => {
        if (!installing) onDismiss();
      }}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!installing) onDismiss();
          }}
        />
        <GlassSurface
          variant="liquid"
          radius={40}
          intensity={85}
          style={[styles.cardWrap, { width: cardWidth }]}
        >
          <View style={styles.cardInner}>
            <View style={styles.badgeIconWrap}>
              <Ionicons name="sparkles" size={26} color="#FFF" />
            </View>

            <Text style={styles.title}>Có bản cập nhật mới</Text>
            <View style={styles.verRow}>
              <Text style={styles.verPill}>v{manifest.versionName}</Text>
              <Text style={styles.verCurrent}>Hiện tại: v{APP_VERSION}</Text>
            </View>

            <Text style={styles.summaryTxt}>
              {manifest.changelog ||
                'Phiên bản mới đã sẵn sàng với nhiều cải tiến về tốc độ phát phim và tính năng tiện ích.'}
            </Text>

            {latestChanges.length > 0 ? (
              <View style={styles.changesBox}>
                {latestChanges.slice(0, 3).map((line, idx) => (
                  <Text key={idx} style={styles.changeLine}>
                    • {line}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={styles.reassureRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color="#30D158" />
              <Text style={styles.reassureTxt}>
                Cập nhật trực tiếp ngay trên iPhone, tự động ghi đè và giữ nguyên toàn bộ dữ liệu.
              </Text>
            </View>

            {statusMsg ? (
              <View
                style={[
                  styles.statusBox,
                  { backgroundColor: statusMsg.ok ? 'rgba(48, 209, 88, 0.16)' : 'rgba(239, 68, 68, 0.18)' },
                ]}
              >
                <Text
                  style={[
                    styles.statusTxt,
                    { color: statusMsg.ok ? '#D8FFE2' : '#FECACA' },
                  ]}
                >
                  {statusMsg.text}
                </Text>
              </View>
            ) : null}

            <View style={styles.actionsRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={installing}
                style={styles.laterBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  onDismiss();
                }}
              >
                <Text style={styles.laterBtnTxt}>Để sau</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                disabled={installing}
                style={styles.updateBtn}
                onPress={handleInstallPress}
              >
                {installing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="arrow-down-circle-outline" size={18} color="#FFF" />
                )}
                <Text style={styles.updateBtnTxt}>
                  {installing ? 'Đang chuẩn bị...' : 'Cập nhật ngay'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  cardWrap: {
    borderRadius: 40,
  },
  cardInner: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
  },
  badgeIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  verRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  verPill: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
    backgroundColor: 'rgba(229, 9, 20, 0.28)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  verCurrent: {
    color: COLORS.muted,
    fontSize: 12.5,
    fontWeight: '600',
  },
  summaryTxt: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 12,
  },
  changesBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 6,
    marginBottom: 12,
  },
  changeLine: {
    color: '#E2E8F0',
    fontSize: 12.5,
    lineHeight: 17.5,
  },
  reassureRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 14,
  },
  reassureTxt: {
    flex: 1,
    color: '#D8FFE2',
    fontSize: 12,
    lineHeight: 16.5,
  },
  statusBox: {
    width: '100%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 12,
  },
  statusTxt: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    fontWeight: '600',
  },
  actionsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
  },
  laterBtn: {
    flex: 0.9,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterBtnTxt: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '700',
  },
  updateBtn: {
    flex: 1.3,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  updateBtnTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
