import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientAppBackground } from '../components/AmbientAppBackground';
import { showAppAlert } from '../components/AppAlertModal';
import { GlassSurface } from '../components/GlassSurface';
import { COLORS } from '../constants/config';
import {
  castPairApi,
  castPushApi,
  castStatusApi,
  castStopApi,
} from '../services/api';

export interface CastMoviePayload {
  videosId: number;
  streamCode: string;
  title: string;
  episode?: string;
  poster?: string;
  streamUrl?: string;
  position?: number;
  paused?: boolean;
  subHigh?: string;
  subVn?: string;
  subEn?: string;
}

interface CastModalProps {
  visible: boolean;
  inlinePopup?: boolean;
  movieToCast?: CastMoviePayload | null;
  onCastStarted?: () => void;
  onClose: () => void;
}

function fmtSec(sec?: number): string {
  const n = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatPairCodeDisplay(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (clean.length === 6) {
    return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  }
  return clean;
}

export function CastModal({
  visible,
  inlinePopup = false,
  movieToCast,
  onCastStarted,
  onClose,
}: CastModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [senderToken, setSenderToken] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [tvStatus, setTvStatus] = useState<any>(null);
  const [tvPaused, setTvPaused] = useState(false);
  const [tvMuted, setTvMuted] = useState(false);
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
      setScanned(false);
    }
  }, [visible, enterAnim]);

  useEffect(() => {
    if (visible && !senderToken && permission && !permission.granted && permission.canAskAgain) {
      requestPermission().catch(() => {});
    }
  }, [visible, senderToken, permission, requestPermission]);

  useEffect(() => {
    if (!visible || !senderToken) return;
    let active = true;

    const pollStatus = async () => {
      try {
        const res = await castStatusApi(senderToken);
        if (!active) return;
        if (res?.st === 'ended' || (!res?.ok && !res?.success)) {
          setSenderToken('');
          setPairCode('');
          setTvStatus(null);
          setScanned(false);
          showAppAlert('Đã ngắt kết nối', 'Phiên trình chiếu trên TV đã kết thúc.');
          return;
        }
        setTvStatus(res);
        if (typeof res?.receiver_state === 'string') {
          setTvPaused(res.receiver_state === 'paused');
        } else if (typeof res?.paused === 'boolean') {
          setTvPaused(res.paused);
        }
        if (typeof res?.receiver_muted !== 'undefined') {
          setTvMuted(Boolean(Number(res.receiver_muted)));
        }
      } catch {}
    };

    pollStatus();
    const iv = setInterval(pollStatus, 2500);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [visible, senderToken]);

  const extractCode = (raw: string): string => {
    const trimmed = String(raw || '').trim();
    const urlMatch = trimmed.match(/[?&](?:code|pair)=([A-Za-z0-9]{6})\b/i);
    if (urlMatch) return urlMatch[1].toUpperCase();
    const tagMatch = trimmed.match(/DVACAST:([A-Za-z0-9]{6})/i);
    if (tagMatch) return tagMatch[1].toUpperCase();
    const cleaned = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleaned.length === 6) return cleaned;
    return '';
  };

  const pushMovieToTv = async (tokenToUse: string, movie: CastMoviePayload) => {
    const res = await castPushApi({
      sender_token: tokenToUse,
      command: 'load_media',
      videos_id: movie.videosId,
      stream_code: movie.streamCode,
      stream_url: movie.streamUrl || '',
      title: movie.title,
      episode: movie.episode || '',
      poster: movie.poster || '',
      position: Number(movie.position) || 0,
      paused: false,
      subtitles: {
        vn: movie.subVn || '',
        en: movie.subEn || '',
        sub_high: movie.subHigh || '',
      },
    });
    if (res?.ok || res?.success) {
      setTvStatus(res);
      setTvPaused(false);
      onCastStarted?.();
    } else if (res?.error || res?.err) {
      showAppAlert('Không thể phát lên TV', res.error || 'Nguồn phát chưa sẵn sàng để trình chiếu.');
    }
  };

  const handlePair = async (codeRaw: string) => {
    const code = extractCode(codeRaw);
    if (!code) {
      showAppAlert('Thiếu mã ghép đôi', 'Vui lòng quét mã QR trên TV hoặc nhập đúng mã 6 ký tự.');
      setScanned(false);
      return;
    }
    setPairing(true);
    try {
      const res = await castPairApi(code);
      const tok = String(res?.sender_token || res?.room_id || '');
      if ((res?.ok || res?.success) && tok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSenderToken(tok);
        setPairCode(String(res?.code || code));
        setManualCode('');
        if (movieToCast && (movieToCast.streamCode || movieToCast.streamUrl)) {
          try {
            await pushMovieToTv(tok, movieToCast);
          } catch (pushErr: any) {
            showAppAlert('Đã ghép đôi TV', pushErr?.message || 'Chưa thể đẩy phim tự động, hãy bấm nút phát lại.');
          }
        }
      } else {
        showAppAlert('Không thể ghép đôi', res?.error || res?.message || 'Mã TV không hợp lệ hoặc đã hết hạn.');
        setScanned(false);
      }
    } catch (err: any) {
      showAppAlert('Lỗi DVA Cast', err?.message || 'Không kết nối được tới máy chủ DVA Cast.');
      setScanned(false);
    } finally {
      setPairing(false);
    }
  };

  const sendCommand = async (cmd: string, extra: Record<string, any> = {}) => {
    if (!senderToken) return;
    Haptics.selectionAsync();
    try {
      const res = await castPushApi({ sender_token: senderToken, command: cmd, ...extra });
      if (res?.st === 'ended') {
        setSenderToken('');
        setPairCode('');
        setTvStatus(null);
        setScanned(false);
        showAppAlert('Đã ngắt kết nối', 'Phiên trình chiếu trên TV đã kết thúc.');
        return;
      }
      if (res?.ok || res?.success) {
        setTvStatus(res);
        if (typeof res?.paused === 'boolean') setTvPaused(res.paused);
        if (typeof res?.muted === 'boolean') setTvMuted(res.muted);
      }
    } catch (err: any) {
      showAppAlert('Lỗi điều khiển', err?.message || 'Không thể gửi lệnh tới TV.');
    }
  };

  const handleDisconnect = async () => {
    if (senderToken) {
      try {
        await castStopApi(senderToken);
      } catch {}
    }
    setSenderToken('');
    setPairCode('');
    setTvStatus(null);
    setTvPaused(false);
    setTvMuted(false);
    setScanned(false);
  };

  if (!visible) {
    return null;
  }

  const cameraBox = (compact: boolean) => (
    <View style={[styles.cameraBox, compact ? styles.cameraBoxInline : styles.cameraBoxFull]}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={
            scanned || pairing
              ? undefined
              : ({ data }) => {
                  setScanned(true);
                  handlePair(data);
                }
          }
        />
      ) : (
        <View style={styles.permBox}>
          <Ionicons name="camera-outline" size={34} color={COLORS.muted} />
          <Text style={styles.permText}>Cần quyền Camera để quét mã QR trên TV</Text>
          <TouchableOpacity
            style={styles.permBtn}
            onPress={() => requestPermission().catch(() => {})}
          >
            <Text style={styles.permBtnTxt}>Cấp quyền Camera</Text>
          </TouchableOpacity>
        </View>
      )}
      <View
        style={[styles.scanFrame, compact && { width: 146, height: 146, borderRadius: 20 }]}
        pointerEvents="none"
      />
    </View>
  );

  const manualInputBox = (
    <View style={styles.manualCardInner}>
      <Text style={styles.manualLabel}>Hoặc nhập mã ghép đôi 6 ký tự</Text>
      <View style={styles.manualRow}>
        <TextInput
          style={styles.codeInput}
          placeholder="VD: A1B2C3"
          placeholderTextColor={COLORS.muted}
          autoCapitalize="characters"
          autoCorrect={false}
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
    </View>
  );

  const remoteControlsContent = (compact: boolean) => {
    const posSec = Number(tvStatus?.receiver_pos || 0);
    const durSec = Number(tvStatus?.receiver_dur || 0);
    const titleStr =
      tvStatus?.title || movieToCast?.title || 'Sẵn sàng điều khiển phát trên TV';
    const epStr = tvStatus?.episode || movieToCast?.episode || '';

    return (
      <View style={[styles.remoteInner, compact && { gap: 10 }]}>
        <View style={styles.remoteTopInfo}>
          <View style={styles.tvBadgeIcon}>
            <Ionicons name="tv" size={compact ? 28 : 38} color={COLORS.accent} />
          </View>
          <View style={compact ? { flex: 1 } : { alignItems: 'center' }}>
            <Text style={styles.connectedTitle}>
              Đã kết nối phòng {formatPairCodeDisplay(pairCode)}
            </Text>
            <Text style={[styles.connectedSub, compact && { textAlign: 'left' }]} numberOfLines={2}>
              {epStr ? `${titleStr} • ${epStr}` : titleStr}
            </Text>
            {durSec > 0 ? (
              <Text style={styles.timeReadout}>
                {fmtSec(posSec)} / {fmtSec(durSec)}
              </Text>
            ) : null}
          </View>
        </View>

        {movieToCast ? (
          <TouchableOpacity
            style={styles.pushBtn}
            onPress={() => pushMovieToTv(senderToken, movieToCast)}
          >
            <Ionicons name="tv-outline" size={18} color="#FFF" />
            <Text style={styles.pushBtnText} numberOfLines={1}>
              Phát "{movieToCast.title}" lên TV
            </Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={styles.ctrlBtn}
            onPress={() => sendCommand('seek_rel', { delta: -15 })}
          >
            <Ionicons name="play-back" size={22} color="#FFF" />
            <Text style={styles.ctrlLabel}>-15s</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.ctrlBtn, styles.ctrlPlay]}
            onPress={() => sendCommand('toggle_play')}
          >
            <Ionicons name={tvPaused ? 'play' : 'pause'} size={28} color="#FFF" />
            <Text style={styles.ctrlLabel}>{tvPaused ? 'Phát' : 'Tạm dừng'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ctrlBtn}
            onPress={() => sendCommand('seek_rel', { delta: 15 })}
          >
            <Ionicons name="play-forward" size={22} color="#FFF" />
            <Text style={styles.ctrlLabel}>+15s</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ctrlBtn}
            onPress={() => sendCommand('toggle_mute')}
          >
            <Ionicons
              name={tvMuted ? 'volume-mute' : 'volume-high'}
              size={22}
              color="#FFF"
            />
            <Text style={styles.ctrlLabel}>{tvMuted ? 'Bật tiếng' : 'Tắt tiếng'}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.stopBtn} onPress={handleDisconnect}>
          <Text style={styles.stopTxt}>Ngắt kết nối TV</Text>
        </TouchableOpacity>
      </View>
    );
  };

  if (inlinePopup) {
    const cardWidth = isLandscape
      ? Math.min(720, winWidth - Math.max(40, insets.left + insets.right + 20))
      : Math.min(440, winWidth - 24);
    const cardHeight = isLandscape
      ? Math.min(352, winHeight - 20)
      : Math.min(winHeight * 0.82, 620);

    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
        onRequestClose={onClose}
      >
        <View style={styles.popupBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: cardWidth, maxWidth: '100%' }}
          >
            <GlassSurface
              variant="liquid"
              intensity={85}
              radius={40}
              style={{ width: cardWidth, height: cardHeight }}
            >
              <View style={styles.popupInner}>
                <View style={styles.header}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={styles.popupTitle}>DVA Cast lên TV</Text>
                    {movieToCast?.title ? (
                      <Text style={styles.popupSub} numberOfLines={1}>
                        {movieToCast.episode
                          ? `${movieToCast.title} • ${movieToCast.episode}`
                          : movieToCast.title}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.closeBtn}
                    hitSlop={10}
                    onPress={() => {
                      Haptics.selectionAsync();
                      onClose();
                    }}
                  >
                    <Ionicons name="close" size={22} color="#FFF" />
                  </TouchableOpacity>
                </View>

                {senderToken ? (
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.popupRemoteScroll}
                  >
                    {remoteControlsContent(isLandscape)}
                  </ScrollView>
                ) : isLandscape ? (
                  <View style={styles.landscapeColumns}>
                    <View style={{ flex: 1.05 }}>{cameraBox(true)}</View>
                    <View style={styles.landscapeRightCol}>
                      <Text style={styles.desc}>
                        Mở DVA Cast trên TV / máy chiếu, hướng Camera vào mã QR hoặc nhập mã 6 ký tự bên dưới.
                      </Text>
                      <View style={styles.glassPanelBox}>{manualInputBox}</View>
                    </View>
                  </View>
                ) : (
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ gap: 14 }}
                  >
                    <Text style={styles.desc}>
                      Mở DVA Cast trên TV / máy chiếu, hướng Camera iPhone vào mã QR hoặc nhập mã 6 ký tự bên dưới.
                    </Text>
                    {cameraBox(false)}
                    <View style={styles.glassPanelBox}>{manualInputBox}</View>
                  </ScrollView>
                )}
              </View>
            </GlassSurface>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[
          styles.container,
          { paddingTop: insets.top + 14, paddingBottom: Math.max(24, insets.bottom + 14) },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>DVA Cast lên TV</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>

        {senderToken ? (
          <View style={styles.remoteWrap}>
            <GlassSurface variant="liquid" intensity={85} radius={40} style={styles.remoteCard}>
              {remoteControlsContent(false)}
            </GlassSurface>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.pairBody}
          >
            <Text style={styles.desc}>
              Mở trang chiếu DVA Cast trên TV / máy chiếu, sau đó hướng Camera iPhone vào mã QR hoặc nhập mã 6 ký tự bên dưới.
            </Text>

            {cameraBox(false)}

            <GlassSurface variant="liquid" intensity={85} radius={40} style={styles.manualCard}>
              {manualInputBox}
            </GlassSurface>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  popupBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  popupInner: {
    flex: 1,
    paddingHorizontal: 26,
    paddingVertical: 22,
  },
  popupTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
  popupSub: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
  },
  landscapeColumns: {
    flex: 1,
    flexDirection: 'row',
    gap: 18,
    alignItems: 'stretch',
  },
  landscapeRightCol: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
  },
  glassPanelBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 24,
    padding: 16,
  },
  popupRemoteScroll: {
    flexGrow: 1,
    justifyContent: 'center',
  },
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
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairBody: {
    gap: 16,
    paddingBottom: 24,
  },
  desc: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 19,
  },
  cameraBox: {
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#111623',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBoxFull: {
    height: 290,
  },
  cameraBoxInline: {
    flex: 1,
    minHeight: 210,
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
  manualCard: {
    padding: 18,
  },
  manualCardInner: {
    gap: 10,
  },
  manualLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  manualRow: {
    flexDirection: 'row',
    gap: 10,
  },
  codeInput: {
    flex: 1,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 2,
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
  remoteWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  remoteCard: {
    padding: 26,
  },
  remoteInner: {
    alignItems: 'center',
    gap: 14,
  },
  remoteTopInfo: {
    alignItems: 'center',
    gap: 8,
  },
  tvBadgeIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(229,9,20,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectedTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  connectedSub: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    textAlign: 'center',
    marginTop: 2,
  },
  timeReadout: {
    color: '#5AC8FA',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  pushBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    maxWidth: '100%',
  },
  pushBtnText: {
    color: '#FFF',
    fontWeight: '700',
    flexShrink: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  ctrlBtn: {
    minWidth: 74,
    height: 70,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  ctrlPlay: {
    backgroundColor: 'rgba(229,9,20,0.32)',
  },
  ctrlLabel: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  stopBtn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: 'rgba(239,68,68,0.2)',
  },
  stopTxt: {
    color: '#FCA5A5',
    fontWeight: '700',
  },
});
