import React, { useEffect, useState } from 'react';
import {
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
import { COLORS } from '../constants/config';

export interface AppAlertButton {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

export interface AppAlertOptions {
  cancelable?: boolean;
  tone?: 'info' | 'success' | 'warning' | 'error';
}

interface AlertPayload {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  cancelable: boolean;
  tone: 'info' | 'success' | 'warning' | 'error';
}

type AlertListener = (current: AlertPayload | null) => void;

const listeners = new Set<AlertListener>();
const queue: AlertPayload[] = [];
let activeAlert: AlertPayload | null = null;
let seq = 1;

function inferAlertTone(
  title: string,
  buttons: AppAlertButton[],
  explicit?: AppAlertOptions['tone']
): 'info' | 'success' | 'warning' | 'error' {
  if (explicit) return explicit;
  const lower = title.toLowerCase();
  if (
    lower.includes('thành công') ||
    lower.includes('đã tải bản cập nhật') ||
    lower.includes('mới nhất')
  ) {
    return 'success';
  }
  if (buttons.some((b) => b.style === 'destructive') || lower.includes('xóa') || lower.includes('hết hạn')) {
    return 'warning';
  }
  if (
    lower.includes('lỗi') ||
    lower.includes('không tìm thấy') ||
    lower.includes('không thể') ||
    lower.includes('không hợp lệ') ||
    lower.includes('thiếu')
  ) {
    return 'error';
  }
  return 'info';
}

function emitCurrent(): void {
  listeners.forEach((fn) => {
    try {
      fn(activeAlert);
    } catch {}
  });
}

function advanceQueue(): void {
  activeAlert = queue.length > 0 ? queue.shift() || null : null;
  emitCurrent();
}

export function showAppAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
  options?: AppAlertOptions
): void {
  const normalizedButtons: AppAlertButton[] =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK', style: 'default' }];
  const tone = inferAlertTone(title, normalizedButtons, options?.tone);
  const payload: AlertPayload = {
    id: seq++,
    title,
    message,
    buttons: normalizedButtons,
    cancelable: options?.cancelable !== undefined ? options.cancelable : normalizedButtons.length <= 1,
    tone,
  };

  if (!activeAlert) {
    activeAlert = payload;
    emitCurrent();
  } else {
    queue.push(payload);
  }
}

export function dismissCurrentAppAlert(): void {
  if (activeAlert) {
    advanceQueue();
  }
}

export function AppAlertHost(): React.ReactElement | null {
  const { width: winWidth } = useWindowDimensions();
  const [current, setCurrent] = useState<AlertPayload | null>(() => activeAlert);

  useEffect(() => {
    const listener: AlertListener = (next) => {
      setCurrent(next);
    };
    listeners.add(listener);
    setCurrent(activeAlert);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    try {
      if (current.tone === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (current.tone === 'error') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } else if (current.tone === 'warning') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {}
  }, [current?.id]);

  if (!current) {
    return null;
  }

  const cardWidth = Math.min(390, Math.max(290, winWidth - 40));

  const badgeConfig =
    current.tone === 'success'
      ? { icon: 'checkmark-circle' as const, color: '#30D158', bg: 'rgba(48, 209, 88, 0.2)' }
      : current.tone === 'error'
        ? { icon: 'alert-circle' as const, color: '#FF453A', bg: 'rgba(255, 69, 58, 0.22)' }
        : current.tone === 'warning'
          ? { icon: 'warning' as const, color: '#FFD60A', bg: 'rgba(255, 214, 10, 0.2)' }
          : { icon: 'sparkles' as const, color: '#FFFFFF', bg: 'rgba(229, 9, 20, 0.72)' };

  const handlePressButton = (btn: AppAlertButton) => {
    Haptics.selectionAsync();
    const cb = btn.onPress;
    advanceQueue();
    if (cb) {
      setTimeout(() => {
        try {
          cb();
        } catch {}
      }, 20);
    }
  };

  const handleBackdropDismiss = () => {
    if (!current.cancelable) return;
    const cancelBtn = current.buttons.find((b) => b.style === 'cancel');
    if (cancelBtn) {
      handlePressButton(cancelBtn);
    } else if (current.buttons.length === 1) {
      handlePressButton(current.buttons[0]);
    } else {
      advanceQueue();
    }
  };

  const isHorizontalTwoButtons =
    current.buttons.length === 2 &&
    current.buttons.every((b) => (b.text || 'OK').length <= 16);

  return (
    <Modal
      visible={Boolean(current)}
      transparent
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={handleBackdropDismiss}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackdropDismiss} />
        <GlassSurface
          variant="liquid"
          radius={40}
          intensity={85}
          style={[styles.cardWrap, { width: cardWidth }]}
        >
          <View style={styles.cardInner}>
            <View style={[styles.badgeCircle, { backgroundColor: badgeConfig.bg }]}>
              <Ionicons name={badgeConfig.icon} size={26} color={badgeConfig.color} />
            </View>

            <Text style={styles.title}>{current.title}</Text>

            {current.message ? (
              <Text style={styles.message}>{current.message}</Text>
            ) : null}

            <View
              style={[
                styles.actionsWrap,
                isHorizontalTwoButtons ? styles.actionsRow : styles.actionsCol,
              ]}
            >
              {current.buttons.map((btn, idx) => {
                const isCancel = btn.style === 'cancel';
                const isDestructive = btn.style === 'destructive';
                const isPrimary =
                  !isCancel &&
                  !isDestructive &&
                  (current.buttons.length === 1 || idx === current.buttons.length - 1);

                return (
                  <TouchableOpacity
                    key={`${current.id}-${idx}`}
                    activeOpacity={0.82}
                    onPress={() => handlePressButton(btn)}
                    style={[
                      styles.btnBase,
                      isHorizontalTwoButtons && styles.btnFlex,
                      isCancel && styles.btnCancel,
                      isDestructive && styles.btnDestructive,
                      isPrimary && styles.btnPrimary,
                    ]}
                  >
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.btnTxt,
                        isCancel && styles.btnTxtCancel,
                      ]}
                    >
                      {btn.text || 'OK'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
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
    padding: 20,
  },
  cardWrap: {
    borderRadius: 40,
  },
  cardInner: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 22,
    alignItems: 'center',
  },
  badgeCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  message: {
    marginTop: 8,
    color: 'rgba(255, 255, 255, 0.84)',
    fontSize: 13.5,
    lineHeight: 19.5,
    textAlign: 'center',
  },
  actionsWrap: {
    width: '100%',
    marginTop: 20,
    gap: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionsCol: {
    flexDirection: 'column',
  },
  btnBase: {
    minHeight: 46,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  btnFlex: {
    flex: 1,
  },
  btnCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.11)',
  },
  btnDestructive: {
    backgroundColor: 'rgba(229, 9, 20, 0.86)',
  },
  btnPrimary: {
    backgroundColor: COLORS.accent,
  },
  btnTxt: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  btnTxtCancel: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontWeight: '600',
  },
});
