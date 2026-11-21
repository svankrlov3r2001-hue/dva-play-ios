import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { showAppAlert } from '../components/AppAlertModal';
import { AppUpdateModal } from '../components/AppUpdateModal';
import { GlassSurface } from '../components/GlassSurface';
import {
  APP_RELEASE_DATE,
  APP_VERSION,
  APP_VERSION_CODE,
  COLORS,
  PORTAL_URL,
  RADII,
} from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import {
  checkOtaUpdateApi,
  fetchProxyPresetsApi,
  resolveProxyPresetApi,
} from '../services/api';
import {
  disableProxyAsync,
  enableProxyAsync,
  getProxyConfig,
  isNativeProxySupported,
  normalizeCustomProxyInput,
  PROXY_PROBE_TIMEOUT_MS,
  ProxyPreset,
  ProxyRuntimeConfig,
  ProxyTestResult,
  setProxyConfig,
  subscribeProxyConfig,
  syncProxyPresetsFromDbAsync,
  testProxyDirectAsync,
} from '../services/proxyService';
import {
  clearAllOfflineDownloads,
  enforceOfflineRetentionPolicy,
  formatBytes,
  loadOfflineDownloads,
  setOfflineRuntimePolicy,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import {
  applyOtaReloadNow,
  checkAndFetchOtaCombinedAsync,
} from '../services/otaService';
import { OfflineDownloadItem, VersionManifest } from '../types/models';

const QUALITY_OPTIONS: ('auto' | '1080p' | '720p' | '360p')[] = [
  'auto',
  '1080p',
  '720p',
  '360p',
];

const STORAGE_LIMIT_GB_OPTIONS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const AUTO_DELETE_DAY_OPTIONS: { days: number; label: string }[] = [
  { days: 3, label: '3 ngày' },
  { days: 7, label: '7 ngày' },
  { days: 14, label: '14 ngày' },
  { days: 30, label: '1 tháng' },
  { days: 60, label: '2 tháng' },
  { days: 90, label: '3 tháng' },
];

const THREAD_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];

type PresetProbeStatus = 'testing' | 'ok' | 'timeout' | 'error';

interface PresetProbeState {
  status: PresetProbeStatus;
  latencyMs?: number;
  error?: string;
}

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
  const [directUpdateOpen, setDirectUpdateOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [proxyCfg, setProxyCfg] = useState<ProxyRuntimeConfig>(() => getProxyConfig());
  const [proxyPresets, setProxyPresets] = useState<ProxyPreset[]>([
    { id: 'hanoi', name: 'Server Hà Nội', region: 'Hà Nội, Việt Nam', managed: true },
  ]);
  const [showProxyPass, setShowProxyPass] = useState(false);
  const [applyingProxy, setApplyingProxy] = useState(false);
  const [reloadingPresets, setReloadingPresets] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const [presetProbeMap, setPresetProbeMap] = useState<Record<string, PresetProbeState>>({});
  const [proxyStatusMsg, setProxyStatusMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const probeRunIdRef = useRef(0);
  const nativeProxyReady = isNativeProxySupported();
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
      setDirectUpdateOpen(false);
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

  useEffect(() => {
    return subscribeProxyConfig(setProxyCfg);
  }, []);

  const handleReloadPresets = useCallback(async (isManual: boolean = false) => {
    probeRunIdRef.current++;
    setTestingProxy(false);
    setPresetProbeMap({});
    setReloadingPresets(true);
    if (isManual) {
      Haptics.selectionAsync();
      setProxyStatusMsg(null);
    }
    try {
      const latest = await syncProxyPresetsFromDbAsync(fetchProxyPresetsApi);
      setProxyPresets(latest);
      if (isManual) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setProxyStatusMsg({
          ok: true,
          text:
            latest.length > 0
              ? `Đã cập nhật ${latest.length} máy chủ sẵn có mới nhất từ hệ thống.`
              : 'Hiện chưa có máy chủ sẵn có nào đang bật trên hệ thống.',
        });
      }
    } catch (err: any) {
      if (isManual) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setProxyStatusMsg({
          ok: false,
          text: err?.message || 'Không thể tải danh sách máy chủ từ hệ thống.',
        });
      }
    } finally {
      setReloadingPresets(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      probeRunIdRef.current++;
      setTestingProxy(false);
      return;
    }
    handleReloadPresets(false);
  }, [visible, handleReloadPresets]);

  const applyProxyOverride = async (override: Partial<ProxyRuntimeConfig>) => {
    if (applyingProxy) return;
    if (proxyCfg.enabled && nativeProxyReady) {
      setApplyingProxy(true);
      try {
        await enableProxyAsync(resolveProxyPresetApi, override);
      } catch (err: any) {
        await disableProxyAsync().catch(() => {});
        setProxyStatusMsg({
          ok: false,
          text: err?.message || 'Không thể áp dụng kết nối Proxy.',
        });
      } finally {
        setApplyingProxy(false);
      }
    } else {
      setProxyConfig(override);
    }
  };

  const handleToggleProxy = async (nextVal: boolean) => {
    if (applyingProxy) return;
    setProxyStatusMsg(null);
    if (!nextVal) {
      Haptics.selectionAsync();
      setApplyingProxy(true);
      try {
        await disableProxyAsync();
      } finally {
        setApplyingProxy(false);
      }
      return;
    }

    if (!nativeProxyReady) {
      showAppAlert(
        'Cần cập nhật ứng dụng',
        'Tính năng kết nối Proxy trực tiếp trên iPhone yêu cầu cài đặt bản ứng dụng iOS mới nhất.'
      );
      return;
    }

    if (
      proxyCfg.mode === 'custom' &&
      !normalizeCustomProxyInput(proxyCfg.customHost, proxyCfg.customPort)
    ) {
      showAppAlert(
        'Thiếu thông tin Proxy',
        'Vui lòng nhập đầy đủ Địa chỉ IP/Host và Cổng (1 - 65535) trước khi bật Proxy tự cấu hình.'
      );
      return;
    }

    setApplyingProxy(true);
    try {
      await enableProxyAsync(resolveProxyPresetApi);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setProxyStatusMsg({
        ok: false,
        text: err?.message || 'Không thể bật kết nối Proxy.',
      });
    } finally {
      setApplyingProxy(false);
    }
  };

  const handleTestProxyConnection = async () => {
    if (testingProxy) return;
    setProxyStatusMsg(null);
    if (!nativeProxyReady) {
      setProxyStatusMsg({
        ok: false,
        text: 'Cần cài đặt bản ứng dụng iOS mới nhất để kiểm tra Proxy trực tiếp trên iPhone.',
      });
      return;
    }

    if (proxyCfg.mode === 'custom') {
      if (!normalizeCustomProxyInput(proxyCfg.customHost, proxyCfg.customPort)) {
        setProxyStatusMsg({
          ok: false,
          text: 'Vui lòng nhập đúng IP/Host và Cổng (1 - 65535).',
        });
        return;
      }

      setTestingProxy(true);
      try {
        const res = await testProxyDirectAsync(
          proxyCfg,
          resolveProxyPresetApi,
          PROXY_PROBE_TIMEOUT_MS
        );
        if (res.success) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          const suffix = !res.managed && res.exit_ip ? ` • IP: ${res.exit_ip}` : '';
          setProxyStatusMsg({
            ok: true,
            text: `Đã kết nối ${res.label} • ${res.latency_ms} ms${suffix}`,
          });
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setProxyStatusMsg({
            ok: false,
            text: res.error || 'Không thể kết nối qua proxy này.',
          });
        }
      } catch (err: any) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setProxyStatusMsg({
          ok: false,
          text: err?.message || 'Kiểm tra kết nối thất bại.',
        });
      } finally {
        setTestingProxy(false);
      }
      return;
    }

    const listToProbe = [...proxyPresets];
    if (listToProbe.length === 0) {
      setProxyStatusMsg({
        ok: false,
        text: 'Hiện chưa có máy chủ sẵn có nào đang bật để kiểm tra.',
      });
      return;
    }

    const runId = ++probeRunIdRef.current;
    setTestingProxy(true);
    setPresetProbeMap({});

    let okCount = 0;
    let timeoutCount = 0;
    let fastest: { name: string; latencyMs: number } | null = null;
    let firstErrorMsg = '';

    try {
      for (const preset of listToProbe) {
        if (probeRunIdRef.current !== runId) return;

        setPresetProbeMap((prev) => ({
          ...prev,
          [preset.id]: { status: 'testing' },
        }));

        let res: ProxyTestResult;
        try {
          res = await testProxyDirectAsync(
            {
              ...proxyCfg,
              mode: 'preset',
              presetId: preset.id,
              presetName: preset.name,
            },
            resolveProxyPresetApi,
            PROXY_PROBE_TIMEOUT_MS
          );
        } catch (err: any) {
          res = {
            success: false,
            timedOut: false,
            latency_ms: 0,
            label: preset.name,
            managed: true,
            exit_ip: null,
            error: err?.message || 'Kiểm tra kết nối thất bại.',
          };
        }

        if (probeRunIdRef.current !== runId) return;

        if (res.success) {
          okCount++;
          if (!fastest || res.latency_ms < fastest.latencyMs) {
            fastest = { name: preset.name, latencyMs: res.latency_ms };
          }
          setPresetProbeMap((prev) => ({
            ...prev,
            [preset.id]: { status: 'ok', latencyMs: res.latency_ms },
          }));
        } else if (res.timedOut) {
          timeoutCount++;
          if (!firstErrorMsg) {
            firstErrorMsg = res.error || 'Quá thời gian chờ (3s).';
          }
          setPresetProbeMap((prev) => ({
            ...prev,
            [preset.id]: { status: 'timeout', error: res.error || undefined },
          }));
        } else {
          if (!firstErrorMsg) {
            firstErrorMsg = res.error || 'Không thể kết nối qua proxy này.';
          }
          setPresetProbeMap((prev) => ({
            ...prev,
            [preset.id]: { status: 'error', error: res.error || undefined },
          }));
        }
      }

      if (probeRunIdRef.current !== runId) return;

      if (okCount > 0 && fastest) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setProxyStatusMsg({
          ok: true,
          text: `Đã kiểm tra ${listToProbe.length} máy chủ (${okCount} hoạt động) • Nhanh nhất: ${fastest.name} (${fastest.latencyMs} ms)`,
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setProxyStatusMsg({
          ok: false,
          text:
            timeoutCount === listToProbe.length
              ? `Tất cả ${listToProbe.length} máy chủ đều quá thời gian chờ (${Math.round(
                  PROXY_PROBE_TIMEOUT_MS / 1000
                )}s).`
              : firstErrorMsg || 'Không thể kết nối qua các máy chủ sẵn có.',
        });
      }
    } finally {
      if (probeRunIdRef.current === runId) {
        setTestingProxy(false);
      }
    }
  };

  const totalBytes = offlineItems.reduce((acc, i) => acc + (i.size_bytes || 0), 0);
  const storageLimitGb = Math.max(10, Math.min(100, settings.offlineStorageLimitGb || 20));
  const storageLimitBytes = storageLimitGb * 1024 * 1024 * 1024;
  const storageUsedPct = Math.min(
    100,
    totalBytes > 0 ? Math.max(2, Math.round((totalBytes / storageLimitBytes) * 100)) : 0
  );

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

      if (res.canDirectInstall && res.ipaAvailable && res.directInstallReady && res.manifest) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setDirectUpdateOpen(true);
      } else if (res.otaUpdated) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAppAlert(
          'Đã tải bản cập nhật mới!',
          'Giao diện và tính năng xem phim mới đã sẵn sàng ngay trên iPhone của bạn.',
          [
            { text: 'Để lần sau', style: 'cancel' },
            {
              text: 'Áp dụng ngay',
              onPress: () => applyOtaReloadNow().catch(() => {}),
            },
          ]
        );
      } else if (res.ipaAvailable && res.manifest) {
        showAppAlert(
          `Có phiên bản mới v${res.manifest.versionName}`,
          res.manifest.changelog || 'Phiên bản ứng dụng mới đã sẵn sàng trên trang Tải Ứng Dụng.',
          [
            { text: 'Để sau', style: 'cancel' },
            {
              text: 'Mở trang Tải Ứng Dụng',
              onPress: () => Linking.openURL(res.manifest?.portalUrl || PORTAL_URL),
            },
          ]
        );
      } else {
        showAppAlert(
          'Đã là phiên bản mới nhất',
          `Phiên bản hiện tại: v${APP_VERSION} • Phát hành ${APP_RELEASE_DATE}`
        );
      }
    } catch {
      showAppAlert('Lỗi', 'Không thể kiểm tra cập nhật lúc này.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleClearOffline = () => {
    if (offlineItems.length === 0) return;
    showAppAlert('Xóa toàn bộ phim ngoại tuyến?', 'Tất cả phim đã tải để xem ngoại tuyến trên iPhone sẽ bị xóa.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa hết',
        style: 'destructive',
        onPress: () => clearAllOfflineDownloads(),
      },
    ]);
  };

  const handleLogout = () => {
    showAppAlert('Đăng xuất?', 'Bạn muốn đăng xuất tài khoản khỏi iPhone?', [
      { text: 'Hủy', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: logout },
    ]);
  };

  const updateOfflinePolicyAndEnforce = (patch: {
    offlineStorageLimitGb?: number;
    offlineAutoDeleteEnabled?: boolean;
    offlineAutoDeleteDays?: number;
    offlineAntiStallEnabled?: boolean;
  }) => {
    const nextPolicy = {
      storageLimitGb: patch.offlineStorageLimitGb ?? storageLimitGb,
      autoDeleteEnabled:
        patch.offlineAutoDeleteEnabled ?? settings.offlineAutoDeleteEnabled,
      autoDeleteDays:
        patch.offlineAutoDeleteDays ?? (settings.offlineAutoDeleteDays || 7),
      antiStallEnabled:
        patch.offlineAntiStallEnabled ?? settings.offlineAntiStallEnabled,
    };
    setOfflineRuntimePolicy(nextPolicy);
    if (patch.offlineStorageLimitGb !== undefined) {
      void updateSetting('offlineStorageLimitGb', patch.offlineStorageLimitGb);
    }
    if (patch.offlineAutoDeleteEnabled !== undefined) {
      void updateSetting('offlineAutoDeleteEnabled', patch.offlineAutoDeleteEnabled);
    }
    if (patch.offlineAutoDeleteDays !== undefined) {
      void updateSetting('offlineAutoDeleteDays', patch.offlineAutoDeleteDays);
    }
    if (patch.offlineAntiStallEnabled !== undefined) {
      void updateSetting('offlineAntiStallEnabled', patch.offlineAntiStallEnabled);
    }
    void enforceOfflineRetentionPolicy(nextPolicy);
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

      {/* iOS Navigation Bar Header */}
      <View style={[styles.navBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          activeOpacity={0.78}
          style={styles.navBackBtn}
          onPress={() => {
            Haptics.selectionAsync();
            onClose();
          }}
        >
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Cài đặt</Text>
        <View style={styles.navRightSpacer} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{
          paddingTop: 8,
          paddingHorizontal: 16,
          paddingBottom: Math.max(36, insets.bottom + 28),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Apple Account Profile Card */}
        <GlassSurface intensity={56} radius={22} style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatarRing}>
              <Image
                source={{ uri: user?.avatar_url || 'https://dangvietanh.com/uploads/user.jpg' }}
                style={styles.avatar}
                resizeMode="cover"
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.nameRow}>
                <Text style={styles.userName} numberOfLines={1}>
                  {user?.name || user?.username || 'Thành viên'}
                </Text>
                <View style={styles.verifiedBadge}>
                  <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                </View>
              </View>
              <Text style={styles.userEmail} numberOfLines={1}>
                {user?.email || 'Thành viên Đặng Việt Anh'}
              </Text>
              <View style={styles.tierPill}>
                <Ionicons name="star" size={11} color={COLORS.accentGold} />
                <Text style={styles.tierText}>{roleLabel} • Đồng bộ dangvietanh.com</Text>
              </View>
            </View>
          </View>
        </GlassSurface>

        {/* Section 1: Playback & Experience */}
        <Text style={styles.sectionHeader}>TRẢI NGHIỆM XEM PHIM</Text>
        <View style={styles.insetGroup}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.insetGroupFill} />

          <View style={styles.groupedColumnRow}>
            <View style={styles.rowHeaderTop}>
              <View style={[styles.iosBadge, { backgroundColor: '#5E5CE6' }]}>
                <Ionicons name="videocam" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Chất lượng phát ưu tiên</Text>
                <Text style={styles.settingDesc}>Độ phân giải mặc định khi mở phim</Text>
              </View>
            </View>
            <View style={styles.segmentedControlRow}>
              {QUALITY_OPTIONS.map((q) => {
                const active = settings.preferredQuality === q;
                return (
                  <TouchableOpacity
                    key={q}
                    activeOpacity={0.8}
                    style={[styles.segmentOption, active && styles.segmentOptionActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      void updateSetting('preferredQuality', q);
                    }}
                  >
                    <Text style={[styles.segmentOptionTxt, active && styles.segmentOptionTxtActive]}>
                      {q === 'auto' ? 'Tự động' : q}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="play-skip-forward"
            badgeColor="#E50914"
            label="Tự động phát tập tiếp theo"
            desc="Chuyển sang tập kế tiếp khi phim bộ kết thúc"
            value={settings.autoPlayNext}
            onChange={(v) => void updateSetting('autoPlayNext', v)}
          />

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="flash"
            badgeColor="#FF9F0A"
            label="Bỏ qua đoạn giới thiệu"
            desc="Tự động tua nhanh phần mở đầu mỗi tập phim"
            value={settings.autoSkipIntro}
            onChange={(v) => void updateSetting('autoSkipIntro', v)}
          />

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="albums"
            badgeColor="#0A84FF"
            label="Thu nhỏ khung hình phim"
            desc="Xem nổi khi thoát ra màn hình chính iPhone"
            value={settings.pipEnabled}
            onChange={(v) => void updateSetting('pipEnabled', v)}
          />

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="contrast"
            badgeColor="#BF5AF2"
            label="Tăng cường tương phản hình ảnh"
            desc="Tăng chiều sâu vùng tối và độ sắc nét khung hình"
            value={settings.highContrastMode}
            onChange={(v) => void updateSetting('highContrastMode', v)}
          />
        </View>

        {/* Section 2: Offline Storage & Retention (Item 8) */}
        <Text style={styles.sectionHeader}>LƯU TRỮ &amp; NGOẠI TUYẾN</Text>
        <View style={styles.insetGroup}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.insetGroupFill} />

          {/* Storage Usage Bar */}
          <View style={styles.groupedColumnRow}>
            <View style={styles.storageTopRow}>
              <View style={[styles.iosBadge, { backgroundColor: '#32ADE6' }]}>
                <Ionicons name="folder-open" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Dung lượng bộ nhớ ngoại tuyến</Text>
                <Text style={styles.settingDesc}>
                  {offlineItems.length} phim • Đã dùng {formatBytes(totalBytes)} / {storageLimitGb} GB
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.cleanPillBtn, offlineItems.length === 0 && { opacity: 0.45 }]}
                onPress={handleClearOffline}
                disabled={offlineItems.length === 0}
              >
                <Text style={styles.cleanPillTxt}>Dọn sạch</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.storageTrack}>
              <LinearGradient
                colors={['#32ADE6', '#0A84FF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.storageFill, { width: `${storageUsedPct}%` }]}
              />
            </View>
          </View>

          <View style={styles.insetDivider} />
          <View style={styles.groupedColumnRow}>
            <View style={styles.rowHeaderTop}>
              <View style={[styles.iosBadge, { backgroundColor: '#30D158' }]}>
                <Ionicons name="pie-chart" size={15} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Giới hạn dung lượng tối đa</Text>
                <Text style={styles.settingDesc}>
                  Tự dọn phim xem cũ nhất khi vượt quá {storageLimitGb} GB
                </Text>
              </View>
              <Text style={styles.rightValuePill}>{storageLimitGb} GB</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalChipsScroll}
            >
              {STORAGE_LIMIT_GB_OPTIONS.map((gb) => {
                const active = storageLimitGb === gb;
                return (
                  <TouchableOpacity
                    key={gb}
                    activeOpacity={0.78}
                    style={[styles.chipPill, active && styles.chipPillActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      updateOfflinePolicyAndEnforce({ offlineStorageLimitGb: gb });
                    }}
                  >
                    <Text style={[styles.chipPillTxt, active && styles.chipPillTxtActive]}>
                      {gb} GB
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.insetDivider} />
          <View style={styles.groupedColumnRow}>
            <View style={styles.switchRowInner}>
              <View style={[styles.iosBadge, { backgroundColor: '#FF453A' }]}>
                <Ionicons name="trash-bin" size={15} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Tự động xóa phim cũ theo thời gian</Text>
                <Text style={styles.settingDesc}>
                  {settings.offlineAutoDeleteEnabled
                    ? `Tự xóa phim đã tải sau ${
                        AUTO_DELETE_DAY_OPTIONS.find((d) => d.days === settings.offlineAutoDeleteDays)
                          ?.label || `${settings.offlineAutoDeleteDays} ngày`
                      }`
                    : 'Giữ lại phim ngoại tuyến không giới hạn thời gian'}
                </Text>
              </View>
              <Switch
                value={settings.offlineAutoDeleteEnabled}
                onValueChange={(v) => {
                  Haptics.selectionAsync();
                  updateOfflinePolicyAndEnforce({ offlineAutoDeleteEnabled: v });
                }}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                thumbColor="#FFFFFF"
              />
            </View>
            {settings.offlineAutoDeleteEnabled ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalChipsScroll}
              >
                {AUTO_DELETE_DAY_OPTIONS.map((opt) => {
                  const active = (settings.offlineAutoDeleteDays || 7) === opt.days;
                  return (
                    <TouchableOpacity
                      key={opt.days}
                      activeOpacity={0.78}
                      style={[styles.chipPill, active && styles.chipPillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        updateOfflinePolicyAndEnforce({ offlineAutoDeleteDays: opt.days });
                      }}
                    >
                      <Text style={[styles.chipPillTxt, active && styles.chipPillTxtActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : null}
          </View>

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="shield-checkmark"
            badgeColor="#10B981"
            label="Chống treo & tự đổi liên kết tải chậm"
            desc="Tự khởi động lại tiến trình khi tải bị đứng hoặc tốc độ thấp"
            value={settings.offlineAntiStallEnabled}
            onChange={(v) => updateOfflinePolicyAndEnforce({ offlineAntiStallEnabled: v })}
          />

          <View style={styles.insetDivider} />
          <View style={styles.groupedColumnRow}>
            <View style={styles.rowHeaderTop}>
              <View style={[styles.iosBadge, { backgroundColor: '#6366F1' }]}>
                <Ionicons name="git-branch" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Số luồng tải song song</Text>
                <Text style={styles.settingDesc}>Tăng tốc độ lưu phim ngoại tuyến</Text>
              </View>
              <Text style={styles.rightValuePill}>{settings.offlineDownloadConcurrency || 3} luồng</Text>
            </View>
            <View style={styles.segmentedControlRow}>
              {THREAD_COUNT_OPTIONS.map((n) => {
                const active = (settings.offlineDownloadConcurrency || 3) === n;
                return (
                  <TouchableOpacity
                    key={n}
                    activeOpacity={0.78}
                    style={[styles.segmentOption, active && styles.segmentOptionActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      void updateSetting('offlineDownloadConcurrency', n);
                    }}
                  >
                    <Text style={[styles.segmentOptionTxt, active && styles.segmentOptionTxtActive]}>
                      {n}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="download"
            badgeColor="#0EA5E9"
            label="Tự động tải tập đang xem"
            desc="Lưu tập đang phát để xem lại không cần mạng"
            value={settings.autoDownloadCurrentOnWatch}
            onChange={(v) => void updateSetting('autoDownloadCurrentOnWatch', v)}
          />

          <View style={styles.insetDivider} />
          <View style={styles.switchRow}>
            <View style={[styles.iosBadge, { backgroundColor: '#EC4899' }]}>
              <Ionicons name="layers" size={15} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Tải thêm tập tiếp theo</Text>
              <Text style={styles.settingDesc}>
                {settings.autoDownloadNextCount > 0
                  ? `Tự động tải trước ${settings.autoDownloadNextCount} tập tiếp theo`
                  : 'Đang tắt tải trước tập kế tiếp'}
              </Text>
            </View>
            <View style={styles.offlineStepperRow}>
              <TouchableOpacity
                style={styles.offlineStepBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting(
                    'autoDownloadNextCount',
                    Math.max(0, (settings.autoDownloadNextCount || 0) - 1)
                  );
                }}
              >
                <Ionicons name="remove" size={15} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.offlineStepVal}>{settings.autoDownloadNextCount || 0}</Text>
              <TouchableOpacity
                style={styles.offlineStepBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting(
                    'autoDownloadNextCount',
                    Math.min(20, (settings.autoDownloadNextCount || 0) + 1)
                  );
                }}
              >
                <Ionicons name="add" size={15} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.insetDivider} />
          <IosSwitchRow
            icon="phone-portrait"
            badgeColor="#14B8A6"
            label="Ưu tiên phát từ máy khi có mạng"
            desc="Dùng ngay bản ngoại tuyến đã tải để mở tức thì"
            value={settings.preferOfflineWhenOnline}
            onChange={(v) => void updateSetting('preferOfflineWhenOnline', v)}
          />
        </View>

        {/* Section 3: Security, Proxy & TV Cast */}
        <Text style={styles.sectionHeader}>BẢO MẬT &amp; KẾT NỐI</Text>
        <View style={styles.insetGroup}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.insetGroupFill} />

          <IosSwitchRow
            icon="scan"
            badgeColor="#30D158"
            label="Khóa bằng Face ID / Touch ID"
            desc="Yêu cầu xác thực sinh trắc học khi mở ứng dụng"
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
                showAppAlert(
                  'Không thể bật khóa Face ID',
                  res.reason || 'Vui lòng kiểm tra quyền Face ID hoặc mật mã trong Cài đặt iPhone.'
                );
              }
            }}
          />

          <View style={styles.insetDivider} />
          <TouchableOpacity
            activeOpacity={0.78}
            style={styles.navRow}
            onPress={() => {
              Haptics.selectionAsync();
              onOpenCast();
            }}
          >
            <View style={[styles.iosBadge, { backgroundColor: '#00C7BE' }]}>
              <Ionicons name="tv" size={15} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Chiếu lên TV (DVA Cast)</Text>
              <Text style={styles.settingDesc}>Quét mã QR để điều khiển trên màn hình TV</Text>
            </View>
            <Feather name="chevron-right" size={17} color="rgba(255,255,255,0.38)" />
          </TouchableOpacity>

          <View style={styles.insetDivider} />
          <View style={styles.groupedColumnRow}>
            <View style={styles.proxyHeaderRow}>
              <View style={[styles.iosBadge, { backgroundColor: '#0A84FF' }]}>
                <Ionicons name="globe" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>Kết nối Proxy</Text>
                <Text style={styles.settingDesc}>Tự động tắt mỗi khi thoát ứng dụng</Text>
              </View>
              <Switch
                value={proxyCfg.enabled}
                onValueChange={handleToggleProxy}
                disabled={applyingProxy}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                thumbColor="#FFFFFF"
              />
            </View>

            {!nativeProxyReady ? (
              <View style={styles.proxyNoticeBanner}>
                <Ionicons name="information-circle-outline" size={16} color="#FDE68A" />
                <Text style={styles.proxyNoticeTxt}>
                  Cần cài đặt bản ứng dụng iOS mới nhất để bật kết nối Proxy trực tiếp trên iPhone.
                </Text>
              </View>
            ) : null}

            <View style={styles.proxyModeRow}>
              <TouchableOpacity
                style={[
                  styles.segmentOption,
                  proxyCfg.mode === 'preset' && styles.segmentOptionActive,
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setProxyStatusMsg(null);
                  void applyProxyOverride({ mode: 'preset' });
                }}
              >
                <Text
                  style={[
                    styles.segmentOptionTxt,
                    proxyCfg.mode === 'preset' && styles.segmentOptionTxtActive,
                  ]}
                >
                  Máy chủ sẵn có
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.segmentOption,
                  proxyCfg.mode === 'custom' && styles.segmentOptionActive,
                ]}
                onPress={async () => {
                  Haptics.selectionAsync();
                  setProxyStatusMsg(null);
                  const validCustom = Boolean(
                    normalizeCustomProxyInput(proxyCfg.customHost, proxyCfg.customPort)
                  );
                  if (proxyCfg.enabled && validCustom) {
                    await applyProxyOverride({ mode: 'custom' });
                  } else {
                    if (proxyCfg.enabled && !validCustom) {
                      await disableProxyAsync().catch(() => {});
                    }
                    setProxyConfig({ mode: 'custom', enabled: false });
                  }
                }}
              >
                <Text
                  style={[
                    styles.segmentOptionTxt,
                    proxyCfg.mode === 'custom' && styles.segmentOptionTxtActive,
                  ]}
                >
                  Proxy tự cấu hình
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.reloadProxyIconBtn}
                onPress={() => handleReloadPresets(true)}
                disabled={reloadingPresets || applyingProxy}
                activeOpacity={0.78}
              >
                {reloadingPresets ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="refresh" size={16} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>

            {proxyCfg.mode === 'preset' ? (
              <View style={styles.presetList}>
                {proxyPresets.length === 0 ? (
                  <View style={styles.presetEmptyBox}>
                    <Text style={styles.presetEmptyTxt}>
                      Chưa có máy chủ sẵn có nào. Nhấn làm mới hoặc chọn Proxy tự cấu hình.
                    </Text>
                  </View>
                ) : (
                  proxyPresets.map((preset) => {
                    const selected = proxyCfg.presetId === preset.id;
                    const probe = presetProbeMap[preset.id];
                    return (
                      <TouchableOpacity
                        key={preset.id}
                        activeOpacity={0.85}
                        style={[styles.presetCard, selected && styles.presetCardActive]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setProxyStatusMsg(null);
                          void applyProxyOverride({
                            mode: 'preset',
                            presetId: preset.id,
                            presetName: preset.name,
                          });
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={styles.presetName} numberOfLines={1}>
                            {preset.name}
                          </Text>
                          <Text style={styles.presetRegion} numberOfLines={1}>
                            {preset.region}
                          </Text>
                        </View>
                        <View style={styles.presetRightWrap}>
                          {probe ? (
                            <View
                              style={[
                                styles.presetLatencyPill,
                                probe.status === 'testing'
                                  ? styles.presetLatencyTesting
                                  : probe.status === 'ok'
                                  ? styles.presetLatencyOk
                                  : probe.status === 'timeout'
                                  ? styles.presetLatencyTimeout
                                  : styles.presetLatencyErr,
                              ]}
                            >
                              {probe.status === 'testing' ? (
                                <>
                                  <ActivityIndicator
                                    size="small"
                                    color="#93C5FD"
                                    style={styles.presetLatencySpinner}
                                  />
                                  <Text style={[styles.presetLatencyTxt, { color: '#BFDBFE' }]}>
                                    Đang đo
                                  </Text>
                                </>
                              ) : probe.status === 'ok' ? (
                                <>
                                  <View
                                    style={[
                                      styles.presetLatencyDot,
                                      { backgroundColor: '#30D158' },
                                    ]}
                                  />
                                  <Text style={[styles.presetLatencyTxt, { color: '#4ADE80' }]}>
                                    {probe.latencyMs} ms
                                  </Text>
                                </>
                              ) : probe.status === 'timeout' ? (
                                <>
                                  <View
                                    style={[
                                      styles.presetLatencyDot,
                                      { backgroundColor: '#F59E0B' },
                                    ]}
                                  />
                                  <Text style={[styles.presetLatencyTxt, { color: '#FDE68A' }]}>
                                    Quá 3s
                                  </Text>
                                </>
                              ) : (
                                <>
                                  <View
                                    style={[
                                      styles.presetLatencyDot,
                                      { backgroundColor: '#EF4444' },
                                    ]}
                                  />
                                  <Text style={[styles.presetLatencyTxt, { color: '#FCA5A5' }]}>
                                    Lỗi
                                  </Text>
                                </>
                              )}
                            </View>
                          ) : null}
                          <Ionicons
                            name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                            size={20}
                            color={selected ? COLORS.accent : COLORS.muted}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            ) : (
              <View style={styles.customProxyForm}>
                <View style={styles.customRowPair}>
                  <View style={{ flex: 2 }}>
                    <Text style={styles.inputLabel}>Địa chỉ IP / Host</Text>
                    <TextInput
                      style={styles.proxyInput}
                      value={proxyCfg.customHost}
                      onChangeText={(txt) =>
                        setProxyConfig({ customHost: txt.trim(), enabled: false })
                      }
                      placeholder="Ví dụ: 203.0.113.10"
                      placeholderTextColor="rgba(255,255,255,0.36)"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Cổng (Port)</Text>
                    <TextInput
                      style={styles.proxyInput}
                      value={proxyCfg.customPort}
                      onChangeText={(txt) =>
                        setProxyConfig({
                          customPort: txt.replace(/[^0-9]/g, ''),
                          enabled: false,
                        })
                      }
                      placeholder="8080"
                      placeholderTextColor="rgba(255,255,255,0.36)"
                      keyboardType="number-pad"
                      maxLength={5}
                    />
                  </View>
                </View>

                <View style={styles.customRowPair}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Tài khoản (TK)</Text>
                    <TextInput
                      style={styles.proxyInput}
                      value={proxyCfg.customUsername}
                      onChangeText={(txt) =>
                        setProxyConfig({ customUsername: txt, enabled: false })
                      }
                      placeholder="Không bắt buộc"
                      placeholderTextColor="rgba(255,255,255,0.36)"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>Mật khẩu (MK)</Text>
                    <View style={styles.passwordInputWrap}>
                      <TextInput
                        style={styles.passwordInputField}
                        value={proxyCfg.customPassword}
                        onChangeText={(txt) =>
                          setProxyConfig({ customPassword: txt, enabled: false })
                        }
                        placeholder="Không bắt buộc"
                        placeholderTextColor="rgba(255,255,255,0.36)"
                        secureTextEntry={!showProxyPass}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        onPress={() => setShowProxyPass((v) => !v)}
                        hitSlop={8}
                        style={{ paddingLeft: 6 }}
                      >
                        <Ionicons
                          name={showProxyPass ? 'eye-outline' : 'eye-off-outline'}
                          size={17}
                          color={COLORS.muted}
                        />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.proxyFooterRow}>
              <TouchableOpacity
                style={styles.testProxyBtn}
                onPress={handleTestProxyConnection}
                disabled={testingProxy}
              >
                {testingProxy ? (
                  <>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.testProxyBtnTxt}>Đang kiểm tra...</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="pulse-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.testProxyBtnTxt}>Kiểm tra kết nối</Text>
                  </>
                )}
              </TouchableOpacity>

              {proxyStatusMsg ? (
                <View
                  style={[
                    styles.proxyStatusPill,
                    proxyStatusMsg.ok ? styles.proxyStatusOk : styles.proxyStatusErr,
                  ]}
                >
                  <Ionicons
                    name={proxyStatusMsg.ok ? 'checkmark-circle' : 'alert-circle'}
                    size={14}
                    color={proxyStatusMsg.ok ? '#30D158' : '#FCA5A5'}
                  />
                  <Text
                    style={[
                      styles.proxyStatusTxt,
                      { color: proxyStatusMsg.ok ? '#D8FFE2' : '#FECACA' },
                    ]}
                    numberOfLines={2}
                  >
                    {proxyStatusMsg.text}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Section 4: App & Updates */}
        <Text style={styles.sectionHeader}>ỨNG DỤNG &amp; CẬP NHẬT</Text>
        <View style={styles.insetGroup}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.insetGroupFill} />

          <View style={styles.navRow}>
            <View style={[styles.iosBadge, { backgroundColor: '#5856D6' }]}>
              <Ionicons name="cloud-download" size={15} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.settingLabel}>Phiên bản &amp; Cập nhật</Text>
              <Text style={styles.settingDesc}>
                Phiên bản v{APP_VERSION} • Phát hành {APP_RELEASE_DATE}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.updateCheckBtn}
              onPress={handleCheckUpdate}
              disabled={checkingUpdate}
            >
              {checkingUpdate ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.updateCheckTxt}>Kiểm tra</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.insetDivider} />
          <TouchableOpacity
            activeOpacity={0.78}
            style={styles.navRow}
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
            <View style={[styles.iosBadge, { backgroundColor: '#FF2D55' }]}>
              <Ionicons name="sparkles" size={15} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Có gì mới</Text>
              <Text style={styles.settingDesc}>Chi tiết tính năng trong các bản phát hành</Text>
            </View>
            <Ionicons
              name={changelogOpen ? 'chevron-up' : 'chevron-down'}
              size={17}
              color="rgba(255,255,255,0.42)"
            />
          </TouchableOpacity>

          {changelogOpen ? (
            <View style={styles.changelogWrap}>
              {(manifest?.history || [
                {
                  versionCode: APP_VERSION_CODE,
                  versionName: APP_VERSION,
                  date: APP_RELEASE_DATE,
                  title: 'Nâng cấp giao diện & trải nghiệm xem phim mượt mà',
                  changes: [
                    'Thiết kế lại toàn bộ giao diện Cài đặt và điều khiển trình phát theo chuẩn iPhone hiện đại',
                    'Bổ sung thanh kéo thước đo trực quan, nạp lại phụ đề tức thì và xem ngoại tuyến thông minh',
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
        </View>

        {/* Sign Out Action Card */}
        <TouchableOpacity activeOpacity={0.82} style={styles.logoutCard} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={19} color="#FF6B6B" />
          <Text style={styles.logoutTxt}>Đăng xuất tài khoản</Text>
        </TouchableOpacity>
      </ScrollView>

      <AppUpdateModal
        visible={directUpdateOpen}
        manifest={manifest}
        onDismiss={() => setDirectUpdateOpen(false)}
      />
    </Animated.View>
  );
}

function IosSwitchRow({
  icon,
  badgeColor,
  label,
  desc,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  badgeColor: string;
  label: string;
  desc: string;
  value: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={[styles.iosBadge, { backgroundColor: badgeColor }]}>
        <Ionicons name={icon} size={15} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingDesc}>{desc}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.selectionAsync();
          onChange(v);
        }}
        trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
        thumbColor="#FFFFFF"
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  navBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  navRightSpacer: {
    width: 36,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  profileCard: {
    padding: 16,
    marginBottom: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    padding: 2,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: 28,
    backgroundColor: COLORS.cardPlaceholder,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  verifiedBadge: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userEmail: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12.5,
    marginTop: 2,
  },
  tierPill: {
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
  sectionHeader: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginLeft: 12,
    marginBottom: 7,
    marginTop: 4,
  },
  insetGroup: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 0.75,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 18,
    position: 'relative',
  },
  insetGroupFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(18, 22, 34, 0.78)',
  },
  insetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginLeft: 56,
  },
  iosBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
  },
  switchRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  groupedColumnRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  rowHeaderTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  storageTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingLabel: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '600',
  },
  settingDesc: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
    marginTop: 1.5,
  },
  rightValuePill: {
    color: '#93C5FD',
    fontSize: 12.5,
    fontWeight: '700',
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 99,
    overflow: 'hidden',
  },
  cleanPillBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255, 69, 58, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.35)',
  },
  cleanPillTxt: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '700',
  },
  storageTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginLeft: 42,
  },
  storageFill: {
    height: '100%',
    borderRadius: 3,
  },
  segmentedControlRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 3,
    gap: 4,
    marginLeft: 42,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionActive: {
    backgroundColor: COLORS.accent,
  },
  segmentOptionTxt: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  segmentOptionTxtActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  horizontalChipsScroll: {
    gap: 7,
    paddingLeft: 42,
    paddingRight: 4,
  },
  chipPill: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  chipPillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  chipPillTxt: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  chipPillTxtActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  offlineStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  offlineStepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineStepVal: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
  proxyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  proxyNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(253, 230, 138, 0.3)',
  },
  proxyNoticeTxt: {
    flex: 1,
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  proxyModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 42,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 12,
    padding: 3,
  },
  reloadProxyIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetList: {
    marginLeft: 42,
    gap: 8,
  },
  presetEmptyBox: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  presetEmptyTxt: {
    color: COLORS.muted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  presetCardActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.14)',
    borderColor: 'rgba(229, 9, 20, 0.65)',
  },
  presetName: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  presetRegion: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: 2,
  },
  presetRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  presetLatencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  presetLatencyTesting: {
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderColor: 'rgba(147, 197, 253, 0.28)',
  },
  presetLatencyOk: {
    backgroundColor: 'rgba(48, 209, 88, 0.14)',
    borderColor: 'rgba(48, 209, 88, 0.35)',
  },
  presetLatencyTimeout: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderColor: 'rgba(253, 230, 138, 0.32)',
  },
  presetLatencyErr: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  presetLatencyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  presetLatencySpinner: {
    transform: [{ scale: 0.7 }],
    marginVertical: -2,
    marginHorizontal: -2,
  },
  presetLatencyTxt: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  customProxyForm: {
    marginLeft: 42,
    gap: 10,
  },
  customRowPair: {
    flexDirection: 'row',
    gap: 10,
  },
  inputLabel: {
    color: COLORS.textSecondary,
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 4,
  },
  proxyInput: {
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 11,
    color: '#FFFFFF',
    fontSize: 13,
  },
  passwordInputWrap: {
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInputField: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    paddingVertical: 0,
  },
  proxyFooterRow: {
    marginLeft: 42,
    gap: 8,
  },
  testProxyBtn: {
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.11)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  testProxyBtnTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  proxyStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: 1,
  },
  proxyStatusOk: {
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    borderColor: 'rgba(48, 209, 88, 0.35)',
  },
  proxyStatusErr: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  proxyStatusTxt: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  updateCheckBtn: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 99,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  updateCheckTxt: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  changelogWrap: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 8,
  },
  historyBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  historyTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 5,
  },
  historyLine: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    lineHeight: 17.5,
  },
  logoutCard: {
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.28)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  logoutTxt: {
    color: '#FF8A80',
    fontSize: 15,
    fontWeight: '700',
  },
});
