import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { showAppAlert } from '../components/AppAlertModal';
import { BouncyButton } from '../components/BouncyButton';
import { GlassSurface } from '../components/GlassSurface';
import { COLORS } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import {
  approveQuickLoginQrApi,
  claimQuickLoginQrApi,
  fetchQrPendingDevicesApi,
  QrPendingDevice,
} from '../services/api';

interface QuickLoginQrModalProps {
  visible: boolean;
  onClose: () => void;
}

export function extractQuickLoginKey(raw: string): string | null {
  if (!raw) return null;
  const payload = String(raw).trim();
  const matchParam = payload.match(
    /[?&](?:backQR|backQR_share_1|backQR_share_2|key|qr_login_key|code)=([0-9a-zA-Z_-]+)/i
  );
  if (matchParam && matchParam[1]) {
    return matchParam[1].replace(/\s+/g, '');
  }
  try {
    const obj = JSON.parse(payload);
    if (obj && (obj.key || obj.backQR || obj.qr_login_key)) {
      return String(obj.key || obj.backQR || obj.qr_login_key).replace(/\s+/g, '');
    }
  } catch {}
  const cleaned = payload.replace(/\s+/g, '');
  if (/^\d{6,12}$/.test(cleaned)) {
    return cleaned;
  }
  const spacedNine = payload.match(/\b(\d{3}\s+\d{3}\s+\d{3})\b/);
  if (spacedNine && spacedNine[1]) {
    return spacedNine[1].replace(/\s+/g, '');
  }
  const matchNineDigits = payload.match(/\b(\d{9})\b/);
  if (matchNineDigits && matchNineDigits[1]) {
    return matchNineDigits[1];
  }
  return null;
}

function formatDeviceKey(rawKey: string): string {
  return String(rawKey || '')
    .replace(/\s+/g, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function deviceIconName(device: string): keyof typeof Ionicons.glyphMap {
  const d = String(device || '').toLowerCase();
  if (d.includes('windows')) return 'logo-windows';
  if (d.includes('iphone') || d.includes('ipad') || d.includes('ipod') || d.includes('mac')) {
    return 'logo-apple';
  }
  if (d.includes('android')) return 'logo-android';
  return 'laptop-outline';
}

export function QuickLoginQrModal({ visible, onClose }: QuickLoginQrModalProps) {
  const insets = useSafeAreaInsets();
  const { user, verifyBiometricsForAction } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();

  const [step, setStep] = useState<'scan' | 'confirm'>('scan');
  const [scanned, setScanned] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [approving, setApproving] = useState(false);

  const [activeKey, setActiveKey] = useState('');
  const [formattedKey, setFormattedKey] = useState('');
  const [targetDevice, setTargetDevice] = useState('');
  const [pendingDevices, setPendingDevices] = useState<QrPendingDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const [bioLabel, setBioLabel] = useState('Face ID');
  const [showPasswordBox, setShowPasswordBox] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassText, setShowPassText] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  const enterAnim = useRef(new Animated.Value(0)).current;
  const autoBioTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLockRef = useRef(false);
  const claimingRef = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const resetModalState = useCallback(() => {
    if (autoBioTimerRef.current) {
      clearTimeout(autoBioTimerRef.current);
      autoBioTimerRef.current = null;
    }
    scanLockRef.current = false;
    claimingRef.current = false;
    setStep('scan');
    setScanned(false);
    setManualKey('');
    setClaiming(false);
    setApproving(false);
    setActiveKey('');
    setFormattedKey('');
    setTargetDevice('');
    setShowPasswordBox(false);
    setPasswordInput('');
    setShowPassText(false);
    setStatusFeedback(null);
  }, []);

  useEffect(() => {
    if (visible) {
      enterAnim.setValue(0);
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      LocalAuthentication.supportedAuthenticationTypesAsync()
        .then((types) => {
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            setBioLabel('Face ID');
          } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            setBioLabel('Touch ID');
          } else {
            setBioLabel('Sinh trắc học');
          }
        })
        .catch(() => {});
    } else {
      enterAnim.stopAnimation();
      enterAnim.setValue(0);
      resetModalState();
    }
  }, [visible, enterAnim, resetModalState]);

  useEffect(() => {
    if (visible && step === 'scan' && permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(() => {});
    }
  }, [visible, step, permission, requestPermission]);

  useEffect(() => {
    if (!visible || step !== 'scan') return;
    let active = true;
    setLoadingDevices(true);

    const loadPending = async () => {
      try {
        const res = await fetchQrPendingDevicesApi();
        if (active && res?.success) {
          setPendingDevices(res.devices || []);
        }
      } catch {} finally {
        if (active) setLoadingDevices(false);
      }
    };

    loadPending();
    const iv = setInterval(loadPending, 2500);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [visible, step]);

  const handleBiometricApprove = useCallback(
    async (keyOverride?: string, devOverride?: string) => {
      const targetKey = keyOverride || activeKey;
      if (!targetKey || approving) return;

      setApproving(true);
      setStatusFeedback(null);
      try {
        const bioRes = await verifyBiometricsForAction(
          `Xác nhận đăng nhập nhanh cho ${devOverride || targetDevice || 'thiết bị khác'}`
        );
        if (bioRes.biometricLabel) setBioLabel(bioRes.biometricLabel);
        if (!visibleRef.current) return;

        if (!bioRes.ok) {
          setStatusFeedback({
            ok: false,
            text:
              bioRes.reason ||
              `Chưa xác thực ${bioRes.biometricLabel}. Bạn có thể thử lại hoặc dùng mật khẩu bên dưới.`,
          });
          setApproving(false);
          return;
        }

        const res = await approveQuickLoginQrApi(targetKey, 'biometric');
        if (!visibleRef.current) return;

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAppAlert(
          'Thành công',
          `Đã kích hoạt đăng nhập nhanh cho thiết bị ${res.formatted_key || formatDeviceKey(targetKey)} thành công!`
        );
        onClose();
      } catch (err: any) {
        if (!visibleRef.current) return;
        const msg = err?.message || 'Không thể hoàn tất kích hoạt đăng nhập nhanh.';
        setStatusFeedback({ ok: false, text: msg });
        if (err?.code === 'expired' || err?.status === 410) {
          showAppAlert('Mã đã hết hạn', msg, [
            { text: 'Quét lại', onPress: () => resetModalState() },
          ]);
        }
      } finally {
        setApproving(false);
      }
    },
    [activeKey, approving, targetDevice, verifyBiometricsForAction, onClose, resetModalState]
  );

  const handleSelectOrScanKey = async (
    rawInput: string,
    deviceHint?: string,
    source: 'qr' | 'manual' | 'pending' = 'manual'
  ) => {
    if (claimingRef.current) return;
    const key = extractQuickLoginKey(rawInput);
    if (!key) {
      showAppAlert(
        'Mã QR không hợp lệ',
        'Không tìm thấy mã đăng nhập nhanh hợp lệ trong mã QR hoặc chuỗi vừa nhập.',
        [
          {
            text: 'OK',
            onPress: () => {
              scanLockRef.current = false;
              setScanned(false);
            },
          },
        ]
      );
      return;
    }
    claimingRef.current = true;
    setClaiming(true);
    setStatusFeedback(null);
    try {
      const claimRes = await claimQuickLoginQrApi(key, source);
      if (!visibleRef.current) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const resolvedDevice = claimRes.device || deviceHint || 'Thiết bị khác';
      const resolvedFormatted = claimRes.formatted_key || formatDeviceKey(key);
      setActiveKey(claimRes.key || key);
      setFormattedKey(resolvedFormatted);
      setTargetDevice(resolvedDevice);
      setStep('confirm');
      setStatusFeedback({
        ok: true,
        text: `Đã nhận diện thiết bị (${resolvedFormatted}). Vui lòng xác thực ${bioLabel}.`,
      });

      if (autoBioTimerRef.current) clearTimeout(autoBioTimerRef.current);
      autoBioTimerRef.current = setTimeout(() => {
        autoBioTimerRef.current = null;
        if (visibleRef.current) {
          void handleBiometricApprove(claimRes.key || key, resolvedDevice);
        }
      }, 260);
    } catch (err: any) {
      showAppAlert(
        'Không tìm thấy thiết bị',
        err?.message || 'Mã thiết bị không tồn tại hoặc đã hết hạn.',
        [
          {
            text: 'OK',
            onPress: () => {
              scanLockRef.current = false;
              setScanned(false);
            },
          },
        ]
      );
    } finally {
      claimingRef.current = false;
      setClaiming(false);
    }
  };

  const handlePasswordApprove = async () => {
    if (!activeKey || approving) return;
    const pw = passwordInput.trim();
    if (!pw) {
      setStatusFeedback({ ok: false, text: 'Vui lòng nhập mật khẩu tài khoản.' });
      return;
    }
    setApproving(true);
    setStatusFeedback(null);
    try {
      const res = await approveQuickLoginQrApi(activeKey, 'password', pw);
      if (!visibleRef.current) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        'Thành công',
        `Đã kích hoạt đăng nhập nhanh cho thiết bị ${res.formatted_key || formattedKey} thành công!`
      );
      onClose();
    } catch (err: any) {
      if (!visibleRef.current) return;
      const msg = err?.message || 'Xác nhận mật khẩu không thành công.';
      setStatusFeedback({ ok: false, text: msg });
      if (err?.code === 'expired' || err?.status === 410) {
        showAppAlert('Mã đã hết hạn', msg, [
          { text: 'Quét lại', onPress: () => resetModalState() },
        ]);
      }
    } finally {
      setApproving(false);
    }
  };

  if (!visible) return null;

  const translateY = enterAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [56, 0],
  });

  return (
    <Animated.View
      style={[
        styles.overlayRoot,
        { opacity: enterAnim, transform: [{ translateY }] },
      ]}
    >
      <AmbientAppBackground />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.container,
          { paddingTop: insets.top + 14, paddingBottom: Math.max(24, insets.bottom + 14) },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Kích hoạt đăng nhập nhanh</Text>
          <BouncyButton
            style={styles.closeBtn}
            onPress={() => {
              Haptics.selectionAsync();
              onClose();
            }}
          >
            <Ionicons name="close" size={22} color="#FFF" />
          </BouncyButton>
        </View>

        {step === 'scan' ? (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollBody}
          >
            <Text style={styles.desc}>
              Mở mục "Đăng nhập nhanh" trên thiết bị khác, sau đó quét mã QR bằng Camera hoặc chọn thiết bị đang chờ bên dưới.
            </Text>

            <View style={styles.cameraBox}>
              {permission?.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={
                    scanned || claiming
                      ? undefined
                      : ({ data }) => {
                          if (scanLockRef.current || claimingRef.current) return;
                          scanLockRef.current = true;
                          setScanned(true);
                          void handleSelectOrScanKey(data, undefined, 'qr');
                        }
                  }
                />
              ) : (
                <View style={styles.permBox}>
                  <Ionicons name="camera-outline" size={36} color={COLORS.muted} />
                  <Text style={styles.permText}>
                    Cần quyền Camera để quét mã QR đăng nhập nhanh
                  </Text>
                  <BouncyButton
                    style={styles.permBtn}
                    onPress={() => requestPermission().catch(() => {})}
                  >
                    <Text style={styles.permBtnTxt}>Cấp quyền Camera</Text>
                  </BouncyButton>
                </View>
              )}
              <View style={styles.scanFrame} pointerEvents="none" />
              {claiming ? (
                <View style={styles.busyOverlay}>
                  <ActivityIndicator size="large" color="#FFF" />
                </View>
              ) : null}
            </View>

            <GlassSurface variant="liquid" intensity={30} radius={26} style={styles.card}>
              <Text style={styles.cardLabel}>Hoặc nhập mã thiết bị 9 số</Text>
              <View style={styles.manualRow}>
                <TextInput
                  style={styles.codeInput}
                  placeholder="VD: 123 456 789"
                  placeholderTextColor={COLORS.muted}
                  keyboardType="number-pad"
                  maxLength={16}
                  value={manualKey}
                  onChangeText={setManualKey}
                />
                <BouncyButton
                  style={styles.connectBtn}
                  disabled={claiming}
                  onPress={() => void handleSelectOrScanKey(manualKey, undefined, 'manual')}
                >
                  {claiming ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={styles.connectBtnTxt}>Tiếp tục</Text>
                  )}
                </BouncyButton>
              </View>
            </GlassSurface>

            <GlassSurface variant="liquid" intensity={30} radius={26} style={styles.card}>
              <View style={styles.listHeader}>
                <Text style={styles.cardLabel}>Thiết bị đang chờ đăng nhập</Text>
                {loadingDevices ? <ActivityIndicator size="small" color={COLORS.muted} /> : null}
              </View>
              {pendingDevices.length > 0 ? (
                <View style={styles.deviceList}>
                  {pendingDevices.map((dev) => (
                    <BouncyButton
                      key={dev.key}
                      bounciness="gentle"
                      activeOpacity={0.82}
                      style={styles.deviceRow}
                      disabled={claiming}
                      onPress={() => void handleSelectOrScanKey(dev.key, dev.device, 'pending')}
                    >
                      <View style={styles.deviceIconBox}>
                        <Ionicons
                          name={deviceIconName(dev.device)}
                          size={20}
                          color="#FFF"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{dev.device}</Text>
                        <Text style={styles.deviceCode}>{dev.formatted_key}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                    </BouncyButton>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyPending}>
                  Chưa có thiết bị nào đang mở màn hình Đăng nhập nhanh.
                </Text>
              )}
            </GlassSurface>
          </ScrollView>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.confirmScroll}
          >
            <GlassSurface variant="liquid" intensity={34} radius={34} style={styles.confirmCard}>
              <View style={styles.userIdentityRow}>
                {user?.avatar_url ? (
                  <Image
                    source={{ uri: user.avatar_url }}
                    style={styles.avatarImg}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.avatarImg, styles.avatarFallback]}>
                    <Ionicons name="person" size={24} color="#FFF" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {user?.name || 'Thành viên'}
                  </Text>
                  <Text style={styles.userEmail} numberOfLines={1}>
                    {user?.email || ''}
                  </Text>
                </View>
              </View>

              <View style={styles.targetDevicePill}>
                <Ionicons name={deviceIconName(targetDevice)} size={16} color="#FF3B6B" />
                <Text style={styles.targetDeviceText}>
                  {targetDevice} • {formattedKey}
                </Text>
              </View>

              {statusFeedback ? (
                <View
                  style={[
                    styles.feedbackBox,
                    statusFeedback.ok ? styles.feedbackOk : styles.feedbackErr,
                  ]}
                >
                  <Text
                    style={[
                      styles.feedbackText,
                      { color: statusFeedback.ok ? '#4ADE80' : '#FCA5A5' },
                    ]}
                  >
                    {statusFeedback.text}
                  </Text>
                </View>
              ) : null}

              <BouncyButton
                bounciness="gentle"
                activeOpacity={0.86}
                disabled={approving}
                style={styles.bioPrimaryBtn}
                onPress={() => void handleBiometricApprove()}
              >
                {approving && !showPasswordBox ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Ionicons name="scan-outline" size={20} color="#FFF" />
                )}
                <Text style={styles.bioPrimaryText}>Xác nhận bằng {bioLabel}</Text>
              </BouncyButton>

              <BouncyButton
                style={styles.togglePwLink}
                onPress={() => setShowPasswordBox((prev) => !prev)}
              >
                <Text style={styles.togglePwText}>
                  {showPasswordBox ? 'Ẩn nhập mật khẩu thủ công' : 'Hoặc xác nhận bằng mật khẩu'}
                </Text>
              </BouncyButton>

              {showPasswordBox ? (
                <View style={styles.passwordSection}>
                  <View style={styles.passwordInputWrap}>
                    <TextInput
                      style={styles.passwordInput}
                      placeholder="Nhập mật khẩu tài khoản..."
                      placeholderTextColor={COLORS.muted}
                      secureTextEntry={!showPassText}
                      autoCapitalize="none"
                      value={passwordInput}
                      onChangeText={setPasswordInput}
                    />
                    <BouncyButton
                      style={styles.eyeBtn}
                      onPress={() => setShowPassText((v) => !v)}
                    >
                      <Ionicons
                        name={showPassText ? 'eye-off-outline' : 'eye-outline'}
                        size={19}
                        color={COLORS.muted}
                      />
                    </BouncyButton>
                  </View>
                  <BouncyButton
                    bounciness="gentle"
                    activeOpacity={0.85}
                    disabled={approving}
                    style={styles.pwSubmitBtn}
                    onPress={() => void handlePasswordApprove()}
                  >
                    {approving ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.pwSubmitText}>Xác nhận đăng nhập</Text>
                    )}
                  </BouncyButton>
                </View>
              ) : null}

              <BouncyButton style={styles.rescanBtn} onPress={resetModalState}>
                <Ionicons name="qr-code-outline" size={16} color={COLORS.textSecondary} />
                <Text style={styles.rescanText}>Quay lại quét mã khác</Text>
              </BouncyButton>
            </GlassSurface>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 720,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollBody: {
    gap: 14,
    paddingBottom: 28,
  },
  desc: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
  },
  cameraBox: {
    height: 264,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#111623',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 184,
    height: 184,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permBox: {
    alignItems: 'center',
    gap: 10,
    padding: 20,
  },
  permText: {
    color: COLORS.muted,
    textAlign: 'center',
    fontSize: 13,
  },
  permBtn: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 14,
  },
  permBtnTxt: {
    color: '#FFF',
    fontWeight: '700',
  },
  card: {
    padding: 18,
    gap: 10,
  },
  cardLabel: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    fontWeight: '700',
  },
  manualRow: {
    flexDirection: 'row',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.09)',
    paddingHorizontal: 14,
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  connectBtn: {
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnTxt: {
    color: '#FFF',
    fontWeight: '700',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deviceList: {
    gap: 8,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deviceIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(229,9,20,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceName: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  deviceCode: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  emptyPending: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  confirmScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  confirmCard: {
    padding: 26,
    gap: 16,
    alignItems: 'center',
  },
  userIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.07)',
    padding: 14,
    borderRadius: 22,
  },
  avatarImg: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  userEmail: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  targetDevicePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(229, 9, 20, 0.16)',
  },
  targetDeviceText: {
    color: '#FF85A1',
    fontSize: 13.5,
    fontWeight: '700',
  },
  feedbackBox: {
    width: '100%',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
  },
  feedbackOk: {
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
  },
  feedbackErr: {
    backgroundColor: 'rgba(248, 113, 113, 0.14)',
  },
  feedbackText: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    fontWeight: '600',
  },
  bioPrimaryBtn: {
    width: '100%',
    height: 50,
    borderRadius: 24,
    backgroundColor: '#0072FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bioPrimaryText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  togglePwLink: {
    paddingVertical: 4,
  },
  togglePwText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  passwordSection: {
    width: '100%',
    gap: 10,
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderRadius: 18,
    height: 48,
    paddingHorizontal: 14,
  },
  passwordInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 14.5,
  },
  eyeBtn: {
    padding: 4,
  },
  pwSubmitBtn: {
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pwSubmitText: {
    color: '#FFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 4,
  },
  rescanText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
