import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { GlassSurface } from '../components/GlassSurface';
import { COLORS, RADII } from '../constants/config';
import {
  castPairApi,
  castPushApi,
  castStatusApi,
  castStopApi,
} from '../services/api';

interface CastModalProps {
  visible: boolean;
  movieToCast?: {
    videosId: number;
    streamCode: string;
    title: string;
  } | null;
  onClose: () => void;
}

export function CastModal({ visible, movieToCast, onClose }: CastModalProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [roomId, setRoomId] = useState('');
  const [pairing, setPairing] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [tvStatus, setTvStatus] = useState<any>(null);
  const enterAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      enterAnim.setValue(0);
      Animated.timing(enterAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      enterAnim.stopAnimation();
      enterAnim.setValue(0);
    }
  }, [visible, enterAnim]);

  useEffect(() => {
    if (!visible) {
      setScanned(false);
    } else if (!permission?.granted) {
      requestPermission().catch(() => {});
    }
  }, [visible, permission, requestPermission]);

  useEffect(() => {
    if (!visible || !roomId) return;
    const iv = setInterval(async () => {
      try {
        const res = await castStatusApi(roomId);
        setTvStatus(res);
      } catch {}
    }, 3500);
    return () => clearInterval(iv);
  }, [visible, roomId]);

  const extractCode = (raw: string): string => {
    const trimmed = raw.trim();
    const match = trimmed.match(/(?:code=|pair=|cast\/)([A-Za-z0-9]{4,10})/i);
    if (match) return match[1].toUpperCase();
    return trimmed.toUpperCase();
  };

  const handlePair = async (codeRaw: string) => {
    const code = extractCode(codeRaw);
    if (!code) {
      Alert.alert('Thiếu mã ghép đôi', 'Vui lòng quét mã QR trên TV hoặc nhập mã 6 ký tự.');
      return;
    }
    setPairing(true);
    try {
      const res = await castPairApi(code);
      if (res.ok || res.success || res.room_id) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const rid = res.room_id || code;
        setRoomId(rid);
        if (movieToCast?.streamCode) {
          await castPushApi({
            room_id: rid,
            cmd: 'play_movie',
            videos_id: movieToCast.videosId,
            stream_code: movieToCast.streamCode,
            title: movieToCast.title,
          });
        }
      } else {
        Alert.alert('Không thể ghép đôi', res.error || res.message || 'Mã TV không hợp lệ.');
        setScanned(false);
      }
    } catch (err: any) {
      Alert.alert('Lỗi DVA Cast', err?.message || 'Không kết nối được tới máy chủ DVA Cast.');
      setScanned(false);
    } finally {
      setPairing(false);
    }
  };

  const sendCommand = async (cmd: string, extra: Record<string, any> = {}) => {
    if (!roomId) return;
    Haptics.selectionAsync();
    try {
      await castPushApi({ room_id: roomId, cmd, ...extra });
    } catch {}
  };

  const handleDisconnect = async () => {
    if (roomId) {
      try {
        await castStopApi(roomId);
      } catch {}
    }
    setRoomId('');
    setTvStatus(null);
    setScanned(false);
  };

  if (!visible) {
    return null;
  }

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
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + 14, paddingBottom: Math.max(24, insets.bottom + 14) },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>DVA Cast lên TV</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>

        {roomId ? (
          <View style={styles.remoteWrap}>
            <GlassSurface intensity={55} radius={28} style={styles.remoteCard}>
              <Ionicons name="tv" size={44} color={COLORS.accent} />
              <Text style={styles.connectedTitle}>Đã kết nối phòng {roomId}</Text>
              <Text style={styles.connectedSub}>
                {tvStatus?.title || movieToCast?.title || 'Sẵn sàng điều khiển phát trên TV'}
              </Text>

              {movieToCast ? (
                <TouchableOpacity
                  style={styles.pushBtn}
                  onPress={() =>
                    sendCommand('play_movie', {
                      videos_id: movieToCast.videosId,
                      stream_code: movieToCast.streamCode,
                      title: movieToCast.title,
                    })
                  }
                >
                  <Ionicons name="tv" size={18} color="#FFF" />
                  <Text style={styles.pushBtnText}>Phát "{movieToCast.title}" lên TV</Text>
                </TouchableOpacity>
              ) : null}

              <View style={styles.controlsRow}>
                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => sendCommand('seek_rel', { delta: -15 })}
                >
                  <Ionicons name="play-back" size={24} color="#FFF" />
                  <Text style={styles.ctrlLabel}>-15s</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.ctrlBtn, styles.ctrlPlay]}
                  onPress={() => sendCommand('toggle_play')}
                >
                  <Ionicons name="play-circle" size={32} color="#FFF" />
                  <Text style={styles.ctrlLabel}>Phát / Dừng</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => sendCommand('seek_rel', { delta: 15 })}
                >
                  <Ionicons name="play-forward" size={24} color="#FFF" />
                  <Text style={styles.ctrlLabel}>+15s</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.stopBtn} onPress={handleDisconnect}>
                <Text style={styles.stopTxt}>Ngắt kết nối TV</Text>
              </TouchableOpacity>
            </GlassSurface>
          </View>
        ) : (
          <View style={styles.pairBody}>
            <Text style={styles.desc}>
              Mở trang chiếu DVA Cast trên TV / máy chiếu, sau đó hướng Camera iPhone vào mã QR hoặc nhập mã 6 ký tự bên dưới.
            </Text>

            <View style={styles.cameraBox}>
              {permission?.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={
                    scanned
                      ? undefined
                      : ({ data }) => {
                          setScanned(true);
                          handlePair(data);
                        }
                  }
                />
              ) : (
                <View style={styles.permBox}>
                  <Ionicons name="camera-outline" size={38} color={COLORS.muted} />
                  <Text style={styles.permText}>Cần quyền Camera để quét mã QR trên TV</Text>
                  <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
                    <Text style={styles.permBtnTxt}>Cấp quyền Camera</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={styles.scanFrame} pointerEvents="none" />
            </View>

            <GlassSurface intensity={45} radius={RADII.md} style={styles.manualCard}>
              <Text style={styles.manualLabel}>Hoặc nhập mã ghép đôi 6 ký tự</Text>
              <View style={styles.manualRow}>
                <TextInput
                  style={styles.codeInput}
                  placeholder="VD: A1B2C3"
                  placeholderTextColor={COLORS.muted}
                  autoCapitalize="characters"
                  maxLength={12}
                  value={manualCode}
                  onChangeText={setManualCode}
                />
                <TouchableOpacity
                  style={styles.connectBtn}
                  disabled={pairing}
                  onPress={() => handlePair(manualCode)}
                >
                  {pairing ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={styles.connectBtnTxt}>Kết nối</Text>
                  )}
                </TouchableOpacity>
              </View>
            </GlassSurface>
          </View>
        )}
      </View>
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
    zIndex: 700,
    backgroundColor: COLORS.bg,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
    fontSize: 21,
    fontWeight: '800',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairBody: {
    flex: 1,
    gap: 16,
  },
  desc: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
  },
  cameraBox: {
    height: 290,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#111623',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    width: 190,
    height: 190,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  permBox: {
    alignItems: 'center',
    gap: 10,
    padding: 20,
  },
  permText: {
    color: COLORS.muted,
    textAlign: 'center',
  },
  permBtn: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
  },
  permBtnTxt: {
    color: '#FFF',
    fontWeight: '700',
  },
  manualCard: {
    padding: 16,
  },
  manualLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  manualRow: {
    flexDirection: 'row',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
  },
  connectBtn: {
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnTxt: {
    color: '#FFF',
    fontWeight: '700',
  },
  remoteWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  remoteCard: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  connectedTitle: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: '800',
  },
  connectedSub: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    textAlign: 'center',
  },
  pushBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    marginTop: 4,
  },
  pushBtnText: {
    color: '#FFF',
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
  },
  ctrlBtn: {
    width: 86,
    height: 76,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ctrlPlay: {
    backgroundColor: 'rgba(229,9,20,0.28)',
  },
  ctrlLabel: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  stopBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(239,68,68,0.18)',
  },
  stopTxt: {
    color: '#FCA5A5',
    fontWeight: '700',
  },
});
