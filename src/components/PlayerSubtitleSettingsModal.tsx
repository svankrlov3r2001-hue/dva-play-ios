import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppAlertInlineHost, showAppAlert } from './AppAlertModal';
import { BouncyButton } from './BouncyButton';
import { GlassSurface, WaterDropPopupView } from './GlassSurface';
import { IosRulerSlider } from './IosRulerSlider';
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
  onReloadSubtitles?: () => void | Promise<void>;
  isReloadingSubtitles?: boolean;
  onLivePreviewModeChange?: (mode: 'layout' | 'timing' | null) => void;
}

export function PlayerSubtitleSettingsModal({
  visible,
  onClose,
  subHighRaw,
  onReloadSubtitles,
  isReloadingSubtitles = false,
  onLivePreviewModeChange,
}: PlayerSubtitleSettingsModalProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const { settings, updateSetting, updateSettingsBatch, resetSubtitleSettings } = useSettings();

  const [subView, setSubView] = useState<SubSettingsView>('grid');
  const [langQuery, setLangQuery] = useState('');
  const [activeScrubSlider, setActiveScrubSlider] = useState<
    'fontSize' | 'position' | 'delay' | 'extend' | null
  >(null);
  const chromeAnim = useRef(new Animated.Value(1)).current;
  const fontSizeAnim = useRef(new Animated.Value(1)).current;
  const positionAnim = useRef(new Animated.Value(1)).current;
  const onLivePreviewModeChangeRef = useRef(onLivePreviewModeChange);
  onLivePreviewModeChangeRef.current = onLivePreviewModeChange;

  const {
    chromeOpacity,
    chromeScale,
    chromeTranslateY,
    headerTranslateY,
    fontSizeOpacity,
    fontSizeScale,
    fontSizeTranslateY,
    positionOpacity,
    positionScale,
    positionTranslateY,
  } = useMemo(
    () => ({
      chromeOpacity: chromeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
      chromeScale: chromeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.91, 1],
      }),
      chromeTranslateY: chromeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 0],
      }),
      headerTranslateY: chromeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-8, 0],
      }),
      fontSizeOpacity: fontSizeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
      fontSizeScale: fontSizeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.91, 1],
      }),
      fontSizeTranslateY: fontSizeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 0],
      }),
      positionOpacity: positionAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
        extrapolate: 'clamp',
      }),
      positionScale: positionAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.91, 1],
      }),
      positionTranslateY: positionAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [10, 0],
      }),
    }),
    [chromeAnim, fontSizeAnim, positionAnim]
  );

  useEffect(() => {
    const mode: 'layout' | 'timing' | null =
      activeScrubSlider === 'fontSize' || activeScrubSlider === 'position'
        ? 'layout'
        : activeScrubSlider === 'delay' || activeScrubSlider === 'extend'
          ? 'timing'
          : null;
    onLivePreviewModeChangeRef.current?.(visible ? mode : null);

    const animateValue = (anim: Animated.Value, target: 0 | 1) =>
      target === 0
        ? Animated.timing(anim, {
            toValue: 0,
            duration: 170,
            useNativeDriver: true,
          })
        : Animated.spring(anim, {
            toValue: 1,
            stiffness: 210,
            damping: 11,
            mass: 0.9,
            useNativeDriver: true,
          });

    const chromeTarget: 0 | 1 = activeScrubSlider ? 0 : 1;
    const fontSizeTarget: 0 | 1 = activeScrubSlider === 'position' ? 0 : 1;
    const positionTarget: 0 | 1 = activeScrubSlider === 'fontSize' ? 0 : 1;

    chromeAnim.stopAnimation();
    fontSizeAnim.stopAnimation();
    positionAnim.stopAnimation();

    Animated.parallel([
      animateValue(chromeAnim, chromeTarget),
      animateValue(fontSizeAnim, fontSizeTarget),
      animateValue(positionAnim, positionTarget),
    ]).start();
  }, [activeScrubSlider, visible, chromeAnim, fontSizeAnim, positionAnim]);

  useEffect(() => {
    setActiveScrubSlider(null);
    if (!visible) {
      chromeAnim.setValue(1);
      fontSizeAnim.setValue(1);
      positionAnim.setValue(1);
    }
  }, [subView, visible, chromeAnim, fontSizeAnim, positionAnim]);

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
    ? Math.min(580, winWidth - Math.max(40, insets.left + insets.right + 20))
    : Math.min(440, winWidth - 24);
  const cardHeight = isLandscape
    ? Math.min(362, winHeight - 14)
    : Math.min(winHeight * 0.84, 620);

  const handleClose = () => {
    setActiveScrubSlider(null);
    setSubView('grid');
    setLangQuery('');
    onLivePreviewModeChangeRef.current?.(null);
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
        <ScrollView
          style={styles.scrollBleed}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }}
        >
          <View style={styles.langToggleRow}>
            <BouncyButton
              activeOpacity={0.8}
              style={[styles.langPill, settings.subShowVi && styles.langPillActive]}
              onPress={handleToggleVi}
            >
              <Text style={styles.langPillTxt}>Tiếng Việt</Text>
            </BouncyButton>

            <BouncyButton
              activeOpacity={0.8}
              style={[styles.swapBtn, settings.subReverse && styles.swapBtnActive]}
              onPress={() => {
                Haptics.selectionAsync();
                void updateSetting('subReverse', !settings.subReverse);
              }}
            >
              <Ionicons name="swap-vertical" size={18} color="#FFF" />
            </BouncyButton>

            <BouncyButton
              activeOpacity={0.8}
              style={[styles.langPill, settings.subShowEn && styles.langPillActive]}
              onPress={handleToggleEn}
            >
              <Text style={styles.langPillTxt}>Tiếng Anh</Text>
            </BouncyButton>
          </View>

          <View style={styles.tilesGrid}>
            <BouncyButton style={styles.tileBtn} onPress={() => setSubView('font')}>
              <Ionicons name="text-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Phông chữ</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeFontLabel}
              </Text>
            </BouncyButton>

            <BouncyButton style={styles.tileBtn} onPress={() => setSubView('color')}>
              <Ionicons name="color-palette-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Màu sắc</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeColorLabel}
              </Text>
            </BouncyButton>

            <BouncyButton style={styles.tileBtn} onPress={() => setSubView('layout')}>
              <Ionicons name="resize-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Kích thước & Vị trí</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {settings.subAutoLayout
                  ? 'Tự động'
                  : `Cỡ ${settings.subFontSizeStep} • ${settings.subPositionPct}%`}
              </Text>
            </BouncyButton>

            <BouncyButton style={styles.tileBtn} onPress={() => setSubView('outline')}>
              <Ionicons name="sparkles-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Viền chữ</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeOutlineLabel}
              </Text>
            </BouncyButton>

            <BouncyButton style={styles.tileBtn} onPress={() => setSubView('delay')}>
              <Ionicons name="hourglass-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Độ trễ</Text>
              <Text style={styles.tileSub}>{settings.subDelaySec.toFixed(2)}s</Text>
            </BouncyButton>

            <BouncyButton style={styles.tileBtn} onPress={() => setSubView('extend')}>
              <Ionicons name="swap-horizontal-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Kéo dài</Text>
              <Text style={styles.tileSub}>{settings.subExtendSec.toFixed(2)}s</Text>
            </BouncyButton>

            <BouncyButton
              style={[styles.tileBtn, Boolean(settings.subTranslateLang) && styles.tileBtnActive]}
              onPress={() => setSubView('translate')}
            >
              <Ionicons name="language-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Dịch thuật</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeTransLabel}
              </Text>
            </BouncyButton>

            <BouncyButton
              style={[styles.tileBtn, settings.subAiVoiceEnabled && styles.tileBtnActive]}
              onPress={() => setSubView('aivoice')}
            >
              <Ionicons name="headset-outline" size={20} color="#FFF" />
              <Text style={styles.tileTitle}>Thuyết minh</Text>
              <Text style={styles.tileSub} numberOfLines={1}>
                {activeVoiceLabel}
              </Text>
            </BouncyButton>

            <BouncyButton
              style={[styles.tileBtn, styles.tileBtnReload]}
              disabled={isReloadingSubtitles}
              onPress={() => {
                Haptics.selectionAsync();
                void onReloadSubtitles?.();
              }}
            >
              {isReloadingSubtitles ? (
                <ActivityIndicator size="small" color="#60A5FA" />
              ) : (
                <Feather name="refresh-cw" size={18} color="#60A5FA" />
              )}
              <Text style={[styles.tileTitle, { color: '#93C5FD' }]}>Nạp lại</Text>
              <Text style={styles.tileSub}>Phụ đề & thuyết minh</Text>
            </BouncyButton>
          </View>

          <BouncyButton
            bounciness="gentle"
            activeOpacity={0.8}
            style={styles.resetBannerBtn}
            onPress={handleResetAll}
          >
            <Feather name="rotate-ccw" size={15} color="#FCA5A5" />
            <Text style={styles.resetBannerTxt}>Đặt lại tất cả về mặc định</Text>
          </BouncyButton>
        </ScrollView>
      );
    }

    if (subView === 'font') {
      return (
        <ScrollView
          style={styles.scrollBleed}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }}
        >
          {SUBTITLE_FONT_OPTIONS.map((opt) => {
            const selected = settings.subFont === opt.value;
            return (
              <BouncyButton
                key={opt.value}
                bounciness="gentle"
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
              </BouncyButton>
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
              <BouncyButton
                key={key}
                style={[styles.colorCell, selected && styles.colorCellSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subColor', key);
                }}
              >
                <View style={[styles.colorSwatch, { backgroundColor: c.main }]} />
                <Text style={styles.colorLabel}>{c.label}</Text>
              </BouncyButton>
            );
          })}
        </View>
      );
    }

    if (subView === 'layout') {
      const displayStep = settings.subAutoLayout
        ? autoDefaults.fontStep
        : settings.subFontSizeStep || 18;
      const displayPos = settings.subAutoLayout
        ? autoDefaults.positionPct
        : settings.subPositionPct ?? 12;

      return (
        <ScrollView
          nestedScrollEnabled
          scrollEnabled={activeScrubSlider === null}
          style={styles.scrollBleed}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }}
        >
          <Animated.View
            style={[
              styles.switchRow,
              {
                opacity: chromeOpacity,
                transform: [{ scale: chromeScale }, { translateY: chromeTranslateY }],
              },
            ]}
            pointerEvents={activeScrubSlider ? 'none' : 'auto'}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.switchTitle}>Tự động cân chỉnh phụ đề</Text>
              <Text style={[styles.switchSub, { textAlign: 'left' }]}>
                Tối ưu cỡ {autoDefaults.fontStep} • Vị trí {autoDefaults.positionPct}% (kéo thước để tùy chỉnh)
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
          </Animated.View>

          <Animated.View
            style={{
              opacity: fontSizeOpacity,
              transform: [{ scale: fontSizeScale }, { translateY: fontSizeTranslateY }],
            }}
            pointerEvents={activeScrubSlider === 'position' ? 'none' : 'auto'}
          >
            <IosRulerSlider
              label="Kích cỡ chữ (1 – 20)"
              value={displayStep}
              min={1}
              max={20}
              step={1}
              majorStep={1}
              defaultValue={18}
              valueText={`Cỡ ${displayStep}`}
              tickSpacing={28}
              resetLabel="Cỡ 18"
              onInteractionStart={() => setActiveScrubSlider('fontSize')}
              onInteractionEnd={() =>
                setActiveScrubSlider((cur) => (cur === 'fontSize' ? null : cur))
              }
              onChange={(v) =>
                void updateSettingsBatch({
                  subAutoLayout: false,
                  subFontSizeStep: Math.round(v),
                })
              }
              onReset={() =>
                void updateSettingsBatch({
                  subAutoLayout: false,
                  subFontSizeStep: 18,
                })
              }
            />
          </Animated.View>

          <Animated.View
            style={{
              opacity: positionOpacity,
              transform: [{ scale: positionScale }, { translateY: positionTranslateY }],
            }}
            pointerEvents={activeScrubSlider === 'fontSize' ? 'none' : 'auto'}
          >
            <IosRulerSlider
              label="Vị trí từ dưới lên (-10% – 40%)"
              value={displayPos}
              min={-10}
              max={40}
              step={1}
              majorStep={5}
              defaultValue={12}
              valueText={`${displayPos}%`}
              formatTickLabel={(v) => `${v}%`}
              tickSpacing={14}
              resetLabel="12%"
              onInteractionStart={() => setActiveScrubSlider('position')}
              onInteractionEnd={() =>
                setActiveScrubSlider((cur) => (cur === 'position' ? null : cur))
              }
              onChange={(v) =>
                void updateSettingsBatch({
                  subAutoLayout: false,
                  subPositionPct: Math.round(v),
                })
              }
              onReset={() =>
                void updateSettingsBatch({
                  subAutoLayout: false,
                  subPositionPct: 12,
                })
              }
            />
          </Animated.View>
        </ScrollView>
      );
    }

    if (subView === 'outline') {
      return (
        <View style={styles.outlineGrid}>
          {SUBTITLE_OUTLINE_OPTIONS.map((opt) => {
            const selected = settings.subOutline === opt.value;
            return (
              <BouncyButton
                key={opt.value}
                style={[styles.outlineCell, selected && styles.listOptionSelected]}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subOutline', opt.value);
                }}
              >
                <Text style={styles.listOptionTxt}>{opt.label}</Text>
              </BouncyButton>
            );
          })}
        </View>
      );
    }

    if (subView === 'delay' || subView === 'extend') {
      const isDelay = subView === 'delay';
      const val = isDelay ? settings.subDelaySec : settings.subExtendSec;
      const sliderKind = isDelay ? 'delay' : 'extend';
      const updateDelta = (delta: number) => {
        Haptics.selectionAsync();
        const next = Math.max(-30, Math.min(30, Math.round((val + delta) * 100) / 100));
        void updateSetting(isDelay ? 'subDelaySec' : 'subExtendSec', next);
      };
      return (
        <ScrollView
          nestedScrollEnabled
          scrollEnabled={activeScrubSlider === null}
          style={styles.scrollBleed}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }}
        >
          <IosRulerSlider
            label={isDelay ? 'Độ trễ phụ đề (giây)' : 'Kéo dài hiển thị (giây)'}
            value={val}
            min={-30}
            max={30}
            step={0.25}
            majorStep={1}
            defaultValue={0}
            valueText={`${val > 0 ? '+' : ''}${val.toFixed(2)}s`}
            formatTickLabel={(v) => `${v}s`}
            tickSpacing={11}
            resetLabel="0.00s"
            onInteractionStart={() => setActiveScrubSlider(sliderKind)}
            onInteractionEnd={() =>
              setActiveScrubSlider((cur) => (cur === sliderKind ? null : cur))
            }
            onChange={(v) => void updateSetting(isDelay ? 'subDelaySec' : 'subExtendSec', v)}
            onReset={() => void updateSetting(isDelay ? 'subDelaySec' : 'subExtendSec', 0)}
          />
          <Animated.View
            style={{
              opacity: chromeOpacity,
              gap: 12,
              transform: [{ scale: chromeScale }, { translateY: chromeTranslateY }],
            }}
            pointerEvents={activeScrubSlider ? 'none' : 'auto'}
          >
            <Text style={styles.switchSub}>
              {isDelay
                ? 'Kéo sang trái (-) để phụ đề hiện sớm hơn, sang phải (+) để hiện trễ hơn'
                : 'Kéo dài hoặc rút ngắn thời lượng hiển thị mỗi câu phụ đề (-30s đến +30s)'}
            </Text>
            <View style={styles.stepperControls}>
              {[-5, -1, -0.25, 0.25, 1, 5].map((d) => (
                <BouncyButton
                  key={d}
                  style={styles.stepBtn}
                  onPress={() => updateDelta(d)}
                >
                  <Text style={styles.stepBtnTxt}>
                    {d > 0 ? `+${d}` : `${d}`}s
                  </Text>
                </BouncyButton>
              ))}
            </View>
          </Animated.View>
        </ScrollView>
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
              <BouncyButton
                style={styles.turnOffTag}
                onPress={() => {
                  Haptics.selectionAsync();
                  void updateSetting('subTranslateLang', '');
                }}
              >
                <Text style={styles.turnOffTagTxt}>Tắt dịch</Text>
              </BouncyButton>
            ) : null}
          </View>
          <FlatList
            data={filteredLanguages}
            keyExtractor={(it) => it.code}
            style={styles.scrollBleed}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 }}
            renderItem={({ item }) => {
              const selected = settings.subTranslateLang === item.code;
              return (
                <BouncyButton
                  bounciness="gentle"
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
                </BouncyButton>
              );
            }}
          />
        </View>
      );
    }

    // subView === 'aivoice'
    return (
      <ScrollView
        nestedScrollEnabled
        style={styles.scrollBleed}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 }}
      >
        {AI_VOICE_OPTIONS.map((opt) => {
          const isSelected =
            opt.value === 'none'
              ? !settings.subAiVoiceEnabled
              : settings.subAiVoiceEnabled && settings.subAiVoiceMode === opt.value;
          return (
            <BouncyButton
              key={opt.value}
              bounciness="gentle"
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
                <Text style={[styles.switchSub, { textAlign: 'left' }]}>{opt.subtitle}</Text>
              </View>
              {isSelected ? (
                <Ionicons name="checkmark-circle" size={18} color={COLORS.accent} />
              ) : null}
            </BouncyButton>
          );
        })}

        <View
          style={{
            marginTop: 6,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: 'rgba(255,255,255,0.08)',
          }}
        >
          <IosRulerSlider
            label="Âm lượng thuyết minh"
            value={Math.round(settings.subAiVoiceVolume ?? 80)}
            min={0}
            max={100}
            step={5}
            majorStep={10}
            defaultValue={80}
            valueText={`${Math.round(settings.subAiVoiceVolume ?? 80)}%`}
            formatTickLabel={(v) => `${v}%`}
            tickSpacing={18}
            staggerLabels
            resetLabel="80%"
            onChange={(v) => void updateSetting('subAiVoiceVolume', Math.round(v))}
            onReset={() => void updateSetting('subAiVoiceVolume', 80)}
          />
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
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0, 0, 0, 0.34)', opacity: chromeOpacity },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <WaterDropPopupView visible={visible} from="center">
          <GlassSurface
            variant="liquid"
            radius={40}
            intensity={34}
            noShadow={activeScrubSlider !== null}
            backgroundOpacity={chromeOpacity}
            style={[styles.cardWrap, { width: cardWidth, height: cardHeight }]}
          >
            <View style={styles.inner}>
              <Animated.View
                style={[
                  styles.header,
                  {
                    opacity: chromeOpacity,
                    transform: [{ scale: chromeScale }, { translateY: headerTranslateY }],
                  },
                ]}
                pointerEvents={activeScrubSlider ? 'none' : 'auto'}
              >
                {subView !== 'grid' ? (
                  <BouncyButton
                    style={styles.backIconBtn}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSubView('grid');
                    }}
                  >
                    <Ionicons name="chevron-back" size={20} color="#FFF" />
                  </BouncyButton>
                ) : (
                  <View style={styles.headerIconPlaceholder} />
                )}
                <Text style={styles.headerTitle}>{renderHeaderTitle()}</Text>
                <BouncyButton style={styles.closeBtn} onPress={handleClose}>
                  <Ionicons name="close" size={20} color="#FFF" />
                </BouncyButton>
              </Animated.View>

              {renderBody()}
            </View>
          </GlassSurface>
        </WaterDropPopupView>
        <AppAlertInlineHost active={visible} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
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
  scrollBleed: {
    marginHorizontal: -16,
    marginTop: -6,
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
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.5)',
  },
  tileBtnReload: {
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.32)',
  },
  resetBannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 69, 58, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255, 69, 58, 0.3)',
  },
  resetBannerTxt: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '700',
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
