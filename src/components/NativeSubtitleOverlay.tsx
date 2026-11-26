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
  computeCueSpeechWindowSec,
  computeLocalTtsPlaybackRate,
  estimateNaturalTtsDurationSec,
  findNextSpeakableCue,
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
  playbackRate?: number;
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

interface QueuedTtsTask {
  cueSig: string;
  spokenText: string;
  spokenLang: string;
  effVoice: 'hoaimy' | 'namminh' | 'google';
  serverSpeed: number;
  remoteUrl: string;
  cueStart: number;
  cueEnd: number;
  nextCueStart: number | null;
  speechWindowSec: number;
}

interface AiVoicePlayerEngineProps {
  enabled: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  isInPip: boolean;
  appState: string;
  voiceMode: SubtitleAiVoiceMode;
  volume: number;
  currentTime: number;
  extendSec: number;
  playbackRate: number;
  activeCue: ParsedVttCue | null;
  spokenText: string;
  spokenLang: string;
  mainVnIndex: number;
  vnCues: ParsedVttCue[];
  translateLang: string;
  episodeSignature: string;
  reloadNonce: number;
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
  currentTime,
  extendSec,
  playbackRate,
  activeCue,
  spokenText,
  spokenLang,
  mainVnIndex,
  vnCues,
  translateLang,
  episodeSignature,
  reloadNonce,
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
    p.preservesPitch = true;
  });

  const canPlayAudio = enabled && isPlaying && !isMuted && (isInPip || appState === 'active');

  const canPlayAudioRef = useRef(canPlayAudio);
  canPlayAudioRef.current = canPlayAudio;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const extendSecRef = useRef(extendSec);
  extendSecRef.current = extendSec;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  const lastSpokenSigRef = useRef('');
  const isSpeakingRef = useRef(false);
  const pausedMidUtteranceRef = useRef(false);
  const currentTaskRef = useRef<QueuedTtsTask | null>(null);
  const pendingCueRef = useRef<QueuedTtsTask | null>(null);
  const currentFinishEstMsRef = useRef(0);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playGenRef = useRef(0);
  const prevVideoTimeRef = useRef(currentTime);
  const onEngineErrorRef = useRef(onEngineError);
  onEngineErrorRef.current = onEngineError;

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  }, []);

  const ensureCachedTtsFile = useCallback(
    async (url: string): Promise<string | null> => {
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
            while (ttsLocalCacheRef.current.size > 120) {
              const oldestKey = ttsLocalCacheRef.current.keys().next().value;
              if (!oldestKey) break;
              const oldestUri = ttsLocalCacheRef.current.get(oldestKey);
              ttsLocalCacheRef.current.delete(oldestKey);
              if (oldestUri) {
                FileSystem.deleteAsync(oldestUri, { idempotent: true }).catch(() => {});
              }
            }
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
    },
    [ttsLocalCacheRef, ttsInFlightRef]
  );

  const computeAvailableWallSecForTask = useCallback((task: QueuedTtsTask): number => {
    const nowPos = currentTimeRef.current;
    const effectiveStart = Math.max(task.cueStart, nowPos);
    const effectiveEnd = Math.max(task.cueEnd, effectiveStart + 0.5);
    return computeCueSpeechWindowSec({
      cueStart: effectiveStart,
      cueEnd: effectiveEnd,
      extendSec: extendSecRef.current,
      nextCueStart: task.nextCueStart,
      videoPlaybackRate: playbackRateRef.current,
    });
  }, []);

  const calibrateRateAndTimer = useCallback(
    (actualAudioDurSec: number, task: QueuedTtsTask, onSafetyFinish: () => void) => {
      if (actualAudioDurSec <= 0.2) return;
      const availableWallSec = computeAvailableWallSecForTask(task);
      const refinedRate = computeLocalTtsPlaybackRate({
        actualAudioDurSec,
        availableWallSec,
        effectiveVoice: task.effVoice,
        serverSpeed: task.serverSpeed,
        videoPlaybackRate: playbackRateRef.current,
      });
      try {
        ttsPlayer.preservesPitch = true;
        ttsPlayer.playbackRate = refinedRate;
      } catch {}

      let playerPos = 0;
      try {
        playerPos = Math.max(0, ttsPlayer.currentTime || 0);
      } catch {}
      const remainingAudioWallMs = Math.max(
        250,
        ((Math.max(0.2, actualAudioDurSec - playerPos)) / Math.max(0.5, refinedRate)) * 1000
      );
      currentFinishEstMsRef.current = Date.now() + remainingAudioWallMs;
      clearFinishTimer();
      finishTimerRef.current = setTimeout(onSafetyFinish, remainingAudioWallMs + 250);
    },
    [clearFinishTimer, computeAvailableWallSecForTask, ttsPlayer]
  );

  const startTaskNowRef = useRef<(task: QueuedTtsTask) => Promise<void>>(async () => {});

  const completeAndFlushPending = useCallback(() => {
    clearFinishTimer();
    isSpeakingRef.current = false;
    pausedMidUtteranceRef.current = false;
    currentTaskRef.current = null;
    const queued = pendingCueRef.current;
    pendingCueRef.current = null;
    if (queued && canPlayAudioRef.current) {
      void startTaskNowRef.current(queued);
    }
  }, [clearFinishTimer]);

  const startTaskNow = useCallback(
    async (task: QueuedTtsTask) => {
      const myGen = ++playGenRef.current;
      clearFinishTimer();
      isSpeakingRef.current = true;
      pausedMidUtteranceRef.current = false;
      currentTaskRef.current = task;

      const estAudioDurSec = Math.max(
        0.55,
        estimateNaturalTtsDurationSec(task.spokenText) / Math.max(0.5, task.serverSpeed)
      );
      const initialWallSec = computeAvailableWallSecForTask(task);
      const initialLocalRate = computeLocalTtsPlaybackRate({
        actualAudioDurSec: estAudioDurSec,
        availableWallSec: initialWallSec,
        effectiveVoice: task.effVoice,
        serverSpeed: task.serverSpeed,
        videoPlaybackRate: playbackRateRef.current,
      });
      const estWallMs = (estAudioDurSec / Math.max(0.5, initialLocalRate)) * 1000;
      currentFinishEstMsRef.current = Date.now() + estWallMs;

      const localUri = await ensureCachedTtsFile(task.remoteUrl);
      if (playGenRef.current !== myGen || !canPlayAudioRef.current) {
        if (playGenRef.current === myGen) {
          isSpeakingRef.current = false;
          currentTaskRef.current = null;
        }
        return;
      }

      try {
        await ttsPlayer.replaceAsync({ uri: localUri || task.remoteUrl });
        if (playGenRef.current !== myGen || !canPlayAudioRef.current) {
          if (playGenRef.current === myGen) {
            isSpeakingRef.current = false;
            currentTaskRef.current = null;
          }
          return;
        }
        ttsPlayer.audioMixingMode = 'mixWithOthers';
        ttsPlayer.staysActiveInBackground = true;
        ttsPlayer.muted = false;
        ttsPlayer.preservesPitch = true;
        ttsPlayer.volume = Math.max(0, Math.min(1, (volumeRef.current ?? 80) / 100));
        ttsPlayer.playbackRate = initialLocalRate;
        ttsPlayer.play();

        const syncDur = Number(ttsPlayer.duration) || 0;
        if (syncDur > 0.2) {
          calibrateRateAndTimer(syncDur, task, () => {
            if (playGenRef.current === myGen) {
              completeAndFlushPending();
            }
          });
        } else {
          const fallbackMs = estWallMs + 350;
          currentFinishEstMsRef.current = Date.now() + estWallMs;
          clearFinishTimer();
          finishTimerRef.current = setTimeout(() => {
            if (playGenRef.current === myGen) {
              completeAndFlushPending();
            }
          }, fallbackMs);
        }
      } catch {
        if (playGenRef.current === myGen) {
          completeAndFlushPending();
        }
      }
    },
    [
      calibrateRateAndTimer,
      clearFinishTimer,
      completeAndFlushPending,
      computeAvailableWallSecForTask,
      ensureCachedTtsFile,
      ttsPlayer,
    ]
  );

  startTaskNowRef.current = startTaskNow;

  // Player listeners (attached once per ttsPlayer instance)
  useEffect(() => {
    const endSub = ttsPlayer.addListener('playToEnd', () => {
      completeAndFlushPending();
    });

    const loadSub = ttsPlayer.addListener('sourceLoad', (ev) => {
      const task = currentTaskRef.current;
      const dur = ev.duration > 0 ? ev.duration : Number(ttsPlayer.duration) || 0;
      if (isSpeakingRef.current && task && dur > 0.2) {
        const activeGen = playGenRef.current;
        calibrateRateAndTimer(dur, task, () => {
          if (playGenRef.current === activeGen) {
            completeAndFlushPending();
          }
        });
      }
    });

    const statusSub = ttsPlayer.addListener('statusChange', (ev) => {
      if (ev.status === 'readyToPlay') {
        const task = currentTaskRef.current;
        const dur = Number(ttsPlayer.duration) || 0;
        if (isSpeakingRef.current && task && dur > 0.2) {
          const activeGen = playGenRef.current;
          calibrateRateAndTimer(dur, task, () => {
            if (playGenRef.current === activeGen) {
              completeAndFlushPending();
            }
          });
        }
      } else if (ev.status === 'error') {
        clearFinishTimer();
        isSpeakingRef.current = false;
        pausedMidUtteranceRef.current = false;
        currentTaskRef.current = null;
        pendingCueRef.current = null;
        lastSpokenSigRef.current = '';
        onEngineErrorRef.current();
      }
    });

    return () => {
      endSub.remove();
      loadSub.remove();
      statusSub.remove();
    };
  }, [calibrateRateAndTimer, clearFinishTimer, completeAndFlushPending, ttsPlayer]);

  // Dedicated volume sync (never restarts or aborts speech)
  useEffect(() => {
    try {
      ttsPlayer.audioMixingMode = 'mixWithOthers';
      ttsPlayer.staysActiveInBackground = true;
      ttsPlayer.muted = false;
      ttsPlayer.preservesPitch = true;
      ttsPlayer.volume = Math.max(0, Math.min(1, (volume ?? 80) / 100));
    } catch {}
  }, [ttsPlayer, volume]);

  // Hard reset only on episode change, manual reload, or voice mode switch
  useEffect(() => {
    playGenRef.current += 1;
    clearFinishTimer();
    lastSpokenSigRef.current = '';
    isSpeakingRef.current = false;
    pausedMidUtteranceRef.current = false;
    currentTaskRef.current = null;
    pendingCueRef.current = null;
    try {
      ttsPlayer.pause();
    } catch {}
    return () => {
      playGenRef.current += 1;
      clearFinishTimer();
      try {
        ttsPlayer.pause();
      } catch {}
    };
  }, [episodeSignature, reloadNonce, voiceMode, ttsPlayer, clearFinishTimer]);

  // Playback gate: pause cleanly when video pauses/mutes/backgrounds; resume seamlessly without cutoff
  useEffect(() => {
    if (!canPlayAudio) {
      clearFinishTimer();
      const userStillEnabled = enabled && !isMuted;
      if (userStillEnabled && isSpeakingRef.current) {
        pausedMidUtteranceRef.current = true;
      } else {
        playGenRef.current += 1;
        isSpeakingRef.current = false;
        pausedMidUtteranceRef.current = false;
        currentTaskRef.current = null;
        pendingCueRef.current = null;
        if (!enabled || isMuted) {
          lastSpokenSigRef.current = '';
        }
      }
      try {
        ttsPlayer.pause();
      } catch {}
      return;
    }

    if (pausedMidUtteranceRef.current && isSpeakingRef.current) {
      pausedMidUtteranceRef.current = false;
      try {
        ttsPlayer.volume = Math.max(0, Math.min(1, (volumeRef.current ?? 80) / 100));
        ttsPlayer.preservesPitch = true;
        ttsPlayer.play();
        const dur = Number(ttsPlayer.duration) || 0;
        const pos = Math.max(0, Number(ttsPlayer.currentTime) || 0);
        const rate = Math.max(0.5, Number(ttsPlayer.playbackRate) || 1);
        const remainingMs =
          dur > 0.2
            ? Math.max(250, ((dur - pos) / rate) * 1000)
            : Math.max(350, currentFinishEstMsRef.current - Date.now());
        currentFinishEstMsRef.current = Date.now() + remainingMs;
        const activeGen = playGenRef.current;
        clearFinishTimer();
        finishTimerRef.current = setTimeout(() => {
          if (playGenRef.current === activeGen) {
            completeAndFlushPending();
          }
        }, remainingMs + 250);
      } catch {
        completeAndFlushPending();
      }
    }
  }, [
    canPlayAudio,
    enabled,
    isMuted,
    ttsPlayer,
    clearFinishTimer,
    completeAndFlushPending,
  ]);

  // Seek / jump detector: immediately cancel stale speech on scrub > 1.8s
  useEffect(() => {
    const prevT = prevVideoTimeRef.current;
    prevVideoTimeRef.current = currentTime;
    if (Math.abs(currentTime - prevT) > 1.8) {
      playGenRef.current += 1;
      clearFinishTimer();
      isSpeakingRef.current = false;
      pausedMidUtteranceRef.current = false;
      currentTaskRef.current = null;
      pendingCueRef.current = null;
      lastSpokenSigRef.current = '';
      try {
        ttsPlayer.pause();
      } catch {}
    }
  }, [currentTime, ttsPlayer, clearFinishTimer]);

  // Cue trigger effect: NEVER aborts in-flight speech when activeCue turns null during silent gaps
  useEffect(() => {
    if (!canPlayAudio || !activeCue || !spokenText || spokenText.includes('♪')) {
      return;
    }

    const cueSig = `${episodeSignature}|${reloadNonce}|${activeCue.start}|${spokenText}`;
    if (lastSpokenSigRef.current === cueSig) return;
    lastSpokenSigRef.current = cueSig;

    const effVoice = getAdaptiveVoiceForTime(voiceMode || 'adaptive', activeCue.start);
    const nextCue = mainVnIndex >= 0 ? findNextSpeakableCue(vnCues, mainVnIndex) : null;
    const speechWindowSec = computeCueSpeechWindowSec({
      cueStart: activeCue.start,
      cueEnd: activeCue.end,
      extendSec: extendSecRef.current,
      nextCueStart: nextCue?.start ?? null,
      videoPlaybackRate: playbackRateRef.current,
    });
    const serverSpeed = calculateTtsSpeed(spokenText, speechWindowSec, effVoice);
    const remoteUrl = buildTtsProxyUrl(spokenText, spokenLang, serverSpeed, effVoice);

    const task: QueuedTtsTask = {
      cueSig,
      spokenText,
      spokenLang,
      effVoice,
      serverSpeed,
      remoteUrl,
      cueStart: activeCue.start,
      cueEnd: activeCue.end,
      nextCueStart: nextCue?.start ?? null,
      speechWindowSec,
    };

    // Start downloading active cue immediately and preload next 6 speakable cues
    void ensureCachedTtsFile(remoteUrl);
    if (mainVnIndex >= 0) {
      let preloaded = 0;
      for (let i = mainVnIndex + 1; i < vnCues.length && preloaded < 6; i++) {
        const nxt = vnCues[i];
        if (!nxt || nxt.isTop || !nxt.text || nxt.text.includes('♪')) continue;
        const nxtTrans = translateLang
          ? translationCacheRef.current.get(`${translateLang}::${nxt.text}`)
          : '';
        const nxtText = (nxtTrans || nxt.text).trim();
        if (!nxtText) continue;
        const nxtLang = nxtTrans && translateLang ? translateLang : 'vi';
        const nxtVoice = getAdaptiveVoiceForTime(voiceMode || 'adaptive', nxt.start);
        const afterNxt = findNextSpeakableCue(vnCues, i);
        const nxtWindow = computeCueSpeechWindowSec({
          cueStart: nxt.start,
          cueEnd: nxt.end,
          extendSec: extendSecRef.current,
          nextCueStart: afterNxt?.start ?? null,
          videoPlaybackRate: playbackRateRef.current,
        });
        const nxtSpeed = calculateTtsSpeed(nxtText, nxtWindow, nxtVoice);
        const nxtUrl = buildTtsProxyUrl(nxtText, nxtLang, nxtSpeed, nxtVoice);
        void ensureCachedTtsFile(nxtUrl);
        preloaded++;
      }
    }

    if (!isSpeakingRef.current) {
      void startTaskNow(task);
    } else {
      let remainingMs = Math.max(0, currentFinishEstMsRef.current - Date.now());
      try {
        const dur = Number(ttsPlayer.duration) || 0;
        const pos = Math.max(0, Number(ttsPlayer.currentTime) || 0);
        const rate = Math.max(0.5, Number(ttsPlayer.playbackRate) || 1);
        if (dur > 0.2) {
          remainingMs = Math.max(0, ((dur - pos) / rate) * 1000);
        }
      } catch {}

      if (remainingMs <= 1800) {
        // Let current sentence finish cleanly without cutoff, then speak this cue immediately
        pendingCueRef.current = task;
      } else {
        // Extreme lag guard: jump directly to keep narration synchronized
        pendingCueRef.current = null;
        void startTaskNow(task);
      }
    }
  }, [
    canPlayAudio,
    activeCue?.start,
    activeCue?.end,
    spokenText,
    spokenLang,
    voiceMode,
    episodeSignature,
    reloadNonce,
    mainVnIndex,
    vnCues,
    translateLang,
    translationCacheRef,
    ensureCachedTtsFile,
    startTaskNow,
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
  playbackRate = 1.0,
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
  const activeVoiceToLang = settings.subTranslateLang || '';
  const activeVoiceCachedTrans =
    activeVoiceCue && activeVoiceToLang
      ? translationCacheRef.current.get(`${activeVoiceToLang}::${activeVoiceCue.text}`)
      : '';
  const activeSpokenText = activeVoiceCue
    ? (activeVoiceCachedTrans || activeVoiceCue.text || '').trim()
    : '';
  const activeSpokenLang = activeVoiceCachedTrans && activeVoiceToLang ? activeVoiceToLang : 'vi';
  void translationVersion;

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
      currentTime={currentTime}
      extendSec={extendSec}
      playbackRate={playbackRate}
      activeCue={activeVoiceCue}
      spokenText={activeSpokenText}
      spokenLang={activeSpokenLang}
      mainVnIndex={mainVnIndex}
      vnCues={vnCues}
      translateLang={activeVoiceToLang}
      episodeSignature={episodeSignature}
      reloadNonce={reloadNonce}
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
  const effectiveFontStep = settings.subAutoLayout ? autoLayout.fontStep : settings.subFontSizeStep || 18;
  const effectivePosPct = settings.subAutoLayout ? autoLayout.positionPct : settings.subPositionPct ?? 12;

  // Recalibrated for 1..20 scale (default 18)
  const autoScaleRatio = Math.min(1.35, Math.max(0.78, (winHeight > 0 ? winHeight : 390) / 390));
  const clampedFontStep = Math.min(20, Math.max(1, Math.round(effectiveFontStep || 18)));
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
