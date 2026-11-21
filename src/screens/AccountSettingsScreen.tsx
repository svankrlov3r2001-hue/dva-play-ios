import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { AppUpdateModal } from '../components/AppUpdateModal';
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
      Alert.alert(
        'Cần cập nhật ứng dụng (v1.0.17)',
        'Tính năng kết nối Proxy trực tiếp trên iPhone yêu cầu cài đặt bản ứng dụng iOS mới nhất (v1.0.17).'
      );
      return;
    }

    if (
      proxyCfg.mode === 'custom' &&
      !normalizeCustomProxyInput(proxyCfg.customHost, proxyCfg.customPort)
    ) {
      Alert.alert(
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
        text: 'Cần cài đặt bản ứng dụng iOS mới nhất (v1.0.17+) để kiểm tra Proxy trực tiếp trên iPhone.',
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
        Alert.alert(
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
        Alert.alert(
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
      } else if (!res.otaSupported) {
        Alert.alert(
          'Đã là phiên bản mới nhất',
          `Phiên bản hiện tại: v${APP_VERSION} • Phát hành ${APP_RELEASE_DATE}`
        );
      } else {
        Alert.alert(
          'Đã là phiên bản mới nhất',
          `Phiên bản hiện tại: v${APP_VERSION} • Phát hành ${APP_RELEASE_DATE}`
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
    Alert.alert('Xóa toàn bộ phim ngoại tuyến?', 'Tất cả phim đã tải để xem ngoại tuyến trên iPhone sẽ bị xóa.', [
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
        keyboardShouldPersistTaps="handled"
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
          label="Thu nhỏ khung hình phim"
          desc="Tiếp tục xem phim trong khung hình nổi khi thoát ra màn hình chính"
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

      {/* Proxy Connection Card */}
      <GlassSurface intensity={45} radius={RADII.xl} style={styles.card}>
        <View style={styles.proxyHeaderRow}>
          <View style={styles.rowLeft}>
            <Ionicons name="globe-outline" size={20} color="#FFF" />
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Kết nối Proxy</Text>
              <Text style={styles.settingDesc}>
                Tự động tắt mỗi khi thoát ứng dụng
              </Text>
            </View>
          </View>
          <Switch
            value={proxyCfg.enabled}
            onValueChange={handleToggleProxy}
            disabled={applyingProxy}
            trackColor={{ false: 'rgba(255,255,255,0.16)', true: COLORS.accent }}
            thumbColor="#FFF"
          />
        </View>

        {!nativeProxyReady ? (
          <View style={styles.proxyNoticeBanner}>
            <Ionicons name="information-circle-outline" size={16} color="#FDE68A" />
            <Text style={styles.proxyNoticeTxt}>
              Cần cài đặt bản ứng dụng iOS mới nhất (v1.0.17) để bật kết nối Proxy trực tiếp trên
              iPhone.
            </Text>
          </View>
        ) : null}

        <View style={styles.proxyModeRow}>
          <TouchableOpacity
            style={[
              styles.qualityChip,
              proxyCfg.mode === 'preset' && styles.qualityChipActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setProxyStatusMsg(null);
              applyProxyOverride({ mode: 'preset' });
            }}
          >
            <Text
              style={[
                styles.qualityTxt,
                proxyCfg.mode === 'preset' && { color: '#FFF' },
              ]}
            >
              Máy chủ sẵn có
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.qualityChip,
              proxyCfg.mode === 'custom' && styles.qualityChipActive,
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
                styles.qualityTxt,
                proxyCfg.mode === 'custom' && { color: '#FFF' },
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
            accessibilityLabel="Làm mới danh sách máy chủ Proxy"
          >
            {reloadingPresets ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="refresh" size={17} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>

        {proxyCfg.mode === 'preset' ? (
          <View style={styles.presetList}>
            {proxyPresets.length === 0 ? (
              <View style={styles.presetEmptyBox}>
                <Text style={styles.presetEmptyTxt}>
                  Chưa có máy chủ sẵn có nào. Nhấn biểu tượng làm mới hoặc chọn Proxy tự cấu hình.
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
                      applyProxyOverride({
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
                                style={[styles.presetLatencyDot, { backgroundColor: '#30D158' }]}
                              />
                              <Text style={[styles.presetLatencyTxt, { color: '#4ADE80' }]}>
                                {probe.latencyMs} ms
                              </Text>
                            </>
                          ) : probe.status === 'timeout' ? (
                            <>
                              <View
                                style={[styles.presetLatencyDot, { backgroundColor: '#F59E0B' }]}
                              />
                              <Text style={[styles.presetLatencyTxt, { color: '#FDE68A' }]}>
                                Quá 3s
                              </Text>
                            </>
                          ) : (
                            <>
                              <View
                                style={[styles.presetLatencyDot, { backgroundColor: '#EF4444' }]}
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
                        size={21}
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
                <ActivityIndicator size="small" color="#FFF" />
                <Text style={styles.testProxyBtnTxt}>Đang kiểm tra...</Text>
              </>
            ) : (
              <>
                <Ionicons name="pulse-outline" size={16} color="#FFF" />
                <Text style={styles.testProxyBtnTxt}>Kiểm tra kết nối</Text>
              </>
            )}
          </TouchableOpacity>

          {proxyStatusMsg ? (
            <View
              style={[
                styles.proxyStatusPill,
                proxyStatusMsg.ok
                  ? styles.proxyStatusOk
                  : styles.proxyStatusErr,
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
      </GlassSurface>

      {/* Offline & TV Cast Card */}
      <GlassSurface intensity={45} radius={RADII.xl} style={styles.card}>
        <Text style={styles.cardHeading}>Lưu trữ &amp; Kết nối TV</Text>

        <TouchableOpacity style={styles.actionRow} onPress={onOpenCast}>
          <View style={styles.rowLeft}>
            <Ionicons name="tv-outline" size={20} color="#FFF" />
            <View>
              <Text style={styles.settingLabel}>DVA Cast (Quét QR chiếu lên TV)</Text>
              <Text style={styles.settingDesc}>Kết nối và điều khiển phát phim trên màn hình lớn TV</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </TouchableOpacity>

        <View style={styles.divider} />

        <View style={styles.actionRow}>
          <View style={styles.rowLeft}>
            <Ionicons name="folder-outline" size={20} color="#FFF" />
            <View>
              <Text style={styles.settingLabel}>Bộ nhớ phim ngoại tuyến</Text>
              <Text style={styles.settingDesc}>
                {offlineItems.length} phim • {formatBytes(totalBytes)} đã dùng
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

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Tự động tải tập đang xem</Text>
            <Text style={styles.settingDesc}>Lưu tập đang phát để xem lại không cần mạng</Text>
          </View>
          <Switch
            value={settings.autoDownloadCurrentOnWatch}
            onValueChange={(v) => {
              Haptics.selectionAsync();
              updateSetting('autoDownloadCurrentOnWatch', v);
            }}
            trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
            thumbColor="#FFF"
          />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Tải thêm tập tiếp theo</Text>
            <Text style={styles.settingDesc}>
              {settings.autoDownloadNextCount > 0
                ? `Tự động tải trước ${settings.autoDownloadNextCount} tập tiếp theo khi xem`
                : 'Đang tắt tự động tải tập tiếp theo'}
            </Text>
          </View>
          <View style={styles.offlineStepperRow}>
            <TouchableOpacity
              style={styles.offlineStepBtn}
              onPress={() => {
                Haptics.selectionAsync();
                updateSetting(
                  'autoDownloadNextCount',
                  Math.max(0, (settings.autoDownloadNextCount || 0) - 1)
                );
              }}
            >
              <Ionicons name="remove" size={16} color="#FFF" />
            </TouchableOpacity>
            <Text style={styles.offlineStepVal}>{settings.autoDownloadNextCount || 0}</Text>
            <TouchableOpacity
              style={styles.offlineStepBtn}
              onPress={() => {
                Haptics.selectionAsync();
                updateSetting(
                  'autoDownloadNextCount',
                  Math.min(20, (settings.autoDownloadNextCount || 0) + 1)
                );
              }}
            >
              <Ionicons name="add" size={16} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>Ưu tiên phát từ máy khi có mạng</Text>
            <Text style={styles.settingDesc}>Tự dùng tệp ngoại tuyến đã tải để mở tức thì</Text>
          </View>
          <Switch
            value={settings.preferOfflineWhenOnline}
            onValueChange={(v) => {
              Haptics.selectionAsync();
              updateSetting('preferOfflineWhenOnline', v);
            }}
            trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
            thumbColor="#FFF"
          />
        </View>
      </GlassSurface>

      {/* Updates & Changelog Card */}
      <GlassSurface intensity={45} radius={RADII.xl} style={styles.card}>
        <View style={styles.actionRow}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.settingLabel}>Cập nhật ứng dụng</Text>
            <Text style={styles.settingDesc}>
              Phiên bản v{APP_VERSION} • Phát hành {APP_RELEASE_DATE}
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
              <Text style={styles.subtleBtnTxt}>Kiểm tra</Text>
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
                  'Giao diện điện ảnh tối ưu thao tác một tay trên màn hình iPhone',
                  'Hỗ trợ xem ngoại tuyến, thu nhỏ khung hình phim, khóa Face ID và chiếu phim lên TV qua mã QR',
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
      <AppUpdateModal
        visible={directUpdateOpen}
        manifest={manifest}
        onDismiss={() => setDirectUpdateOpen(false)}
      />
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
  proxyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  proxyNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
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
    gap: 8,
    marginTop: 14,
  },
  reloadProxyIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetList: {
    marginTop: 12,
    gap: 8,
  },
  presetEmptyBox: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  presetEmptyTxt: {
    color: COLORS.muted,
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  presetCardActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.14)',
    borderColor: 'rgba(229, 9, 20, 0.65)',
  },
  presetName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  presetRegion: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 3,
  },
  presetRightWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  presetLatencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
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
    fontSize: 11.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  customProxyForm: {
    marginTop: 12,
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
    marginBottom: 5,
  },
  proxyInput: {
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    color: '#FFF',
    fontSize: 13,
  },
  passwordInputWrap: {
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInputField: {
    flex: 1,
    color: '#FFF',
    fontSize: 13,
    paddingVertical: 0,
  },
  proxyFooterRow: {
    marginTop: 12,
    gap: 10,
  },
  testProxyBtn: {
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  testProxyBtnTxt: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  proxyStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
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
  offlineStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  offlineStepBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineStepVal: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
});
