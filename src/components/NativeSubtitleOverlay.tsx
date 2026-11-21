import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextStyle,
  useWindowDimensions,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer } from 'expo-video';
import {
  AppSettings,
  SubtitleAiVoiceMode,
  SubtitleFontOption,
  SubtitleOutlineOption,
} from '../types/models';
import {
  buildTtsProxyUrl,
  calculateTtsSpeed,
  computeAutoSubtitleLayout,
  getAdaptiveVoiceForTime,
  ParsedVttCue,
  PRE_TRANSLATE_COUNT,
  SUBTITLE_COLOR_PALETTE,
  SUBTITLE_FONT_OPTIONS,
  translateTextViaApi,
} from '../services/subtitleService';

interface NativeSubtitleOverlayProps {
  vnCues: ParsedVttCue[];
  enCues: ParsedVttCue[];
  currentTime: number;
  isPlaying: boolean;
  isMuted?: boolean;
  isInPip: boolean;
  subHighRaw?: string;
  settings: AppSettings;
  episodeSignature: string;
}

function resolveFontFamily(font: SubtitleFontOption): string | undefined {
  const found = SUBTITLE_FONT_OPTIONS.find((f) => f.value === font);
  return found?.iosFontFamily;
}

function OutlinedText({
  text,
  style,
  outline,
}: {
  text: string;
  style: TextStyle;
  outline: SubtitleOutlineOption;
}) {
  if (!text) return null;

  if (outline === 'none') {
    return <Text style={style}>{text}</Text>;
  }

  if (outline === 'shadow') {
    return (
      <Text
        style={[
          style,
          {
            textShadowColor: 'rgba(0,0,0,0.95)',
            textShadowOffset: { width: 2, height: 2 },
            textShadowRadius: 4,
          },
        ]}
      >
        {text}
      </Text>
    );
  }

  if (outline === 'raise') {
    return (
      <Text
        style={[
          style,
          {
            textShadowColor: '#000000',
            textShadowOffset: { width: 2, height: -2 },
            textShadowRadius: 1,
          },
        ]}
      >
        {text}
      </Text>
    );
  }

  if (outline === 'lower') {
    return (
      <Text
        style={[
          style,
          {
            textShadowColor: '#000000',
            textShadowOffset: { width: -2, height: 2 },
            textShadowRadius: 1,
          },
        ]}
      >
        {text}
      </Text>
    );
  }

  // 'uniform' / 'uniform2': multi-directional crisp black stroke matching subtitleUI.php
  const strokeWidth = outline === 'uniform' ? 2 : 1.5;
  const strokeOffsets = [
    { x: -strokeWidth, y: 0 },
    { x: strokeWidth, y: 0 },
    { x: 0, y: -strokeWidth },
    { x: 0, y: strokeWidth },
  ];

  return (
    <View style={styles.strokeContainer}>
      {strokeOffsets.map((off, idx) => (
        <Text
          key={idx}
          style={[
            style,
            styles.strokeLayer,
            {
              color: '#000000',
              transform: [{ translateX: off.x }, { translateY: off.y }],
              textShadowColor: '#000000',
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: outline === 'uniform' ? 4 : 1.5,
            },
          ]}
        >
          {text}
        </Text>
      ))}
      <Text
        style={[
          style,
          {
            textShadowColor: 'rgba(0,0,0,0.9)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: outline === 'uniform' ? 4 : 2,
          },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export function NativeSubtitleOverlay({
  vnCues,
  enCues,
  currentTime,
  isPlaying,
  isMuted = false,
  isInPip,
  subHighRaw,
  settings,
  episodeSignature,
}: NativeSubtitleOverlayProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const [vnMeasuredWidth, setVnMeasuredWidth] = useState(0);
  const [translationVersion, setTranslationVersion] = useState(0);
  const translationCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const prevLangRef = useRef(settings.subTranslateLang);

  // Clear translation cache on language or episode change
  useEffect(() => {
    if (prevLangRef.current !== settings.subTranslateLang) {
      prevLangRef.current = settings.subTranslateLang;
      translationCacheRef.current.clear();
      inFlightKeysRef.current.clear();
      setTranslationVersion((v) => v + 1);
    }
  }, [settings.subTranslateLang]);

  useEffect(() => {
    translationCacheRef.current.clear();
    inFlightKeysRef.current.clear();
    setVnMeasuredWidth(0);
    setTranslationVersion((v) => v + 1);
  }, [episodeSignature]);

  const effectiveTime = currentTime + (settings.subDelaySec || 0);
  const extendSec = settings.subExtendSec || 0;

  const activeVnTopCue = useMemo(() => {
    if (!settings.subShowVi || vnCues.length === 0) return null;
    return (
      vnCues.find(
        (c) => c.isTop && c.start <= effectiveTime && effectiveTime <= c.end + extendSec
      ) || null
    );
  }, [settings.subShowVi, vnCues, effectiveTime, extendSec]);

  const { mainVnCue, mainVnIndex } = useMemo(() => {
    if (!settings.subShowVi && !(settings.subShowEn && settings.subTranslateLang)) {
      return { mainVnCue: null, mainVnIndex: -1 };
    }
    for (let i = 0; i < vnCues.length; i++) {
      const c = vnCues[i];
      if (!c.isTop && c.start <= effectiveTime && effectiveTime <= c.end + extendSec) {
        return { mainVnCue: c, mainVnIndex: i };
      }
    }
    return { mainVnCue: null, mainVnIndex: -1 };
  }, [settings.subShowVi, settings.subShowEn, settings.subTranslateLang, vnCues, effectiveTime, extendSec]);

  const mainEnCue = useMemo(() => {
    if (!settings.subShowEn || settings.subTranslateLang || enCues.length === 0) return null;
    return (
      enCues.find(
        (c) => !c.isTop && c.start <= effectiveTime && effectiveTime <= c.end + extendSec
      ) || null
    );
  }, [settings.subShowEn, settings.subTranslateLang, enCues, effectiveTime, extendSec]);

  // Sliding window translation (current cue + next PRE_TRANSLATE_COUNT cues)
  useEffect(() => {
    const toLang = settings.subTranslateLang;
    if (!settings.subShowEn || !toLang || !mainVnCue || mainVnIndex < 0) return;

    let cancelled = false;
    const ensureTranslated = async (text: string) => {
      if (!text) return;
      const cacheKey = `${toLang}::${text}`;
      if (translationCacheRef.current.has(cacheKey) || inFlightKeysRef.current.has(cacheKey)) {
        return;
      }
      inFlightKeysRef.current.add(cacheKey);
      const translated = await translateTextViaApi(text, toLang);
      inFlightKeysRef.current.delete(cacheKey);
      if (cancelled || prevLangRef.current !== toLang) return;
      if (translated) {
        translationCacheRef.current.set(cacheKey, translated);
        setTranslationVersion((v) => v + 1);
      }
    };

    void ensureTranslated(mainVnCue.text);
    for (let offset = 1; offset <= PRE_TRANSLATE_COUNT; offset++) {
      const nxt = vnCues[mainVnIndex + offset];
      if (nxt && nxt.text && !nxt.isTop) {
        void ensureTranslated(nxt.text);
      }
    }

    // Prune outside sliding window [-10, +20]
    const keepSet = new Set<string>();
    for (let i = Math.max(0, mainVnIndex - 10); i <= Math.min(vnCues.length - 1, mainVnIndex + PRE_TRANSLATE_COUNT); i++) {
      const cue = vnCues[i];
      if (cue?.text) keepSet.add(`${toLang}::${cue.text}`);
    }
    Array.from(translationCacheRef.current.keys()).forEach((k) => {
      if (!keepSet.has(k)) {
        translationCacheRef.current.delete(k);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [settings.subShowEn, settings.subTranslateLang, mainVnCue?.text, mainVnIndex, vnCues]);

  // AI Voice TTS playback synchronized with active VN cue
  const ttsPlayer = useVideoPlayer(null, (p) => {
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = false;
    p.loop = false;
  });
  const ttsLocalCacheRef = useRef<Map<string, string>>(new Map());
  const ttsInFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const lastSpokenSigRef = useRef('');

  useEffect(() => {
    try {
      ttsPlayer.volume = Math.max(0, Math.min(1, (settings.subAiVoiceVolume ?? 80) / 100));
    } catch {}
  }, [ttsPlayer, settings.subAiVoiceVolume]);

  useEffect(() => {
    lastSpokenSigRef.current = '';
    try {
      ttsPlayer.pause();
    } catch {}
    return () => {
      try {
        ttsPlayer.pause();
      } catch {}
    };
  }, [episodeSignature, ttsPlayer]);

  useEffect(() => {
    const activeCue = mainVnCue || activeVnTopCue;
    if (!settings.subAiVoiceEnabled || !isPlaying || isMuted || isInPip || !activeCue) {
      try {
        ttsPlayer.pause();
      } catch {}
      if (!activeCue || !settings.subAiVoiceEnabled) {
        lastSpokenSigRef.current = '';
      }
      return;
    }

    const toLang = settings.subTranslateLang || '';
    const cachedTrans = toLang
      ? translationCacheRef.current.get(`${toLang}::${activeCue.text}`)
      : '';
    const spokenText = (cachedTrans || activeCue.text || '').trim();
    const spokenLang = cachedTrans && toLang ? toLang : 'vi';

    if (!spokenText || spokenText.includes('♪')) {
      try {
        ttsPlayer.pause();
      } catch {}
      return;
    }

    const cueSig = `${episodeSignature}|${activeCue.start}|${spokenText}`;
    if (lastSpokenSigRef.current === cueSig) return;
    lastSpokenSigRef.current = cueSig;

    const voiceMode: SubtitleAiVoiceMode = settings.subAiVoiceMode || 'adaptive';
    const effVoice = getAdaptiveVoiceForTime(voiceMode, activeCue.start);
    const durSec = Math.max(0.4, activeCue.end - activeCue.start);
    const speed = calculateTtsSpeed(spokenText, durSec, effVoice);
    const remoteTtsUrl = buildTtsProxyUrl(spokenText, spokenLang, speed, effVoice);

    const ensureCachedTtsFile = async (url: string): Promise<string | null> => {
      const hit = ttsLocalCacheRef.current.get(url);
      if (hit) return hit;
      const inflight = ttsInFlightRef.current.get(url);
      if (inflight) return inflight;
      const promise = (async () => {
        try {
          const baseDir = `${FileSystem.cacheDirectory ?? ''}dva_tts/`;
          await FileSystem.makeDirectoryAsync(baseDir, { intermediates: true });
          const hash = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const dest = `${baseDir}tts_${hash}.mp3`;
          const dl = await FileSystem.downloadAsync(url, dest);
          if (dl.status >= 200 && dl.status < 300) {
            ttsLocalCacheRef.current.set(url, dl.uri);
            return dl.uri;
          }
          return null;
        } catch {
          return null;
        } finally {
          ttsInFlightRef.current.delete(url);
        }
      })();
      ttsInFlightRef.current.set(url, promise);
      return promise;
    };

    let aborted = false;
    (async () => {
      const localUri = await ensureCachedTtsFile(remoteTtsUrl);
      if (aborted || lastSpokenSigRef.current !== cueSig) return;
      try {
        await ttsPlayer.replaceAsync({ uri: localUri || remoteTtsUrl });
        if (aborted || lastSpokenSigRef.current !== cueSig) return;
        ttsPlayer.volume = Math.max(0, Math.min(1, (settings.subAiVoiceVolume ?? 80) / 100));
        ttsPlayer.play();
      } catch {}
    })();

    // Preload next 6 cues in background
    if (mainVnIndex >= 0) {
      for (let i = 1; i <= 6; i++) {
        const nxt = vnCues[mainVnIndex + i];
        if (!nxt || !nxt.text || nxt.text.includes('♪')) continue;
        const nxtTrans = toLang ? translationCacheRef.current.get(`${toLang}::${nxt.text}`) : '';
        const nxtText = (nxtTrans || nxt.text).trim();
        const nxtLang = nxtTrans && toLang ? toLang : 'vi';
        const nxtVoice = getAdaptiveVoiceForTime(voiceMode, nxt.start);
        const nxtSpeed = calculateTtsSpeed(nxtText, Math.max(0.4, nxt.end - nxt.start), nxtVoice);
        const nxtUrl = buildTtsProxyUrl(nxtText, nxtLang, nxtSpeed, nxtVoice);
        void ensureCachedTtsFile(nxtUrl);
      }
    }

    return () => {
      aborted = true;
    };
  }, [
    settings.subAiVoiceEnabled,
    settings.subAiVoiceMode,
    settings.subAiVoiceVolume,
    settings.subTranslateLang,
    isPlaying,
    isMuted,
    isInPip,
    mainVnCue,
    activeVnTopCue,
    mainVnIndex,
    vnCues,
    episodeSignature,
    translationVersion,
    ttsPlayer,
  ]);

  if (isInPip || (!settings.subShowVi && !settings.subShowEn)) {
    return null;
  }

  const autoLayout = computeAutoSubtitleLayout(winHeight, subHighRaw);
  const effectiveFontStep = settings.subAutoLayout ? autoLayout.fontStep : settings.subFontSizeStep || 8;
  const effectivePosPct = settings.subAutoLayout ? autoLayout.positionPct : settings.subPositionPct ?? 4;

  // Calibrated to match Image 1 (~22-24pt on 390pt landscape iPhone for step 8)
  const primaryFontSize = Math.min(
    44,
    Math.max(13, Math.round(winHeight * (effectiveFontStep / 100) * 0.74))
  );
  const secondaryFontSize = Math.max(11, Math.round(primaryFontSize * 0.78));
  const palette = SUBTITLE_COLOR_PALETTE[settings.subColor] || SUBTITLE_COLOR_PALETTE.white;
  const fontFamily = resolveFontFamily(settings.subFont);
  const outline: SubtitleOutlineOption = settings.subOutline || 'uniform2';
  const isReversed = Boolean(settings.subReverse);

  const showVnLine = Boolean(settings.subShowVi && mainVnCue?.text);
  const toLang = settings.subTranslateLang || '';
  const translatedText =
    toLang && mainVnCue ? translationCacheRef.current.get(`${toLang}::${mainVnCue.text}`) || '' : '';
  const isTranslatingLoading = Boolean(settings.subShowEn && toLang && mainVnCue && !translatedText);
  const secondaryText =
    settings.subShowEn && toLang
      ? translatedText
      : settings.subShowEn && mainEnCue?.text
        ? mainEnCue.text
        : '';
  const showSecondaryLine = Boolean(settings.subShowEn && (secondaryText || isTranslatingLoading));

  const primaryColor = palette.main;
  const secondaryColor = palette.sub;

  const vnBlock = showVnLine && mainVnCue ? (
    <View
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (Math.abs(w - vnMeasuredWidth) > 3) setVnMeasuredWidth(w);
      }}
    >
      <OutlinedText
        text={mainVnCue.text}
        outline={outline}
        style={{
          color: isReversed ? secondaryColor : primaryColor,
          fontSize: isReversed ? secondaryFontSize : primaryFontSize,
          lineHeight: Math.round((isReversed ? secondaryFontSize : primaryFontSize) * 1.24),
          fontWeight: '700',
          textAlign: 'center',
          fontFamily,
        }}
      />
    </View>
  ) : null;

  const enBlock = showSecondaryLine ? (
    isTranslatingLoading ? (
      <View style={styles.translatingRow}>
        <ActivityIndicator size="small" color={palette.main} />
      </View>
    ) : (
      <OutlinedText
        text={secondaryText}
        outline={outline}
        style={{
          color: isReversed ? primaryColor : secondaryColor,
          fontSize: isReversed ? primaryFontSize : secondaryFontSize,
          lineHeight: Math.round((isReversed ? primaryFontSize : secondaryFontSize) * 1.24),
          fontWeight: '600',
          textAlign: 'center',
          fontFamily,
        }}
      />
    )
  ) : null;

  const showDivider = Boolean(showVnLine && secondaryText && !isTranslatingLoading);
  const dividerWidth =
    vnMeasuredWidth > 20 ? Math.min(Math.round(vnMeasuredWidth * 0.8), Math.round(winWidth * 0.72)) : 96;

  const dividerEl = showDivider ? (
    <View style={[styles.dividerBar, { width: dividerWidth }]} />
  ) : null;

  const bottomStyleValue = `${Math.max(-5, Math.min(40, effectivePosPct))}%` as `${number}%`;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlayRoot]}>
      {activeVnTopCue ? (
        <View style={styles.topSubContainer}>
          <OutlinedText
            text={activeVnTopCue.text}
            outline={outline}
            style={{
              color: palette.main,
              fontSize: primaryFontSize,
              lineHeight: Math.round(primaryFontSize * 1.24),
              fontWeight: '700',
              textAlign: 'center',
              fontFamily,
            }}
          />
        </View>
      ) : null}

      {showVnLine || showSecondaryLine ? (
        <View style={[styles.bottomSubContainer, { bottom: bottomStyleValue }]}>
          {isReversed ? (
            <>
              {enBlock}
              {dividerEl}
              {vnBlock}
            </>
          ) : (
            <>
              {vnBlock}
              {dividerEl}
              {enBlock}
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    zIndex: 12,
    elevation: 12,
  },
  topSubContainer: {
    position: 'absolute',
    top: '5%',
    left: 18,
    right: 18,
    alignItems: 'center',
    zIndex: 8,
  },
  bottomSubContainer: {
    position: 'absolute',
    left: 18,
    right: 18,
    alignItems: 'center',
    zIndex: 8,
  },
  strokeContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strokeLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  dividerBar: {
    height: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  translatingRow: {
    paddingVertical: 4,
  },
});
