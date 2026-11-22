import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
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
  reloadNonce?: number;
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
    return (
      <Text allowFontScaling={false} style={style}>
        {text}
      </Text>
    );
  }

  if (outline === 'shadow') {
    return (
      <Text
        allowFontScaling={false}
        style={[
          style,
          {
            textShadowColor: 'rgba(0,0,0,0.9)',
            textShadowOffset: { width: 1.5, height: 1.5 },
            textShadowRadius: 3,
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
        allowFontScaling={false}
        style={[
          style,
          {
            textShadowColor: '#000000',
            textShadowOffset: { width: 1.5, height: -1.5 },
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
        allowFontScaling={false}
        style={[
          style,
          {
            textShadowColor: '#000000',
            textShadowOffset: { width: -1.5, height: 1.5 },
            textShadowRadius: 1,
          },
        ]}
      >
        {text}
      </Text>
    );
  }

  // 'uniform' / 'uniform2': thin razor-crisp 8-way border matching web Arial Regular stroke
  const flatStyle = StyleSheet.flatten(style);
  const fontSize = typeof flatStyle?.fontSize === 'number' ? flatStyle.fontSize : 20;
  const d =
    outline === 'uniform'
      ? Math.max(0.75, Math.min(1.2, fontSize * 0.042))
      : Math.max(0.6, Math.min(0.95, fontSize * 0.032));
  const diag = Number((d * 0.72).toFixed(2));
  const offset = Number(d.toFixed(2));
  const strokeOffsets = [
    { x: -offset, y: 0 },
    { x: offset, y: 0 },
    { x: 0, y: -offset },
    { x: 0, y: offset },
    { x: -diag, y: -diag },
    { x: diag, y: -diag },
    { x: -diag, y: diag },
    { x: diag, y: diag },
  ];

  return (
    <View style={styles.strokeContainer}>
      {strokeOffsets.map((off, idx) => (
        <Text
          key={idx}
          allowFontScaling={false}
          style={[
            style,
            styles.strokeLayer,
            {
              color: '#000000',
              transform: [{ translateX: off.x }, { translateY: off.y }],
              textShadowColor: 'rgba(0,0,0,0.85)',
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 0.4,
            },
          ]}
        >
          {text}
        </Text>
      ))}
      <Text
        allowFontScaling={false}
        style={[
          style,
          {
            textShadowColor: 'rgba(0,0,0,0.75)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 1.5,
          },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

interface AiVoicePlayerEngineProps {
  enabled: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  isInPip: boolean;
  appState: string;
  voiceMode: SubtitleAiVoiceMode;
  volume: number;
  translateLang: string;
  activeCue: ParsedVttCue | null;
  mainVnIndex: number;
  vnCues: ParsedVttCue[];
  episodeSignature: string;
  reloadNonce: number;
  translationVersion: number;
  translationCacheRef: React.MutableRefObject<Map<string, string>>;
  ttsLocalCacheRef: React.MutableRefObject<Map<string, string>>;
  ttsInFlightRef: React.MutableRefObject<Map<string, Promise<string | null>>>;
  onEngineError: () => void;
}

function AiVoicePlayerEngine({
  enabled,
  isPlaying,
  isMuted,
  isInPip,
  appState,
  voiceMode,
  volume,
  translateLang,
  activeCue,
  mainVnIndex,
  vnCues,
  episodeSignature,
  reloadNonce,
  translationVersion,
  translationCacheRef,
  ttsLocalCacheRef,
  ttsInFlightRef,
  onEngineError,
}: AiVoicePlayerEngineProps) {
  const ttsPlayer = useVideoPlayer(null, (p) => {
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = true;
    p.loop = false;
    p.muted = false;
  });
  const lastSpokenSigRef = useRef('');
  const onEngineErrorRef = useRef(onEngineError);
  onEngineErrorRef.current = onEngineError;

  useEffect(() => {
    const sub = ttsPlayer.addListener('statusChange', (ev) => {
      if (ev.status === 'error') {
        lastSpokenSigRef.current = '';
        onEngineErrorRef.current();
      }
    });
    return () => sub.remove();
  }, [ttsPlayer]);

  useEffect(() => {
    try {
      ttsPlayer.audioMixingMode = 'mixWithOthers';
      ttsPlayer.staysActiveInBackground = true;
      ttsPlayer.muted = false;
      ttsPlayer.volume = Math.max(0, Math.min(1, (volume ?? 80) / 100));
    } catch {}
  }, [ttsPlayer, volume]);

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
  }, [episodeSignature, reloadNonce, ttsPlayer]);

  useEffect(() => {
    const canSpeakNow =
      enabled && isPlaying && !isMuted && Boolean(activeCue) && (isInPip || appState === 'active');
    if (!canSpeakNow || !activeCue) {
      try {
        ttsPlayer.pause();
      } catch {}
      if (!activeCue || !enabled || !isPlaying || isMuted) {
        lastSpokenSigRef.current = '';
      }
      return;
    }

    const toLang = translateLang || '';
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

    const cueSig = `${episodeSignature}|${reloadNonce}|${activeCue.start}|${spokenText}`;
    if (lastSpokenSigRef.current === cueSig) return;
    lastSpokenSigRef.current = cueSig;

    const effVoice = getAdaptiveVoiceForTime(voiceMode || 'adaptive', activeCue.start);
    const durSec = Math.max(0.4, activeCue.end - activeCue.start);
    const speed = calculateTtsSpeed(spokenText, durSec, effVoice);
    const remoteTtsUrl = buildTtsProxyUrl(spokenText, spokenLang, speed, effVoice);

    const ensureCachedTtsFile = async (url: string): Promise<string | null> => {
      const hit = ttsLocalCacheRef.current.get(url);
      if (hit) {
        try {
          const info = await FileSystem.getInfoAsync(hit);
          if (info.exists && (typeof (info as any).size !== 'number' || (info as any).size > 128)) {
            return hit;
          }
        } catch {}
        ttsLocalCacheRef.current.delete(url);
      }
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
            const info = await FileSystem.getInfoAsync(dl.uri).catch(() => null);
            if (!info || !info.exists || (typeof (info as any).size === 'number' && (info as any).size <= 128)) {
              FileSystem.deleteAsync(dl.uri, { idempotent: true }).catch(() => {});
              return null;
            }
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
        ttsPlayer.audioMixingMode = 'mixWithOthers';
        ttsPlayer.staysActiveInBackground = true;
        ttsPlayer.muted = false;
        ttsPlayer.volume = Math.max(0, Math.min(1, (volume ?? 80) / 100));
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
        const nxtVoice = getAdaptiveVoiceForTime(voiceMode || 'adaptive', nxt.start);
        const nxtSpeed = calculateTtsSpeed(nxtText, Math.max(0.4, nxt.end - nxt.start), nxtVoice);
        const nxtUrl = buildTtsProxyUrl(nxtText, nxtLang, nxtSpeed, nxtVoice);
        void ensureCachedTtsFile(nxtUrl);
      }
    }

    return () => {
      aborted = true;
    };
  }, [
    enabled,
    isPlaying,
    isMuted,
    isInPip,
    appState,
    voiceMode,
    volume,
    translateLang,
    activeCue,
    mainVnIndex,
    vnCues,
    episodeSignature,
    reloadNonce,
    translationVersion,
    translationCacheRef,
    ttsLocalCacheRef,
    ttsInFlightRef,
    ttsPlayer,
  ]);

  return null;
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
  reloadNonce = 0,
}: NativeSubtitleOverlayProps) {
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const [vnMeasuredWidth, setVnMeasuredWidth] = useState(0);
  const [translationVersion, setTranslationVersion] = useState(0);
  const translationCacheRef = useRef<Map<string, string>>(new Map());
  const inFlightKeysRef = useRef<Set<string>>(new Set());
  const prevLangRef = useRef(settings.subTranslateLang);
  const ttsLocalCacheRef = useRef<Map<string, string>>(new Map());
  const ttsInFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const [ttsEngineKey, setTtsEngineKey] = useState(0);
  const [appState, setAppState] = useState<string>(AppState.currentState || 'active');
  const prevAppStateRef = useRef<string>(AppState.currentState || 'active');
  const subAiEnabledRef = useRef(Boolean(settings.subAiVoiceEnabled));
  subAiEnabledRef.current = Boolean(settings.subAiVoiceEnabled);
  const prevReloadNonceRef = useRef(reloadNonce);
  const lastEngineResetAtRef = useRef(0);

  const handleEngineError = useCallback(() => {
    const now = Date.now();
    if (now - lastEngineResetAtRef.current < 2500) return;
    lastEngineResetAtRef.current = now;
    setTtsEngineKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = prevAppStateRef.current;
      prevAppStateRef.current = nextState;
      setAppState(nextState);
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active') {
        if (subAiEnabledRef.current) {
          setTtsEngineKey((k) => k + 1);
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (reloadNonce > 0 && reloadNonce !== prevReloadNonceRef.current) {
      prevReloadNonceRef.current = reloadNonce;
      ttsLocalCacheRef.current.clear();
      ttsInFlightRef.current.clear();
      const baseDir = `${FileSystem.cacheDirectory ?? ''}dva_tts/`;
      FileSystem.deleteAsync(baseDir, { idempotent: true }).catch(() => {});
      setTtsEngineKey((k) => k + 1);
    } else {
      prevReloadNonceRef.current = reloadNonce;
    }
  }, [reloadNonce]);

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
  }, [episodeSignature, reloadNonce]);

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

  const activeVoiceCue = mainVnCue || activeVnTopCue;
  const voiceEngineNode = settings.subAiVoiceEnabled ? (
    <AiVoicePlayerEngine
      key={ttsEngineKey}
      enabled={Boolean(settings.subAiVoiceEnabled)}
      isPlaying={isPlaying}
      isMuted={isMuted}
      isInPip={isInPip}
      appState={appState}
      voiceMode={settings.subAiVoiceMode || 'adaptive'}
      volume={settings.subAiVoiceVolume ?? 80}
      translateLang={settings.subTranslateLang || ''}
      activeCue={activeVoiceCue}
      mainVnIndex={mainVnIndex}
      vnCues={vnCues}
      episodeSignature={episodeSignature}
      reloadNonce={reloadNonce}
      translationVersion={translationVersion}
      translationCacheRef={translationCacheRef}
      ttsLocalCacheRef={ttsLocalCacheRef}
      ttsInFlightRef={ttsInFlightRef}
      onEngineError={handleEngineError}
    />
  ) : null;

  if (isInPip || (!settings.subShowVi && !settings.subShowEn)) {
    return voiceEngineNode;
  }

  const autoLayout = computeAutoSubtitleLayout(winHeight, subHighRaw);
  const effectiveFontStep = settings.subAutoLayout ? autoLayout.fontStep : settings.subFontSizeStep || 10;
  const effectivePosPct = settings.subAutoLayout ? autoLayout.positionPct : settings.subPositionPct ?? 12;

  // Recalibrated for 1..20 scale (default 10 -> ~23pt on 390pt landscape iPhone)
  const autoScaleRatio = Math.min(1.35, Math.max(0.78, (winHeight > 0 ? winHeight : 390) / 390));
  const clampedFontStep = Math.min(20, Math.max(1, Math.round(effectiveFontStep || 10)));
  const primaryFontSize = Math.min(
    46,
    Math.max(12, Math.round((11 + clampedFontStep * 1.2) * autoScaleRatio))
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
          lineHeight: Math.round((isReversed ? secondaryFontSize : primaryFontSize) * 1.2),
          fontWeight: '400',
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
          lineHeight: Math.round((isReversed ? primaryFontSize : secondaryFontSize) * 1.2),
          fontWeight: '400',
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

  const bottomStyleValue = `${Math.max(-10, Math.min(40, effectivePosPct))}%` as `${number}%`;

  return (
    <>
      {voiceEngineNode}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlayRoot]}>
        {activeVnTopCue ? (
          <View style={styles.topSubContainer}>
            <OutlinedText
              text={activeVnTopCue.text}
              outline={outline}
              style={{
                color: palette.main,
                fontSize: primaryFontSize,
                lineHeight: Math.round(primaryFontSize * 1.2),
                fontWeight: '400',
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
    </>
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
