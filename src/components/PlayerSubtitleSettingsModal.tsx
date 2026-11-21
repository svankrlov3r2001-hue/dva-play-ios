import React, { useMemo, useState } from 'react';
import {
  FlatList,
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
import {
  AI_VOICE_OPTIONS,
  computeAutoSubtitleLayout,
  SUBTITLE_COLOR_PALETTE,
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_OUTLINE_OPTIONS,
  TRANSLATE_LANGUAGES,
} from '../services/subtitleService';
import { SubtitleColorOption } from '../types/models';

type SubSettingsView =
  | 'grid'
  | 'font'
  | 'color'
  | 'layout'
  | 'outline'
  | 'delay'
  | 'extend'
  | 'translate'
  | 'aivoice';

interface PlayerSubtitleSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  subHighRaw?: string;
}

const FONT_STEP_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const VOLUME_VALUES = [0, 20, 40, 60, 80, 100];

export function PlayerSubtitleSettingsModal({
  visible,
  onClose,
  subHighRaw,
}: PlayerSubtitleSettingsModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const { settings, updateSetting, updateSettingsBatch, resetSubtitleSettings } = useSettings();

  const [subView, setSubView] = useState<SubSettingsView>('grid');
  const [langQuery, setLangQuery] = useState('');

  const filteredLanguages = useMemo(() => {
    const q = langQuery
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!q) return TRANSLATE_LANGUAGES;
    return TRANSLATE_LANGUAGES.filter((l) => {
      const nameNorm = l.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return nameNorm.includes(q) || l.code.toLowerCase().includes(q);
    });
  }, [langQuery]);

  const autoDefaults = useMemo(
    () => computeAutoSubtitleLayout(winHeight, subHighRaw),
    [winHeight, subHighRaw]
  );

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(540, winWidth - Math.max(40, insets.left + insets.right + 20))
    : Math.min(440, winWidth - 24);
  const cardHeight = isLandscape
    ? Math.min(352, winHeight - 18)
    : Math.min(winHeight * 0.82, 600);

  const handleClose = () => {
    setSubView('grid');
    setLangQuery('');
    onClose();
  };

  const handleResetAll = () => {
    Haptics.selectionAsync();
    showAppAlert(
      'Xác nhận đặt lại',
      'Bạn có chắc muốn đặt lại tất cả cài đặt phụ đề về mặc định không?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Đặt lại',
          style: 'destructive',
          onPress: () => {
            void resetSubtitleSettings();
          },
        },
      ]
    );
  };

  const handleToggleVi = () => {
    Haptics.selectionAsync();
    const nextVi = !settings.subShowVi;
    if (!nextVi && !settings.subShowEn) {
      void updateSettingsBatch({ subShowVi: false, subShowEn: true });
    } else {
      void updateSetting('subShowVi', nextVi);
    }
  };

  const handleToggleEn = () => {
    Haptics.selectionAsync();
    const nextEn = !settings.subShowEn;
    if (!nextEn && !settings.subShowVi) {
      void updateSettingsBatch({ subShowVi: true, subShowEn: false });
    } else {
      void updateSetting('subShowEn', nextEn);
    }
  };

  const activeFontLabel =
    SUBTITLE_FONT_OPTIONS.find((f) => f.value === settings.subFont)?.label || 'Ahri';
  const activeColorLabel =
    SUBTITLE_COLOR_PALETTE[settings.subColor]?.label || 'Trắng';
  const activeOutlineLabel =
    SUBTITLE_OUTLINE_OPTIONS.find((o) => o.value === settings.subOutline)?.label || 'Đồng nhất 2';
  const activeTransLabel = settings.subTranslateLang
    ? TRANSLATE_LANGUAGES.find((l) => l.code === settings.subTranslateLang)?.name ||
      settings.subTranslateLang
    : 'Tắt dịch';
  const activeVoiceLabel = settings.subAiVoiceEnabled
    ? AI_VOICE_OPTIONS.find((v) => v.value === settings.subAiVoiceMode)?.label || 'Tùy biến'
    : 'Đang tắt';

  const renderHeaderTitle = () => {
    const map: Record<SubSettingsView, string> = {
      grid: 'Chỉnh Phụ Đề',
      font: 'Chọn Phông Chữ',
      color: 'Chọn Màu Chữ',
      layout: 'Kích Thước & Vị Trí',
      outline: 'Chọn Kiểu Viền',
      delay: 'Độ Trễ Phụ Đề (Giây)',
      extend: 'Kéo Dài Thời Gian (Giây)',
      translate: 'Dịch Ngôn Ngữ',
      aivoice: 'Giọng Thuyết Minh',
    };
    return map[subView];
  };

  const renderBody = () => {
    if (subView === 'grid') {
      return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          <View style={styles.langToggleRow}>
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.langPill, settings.subShowVi && styles.langPillActive]}
              onPress={handleToggleVi}
            >
              <Text style={styles.langPillTxt}>Tiếng Việt</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.swapBtn, settings.subReverse && styles.swapBtnActive]}
              onPress={() => {
                Haptics.selectionAsync();
                void updateSetting('subReverse', !settings.subReverse);
              }}
            >
              <Ionicons name="swap-vertical" size={18} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.langPill, settings.subShowEn && styles.langPillActive]}
              onPress={handleToggleEn}
            >
              <Text style={styles.langPillTxt}>Tiếng Anh</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tilesGrid}>
            <TouchableOpacity style={styles.tileBtn} onPress={() => setSubView('font')}>
              <Ionicons name="text-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Phông chữ</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeFontLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileBtn} onPress={() => setSubView('color')}>
              <Ionicons name="color-palette-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Màu sắc</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeColorLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileBtn} onPress={() => setSubView('layout')}>
              <Ionicons name="resize-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Kích thước</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {settings.subAutoLayout ? 'Tự động' : `Cỡ ${settings.subFontSizeStep}`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileBtn} onPress={() => setSubView('outline')}>
              <Ionicons name="sparkles-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Viền chữ</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeOutlineLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileBtn} onPress={() => setSubView('delay')}>
              <Ionicons name="hourglass-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Độ trễ</Text>
              <Text style={styles.tileSub}>{settings.subDelaySec.toFixed(2)} s</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileBtn} onPress={() => setSubView('extend')}>
              <Ionicons name="swap-horizontal-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Kéo dài</Text>
              <Text style={styles.tileSub}>{settings.subExtendSec.toFixed(2)} s</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tileBtn, Boolean(settings.subTranslateLang) && styles.tileBtnActive]}
              onPress={() => setSubView('translate')}
            >
              <Ionicons name="language-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Ngôn ngữ</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeTransLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tileBtn, settings.subAiVoiceEnabled && styles.tileBtnActive]}
              onPress={() => setSubView('aivoice')}
            >
              <Ionicons name="headset-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Thuyết minh</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeVoiceLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.tileBtn} onPress={handleResetAll}>
              <Ionicons name="refresh-outline" size={20} color="#FCA5A5" />
              <Text style={[styles.tileTitle, { color: '#FECACA' }]}>Đặt lại</Text>
              <Text style={styles.tileSub}>Mặc định</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      );
    }

    if (subView === 'font') {
      return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {SUBTITLE_FONT_OPTIONS.map((opt) => {
            const selected = settings.subFont === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.listOption, selected && styles.listOptionSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subFont', opt.value);
                }}
              >
                <Text
                  style={[
                    styles.listOptionTxt,
                    opt.iosFontFamily ? { fontFamily: opt.iosFontFamily } : undefined,
                  ]}
                >
                  {opt.label}
                </Text>
                {selected ? <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      );
    }

    if (subView === 'color') {
      const keys = Object.keys(SUBTITLE_COLOR_PALETTE) as SubtitleColorOption[];
      return (
        <View style={styles.colorGrid}>
          {keys.map((key) => {
            const c = SUBTITLE_COLOR_PALETTE[key];
            const selected = settings.subColor === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.colorCell, selected && styles.colorCellSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subColor', key);
                }}
              >
                <View style={[styles.colorSwatch, { backgroundColor: c.main }]} />
                <Text style={styles.colorLabel}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (subView === 'layout') {
      return (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.switchTitle}>Tự động cân chỉnh phụ đề</Text>
              <Text style={styles.switchSub}>
                Tự tối ưu cỡ chữ ({autoDefaults.fontStep}) và vị trí ({autoDefaults.positionPct}%)
              </Text>
            </View>
            <Switch
              value={settings.subAutoLayout}
              trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
              onValueChange={(val) => {
                Haptics.selectionAsync();
                void updateSetting('subAutoLayout', val);
              }}
            />
          </View>

          <View style={{ opacity: settings.subAutoLayout ? 0.45 : 1, gap: 12 }}>
            <View>
              <View style={styles.stepperHeader}>
                <Text style={styles.switchTitle}>Cỡ chữ</Text>
                <Text style={styles.valBadge}>Mức {settings.subFontSizeStep}</Text>
              </View>
              <View style={styles.chipsWrap}>
                {FONT_STEP_VALUES.map((n) => {
                  const sel = settings.subFontSizeStep === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      disabled={settings.subAutoLayout}
                      style={[styles.smallChip, sel && styles.smallChipActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        void updateSetting('subFontSizeStep', n);
                      }}
                    >
                      <Text style={styles.smallChipTxt}>{n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View>
              <View style={styles.stepperHeader}>
                <Text style={styles.switchTitle}>Vị trí từ dưới lên</Text>
                <Text style={styles.valBadge}>{settings.subPositionPct}%</Text>
              </View>
              <View style={styles.stepperControls}>
                <TouchableOpacity
                  disabled={settings.subAutoLayout}
                  style={styles.stepBtn}
                  onPress={() =>
                    void updateSetting(
                      'subPositionPct',
                      Math.max(-5, (settings.subPositionPct ?? 4) - 5)
                    )
                  }
                >
                  <Text style={styles.stepBtnTxt}>-5%</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={settings.subAutoLayout}
                  style={styles.stepBtn}
                  onPress={() =>
                    void updateSetting(
                      'subPositionPct',
                      Math.max(-5, (settings.subPositionPct ?? 4) - 1)
                    )
                  }
                >
                  <Text style={styles.stepBtnTxt}>-1%</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={settings.subAutoLayout}
                  style={styles.stepBtn}
                  onPress={() => void updateSetting('subPositionPct', autoDefaults.positionPct)}
                >
                  <Text style={styles.stepBtnTxt}>Chuẩn</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={settings.subAutoLayout}
                  style={styles.stepBtn}
                  onPress={() =>
                    void updateSetting(
                      'subPositionPct',
                      Math.min(40, (settings.subPositionPct ?? 4) + 1)
                    )
                  }
                >
                  <Text style={styles.stepBtnTxt}>+1%</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={settings.subAutoLayout}
                  style={styles.stepBtn}
                  onPress={() =>
                    void updateSetting(
                      'subPositionPct',
                      Math.min(40, (settings.subPositionPct ?? 4) + 5)
                    )
                  }
                >
                  <Text style={styles.stepBtnTxt}>+5%</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      );
    }

    if (subView === 'outline') {
      return (
        <View style={styles.outlineGrid}>
          {SUBTITLE_OUTLINE_OPTIONS.map((opt) => {
            const selected = settings.subOutline === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[styles.outlineCell, selected && styles.listOptionSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subOutline', opt.value);
                }}
              >
                <Text style={styles.listOptionTxt}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (subView === 'delay' || subView === 'extend') {
      const isDelay = subView === 'delay';
      const val = isDelay ? settings.subDelaySec : settings.subExtendSec;
      const updateDelta = (delta: number) => {
        Haptics.selectionAsync();
        const next = Math.max(-30, Math.min(30, Math.round((val + delta) * 100) / 100));
        void updateSetting(isDelay ? 'subDelaySec' : 'subExtendSec', next);
      };
      return (
        <View style={styles.timeAdjustBox}>
          <Text style={styles.timeBigValue}>{val.toFixed(2)} s</Text>
          <Text style={styles.switchSub}>
            {isDelay
              ? 'Âm (-) để phụ đề hiện sớm hơn, dương (+) để hiện trễ hơn'
              : 'Tăng thêm thời lượng hiển thị mỗi câu phụ đề (-30s đến +30s)'}
          </Text>
          <View style={styles.stepperControls}>
            {[-5, -1, -0.25, 0.25, 1, 5].map((d) => (
              <TouchableOpacity
                key={d}
                style={styles.stepBtn}
                onPress={() => updateDelta(d)}
              >
                <Text style={styles.stepBtnTxt}>
                  {d > 0 ? `+${d}` : `${d}`}s
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={styles.resetInlineBtn}
            onPress={() => void updateSetting(isDelay ? 'subDelaySec' : 'subExtendSec', 0)}
          >
            <Text style={styles.stepBtnTxt}>Về 0.00 s (Mặc định)</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (subView === 'translate') {
      return (
        <View style={{ flex: 1, gap: 10 }}>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color="rgba(255,255,255,0.6)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Tìm kiếm ngôn ngữ..."
              placeholderTextColor="rgba(255,255,255,0.45)"
              value={langQuery}
              onChangeText={setLangQuery}
            />
            {settings.subTranslateLang ? (
              <TouchableOpacity
                style={styles.turnOffTag}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subTranslateLang', '');
                }}
              >
                <Text style={styles.turnOffTagTxt}>Tắt dịch</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <FlatList
            data={filteredLanguages}
            keyExtractor={(it) => it.code}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingBottom: 8 }}
            renderItem={({ item }) => {
              const selected = settings.subTranslateLang === item.code;
              return (
                <TouchableOpacity
                  style={[styles.listOption, selected && styles.listOptionSelected]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    void updateSettingsBatch({
                      subTranslateLang: item.code,
                      subShowEn: true,
                    });
                  }}
                >
                  <Text style={styles.listOptionTxt}>{item.name}</Text>
                  {selected ? (
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      );
    }

    // subView === 'aivoice'
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
        {AI_VOICE_OPTIONS.map((opt) => {
          const isSelected =
            opt.value === 'none'
              ? !settings.subAiVoiceEnabled
              : settings.subAiVoiceEnabled && settings.subAiVoiceMode === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.listOption, isSelected && styles.listOptionSelected]}
              onPress={() => {
                Haptics.selectionAsync();
                if (opt.value === 'none') {
                  void updateSetting('subAiVoiceEnabled', false);
                } else {
                  void updateSettingsBatch({
                    subAiVoiceEnabled: true,
                    subAiVoiceMode: opt.value,
                  });
                }
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.listOptionTxt}>{opt.label}</Text>
                <Text style={styles.switchSub}>{opt.subtitle}</Text>
              </View>
              {isSelected ? (
                <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              ) : null}
            </TouchableOpacity>
          );
        })}

        <View style={styles.volumeBox}>
          <View style={styles.stepperHeader}>
            <Text style={styles.switchTitle}>Âm lượng thuyết minh</Text>
            <Text style={styles.valBadge}>{settings.subAiVoiceVolume}%</Text>
          </View>
          <View style={styles.chipsWrap}>
            {VOLUME_VALUES.map((vol) => {
              const sel = settings.subAiVoiceVolume === vol;
              return (
                <TouchableOpacity
                  key={vol}
                  style={[styles.smallChip, sel && styles.smallChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    void updateSetting('subAiVoiceVolume', vol);
                  }}
                >
                  <Text style={styles.smallChipTxt}>{vol}%</Text>
                </TouchableOpacity>
              );
            })}
          </View>
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
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
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
                  style={styles.backIconBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSubView('grid');
                  }}
                >
                  <Ionicons name="chevron-back" size={20} color="#FFF" />
                </TouchableOpacity>
              ) : (
                <View style={styles.headerIconPlaceholder} />
              )}
              <Text style={styles.headerTitle}>{renderHeaderTitle()}</Text>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>

            {renderBody()}
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
  headerIconPlaceholder: {
    width: 34,
  },
  backIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 16.5,
    fontWeight: '800',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  langPill: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langPillActive: {
    backgroundColor: COLORS.accent,
  },
  langPillTxt: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  swapBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapBtnActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.65)',
  },
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tileBtn: {
    width: '31.8%',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 22,
    paddingHorizontal: 10,
    paddingVertical: 11,
    alignItems: 'center',
    gap: 4,
  },
  tileBtnActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.25)',
  },
  tileTitle: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  tileSub: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 10.5,
    textAlign: 'center',
  },
  listOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  listOptionSelected: {
    backgroundColor: 'rgba(229, 9, 20, 0.28)',
  },
  listOptionTxt: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorCell: {
    width: '31.2%',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 22,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 8,
  },
  colorCellSelected: {
    backgroundColor: 'rgba(229, 9, 20, 0.32)',
  },
  colorSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  colorLabel: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  switchSub: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 11.5,
    marginTop: 2,
    textAlign: 'center',
  },
  stepperHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  valBadge: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '800',
    backgroundColor: 'rgba(229, 9, 20, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    overflow: 'hidden',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  smallChip: {
    minWidth: 40,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
  },
  smallChipActive: {
    backgroundColor: COLORS.accent,
  },
  smallChipTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  stepperControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  stepBtn: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  stepBtnTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  outlineGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  outlineCell: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 20,
    paddingVertical: 14,
    alignItems: 'center',
  },
  timeAdjustBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  timeBigValue: {
    color: '#FFF',
    fontSize: 30,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  resetInlineBtn: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(229, 9, 20, 0.55)',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 18,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: '#FFF',
    fontSize: 13.5,
  },
  turnOffTag: {
    backgroundColor: 'rgba(229, 9, 20, 0.72)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  turnOffTagTxt: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  volumeBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 22,
    padding: 12,
    marginTop: 4,
  },
});
