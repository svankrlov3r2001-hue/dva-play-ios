import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppAlertInlineHost, showAppAlert } from './AppAlertModal';
import { BouncyButton } from './BouncyButton';
import { GlassSurface, WaterDropPopupView } from './GlassSurface';
import { COLORS } from '../constants/config';
import { fetchProxyPresetsApi, resolveProxyPresetApi } from '../services/api';
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

type PresetProbeStatus = 'testing' | 'ok' | 'timeout' | 'error';

interface PresetProbeState {
  status: PresetProbeStatus;
  latencyMs?: number;
  error?: string;
}

interface PlayerProxyModalProps {
  visible: boolean;
  onClose: () => void;
  onProxyApplied?: (cfg: ProxyRuntimeConfig) => void;
}

/**
 * Quick borderless Liquid Glass Proxy connection popup inside Player.
 */
export function PlayerProxyModal({
  visible,
  onClose,
  onProxyApplied,
}: PlayerProxyModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;

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
    setProxyStatusMsg(null);
    void handleReloadPresets(false);
  }, [visible, handleReloadPresets]);

  const applyProxyOverride = async (override: Partial<ProxyRuntimeConfig>) => {
    if (applyingProxy) return;
    if (proxyCfg.enabled && nativeProxyReady) {
      setApplyingProxy(true);
      try {
        const updated = await enableProxyAsync(resolveProxyPresetApi, override);
        onProxyApplied?.(updated);
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
        const updated = await disableProxyAsync();
        setProxyStatusMsg({
          ok: true,
          text: 'Đã ngắt kết nối Proxy.',
        });
        onProxyApplied?.(updated);
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
      const updated = await enableProxyAsync(resolveProxyPresetApi);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const label =
        updated.mode === 'preset'
          ? updated.presetName || 'Máy chủ sẵn có'
          : `${updated.customHost}:${updated.customPort}`;
      setProxyStatusMsg({
        ok: true,
        text: `Đã kết nối Proxy (${label}).`,
      });
      onProxyApplied?.(updated);
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
          const webSuffix = res.web_latency_ms ? ` • Web: ${res.web_latency_ms} ms` : '';
          const suffix = !res.managed && res.exit_ip ? ` • IP: ${res.exit_ip}` : '';
          setProxyStatusMsg({
            ok: true,
            text: `Đã kết nối ${res.label} • ${res.latency_ms} ms${webSuffix}${suffix}`,
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
    let fastest: { name: string; latencyMs: number; webLatencyMs: number | null } | null = null;
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
            fastest = {
              name: preset.name,
              latencyMs: res.latency_ms,
              webLatencyMs: res.web_latency_ms ?? null,
            };
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
        const fastestWeb = fastest.webLatencyMs ? ` • Web: ${fastest.webLatencyMs} ms` : '';
        setProxyStatusMsg({
          ok: true,
          text: `Đã kiểm tra ${listToProbe.length} máy chủ (${okCount} hoạt động) • Nhanh nhất: ${fastest.name} (${fastest.latencyMs} ms${fastestWeb})`,
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

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(580, winWidth - Math.max(40, insets.left + insets.right + 20))
    : Math.min(440, winWidth - 24);
  const cardHeight = isLandscape
    ? Math.min(358, winHeight - 14)
    : Math.min(winHeight * 0.84, 600);

  const activeLabel =
    proxyCfg.mode === 'preset'
      ? proxyCfg.presetName || 'Máy chủ sẵn có'
      : proxyCfg.customHost && proxyCfg.customPort
        ? `${proxyCfg.customHost}:${proxyCfg.customPort}`
        : 'Proxy tự cấu hình';

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

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
          pointerEvents="box-none"
        >
          <WaterDropPopupView visible={visible} from="center">
            <GlassSurface
              variant="liquid"
              radius={40}
              intensity={24}
              style={[styles.sheetCard, { width: cardWidth, maxHeight: cardHeight }]}
            >
              <View style={styles.inner}>
                {/* Header */}
                <View style={styles.headerRow}>
                  <View style={styles.titleCluster}>
                    <View
                      style={[
                        styles.headerIconDot,
                        proxyCfg.enabled && styles.headerIconDotActive,
                      ]}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={17}
                        color={proxyCfg.enabled ? '#4ADE80' : '#60A5FA'}
                      />
                    </View>
                    <View style={{ flexShrink: 1 }}>
                      <Text style={styles.headerTitle} numberOfLines={1}>
                        Kết nối Proxy
                      </Text>
                      <Text
                        style={[
                          styles.headerSubtitle,
                          proxyCfg.enabled && { color: '#4ADE80' },
                        ]}
                        numberOfLines={1}
                      >
                        {proxyCfg.enabled
                          ? `Đang bật • ${activeLabel}`
                          : 'Đang tắt • Tự tắt khi thoát ứng dụng'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.headerRight}>
                    <Switch
                      value={proxyCfg.enabled}
                      onValueChange={handleToggleProxy}
                      disabled={applyingProxy}
                      trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                      thumbColor="#FFFFFF"
                    />
                    <BouncyButton
                      activeOpacity={0.78}
                      style={styles.circleBtn}
                      onPress={() => handleReloadPresets(true)}
                      disabled={reloadingPresets || applyingProxy}
                    >
                      {reloadingPresets ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Ionicons name="refresh" size={15} color="#FFFFFF" />
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

                <ScrollView
                  style={styles.scrollBleed}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.scrollContent}
                >
                  {!nativeProxyReady ? (
                    <View style={styles.proxyNoticeBanner}>
                      <Ionicons name="information-circle-outline" size={16} color="#FDE68A" />
                      <Text style={styles.proxyNoticeTxt}>
                        Cần cài đặt bản ứng dụng iOS mới nhất để bật kết nối Proxy trực tiếp trên iPhone.
                      </Text>
                    </View>
                  ) : null}

                  {/* Mode Switcher */}
                  <View style={styles.proxyModeRow}>
                    <BouncyButton
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
                    </BouncyButton>
                    <BouncyButton
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
                            const updated = await disableProxyAsync().catch(() => null);
                            if (updated) onProxyApplied?.(updated);
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
                    </BouncyButton>
                  </View>

                  {/* Preset or Custom Form */}
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
                            <BouncyButton
                              key={preset.id}
                              bounciness="gentle"
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
                            </BouncyButton>
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
                            <BouncyButton
                              onPress={() => setShowProxyPass((v) => !v)}
                              hitSlop={8}
                              style={{ paddingLeft: 6 }}
                            >
                              <Ionicons
                                name={showProxyPass ? 'eye-outline' : 'eye-off-outline'}
                                size={17}
                                color={COLORS.muted}
                              />
                            </BouncyButton>
                          </View>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Quick Actions Row */}
                  <View style={styles.actionRow}>
                    <BouncyButton
                      bounciness="gentle"
                      style={[styles.actionBtn, styles.testProxyBtn]}
                      onPress={handleTestProxyConnection}
                      disabled={testingProxy}
                    >
                      {testingProxy ? (
                        <>
                          <ActivityIndicator size="small" color="#FFFFFF" />
                          <Text style={styles.actionBtnTxt}>Đang kiểm tra...</Text>
                        </>
                      ) : (
                        <>
                          <Ionicons name="pulse-outline" size={16} color="#FFFFFF" />
                          <Text style={styles.actionBtnTxt}>Kiểm tra kết nối</Text>
                        </>
                      )}
                    </BouncyButton>

                    <BouncyButton
                      bounciness="gentle"
                      style={[
                        styles.actionBtn,
                        proxyCfg.enabled ? styles.disconnectBtn : styles.connectNowBtn,
                      ]}
                      onPress={() => void handleToggleProxy(!proxyCfg.enabled)}
                      disabled={applyingProxy}
                    >
                      {applyingProxy ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Ionicons
                            name={proxyCfg.enabled ? 'power-outline' : 'flash-outline'}
                            size={16}
                            color={proxyCfg.enabled ? '#FCA5A5' : '#FFFFFF'}
                          />
                          <Text
                            style={[
                              styles.actionBtnTxt,
                              proxyCfg.enabled && { color: '#FCA5A5' },
                            ]}
                          >
                            {proxyCfg.enabled ? 'Ngắt kết nối' : 'Kết nối ngay'}
                          </Text>
                        </>
                      )}
                    </BouncyButton>
                  </View>

                  {proxyStatusMsg ? (
                    <View
                      style={[
                        styles.proxyStatusPill,
                        proxyStatusMsg.ok ? styles.proxyStatusOk : styles.proxyStatusErr,
                      ]}
                    >
                      <Ionicons
                        name={proxyStatusMsg.ok ? 'checkmark-circle' : 'alert-circle'}
                        size={15}
                        color={proxyStatusMsg.ok ? '#30D158' : '#FCA5A5'}
                      />
                      <Text
                        style={[
                          styles.proxyStatusTxt,
                          { color: proxyStatusMsg.ok ? '#D8FFE2' : '#FECACA' },
                        ]}
                      >
                        {proxyStatusMsg.text}
                      </Text>
                    </View>
                  ) : null}
                </ScrollView>
              </View>
            </GlassSurface>
          </WaterDropPopupView>
        </KeyboardAvoidingView>

        <AppAlertInlineHost active={visible} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.36)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  keyboardWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCard: {
    borderRadius: 40,
    elevation: 18,
  },
  inner: {
    paddingTop: 18,
    paddingBottom: 18,
    paddingHorizontal: 22,
    maxHeight: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  titleCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  headerIconDot: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: 'rgba(10, 132, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconDotActive: {
    backgroundColor: 'rgba(48, 209, 88, 0.2)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 15.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  circleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBleed: {
    marginHorizontal: -16,
    marginTop: -4,
  },
  scrollContent: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
  },
  proxyNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    padding: 4,
  },
  segmentOption: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionActive: {
    backgroundColor: COLORS.accent,
  },
  segmentOptionTxt: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12.5,
    fontWeight: '600',
  },
  segmentOptionTxtActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  presetList: {
    gap: 8,
  },
  presetEmptyBox: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  presetCardActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.24)',
  },
  presetName: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  presetRegion: {
    color: 'rgba(255, 255, 255, 0.6)',
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
  },
  presetLatencyTesting: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
  },
  presetLatencyOk: {
    backgroundColor: 'rgba(48, 209, 88, 0.18)',
  },
  presetLatencyTimeout: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  presetLatencyErr: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
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
    gap: 9,
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
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    color: '#FFFFFF',
    fontSize: 13,
  },
  passwordInputWrap: {
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInputField: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    paddingVertical: 0,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  testProxyBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  connectNowBtn: {
    backgroundColor: COLORS.accent,
  },
  disconnectBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
  },
  actionBtnTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  proxyStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
  },
  proxyStatusOk: {
    backgroundColor: 'rgba(48, 209, 88, 0.16)',
  },
  proxyStatusErr: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
  },
  proxyStatusTxt: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16.5,
  },
});
