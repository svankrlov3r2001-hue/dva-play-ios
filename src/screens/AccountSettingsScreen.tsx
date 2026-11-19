import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { GlassSurface } from '../components/GlassSurface';
import {
  APP_RELEASE_DATE,
  APP_RUNTIME_VERSION,
  APP_VERSION,
  APP_VERSION_CODE,
  COLORS,
  PORTAL_URL,
  RADII,
} from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { checkOtaUpdateApi } from '../services/api';
import {
  clearAllOfflineDownloads,
  formatBytes,
  loadOfflineDownloads,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import {
  applyOtaReloadNow,
  checkAndFetchOtaCombinedAsync,
  getOtaRuntimeState,
} from '../services/otaService';
import { OfflineDownloadItem, VersionManifest } from '../types/models';

const QUALITY_OPTIONS: ('auto' | '1080p' | '720p' | '360p')[] = [
  'auto',
  '1080p',
  '720p',
  '360p',
];

interface AccountSettingsScreenProps {
  visible: boolean;
  onClose: () => void;
  onOpenCast: () => void;
}

export function AccountSettingsScreen({
  visible,
  onClose,
  onOpenCast,
}: AccountSettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const { user, logout, verifyBiometricsForEnable } = useAuth();
  const { settings, updateSetting } = useSettings();
  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [manifest, setManifest] = useState<VersionManifest | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const otaState = getOtaRuntimeState();
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      enterAnim.setValue(0);
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      enterAnim.stopAnimation();
      enterAnim.setValue(0);
    }
  }, [visible, enterAnim]);

  useEffect(() => {
    loadOfflineDownloads()
      .then(setOfflineItems)
      .catch(() => setOfflineItems([]));
    return subscribeOfflineDownloads(setOfflineItems);
  }, []);

  const totalBytes = offlineItems.reduce((acc, i) => acc + (i.size_bytes || 0), 0);

  const roleLabel =
    user?.role?.toLowerCase() === 'admin'
      ? 'Quản trị viên'
      : Number(user?.CTV) === 1
      ? 'Cộng tác viên'
      : 'Thành viên VIP';

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const res = await checkAndFetchOtaCombinedAsync();
      if (res.manifest) {
        setManifest(res.manifest);
      }

      if (res.otaUpdated) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Đã tải bản cập nhật giao diện OTA!',
          'Giao diện và tính năng mới đã tải xong ngay trên iPhone mà không cần cài lại file .ipa.',
          [
            { text: 'Để lần sau', style: 'cancel' },
            {
              text: 'Áp dụng ngay',
              onPress: () => applyOtaReloadNow().catch(() => {}),
            },
          ]
        );
      } else if (res.ipaAvailable && res.manifest) {
        Alert.alert(
          `Có bản .ipa mới v${res.manifest.versionName}`,
          res.manifest.changelog || 'Phiên bản .ipa mới đã sẵn sàng trên trang tải.',
          [
            { text: 'Để sau', style: 'cancel' },
            {
              text: 'Mở trang tải .ipa',
              onPress: () => Linking.openURL(res.manifest?.portalUrl || PORTAL_URL),
            },
          ]
        );
      } else if (!res.otaSupported) {
        Alert.alert(
          'Đang chạy chế độ Expo Go / Dev',
          `Phiên bản: ${APP_VERSION} (Runtime ${APP_RUNTIME_VERSION}).\n\nKhi build thành file .ipa, expo-updates sẽ tự động tải bản cập nhật giao diện OTA trực tiếp từ dangvietanh.com/dva_ios/api/updates.php.`
        );
      } else {
        Alert.alert(
          'Đã là bản mới nhất',
          `Phiên bản: ${APP_VERSION} • Runtime OTA: ${otaState.runtimeVersion}`
        );
      }
    } catch {
      Alert.alert('Lỗi', 'Không thể kiểm tra cập nhật lúc này.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleClearOffline = () => {
    if (offlineItems.length === 0) return;
    Alert.alert('Xóa toàn bộ phim Offline?', 'Tất cả tệp video tải ngoại tuyến sẽ bị xóa.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa hết',
        style: 'destructive',
        onPress: () => clearAllOfflineDownloads(),
      },
    ]);
  };

  const handleLogout = () => {
    Alert.alert('Đăng xuất?', 'Bạn muốn đăng xuất tài khoản khỏi iPhone?', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: logout },
    ]);
  };

  if (!visible) {
    return null;
  }

  const translateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [44, 0],
  });

  return (
    <Animated.View
      style={[
        styles.overlayRoot,
        { opacity: enterAnim, transform: [{ translateY }] },
      ]}
    >
      <AmbientAppBackground />
      <View style={[styles.topHeader, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          activeOpacity={0.82}
          style={styles.backBtn}
          onPress={() => {
            Haptics.selectionAsync();
            onClose();
          }}
        >
          <Ionicons name="chevron-back" size={21} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.pageTitle}>Tài khoản &amp; Cài đặt</Text>
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingTop: 6,
          paddingHorizontal: 16,
          paddingBottom: Math.max(32, insets.bottom + 24),
        }}
        showsVerticalScrollIndicator={false}
      >

      {/* Profile Card */}
      <GlassSurface intensity={52} radius={RADII.xl} style={styles.card}>
        <View style={styles.profileRow}>
          <Image
            source={{ uri: user?.avatar_url || 'https://dangvietanh.com/uploads/user.jpg' }}
            style={styles.avatar}
            resizeMode="cover"
          />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.userName} numberOfLines={1}>
                {user?.name || user?.username || 'Thành viên'}
              </Text>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={11} color="#FFF" />
              </View>
            </View>
            <Text style={styles.userEmail} numberOfLines={1}>
              {user?.email || 'Thành viên Đặng Việt Anh'}
            </Text>
            <View style={styles.tierRow}>
              <Ionicons name="star" size={13} color={COLORS.accentGold} />
              <Text style={styles.tierText}>{roleLabel} • Đồng bộ dangvietanh.com</Text>
            </View>
          </View>
        </View>
      </GlassSurface>

      {/* iPhone Playback & Security Card */}
      <GlassSurface intensity={45} radius={RADII.xl} style={styles.card}>
        <Text style={styles.cardHeading}>Phát phim &amp; Bảo mật iPhone</Text>

        <View style={styles.settingBlock}>
          <Text style={styles.settingLabel}>Chất lượng phát ưu tiên</Text>
          <View style={styles.qualityRow}>
            {QUALITY_OPTIONS.map((q) => {
              const active = settings.preferredQuality === q;
              return (
                <TouchableOpacity
                  key={q}
                  style={[styles.qualityChip, active && styles.qualityChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    updateSetting('preferredQuality', q);
                  }}
                >
                  <Text style={[styles.qualityTxt, active && { color: '#FFF' }]}>
                    {q === 'auto' ? 'Tự động' : q}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <SettingSwitchRow
          icon="play-skip-forward-outline"
          label="Tự động phát tập tiếp theo"
          desc="Chuyển sang tập kế tiếp khi phim bộ kết thúc"
          value={settings.autoPlayNext}
          onChange={(v) => updateSetting('autoPlayNext', v)}
        />
        <SettingSwitchRow
          icon="flash-outline"
          label="Hiển thị nút Bỏ qua mở đầu"
          desc="Cho phép nhảy qua đoạn giới thiệu nhanh chóng"
          value={settings.autoSkipIntro}
          onChange={(v) => updateSetting('autoSkipIntro', v)}
        />
        <SettingSwitchRow
          icon="albums-outline"
          label="Picture-in-Picture (PiP)"
          desc={
            otaState.isExpoGo
              ? 'Thu nhỏ trình phát nổi khi thoát (chạy đầy đủ trên bản .ipa độc lập)'
              : 'Thu nhỏ trình phát nổi khi thoát ra màn hình chính'
          }
          value={settings.pipEnabled}
          onChange={(v) => updateSetting('pipEnabled', v)}
        />
        <SettingSwitchRow
          icon="scan-outline"
          label="Khóa bằng Face ID / Touch ID"
          desc="Yêu cầu xác thực sinh trắc học khi mở lại hoặc quay lại ứng dụng"
          value={settings.faceIdEnabled}
          onChange={async (v) => {
            if (!v) {
              await updateSetting('faceIdEnabled', false);
              return;
            }
            const res = await verifyBiometricsForEnable();
            if (res.ok) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await updateSetting('faceIdEnabled', true);
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              Alert.alert(
                'Không thể bật khóa Face ID',
                res.reason || 'Vui lòng kiểm tra quyền Face ID hoặc mật mã trong Cài đặt iPhone.'
              );
            }
          }}
        />
      </GlassSurface>

      {/* Offline & TV Cast Card */}
      <GlassSurface intensity={45} radius={RADII.xl} style={styles.card}>
        <Text style={styles.cardHeading}>Lưu trữ &amp; Kết nối TV</Text>

        <TouchableOpacity style={styles.actionRow} onPress={onOpenCast}>
          <View style={styles.rowLeft}>
            <Ionicons name="tv-outline" size={20} color="#FFF" />
            <View>
              <Text style={styles.settingLabel}>DVA Cast (Quét QR chiếu lên TV)</Text>
              <Text style={styles.settingDesc}>Ghép đôi nhanh với Android TV / Web Cast</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.actionRow}>
          <View style={styles.rowLeft}>
            <Ionicons name="folder-outline" size={20} color="#FFF" />
            <View>
              <Text style={styles.settingLabel}>Bộ nhớ phim Offline</Text>
              <Text style={styles.settingDesc}>
                {offlineItems.length} video • {formatBytes(totalBytes)} đã dùng
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.subtleBtn}
            onPress={handleClearOffline}
            disabled={offlineItems.length === 0}
          >
            <Text style={styles.subtleBtnTxt}>Dọn sạch</Text>
          </TouchableOpacity>
        </View>
      </GlassSurface>

      {/* Updates & Changelog Card */}
      <GlassSurface intensity={45} radius={RADII.xl} style={styles.card}>
        <View style={styles.actionRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.settingLabel}>Cập nhật ứng dụng &amp; Giao diện OTA</Text>
            <Text style={styles.settingDesc}>
              v{APP_VERSION} (Build {APP_VERSION_CODE}) • Runtime {otaState.runtimeVersion} •{' '}
              {otaState.isExpoGo
                ? 'Expo Go'
                : otaState.isEmbeddedLaunch
                ? 'Bản .ipa gốc'
                : 'Bản OTA mới nhất'}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.subtleBtn}
            onPress={handleCheckUpdate}
            disabled={checkingUpdate}
          >
            {checkingUpdate ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.subtleBtnTxt}>Cập nhật OTA</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.actionRow}
          onPress={async () => {
            Haptics.selectionAsync();
            const next = !changelogOpen;
            setChangelogOpen(next);
            if (next && !manifest) {
              try {
                const m = await checkOtaUpdateApi();
                setManifest(m);
              } catch {}
            }
          }}
        >
          <View>
            <Text style={styles.settingLabel}>Có gì mới</Text>
            <Text style={styles.settingDesc}>Chi tiết tính năng trong bản phát hành</Text>
          </View>
          <Ionicons
            name={changelogOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={COLORS.muted}
          />
        </TouchableOpacity>

        {changelogOpen ? (
          <View style={styles.changelogWrap}>
            {(manifest?.history || [
              {
                versionCode: APP_VERSION_CODE,
                versionName: APP_VERSION,
                date: APP_RELEASE_DATE,
                title: 'Phát hành phiên bản đầu tiên cho iPhone',
                changes: [
                  'Giao diện Apple Liquid Glass tối ưu thao tác 1 tay',
                  'Trình phát kép AVPlayer + WKWebView fallback, tải MP4 offline, Face ID & DVA Cast QR',
                ],
              },
            ]).map((h) => (
              <View key={h.versionCode} style={styles.historyBox}>
                <Text style={styles.historyTitle}>
                  v{h.versionName} — {h.title}
                </Text>
                {h.changes.map((c, idx) => (
                  <Text key={idx} style={styles.historyLine}>
                    • {c}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </GlassSurface>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color="#FCA5A5" />
        <Text style={styles.logoutTxt}>Đăng xuất tài khoản</Text>
      </TouchableOpacity>
    </ScrollView>
    </Animated.View>
  );
}

function SettingSwitchRow({
  icon,
  label,
  desc,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  desc: string;
  value: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Ionicons name={icon} size={20} color={COLORS.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDesc}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.selectionAsync();
          onChange(v);
        }}
        trackColor={{ false: 'rgba(255,255,255,0.16)', true: COLORS.accent }}
        thumbColor="#FFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 550,
    backgroundColor: COLORS.bg,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  pageTitle: {
    color: '#FFF',
    fontSize: 21,
    fontWeight: '800',
  },
  card: {
    padding: 18,
    marginBottom: 14,
  },
  cardHeading: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 14,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.cardPlaceholder,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
  verifiedBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userEmail: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 2,
  },
  tierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  tierText: {
    color: COLORS.accentGold,
    fontSize: 12,
    fontWeight: '700',
  },
  settingBlock: {
    marginBottom: 14,
  },
  settingLabel: {
    color: '#FFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  settingDesc: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
  qualityRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  qualityChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  qualityChipActive: {
    backgroundColor: COLORS.accent,
  },
  qualityTxt: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 10,
  },
  subtleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  subtleBtnTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  changelogWrap: {
    marginTop: 10,
    gap: 8,
  },
  historyBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 12,
  },
  historyTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
    marginBottom: 6,
  },
  historyLine: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
  logoutBtn: {
    height: 52,
    borderRadius: RADII.md,
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  logoutTxt: {
    color: '#FCA5A5',
    fontSize: 15,
    fontWeight: '700',
  },
});
