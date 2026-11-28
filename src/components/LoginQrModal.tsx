import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BouncyButton } from './BouncyButton';
import { GlassSurface, WaterDropPopupView } from './GlassSurface';
import { QrCodeView } from './QrCodeView';
import { COLORS } from '../constants/config';
import {
  cancelQrLoginSessionApi,
  initQrLoginSessionApi,
  pollQrLoginSessionApi,
} from '../services/api';
import { AuthCookies, User } from '../types/models';

interface LoginQrModalProps {
  visible: boolean;
  onClose: () => void;
  onApproved: (payload: { token: string; cookies?: AuthCookies | null; user: User }) => Promise<void> | void;
}

export function LoginQrModal({ visible, onClose, onApproved }: LoginQrModalProps) {
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'claimed' | 'expired' | 'error'>('loading');
  const [qrKey, setQrKey] = useState('');
  const [formattedKey, setFormattedKey] = useState('--- --- ---');
  const [qrUrl, setQrUrl] = useState('');
  const [expiresIn, setExpiresIn] = useState(90);
  const [claimedUser, setClaimedUser] = useState<{ name: string; avatar_url: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState('Đang khởi tạo mã QR...');

  const activeKeyRef = useRef('');
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const approvedOnceRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const cleanupSession = useCallback(() => {
    stopPolling();
    const k = activeKeyRef.current;
    activeKeyRef.current = '';
    if (k) {
      void cancelQrLoginSessionApi(k).catch(() => {});
    }
  }, [stopPolling]);

  const startSession = useCallback(async () => {
    cleanupSession();
    approvedOnceRef.current = false;
    setPhase('loading');
    setClaimedUser(null);
    setFormattedKey('--- --- ---');
    setStatusMessage('Đang khởi tạo mã QR...');

    try {
      const res = await initQrLoginSessionApi('DVA Play iPhone');
      if (!visibleRef.current) return;
      if (!res.success || !res.key) {
        setPhase('error');
        setStatusMessage('Không thể khởi tạo phiên đăng nhập QR.');
        return;
      }
      activeKeyRef.current = res.key;
      setQrKey(res.key);
      setFormattedKey(res.formatted_key || res.key);
      setQrUrl(res.qr_url || `https://dangvietanh.com/?backQR=${res.key}`);
      setExpiresIn(res.expires_in || 90);
      setPhase('waiting');
      setStatusMessage('Đang đợi quét mã QR hoặc nhập mã thiết bị...');

      pollTimerRef.current = setInterval(async () => {
        const curKey = activeKeyRef.current;
        if (!curKey || !visibleRef.current || approvedOnceRef.current) return;
        try {
          const pollRes = await pollQrLoginSessionApi(curKey);
          if (!visibleRef.current || activeKeyRef.current !== curKey) return;

          if (pollRes.state === 'approved' && pollRes.token && pollRes.user) {
            approvedOnceRef.current = true;
            stopPolling();
            activeKeyRef.current = '';
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setStatusMessage('Đăng nhập thành công!');
            await onApproved({
              token: pollRes.token,
              cookies: pollRes.cookies || null,
              user: pollRes.user,
            });
            return;
          }
          if (pollRes.state === 'claimed') {
            setPhase('claimed');
            setClaimedUser({
              name: pollRes.name || 'Thành viên',
              avatar_url: pollRes.avatar_url || '',
            });
            setExpiresIn(pollRes.expires_in || 60);
            setStatusMessage('Đã nhận diện tài khoản • Vui lòng xác nhận trên thiết bị kia');
            return;
          }
          if (pollRes.state === 'expired') {
            stopPolling();
            activeKeyRef.current = '';
            setPhase('expired');
            setStatusMessage('Mã QR / Mã thiết bị đã hết hạn');
            return;
          }
          if (pollRes.state === 'waiting') {
            setPhase('waiting');
            if (typeof pollRes.expires_in === 'number') {
              setExpiresIn(pollRes.expires_in);
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 2000);
    } catch (err: any) {
      if (!visibleRef.current) return;
      setPhase('error');
      setStatusMessage(err?.message || 'Không thể kết nối máy chủ tạo mã QR.');
    }
  }, [cleanupSession, onApproved, stopPolling]);

  useEffect(() => {
    if (visible) {
      void startSession();
    } else {
      cleanupSession();
    }
    return () => {
      cleanupSession();
    };
  }, [visible, startSession, cleanupSession]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <WaterDropPopupView visible={visible} from="center">
          <GlassSurface variant="liquid" intensity={38} radius={38} style={styles.card}>
            <View style={styles.cardInner}>
              <View style={styles.header}>
                <Text style={styles.title}>Đăng nhập nhanh</Text>
                <BouncyButton
                  style={styles.closeBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onClose();
                  }}
                >
                  <Ionicons name="close" size={20} color="#FFF" />
                </BouncyButton>
              </View>

              <Text style={styles.subtitle}>
                Mở mục Kích hoạt đăng nhập nhanh trên thiết bị đã đăng nhập để quét mã QR hoặc nhập mã 9 số bên dưới.
              </Text>

              <View style={styles.stage}>
                {phase === 'loading' ? (
                  <View style={styles.centerState}>
                    <ActivityIndicator size="large" color={COLORS.accent} />
                  </View>
                ) : phase === 'waiting' && qrUrl ? (
                  <QrCodeView value={qrUrl} size={184} />
                ) : phase === 'claimed' && claimedUser ? (
                  <View style={styles.claimedBox}>
                    <Image
                      source={{
                        uri: claimedUser.avatar_url || 'https://dangvietanh.com/uploads/user.jpg',
                      }}
                      style={styles.claimedAvatar}
                    />
                    <Text style={styles.claimedName}>{claimedUser.name}</Text>
                  </View>
                ) : (
                  <View style={styles.expiredBox}>
                    <Ionicons name="time-outline" size={44} color="#FCA5A5" />
                    <Text style={styles.expiredTitle}>
                      {phase === 'error' ? 'Không thể tạo mã' : 'Mã thiết bị đã hết hạn'}
                    </Text>
                    <BouncyButton
                      bounciness="gentle"
                      style={styles.refreshBtn}
                      onPress={() => {
                        Haptics.selectionAsync();
                        void startSession();
                      }}
                    >
                      <Ionicons name="refresh" size={16} color="#FFF" />
                      <Text style={styles.refreshTxt}>Tạo mã mới</Text>
                    </BouncyButton>
                  </View>
                )}
              </View>

              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Mã thiết bị</Text>
                <Text selectable style={styles.codeValue}>
                  {qrKey ? formattedKey : '--- --- ---'}
                </Text>
              </View>

              <View
                style={[
                  styles.statusPill,
                  phase === 'claimed' && styles.statusPillClaimed,
                  (phase === 'expired' || phase === 'error') && styles.statusPillErr,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    phase === 'claimed' && { color: '#BFDBFE' },
                    (phase === 'expired' || phase === 'error') && { color: '#FECACA' },
                  ]}
                >
                  {phase === 'waiting'
                    ? `${statusMessage} (${expiresIn}s)`
                    : statusMessage}
                </Text>
              </View>
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
    backgroundColor: 'rgba(7, 9, 15, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
  },
  cardInner: {
    padding: 24,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 18,
  },
  stage: {
    minHeight: 212,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimedBox: {
    alignItems: 'center',
    gap: 12,
  },
  claimedAvatar: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  claimedName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  expiredBox: {
    alignItems: 'center',
    gap: 10,
  },
  expiredTitle: {
    color: '#FECACA',
    fontSize: 14,
    fontWeight: '600',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
    marginTop: 4,
  },
  refreshTxt: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  codeBox: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    marginBottom: 12,
  },
  codeLabel: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginBottom: 3,
  },
  codeValue: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2.5,
    fontVariant: ['tabular-nums'],
  },
  statusPill: {
    width: '100%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  statusPillClaimed: {
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    borderColor: 'rgba(59, 130, 246, 0.4)',
  },
  statusPillErr: {
    backgroundColor: 'rgba(229, 9, 20, 0.16)',
    borderColor: 'rgba(229, 9, 20, 0.4)',
  },
  statusText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
});
