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
import { Feather, Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppAlert } from './AppAlertModal';
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

type GeneralSubView = 'main' | 'contrast' | 'hold_speed' | 'sleep_timer' | 'next_delay';

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

interface GroupedRowItem {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  badgeColor: string;
  title: string;
  subtitle?: string;
  keywords: string;
  kind: 'switch' | 'nav';
  switchValue?: boolean;
  valueText?: string;
  dotColor?: string;
  onPress?: () => void;
  onToggle?: (next: boolean) => void;
}

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

/**
 * Grouped Inset iOS Liquid Glass Settings sheet inside Player.
 */
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

  const [subView, setSubView] = useState<GeneralSubView>('main');
  const [searchQuery, setSearchQuery] = useState('');
  const [clockNow, setClockNow] = useState(() => new Date());

  useEffect(() => {
    if (!visible) {
      setSubView('main');
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
        return { text: 'Đang chuẩn bị', dotColor: '#FFD60A' };
      case 'failed':
        return { text: 'Tạm gián đoạn', dotColor: '#FF453A' };
      case 'no_data':
        return { text: 'Tập cuối', dotColor: '#8E8E93' };
      default:
        return { text: 'Đang chờ', dotColor: '#FF9F0A' };
    }
  }, [settings.seamlessPreloadEnabled, preloadState]);

  const sleepStatusLabel = useMemo(() => {
    if (sleepTimerValue === null) return 'Tắt';
    if (sleepTimerValue === 'end_of_episode') return 'Hết tập';
    if (sleepSecondsLeft !== null && sleepSecondsLeft > 0) {
      const m = Math.ceil(sleepSecondsLeft / 60);
      return `${m} phút`;
    }
    return sleepTimerValue === 60 ? '1 giờ' : `${sleepTimerValue} phút`;
  }, [sleepTimerValue, sleepSecondsLeft]);

  const sections = useMemo<{ header: string; rows: GroupedRowItem[] }[]>(
    () => [
      {
        header: 'HÌNH ẢNH & HIỂN THỊ',
        rows: [
          {
            id: 'contrast',
            icon: 'contrast-outline',
            badgeColor: '#5E5CE6',
            title: 'Độ tương phản hình ảnh',
            subtitle: 'Tinh chỉnh sắc nét & dải tối sáng',
            keywords: 'tuong phan sac net mau hinh anh',
            kind: 'nav',
            valueText: settings.contrastLevel,
            onPress: () => {
              Haptics.selectionAsync();
              setSubView('contrast');
            },
          },
          {
            id: 'pip',
            icon: 'albums-outline',
            badgeColor: '#0A84FF',
            title: 'Thu nhỏ khung hình',
            subtitle: 'Xem nổi khi thoát ra màn hình chính',
            keywords: 'thu nho khung hinh pip thoat ra man hinh chinh',
            kind: 'switch',
            switchValue: settings.pipEnabled,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('pipEnabled', v);
            },
          },
          {
            id: 'resume_home',
            icon: 'bookmark-outline',
            badgeColor: '#32ADE6',
            title: 'Ghi nhớ mục Đang xem',
            subtitle: 'Đồng bộ tiến trình lên Trang chủ',
            keywords: 'tiep tuc xem trang chu ghi nho',
            kind: 'switch',
            switchValue: settings.resumeOnHome,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('resumeOnHome', v);
            },
          },
        ],
      },
      {
        header: 'PHÁT TẬP & CHUYỂN CẢNH',
        rows: [
          {
            id: 'skip_intro',
            icon: 'play-skip-forward',
            badgeColor: '#E50914',
            title: 'Bỏ qua đoạn giới thiệu',
            subtitle: 'Tự tua qua phần mở đầu khi phát',
            keywords: 'bo qua mo dau gioi thieu intro',
            kind: 'switch',
            switchValue: settings.autoSkipIntro,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('autoSkipIntro', v);
            },
          },
          {
            id: 'tdmtm',
            icon: 'volume-high',
            badgeColor: '#FF2D55',
            title: 'Tự động thuyết minh',
            subtitle: 'Giữ nguyên giọng đọc khi sang tập mới',
            keywords: 'tu dong thuyet minh tap tiep theo',
            kind: 'switch',
            switchValue: settings.autoDubNext,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('autoDubNext', v);
            },
          },
          {
            id: 'seamless',
            icon: 'link',
            badgeColor: '#30D158',
            title: 'Xem liền mạch tập kế tiếp',
            subtitle: preloadBadge.text,
            dotColor: preloadBadge.dotColor,
            keywords: 'xem lien mach tai truoc chuyen tap',
            kind: 'switch',
            switchValue: settings.seamlessPreloadEnabled,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('seamlessPreloadEnabled', v);
            },
          },
          {
            id: 'transition',
            icon: 'sparkles',
            badgeColor: '#BF5AF2',
            title: 'Hiệu ứng chuyển tập mượt',
            keywords: 'hieu ung chuyen canh muot ma',
            kind: 'switch',
            switchValue: settings.transitionEffectEnabled,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('transitionEffectEnabled', v);
            },
          },
          {
            id: 'next_delay',
            icon: 'timer-outline',
            badgeColor: '#FF9F0A',
            title: 'Thời gian chờ chuyển tập',
            keywords: 'cho chuyen tap dem nguoc giay',
            kind: 'nav',
            valueText: `${settings.nextEpisodeDelaySec} giây`,
            onPress: () => {
              Haptics.selectionAsync();
              setSubView('next_delay');
            },
          },
        ],
      },
      {
        header: 'ĐIỀU KHIỂN & TIỆN ÍCH',
        rows: [
          {
            id: 'hold_speed',
            icon: 'flash',
            badgeColor: '#FFD60A',
            title: 'Tốc độ chạm giữ tua nhanh',
            keywords: 'toc do giu tua cham man hinh 2x',
            kind: 'nav',
            valueText: `${settings.holdSeekSpeed}x`,
            onPress: () => {
              Haptics.selectionAsync();
              setSubView('hold_speed');
            },
          },
          {
            id: 'seek_warn',
            icon: 'warning-outline',
            badgeColor: '#FF6B6B',
            title: 'Xác nhận khi tua xa',
            subtitle: 'Hiện nút quay lại vị trí vừa xem',
            keywords: 'canh bao tua nhanh quay lai vi tri cu',
            kind: 'switch',
            switchValue: settings.seekWarningEnabled,
            onToggle: (v) => {
              Haptics.selectionAsync();
              void updateSetting('seekWarningEnabled', v);
            },
          },
          {
            id: 'sleep',
            icon: 'moon',
            badgeColor: '#5856D6',
            title: 'Hẹn giờ tắt phim',
            keywords: 'hen gio ngu tat phim ban dem',
            kind: 'nav',
            valueText: sleepStatusLabel,
            onPress: () => {
              Haptics.selectionAsync();
              setSubView('sleep_timer');
            },
          },
          {
            id: 'dvacast',
            icon: 'tv-outline',
            badgeColor: '#00C7BE',
            title: 'Chiếu lên TV (Quét QR)',
            keywords: 'quet ma qr chieu tv dva cast',
            kind: 'nav',
            valueText: 'Mở',
            onPress: () => {
              Haptics.selectionAsync();
              onClose();
              onOpenCast();
            },
          },
        ],
      },
    ],
    [
      settings,
      preloadBadge,
      sleepStatusLabel,
      updateSetting,
      onClose,
      onOpenCast,
    ]
  );

  const visibleSections = useMemo(() => {
    const q = searchQuery
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!q) return sections;
    return sections
      .map((sec) => ({
        ...sec,
        rows: sec.rows.filter((r) => {
          const tNorm = r.title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          return tNorm.includes(q) || r.keywords.includes(q);
        }),
      }))
      .filter((sec) => sec.rows.length > 0);
  }, [sections, searchQuery]);

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(620, winWidth - Math.max(36, insets.left + insets.right + 20))
    : Math.min(460, winWidth - 20);
  const cardHeight = isLandscape
    ? Math.min(362, winHeight - 14)
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
      main: 'Cài đặt trình phát',
      contrast: 'Độ Tương Phản',
      hold_speed: 'Tốc Độ Giữ Tua',
      sleep_timer: 'Hẹn Giờ Tắt Phim',
      next_delay: 'Chờ Chuyển Tập',
    };
    return map[subView];
  };

  const renderContent = () => {
    if (subView === 'contrast') {
      return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
          <View style={styles.insetGroup}>
            {CONTRAST_OPTIONS.map((opt, idx) => {
              const selected = settings.contrastLevel === opt.value;
              return (
                <React.Fragment key={opt.value}>
                  {idx > 0 ? <View style={styles.rowDividerPlain} /> : null}
                  <TouchableOpacity
                    activeOpacity={0.78}
                    style={styles.subOptionRow}
                    onPress={() => {
                      Haptics.selectionAsync();
                      void updateSetting('contrastLevel', opt.value);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{opt.value}</Text>
                      <Text style={styles.rowSubtitle}>{opt.desc}</Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark" size={20} color={COLORS.accent} />
                    ) : null}
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
          <View style={styles.insetGroup}>
            <View style={styles.groupedRow}>
              <View style={[styles.iosBadge, { backgroundColor: '#5856D6' }]}>
                <Ionicons name="moon" size={16} color="#FFFFFF" />
              </View>
              <View style={styles.rowTextCol}>
                <Text style={styles.rowTitle}>Bật hẹn giờ tắt phim</Text>
                <Text style={styles.rowSubtitle}>Tự động tạm dừng khi hết thời gian</Text>
              </View>
              <Switch
                value={sleepTimerValue !== null}
                trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                thumbColor="#FFFFFF"
                onValueChange={(on) => {
                  Haptics.selectionAsync();
                  onSelectSleepTimer(on ? 'end_of_episode' : null);
                }}
              />
            </View>
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
            Thời gian đếm ngược trước khi tự động chuyển sang tập kế tiếp
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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 10 }}>
        {/* Clock + Search Pill */}
        <View style={styles.topUtilityRow}>
          <View style={styles.searchPill}>
            <Ionicons name="search" size={15} color="rgba(255,255,255,0.55)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Tìm kiếm cài đặt..."
              placeholderTextColor="rgba(255,255,255,0.42)"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <View style={styles.clockPill}>
            <Text style={styles.clockTime}>{dt.time}</Text>
            <Text style={styles.clockDate}>{dt.date}</Text>
          </View>
        </View>

        {visibleSections.map((sec) => (
          <View key={sec.header}>
            <Text style={styles.sectionHeader}>{sec.header}</Text>
            <View style={styles.insetGroup}>
              {sec.rows.map((row, idx) => (
                <React.Fragment key={row.id}>
                  {idx > 0 ? <View style={styles.rowDividerInset} /> : null}
                  {row.kind === 'nav' ? (
                    <TouchableOpacity
                      activeOpacity={0.76}
                      style={styles.groupedRow}
                      onPress={row.onPress}
                    >
                      <View style={[styles.iosBadge, { backgroundColor: row.badgeColor }]}>
                        <Ionicons name={row.icon} size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.rowTextCol}>
                        <Text style={styles.rowTitle}>{row.title}</Text>
                        {row.subtitle ? (
                          <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
                        ) : null}
                      </View>
                      {row.valueText ? (
                        <Text style={styles.rowValueText}>{row.valueText}</Text>
                      ) : null}
                      <Feather name="chevron-right" size={16} color="rgba(255,255,255,0.38)" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.groupedRow}>
                      <View style={[styles.iosBadge, { backgroundColor: row.badgeColor }]}>
                        <Ionicons name={row.icon} size={16} color="#FFFFFF" />
                      </View>
                      <View style={styles.rowTextCol}>
                        <Text style={styles.rowTitle}>{row.title}</Text>
                        {row.subtitle ? (
                          <View style={styles.subStatusLine}>
                            {row.dotColor ? (
                              <View style={[styles.statusDot, { backgroundColor: row.dotColor }]} />
                            ) : null}
                            <Text style={styles.rowSubtitle}>{row.subtitle}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Switch
                        value={Boolean(row.switchValue)}
                        trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
                        thumbColor="#FFFFFF"
                        onValueChange={(next) => row.onToggle?.(next)}
                      />
                    </View>
                  )}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}
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

        <View style={[styles.sheetCard, { width: cardWidth, height: cardHeight }]}>
          <BlurView intensity={78} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.sheetDarkTint} />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.15)', 'rgba(255,255,255,0)']}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.sheetTopSheen}
          />

          <View style={styles.inner}>
            <View style={styles.header}>
              {subView !== 'main' ? (
                <TouchableOpacity
                  style={styles.iconCircleBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSubView('main');
                  }}
                >
                  <Ionicons name="chevron-back" size={19} color="#FFFFFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.iconCircleBtn} onPress={handleRebootConfirm}>
                  <Feather name="rotate-cw" size={16} color="#FFFFFF" />
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
                <Ionicons name="close" size={19} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {renderContent()}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  sheetCard: {
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 32,
  },
  sheetDarkTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(13, 16, 24, 0.8)',
  },
  sheetTopSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  iconCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  topUtilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchPill: {
    flex: 1,
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13.5,
  },
  clockPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 4,
    alignItems: 'flex-end',
  },
  clockTime: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  clockDate: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 9.5,
  },
  sectionHeader: {
    color: 'rgba(255, 255, 255, 0.48)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    marginLeft: 8,
  },
  insetGroup: {
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 0.75,
    borderColor: 'rgba(255, 255, 255, 0.09)',
    overflow: 'hidden',
  },
  groupedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 10,
    gap: 12,
  },
  iosBadge: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextCol: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  rowSubtitle: {
    color: 'rgba(255, 255, 255, 0.52)',
    fontSize: 11,
    marginTop: 1,
  },
  subStatusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  statusDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.5,
  },
  rowValueText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  rowDividerInset: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginLeft: 55,
  },
  rowDividerPlain: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginLeft: 14,
  },
  subOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 12,
    gap: 10,
  },
  subCenterWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  subHelperTxt: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: 14,
  },
  bigDelayReadout: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 9,
  },
  choiceChip: {
    paddingHorizontal: 17,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  choiceChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  choiceChipTxt: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
});
