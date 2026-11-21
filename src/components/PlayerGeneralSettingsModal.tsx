import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppAlert } from './AppAlertModal';
import { GlassSurface } from './GlassSurface';
import { COLORS } from '../constants/config';
import { useSettings } from '../context/SettingsContext';
import { ContrastLevelOption, HoldSeekSpeedOption } from '../types/models';

export type PreloadVisualState = 'idle' | 'loading' | 'ready' | 'failed' | 'no_data';

export type SleepTimerSettingValue = number | 'end_of_episode' | null;

interface PlayerGeneralSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  preloadState: PreloadVisualState;
  sleepTimerValue: SleepTimerSettingValue;
  sleepSecondsLeft: number | null;
  onSelectSleepTimer: (val: SleepTimerSettingValue) => void;
  onReloadPlayer: () => void;
  onOpenCast: () => void;
}

type GeneralSubView = 'grid' | 'contrast' | 'hold_speed' | 'sleep_timer' | 'next_delay';

const CONTRAST_OPTIONS: { value: ContrastLevelOption; desc: string }[] = [
  { value: 'Thấp', desc: 'Dịu mắt khi xem ban đêm trong phòng tối' },
  { value: 'Mặc định', desc: 'Cân bằng màu sắc nguyên bản của bộ phim' },
  { value: 'Cao', desc: 'Tăng độ sắc nét và chiều sâu khung hình' },
  { value: 'Rất cao', desc: 'Tối đa độ nổi khối và chi tiết vùng tối' },
];

const HOLD_SPEED_OPTIONS: HoldSeekSpeedOption[] = [0.5, 1, 1.25, 1.5, 2];

const SLEEP_OPTIONS: { label: string; value: SleepTimerSettingValue }[] = [
  { label: 'Tắt', value: null },
  { label: '10 phút', value: 10 },
  { label: '15 phút', value: 15 },
  { label: '20 phút', value: 20 },
  { label: '30 phút', value: 30 },
  { label: '45 phút', value: 45 },
  { label: '1 giờ', value: 60 },
  { label: 'Khi hết tập', value: 'end_of_episode' },
];

const NEXT_DELAY_OPTIONS = [0, 1, 2, 3, 5, 7, 10];

function formatViDateTime(now: Date): { time: string; date: string } {
  const days = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return {
    time: `${hh}:${mm}:${ss}`,
    date: `${days[now.getDay()]}, ${dd}/${mo}/${yyyy}`,
  };
}

export function PlayerGeneralSettingsModal({
  visible,
  onClose,
  preloadState,
  sleepTimerValue,
  sleepSecondsLeft,
  onSelectSleepTimer,
  onReloadPlayer,
  onOpenCast,
}: PlayerGeneralSettingsModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const { settings, updateSetting } = useSettings();

  const [subView, setSubView] = useState<GeneralSubView>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    if (!visible) {
      setSubView('grid');
      setSearchQuery('');
      return;
    }
    setClockNow(new Date());
    const iv = setInterval(() => setClockNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, [visible]);

  const dt = formatViDateTime(clockNow);

  const preloadBadge = useMemo(() => {
    if (!settings.seamlessPreloadEnabled) {
      return { text: 'Đang tắt', dotColor: '#6B7280' };
    }
    switch (preloadState) {
      case 'ready':
        return { text: 'Sẵn sàng', dotColor: '#30D158' };
      case 'loading':
        return { text: 'Đang xử lý', dotColor: '#FFD60A' };
      case 'failed':
        return { text: 'Thất bại', dotColor: '#FF453A' };
      case 'no_data':
        return { text: 'Không có tập sau', dotColor: '#8E8E93' };
      default:
        return { text: 'Chưa sẵn sàng', dotColor: '#FF9F0A' };
    }
  }, [settings.seamlessPreloadEnabled, preloadState]);

  const sleepStatusLabel = useMemo(() => {
    if (sleepTimerValue === null) return 'Đang tắt';
    if (sleepTimerValue === 'end_of_episode') return 'Khi hết tập';
    if (sleepSecondsLeft !== null && sleepSecondsLeft > 0) {
      const m = Math.ceil(sleepSecondsLeft / 60);
      return `Còn ${m} phút`;
    }
    return sleepTimerValue === 60 ? '1 giờ' : `${sleepTimerValue} phút`;
  }, [sleepTimerValue, sleepSecondsLeft]);

  const tiles = useMemo(
    () => [
      {
        id: 'skip_intro',
        icon: 'play-skip-forward-circle-outline' as const,
        title: 'Bỏ qua mở đầu',
        keywords: 'bo qua mo dau gioi thieu intro',
        active: settings.autoSkipIntro,
        status: settings.autoSkipIntro ? 'Đang bật' : 'Đang tắt',
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('autoSkipIntro', !settings.autoSkipIntro);
        },
      },
      {
        id: 'tdmtm',
        icon: 'volume-high-outline' as const,
        title: 'Tự động TM',
        keywords: 'tu dong thuyet minh tap tiep theo',
        active: settings.autoDubNext,
        status: settings.autoDubNext ? 'Đang bật' : 'Đang tắt',
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('autoDubNext', !settings.autoDubNext);
        },
      },
      {
        id: 'contrast',
        icon: 'contrast-outline' as const,
        title: 'Tương phản',
        keywords: 'tuong phan sac net mau hinh anh',
        active: settings.contrastLevel === 'Cao' || settings.contrastLevel === 'Rất cao',
        status: settings.contrastLevel,
        onPress: () => {
          Haptics.selectionAsync();
          setSubView('contrast');
        },
      },
      {
        id: 'resume_home',
        icon: 'bookmark-outline' as const,
        title: 'Tiếp tục xem',
        keywords: 'tiep tuc xem trang chu ghi nho',
        active: settings.resumeOnHome,
        status: settings.resumeOnHome ? 'Đang bật' : 'Đang tắt',
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('resumeOnHome', !settings.resumeOnHome);
        },
      },
      {
        id: 'seek_warn',
        icon: 'warning-outline' as const,
        title: 'Cảnh báo tua',
        keywords: 'canh bao tua nhanh quay lai vi tri cu',
        active: settings.seekWarningEnabled,
        status: settings.seekWarningEnabled ? 'Đang bật' : 'Đang tắt',
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('seekWarningEnabled', !settings.seekWarningEnabled);
        },
      },
      {
        id: 'hold_speed',
        icon: 'flash-outline' as const,
        title: 'Tốc độ giữ tua',
        keywords: 'toc do giu tua cham man hinh 2x',
        active: true,
        status: `${settings.holdSeekSpeed}x`,
        onPress: () => {
          Haptics.selectionAsync();
          setSubView('hold_speed');
        },
      },
      {
        id: 'sleep',
        icon: 'moon-outline' as const,
        title: 'Hẹn giờ ngủ',
        keywords: 'hen gio ngu tat phim ban dem',
        active: sleepTimerValue !== null,
        status: sleepStatusLabel,
        onPress: () => {
          Haptics.selectionAsync();
          setSubView('sleep_timer');
        },
      },
      {
        id: 'next_delay',
        icon: 'timer-outline' as const,
        title: 'Chờ chuyển tập',
        keywords: 'cho chuyen tap dem nguoc giay',
        active: settings.nextEpisodeDelaySec > 0,
        status: `${settings.nextEpisodeDelaySec} giây`,
        onPress: () => {
          Haptics.selectionAsync();
          setSubView('next_delay');
        },
      },
      {
        id: 'seamless',
        icon: 'link-outline' as const,
        title: 'Xem liền mạch',
        keywords: 'xem lien mach tai truoc chuyen tap',
        active: settings.seamlessPreloadEnabled,
        status: preloadBadge.text,
        dotColor: preloadBadge.dotColor,
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('seamlessPreloadEnabled', !settings.seamlessPreloadEnabled);
        },
      },
      {
        id: 'transition',
        icon: 'sparkles-outline' as const,
        title: 'Hiệu ứng chuyển tập',
        keywords: 'hieu ung chuyen canh muot ma',
        active: settings.transitionEffectEnabled,
        status: settings.transitionEffectEnabled ? 'Đang bật' : 'Đang tắt',
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('transitionEffectEnabled', !settings.transitionEffectEnabled);
        },
      },
      {
        id: 'pip',
        icon: 'albums-outline' as const,
        title: 'Thu nhỏ khung hình',
        keywords: 'thu nho khung hinh pip thoat ra man hinh chinh',
        active: settings.pipEnabled,
        status: settings.pipEnabled ? 'Đang bật' : 'Đang tắt',
        onPress: () => {
          Haptics.selectionAsync();
          void updateSetting('pipEnabled', !settings.pipEnabled);
        },
      },
      {
        id: 'dvacast',
        icon: 'qr-code-outline' as const,
        title: 'Quét QR DVA Cast',
        keywords: 'quet ma qr chieu tv dva cast',
        active: false,
        status: 'Chiếu lên TV',
        onPress: () => {
          Haptics.selectionAsync();
          onClose();
          onOpenCast();
        },
      },
    ],
    [
      settings,
      sleepTimerValue,
      sleepStatusLabel,
      preloadBadge,
      updateSetting,
      onClose,
      onOpenCast,
    ]
  );

  const visibleTiles = useMemo(() => {
    const q = searchQuery
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!q) return tiles;
    return tiles.filter((t) => {
      const titleNorm = t.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return titleNorm.includes(q) || t.keywords.includes(q);
    });
  }, [tiles, searchQuery]);

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(680, winWidth - Math.max(36, insets.left + insets.right + 20))
    : Math.min(460, winWidth - 20);
  const cardHeight = isLandscape
    ? Math.min(358, winHeight - 16)
    : Math.min(winHeight * 0.85, 650);

  const handleRebootConfirm = () => {
    Haptics.selectionAsync();
    showAppAlert(
      'Xác nhận tải lại trình phát',
      'Bạn có chắc muốn tải lại trình phát video không?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xác nhận',
          style: 'destructive',
          onPress: () => {
            onClose();
            onReloadPlayer();
          },
        },
      ]
    );
  };

  const renderSubViewTitle = () => {
    const map: Record<GeneralSubView, string> = {
      grid: 'Cài Đặt',
      contrast: 'Chỉnh Độ Tương Phản',
      hold_speed: 'Tốc Độ Giữ Tua',
      sleep_timer: 'Hẹn Giờ Ngủ',
      next_delay: 'Thời Gian Chờ Chuyển Tập',
    };
    return map[subView];
  };

  const renderContent = () => {
    if (subView === 'contrast') {
      return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {CONTRAST_OPTIONS.map((opt) => {
            const selected = settings.contrastLevel === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.subOptionRow, selected && styles.subOptionRowSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('contrastLevel', opt.value);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.subOptionTitle}>{opt.value}</Text>
                  <Text style={styles.subOptionDesc}>{opt.desc}</Text>
                </View>
                {selected ? (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.accent} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      );
    }

    if (subView === 'hold_speed') {
      return (
        <View style={styles.subCenterWrap}>
          <Text style={styles.subHelperTxt}>
            Chọn tốc độ phát khi chạm và giữ tay trên khung hình video
          </Text>
          <View style={styles.chipsGrid}>
            {HOLD_SPEED_OPTIONS.map((sp) => {
              const sel = settings.holdSeekSpeed === sp;
              return (
                <TouchableOpacity
                  key={sp}
                  style={[styles.choiceChip, sel && styles.choiceChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    void updateSetting('holdSeekSpeed', sp);
                  }}
                >
                  <Text style={styles.choiceChipTxt}>{sp}x</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    if (subView === 'sleep_timer') {
      return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          <View style={styles.switchCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subOptionTitle}>Bật hẹn giờ ngủ</Text>
              <Text style={styles.subOptionDesc}>
                Tự động tạm dừng phim khi hết thời gian
              </Text>
            </View>
            <Switch
              value={sleepTimerValue !== null}
              trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
              onValueChange={(on) => {
                Haptics.selectionAsync();
                onSelectSleepTimer(on ? 'end_of_episode' : null);
              }}
            />
          </View>
          <View style={styles.chipsGrid}>
            {SLEEP_OPTIONS.map((opt) => {
              const sel = sleepTimerValue === opt.value;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[styles.choiceChip, sel && styles.choiceChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onSelectSleepTimer(opt.value);
                  }}
                >
                  <Text style={styles.choiceChipTxt}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      );
    }

    if (subView === 'next_delay') {
      return (
        <View style={styles.subCenterWrap}>
          <Text style={styles.bigDelayReadout}>{settings.nextEpisodeDelaySec} giây</Text>
          <Text style={styles.subHelperTxt}>
            Thời gian đếm ngược trước khi tự động chuyển sang tập kế tiếp (0 giây để chuyển ngay lập tức)
          </Text>
          <View style={styles.chipsGrid}>
            {NEXT_DELAY_OPTIONS.map((sec) => {
              const sel = settings.nextEpisodeDelaySec === sec;
              return (
                <TouchableOpacity
                  key={sec}
                  style={[styles.choiceChip, sel && styles.choiceChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    void updateSetting('nextEpisodeDelaySec', sec);
                  }}
                >
                  <Text style={styles.choiceChipTxt}>{sec}s</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        <View style={styles.topUtilityRow}>
          <View style={styles.clockPill}>
            <Text style={styles.clockTime}>{dt.time}</Text>
            <Text style={styles.clockDate}>{dt.date}</Text>
          </View>
          <View style={styles.searchPill}>
            <Ionicons name="search" size={15} color="rgba(255,255,255,0.6)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Tìm kiếm cài đặt..."
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        <View style={styles.tilesGrid}>
          {visibleTiles.map((tile) => (
            <TouchableOpacity
              key={tile.id}
              activeOpacity={0.8}
              style={[
                styles.gridTile,
                tile.active && styles.gridTileActive,
                !isLandscape && { width: '48.2%' },
              ]}
              onPress={tile.onPress}
            >
              <Ionicons
                name={tile.icon}
                size={21}
                color={tile.active ? '#FFF' : 'rgba(255,255,255,0.78)'}
              />
              <Text style={styles.tileLabel} numberOfLines={1}>
                {tile.title}
              </Text>
              <View style={styles.tileStatusRow}>
                {'dotColor' in tile && tile.dotColor ? (
                  <View style={[styles.statusDot, { backgroundColor: tile.dotColor }]} />
                ) : null}
                <Text style={styles.tileStatus} numberOfLines={1}>
                  {tile.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    );
  };

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
        <GlassSurface
          variant="liquid"
          radius={40}
          intensity={85}
          style={[styles.cardWrap, { width: cardWidth, height: cardHeight }]}
        >
          <View style={styles.inner}>
            <View style={styles.header}>
              {subView !== 'grid' ? (
                <TouchableOpacity
                  style={styles.iconCircleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSubView('grid');
                  }}
                >
                  <Ionicons name="chevron-back" size={20} color="#FFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.iconCircleBtn} onPress={handleRebootConfirm}>
                  <Ionicons name="refresh" size={18} color="#FFF" />
                </TouchableOpacity>
              )}

              <Text style={styles.headerTitle}>{renderSubViewTitle()}</Text>

              <TouchableOpacity
                style={styles.iconCircleBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                }}
              >
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            {renderContent()}
          </View>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  cardWrap: {
    borderRadius: 40,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  iconCircleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '800',
  },
  topUtilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  clockPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  clockTime: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  clockDate: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 10.5,
  },
  searchPill: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 20,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 13,
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridTile: {
    width: '23.8%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 22,
    paddingHorizontal: 10,
    paddingVertical: 11,
    alignItems: 'center',
    gap: 4,
  },
  gridTileActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.28)',
  },
  tileLabel: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  tileStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  tileStatus: {
    color: 'rgba(255, 255, 255, 0.68)',
    fontSize: 10.5,
    textAlign: 'center',
  },
  subOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  subOptionRowSelected: {
    backgroundColor: 'rgba(229, 9, 20, 0.28)',
  },
  subOptionTitle: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  subOptionDesc: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11.5,
    marginTop: 2,
  },
  subCenterWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  subHelperTxt: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: 14,
  },
  bigDelayReadout: {
    color: '#FFF',
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  choiceChip: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  choiceChipActive: {
    backgroundColor: COLORS.accent,
  },
  choiceChipTxt: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  switchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
});
