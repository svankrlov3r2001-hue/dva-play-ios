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

const TTS_START_LEAD_SEC = 0.22;
const TTS_LOCAL_PREFETCH_COUNT = 12;
const TTS_LOCAL_CACHE_MAX = 200;
const TTS_SERVER_PREWARM_COUNT = 30;
const TTS_LOCAL_CONCURRENCY = 2;
const TTS_SERVER_PREWARM_CONCURRENCY = 2;

function isSpeakableSubtitleText(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.includes('♪')) return false;
  if (trimmed === '[Đặng Việt Anh]' || trimmed === 'Đặng Việt Anh') return false;
  return true;
}

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
  previewSampleWhenIdle?: boolean;
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
  cueIndex: number;
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

interface CueAudioSpec {
  cueIndex: number;
  cue: ParsedVttCue;
  spokenText: string;
  spokenLang: string;
  effVoice: 'hoaimy' | 'namminh' | 'google';
  serverSpeed: number;
  remoteUrl: string;
  prewarmUrl: string;
  nextCueStart: number | null;
  speechWindowSec: number;
}

interface StagedTtsSlot {
  remoteUrl: string;
  localUri: string;
  ready: boolean;
  loadingPromise: Promise<boolean>;
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
  effectiveTime: number;
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
  effectiveTime,
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
  // Dual AVPlayers ping-pong: preload next line on standby player so cue onset has zero load latency
  const ttsPlayerA = useVideoPlayer(null, (p) => {
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = true;
    p.loop = false;
    p.muted = false;
    p.preservesPitch = true;
  });
  const ttsPlayerB = useVideoPlayer(null, (p) => {
    p.audioMixingMode = 'mixWithOthers';
    p.staysActiveInBackground = true;
    p.loop = false;
    p.muted = false;
    p.preservesPitch = true;
  });

  const playersRef = useRef<[typeof ttsPlayerA, typeof ttsPlayerB]>([ttsPlayerA, ttsPlayerB]);
  playersRef.current = [ttsPlayerA, ttsPlayerB];
  const activeSlotRef = useRef<0 | 1>(0);
  const stagedSlotsRef = useRef<[StagedTtsSlot | null, StagedTtsSlot | null]>([null, null]);

  const canPlayAudio = enabled && isPlaying && !isMuted && (isInPip || appState === 'active');

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const canPlayAudioRef = useRef(canPlayAudio);
  canPlayAudioRef.current = canPlayAudio;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const effectiveTimeRef = useRef(effectiveTime);
  effectiveTimeRef.current = effectiveTime;
  const extendSecRef = useRef(extendSec);
  extendSecRef.current = extendSec;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const vnCuesRef = useRef(vnCues);
  vnCuesRef.current = vnCues;
  const mainVnIndexRef = useRef(mainVnIndex);
  mainVnIndexRef.current = mainVnIndex;
  const translateLangRef = useRef(translateLang);
  translateLangRef.current = translateLang;
  const voiceModeRef = useRef(voiceMode);
  voiceModeRef.current = voiceMode;

  const lastSpokenSigRef = useRef('');
  const isSpeakingRef = useRef(false);
  const pausedMidUtteranceRef = useRef(false);
  const currentTaskRef = useRef<QueuedTtsTask | null>(null);
  const pendingCueRef = useRef<QueuedTtsTask | null>(null);
  const currentFinishEstMsRef = useRef(0);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playGenRef = useRef(0);
  const prevVideoTimeRef = useRef(currentTime);
  const prefetchWaveIdRef = useRef(0);
  const serverPrewarmedRef = useRef<Set<string>>(new Set());
  const [seekEpoch, setSeekEpoch] = useState(0);
  const onEngineErrorRef = useRef(onEngineError);
  onEngineErrorRef.current = onEngineError;

  const clearFinishTimer = useCallback(() => {
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }
  }, []);

  const ensureCachedTtsFile = useCallback(
    async (url: string, skipDiskCheck = false): Promise<string | null> => {
      const hit = ttsLocalCacheRef.current.get(url);
      if (hit) {
        if (skipDiskCheck) {
          return hit;
        }
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
            while (ttsLocalCacheRef.current.size > TTS_LOCAL_CACHE_MAX) {
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

  const buildSpecForCueIndex = useCallback(
    (idx: number): CueAudioSpec | null => {
      const cues = vnCuesRef.current;
      if (!Array.isArray(cues) || idx < 0 || idx >= cues.length) return null;
      const cue = cues[idx];
      if (!cue || cue.isTop || !isSpeakableSubtitleText(cue.text)) return null;
      const lang = translateLangRef.current;
      const trans = lang ? translationCacheRef.current.get(`${lang}::${cue.text}`) : '';
      const text = (trans || cue.text).trim();
      if (!isSpeakableSubtitleText(text)) return null;
      const spokenLangValue = trans && lang ? lang : 'vi';
      const effVoice = getAdaptiveVoiceForTime(voiceModeRef.current || 'adaptive', cue.start);
      const afterCue = findNextSpeakableCue(cues, idx);
      const speechWindowSec = computeCueSpeechWindowSec({
        cueStart: cue.start,
        cueEnd: cue.end,
        extendSec: extendSecRef.current,
        nextCueStart: afterCue?.start ?? null,
        videoPlaybackRate: playbackRateRef.current,
      });
      const serverSpeed = calculateTtsSpeed(text, speechWindowSec, effVoice);
      const remoteUrl = buildTtsProxyUrl(text, spokenLangValue, serverSpeed, effVoice, false);
      const prewarmUrl = buildTtsProxyUrl(text, spokenLangValue, serverSpeed, effVoice, true);
      return {
        cueIndex: idx,
        cue,
        spokenText: text,
        spokenLang: spokenLangValue,
        effVoice,
        serverSpeed,
        remoteUrl,
        prewarmUrl,
        nextCueStart: afterCue?.start ?? null,
        speechWindowSec,
      };
    },
    [translationCacheRef]
  );

  const stageUrlOnStandby = useCallback(
    async (remoteUrl: string) => {
      if (!remoteUrl || !enabledRef.current) return;
      const standbySlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
      const existing = stagedSlotsRef.current[standbySlot];
      if (existing && existing.remoteUrl === remoteUrl) return;

      const localUri = await ensureCachedTtsFile(remoteUrl, true);
      if (!localUri || !enabledRef.current) return;

      const targetSlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
      const currentAtTarget = stagedSlotsRef.current[targetSlot];
      if (currentAtTarget && currentAtTarget.remoteUrl === remoteUrl) return;

      const player = playersRef.current[targetSlot];
      const entry: StagedTtsSlot = {
        remoteUrl,
        localUri,
        ready: false,
        loadingPromise: Promise.resolve(false),
      };
      const loadProm = (async () => {
        try {
          try {
            player.pause();
          } catch {}
          await player.replaceAsync({ uri: localUri });
          if (stagedSlotsRef.current[targetSlot] !== entry) return false;
          player.audioMixingMode = 'mixWithOthers';
          player.staysActiveInBackground = true;
          player.muted = false;
          player.preservesPitch = true;
          entry.ready = true;
          return true;
        } catch {
          if (stagedSlotsRef.current[targetSlot] === entry) {
            stagedSlotsRef.current[targetSlot] = null;
          }
          return false;
        }
      })();
      entry.loadingPromise = loadProm;
      stagedSlotsRef.current[targetSlot] = entry;
      await loadProm;
    },
    [ensureCachedTtsFile]
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
    (
      player: typeof ttsPlayerA,
      actualAudioDurSec: number,
      task: QueuedTtsTask,
      onSafetyFinish: () => void
    ) => {
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
        player.preservesPitch = true;
        player.playbackRate = refinedRate;
      } catch {}

      let playerPos = 0;
      try {
        playerPos = Math.max(0, player.currentTime || 0);
      } catch {}
      const remainingAudioWallMs = Math.max(
        250,
        ((Math.max(0.2, actualAudioDurSec - playerPos)) / Math.max(0.5, refinedRate)) * 1000
      );
      currentFinishEstMsRef.current = Date.now() + remainingAudioWallMs;
      clearFinishTimer();
      finishTimerRef.current = setTimeout(onSafetyFinish, remainingAudioWallMs + 250);
    },
    [clearFinishTimer, computeAvailableWallSecForTask]
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

      // Check if either standby or active slot is already staged with this exact audio URL
      const standbySlot: 0 | 1 = activeSlotRef.current === 0 ? 1 : 0;
      const checkOrder: (0 | 1)[] = [standbySlot, activeSlotRef.current];
      let matchedSlot: 0 | 1 | null = null;
      let matchedReady = false;
      for (const slot of checkOrder) {
        const entry = stagedSlotsRef.current[slot];
        if (entry && entry.remoteUrl === task.remoteUrl) {
          matchedSlot = slot;
          if (entry.ready) {
            matchedReady = true;
          } else {
            matchedReady = await entry.loadingPromise;
          }
          break;
        }
      }

      if (playGenRef.current !== myGen || !canPlayAudioRef.current) {
        if (playGenRef.current === myGen) {
          isSpeakingRef.current = false;
          currentTaskRef.current = null;
        }
        return;
      }

      let targetSlot: 0 | 1;
      let player: typeof ttsPlayerA;

      try {
        if (matchedSlot !== null && matchedReady) {
          targetSlot = matchedSlot;
          stagedSlotsRef.current[targetSlot] = null;
          player = playersRef.current[targetSlot];
          const otherSlot: 0 | 1 = targetSlot === 0 ? 1 : 0;
          try {
            playersRef.current[otherSlot].pause();
          } catch {}
        } else {
          targetSlot = standbySlot;
          stagedSlotsRef.current[targetSlot] = null;
          player = playersRef.current[targetSlot];
          const localUri = await ensureCachedTtsFile(task.remoteUrl, true);
          if (playGenRef.current !== myGen || !canPlayAudioRef.current) {
            if (playGenRef.current === myGen) {
              isSpeakingRef.current = false;
              currentTaskRef.current = null;
            }
            return;
          }
          const otherSlot: 0 | 1 = targetSlot === 0 ? 1 : 0;
          try {
            playersRef.current[otherSlot].pause();
          } catch {}
          try {
            await player.replaceAsync({ uri: localUri || task.remoteUrl });
          } catch {
            if (localUri) {
              ttsLocalCacheRef.current.delete(task.remoteUrl);
              const freshUri = await ensureCachedTtsFile(task.remoteUrl, false);
              if (playGenRef.current !== myGen || !canPlayAudioRef.current) {
                if (playGenRef.current === myGen) {
                  isSpeakingRef.current = false;
                  currentTaskRef.current = null;
                }
                return;
              }
              await player.replaceAsync({ uri: freshUri || task.remoteUrl });
            } else {
              throw new Error('TTS replaceAsync failed');
            }
          }
          if (playGenRef.current !== myGen || !canPlayAudioRef.current) {
            if (playGenRef.current === myGen) {
              isSpeakingRef.current = false;
              currentTaskRef.current = null;
            }
            return;
          }
        }

        activeSlotRef.current = targetSlot;
        player.audioMixingMode = 'mixWithOthers';
        player.staysActiveInBackground = true;
        player.muted = false;
        player.preservesPitch = true;
        player.volume = Math.max(0, Math.min(1, (volumeRef.current ?? 80) / 100));
        player.playbackRate = initialLocalRate;
        player.play();

        const syncDur = Number(player.duration) || 0;
        if (syncDur > 0.2) {
          calibrateRateAndTimer(player, syncDur, task, () => {
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

        // Immediately pre-stage the very next speakable cue onto the standby player
        if (task.cueIndex >= 0) {
          const cues = vnCuesRef.current;
          for (let i = task.cueIndex + 1; i < cues.length; i++) {
            const nextSpec = buildSpecForCueIndex(i);
            if (nextSpec) {
              void stageUrlOnStandby(nextSpec.remoteUrl);
              break;
            }
          }
        }
      } catch {
        if (playGenRef.current === myGen) {
          completeAndFlushPending();
        }
      }
    },
    [
      buildSpecForCueIndex,
      calibrateRateAndTimer,
      clearFinishTimer,
      completeAndFlushPending,
      computeAvailableWallSecForTask,
      ensureCachedTtsFile,
      stageUrlOnStandby,
      ttsLocalCacheRef,
    ]
  );

  startTaskNowRef.current = startTaskNow;

  // Player listeners attached to both ping-pong instances
  useEffect(() => {
    const subs: { remove: () => void }[] = [];
    const bindSlot = (player: typeof ttsPlayerA, slotIdx: 0 | 1) => {
      subs.push(
        player.addListener('playToEnd', () => {
          if (activeSlotRef.current === slotIdx) {
            completeAndFlushPending();
          }
        })
      );
      subs.push(
        player.addListener('sourceLoad', (ev) => {
          const staged = stagedSlotsRef.current[slotIdx];
          if (staged) {
            staged.ready = true;
          }
          const task = currentTaskRef.current;
          const dur = ev.duration > 0 ? ev.duration : Number(player.duration) || 0;
          if (activeSlotRef.current === slotIdx && isSpeakingRef.current && task && dur > 0.2) {
            const activeGen = playGenRef.current;
            calibrateRateAndTimer(player, dur, task, () => {
              if (playGenRef.current === activeGen) {
                completeAndFlushPending();
              }
            });
          }
        })
      );
      subs.push(
        player.addListener('statusChange', (ev) => {
          if (ev.status === 'readyToPlay') {
            const staged = stagedSlotsRef.current[slotIdx];
            if (staged) {
              staged.ready = true;
            }
            const task = currentTaskRef.current;
            const dur = Number(player.duration) || 0;
            if (activeSlotRef.current === slotIdx && isSpeakingRef.current && task && dur > 0.2) {
              const activeGen = playGenRef.current;
              calibrateRateAndTimer(player, dur, task, () => {
                if (playGenRef.current === activeGen) {
                  completeAndFlushPending();
                }
              });
            }
          } else if (ev.status === 'error') {
            if (activeSlotRef.current !== slotIdx) {
              stagedSlotsRef.current[slotIdx] = null;
              return;
            }
            clearFinishTimer();
            isSpeakingRef.current = false;
            pausedMidUtteranceRef.current = false;
            currentTaskRef.current = null;
            pendingCueRef.current = null;
            lastSpokenSigRef.current = '';
            onEngineErrorRef.current();
          }
        })
      );
    };
    bindSlot(ttsPlayerA, 0);
    bindSlot(ttsPlayerB, 1);

    return () => {
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {}
      });
    };
  }, [calibrateRateAndTimer, clearFinishTimer, completeAndFlushPending, ttsPlayerA, ttsPlayerB]);

  // Dedicated volume sync on both players (never restarts or aborts speech)
  useEffect(() => {
    const vol = Math.max(0, Math.min(1, (volume ?? 80) / 100));
    for (const p of playersRef.current) {
      try {
        p.audioMixingMode = 'mixWithOthers';
        p.staysActiveInBackground = true;
        p.muted = false;
        p.preservesPitch = true;
        p.volume = vol;
      } catch {}
    }
  }, [ttsPlayerA, ttsPlayerB, volume]);

  // Reset server prewarm tracking only on manual subtitle reload
  useEffect(() => {
    if (reloadNonce > 0) {
      serverPrewarmedRef.current.clear();
    }
  }, [reloadNonce]);

  // Hard reset only on episode change, manual reload, or voice mode switch
  useEffect(() => {
    playGenRef.current += 1;
    prefetchWaveIdRef.current += 1;
    clearFinishTimer();
    lastSpokenSigRef.current = '';
    isSpeakingRef.current = false;
    pausedMidUtteranceRef.current = false;
    currentTaskRef.current = null;
    pendingCueRef.current = null;
    stagedSlotsRef.current = [null, null];
    try {
      ttsPlayerA.pause();
    } catch {}
    try {
      ttsPlayerB.pause();
    } catch {}
    return () => {
      playGenRef.current += 1;
      prefetchWaveIdRef.current += 1;
      clearFinishTimer();
      try {
        ttsPlayerA.pause();
      } catch {}
      try {
        ttsPlayerB.pause();
      } catch {}
    };
  }, [episodeSignature, reloadNonce, voiceMode, ttsPlayerA, ttsPlayerB, clearFinishTimer]);

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
        ttsPlayerA.pause();
      } catch {}
      try {
        ttsPlayerB.pause();
      } catch {}
      return;
    }

    if (pausedMidUtteranceRef.current && isSpeakingRef.current) {
      pausedMidUtteranceRef.current = false;
      const activePlayer = playersRef.current[activeSlotRef.current];
      try {
        activePlayer.volume = Math.max(0, Math.min(1, (volumeRef.current ?? 80) / 100));
        activePlayer.preservesPitch = true;
        activePlayer.play();
        const dur = Number(activePlayer.duration) || 0;
        const pos = Math.max(0, Number(activePlayer.currentTime) || 0);
        const rate = Math.max(0.5, Number(activePlayer.playbackRate) || 1);
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
    ttsPlayerA,
    ttsPlayerB,
    clearFinishTimer,
    completeAndFlushPending,
  ]);

  // Seek / jump detector: immediately cancel stale speech on scrub > 1.8s and re-trigger lookahead
  useEffect(() => {
    const prevT = prevVideoTimeRef.current;
    prevVideoTimeRef.current = currentTime;
    if (Math.abs(currentTime - prevT) > 1.8) {
      playGenRef.current += 1;
      prefetchWaveIdRef.current += 1;
      clearFinishTimer();
      isSpeakingRef.current = false;
      pausedMidUtteranceRef.current = false;
      currentTaskRef.current = null;
      pendingCueRef.current = null;
      stagedSlotsRef.current = [null, null];
      lastSpokenSigRef.current = '';
      try {
        ttsPlayerA.pause();
      } catch {}
      try {
        ttsPlayerB.pause();
      } catch {}
      setSeekEpoch((e) => e + 1);
    }
  }, [currentTime, ttsPlayerA, ttsPlayerB, clearFinishTimer]);

  // 2-tier background pipeline:
  // Tier 1 (nearest 12 cues): download MP3 onto device cache & pre-stage next cue into standby player
  // Tier 2 (cues 13..42): gently pre-warm server cache_tts_proxy via ?prewarm=1 (204 No Content)
  const scheduleLookahead = useCallback(async () => {
    const cues = vnCuesRef.current;
    if (!enabledRef.current || !Array.isArray(cues) || cues.length === 0) return;

    const waveId = ++prefetchWaveIdRef.current;
    let anchorIdx = mainVnIndexRef.current;
    if (anchorIdx < 0) {
      const t = effectiveTimeRef.current;
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i];
        if (c && !c.isTop && c.end + extendSecRef.current >= t && isSpeakableSubtitleText(c.text)) {
          anchorIdx = i;
          break;
        }
      }
      if (anchorIdx < 0) return;
    }

    const totalCollect = TTS_LOCAL_PREFETCH_COUNT + TTS_SERVER_PREWARM_COUNT;
    const specs: CueAudioSpec[] = [];
    for (let i = anchorIdx; i < cues.length && specs.length < totalCollect; i++) {
      const spec = buildSpecForCueIndex(i);
      if (spec) specs.push(spec);
    }
    if (specs.length === 0) return;

    const localBatch = specs.slice(0, TTS_LOCAL_PREFETCH_COUNT);
    const serverBatch = specs.slice(TTS_LOCAL_PREFETCH_COUNT);

    // Phase A: Urgent local fetch + standby pre-staging for immediate upcoming cue(s)
    const urgentSpecs = localBatch.slice(0, 2);
    let stagedUrgent = false;
    for (let u = 0; u < urgentSpecs.length; u++) {
      if (prefetchWaveIdRef.current !== waveId || !enabledRef.current) return;
      const spec = urgentSpecs[u];
      const uri = await ensureCachedTtsFile(spec.remoteUrl, true);
      if (prefetchWaveIdRef.current !== waveId || !enabledRef.current) return;
      if (uri && !stagedUrgent) {
        const isCurrentlyActive = currentTaskRef.current?.remoteUrl === spec.remoteUrl;
        if (!isCurrentlyActive) {
          stagedUrgent = true;
          void stageUrlOnStandby(spec.remoteUrl);
        }
      }
    }

    // Phase B: Tier 1 Local Device Prefetch (nearest 12 cues, bounded concurrency)
    let localCursor = 0;
    const runLocalWorker = async () => {
      while (localCursor < localBatch.length) {
        if (prefetchWaveIdRef.current !== waveId || !enabledRef.current) return;
        const spec = localBatch[localCursor++];
        if (!ttsLocalCacheRef.current.has(spec.remoteUrl)) {
          await ensureCachedTtsFile(spec.remoteUrl, true);
        }
      }
    };
    const localWorkers = Array.from(
      { length: Math.min(TTS_LOCAL_CONCURRENCY, localBatch.length) },
      () => runLocalWorker()
    );

    // Phase C: Tier 2 Server cache_tts_proxy Pre-Warm (cues 13..42 via ?prewarm=1 -> 204 No Content)
    let serverCursor = 0;
    let rateLimited = false;
    const runServerPrewarmWorker = async () => {
      while (serverCursor < serverBatch.length && !rateLimited) {
        if (prefetchWaveIdRef.current !== waveId || !enabledRef.current) return;
        const spec = serverBatch[serverCursor++];
        if (
          ttsLocalCacheRef.current.has(spec.remoteUrl) ||
          serverPrewarmedRef.current.has(spec.remoteUrl)
        ) {
          continue;
        }
        serverPrewarmedRef.current.add(spec.remoteUrl);
        if (serverPrewarmedRef.current.size > 1000) {
          const firstKey = serverPrewarmedRef.current.values().next().value;
          if (firstKey) serverPrewarmedRef.current.delete(firstKey);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(spec.prewarmUrl, {
            method: 'GET',
            signal: controller.signal,
          });
          if (res.status === 429) {
            rateLimited = true;
            break;
          }
          if (!res.ok && res.status !== 204) {
            serverPrewarmedRef.current.delete(spec.remoteUrl);
          }
        } catch {
          serverPrewarmedRef.current.delete(spec.remoteUrl);
        } finally {
          clearTimeout(timer);
        }
        if (prefetchWaveIdRef.current !== waveId || !enabledRef.current) return;
        await new Promise((r) => setTimeout(r, 90));
      }
    };
    const serverWorkers = Array.from(
      { length: Math.min(TTS_SERVER_PREWARM_CONCURRENCY, serverBatch.length) },
      () => runServerPrewarmWorker()
    );

    await Promise.all([...localWorkers, ...serverWorkers]);
  }, [buildSpecForCueIndex, ensureCachedTtsFile, stageUrlOnStandby, ttsLocalCacheRef]);

  useEffect(() => {
    if (!enabled || vnCues.length === 0) return;
    void scheduleLookahead();
  }, [
    enabled,
    vnCues,
    episodeSignature,
    reloadNonce,
    voiceMode,
    translateLang,
    mainVnIndex,
    seekEpoch,
    scheduleLookahead,
  ]);

  // Cue trigger effect: NEVER aborts in-flight speech when activeCue turns null during silent gaps
  useEffect(() => {
    if (!canPlayAudio || !activeCue || !isSpeakableSubtitleText(spokenText)) {
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
    const remoteUrl = buildTtsProxyUrl(spokenText, spokenLang, serverSpeed, effVoice, false);

    const task: QueuedTtsTask = {
      cueSig,
      cueIndex: mainVnIndex,
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

    // Ensure active cue file starts caching immediately if not already downloaded
    void ensureCachedTtsFile(remoteUrl, true);

    if (!isSpeakingRef.current) {
      void startTaskNow(task);
    } else {
      const activePlayer = playersRef.current[activeSlotRef.current];
      let remainingMs = Math.max(0, currentFinishEstMsRef.current - Date.now());
      try {
        const dur = Number(activePlayer.duration) || 0;
        const pos = Math.max(0, Number(activePlayer.currentTime) || 0);
        const rate = Math.max(0.5, Number(activePlayer.playbackRate) || 1);
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
    ensureCachedTtsFile,
    startTaskNow,
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
  previewSampleWhenIdle = false,
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

  const voiceEffectiveTime = isPlaying ? effectiveTime + TTS_START_LEAD_SEC : effectiveTime;
  const { voiceCue, voiceCueIndex } = useMemo(() => {
    if (!settings.subAiVoiceEnabled || vnCues.length === 0) {
      return { voiceCue: null as ParsedVttCue | null, voiceCueIndex: -1 };
    }
    for (let i = 0; i < vnCues.length; i++) {
      const c = vnCues[i];
      if (
        !c.isTop &&
        c.start <= voiceEffectiveTime &&
        voiceEffectiveTime <= c.end + extendSec &&
        isSpeakableSubtitleText(c.text)
      ) {
        return { voiceCue: c, voiceCueIndex: i };
      }
    }
    for (let i = 0; i < vnCues.length; i++) {
      const c = vnCues[i];
      if (
        c.isTop &&
        c.start <= voiceEffectiveTime &&
        voiceEffectiveTime <= c.end + extendSec &&
        isSpeakableSubtitleText(c.text)
      ) {
        return { voiceCue: c, voiceCueIndex: i };
      }
    }
    return { voiceCue: null as ParsedVttCue | null, voiceCueIndex: -1 };
  }, [settings.subAiVoiceEnabled, vnCues, voiceEffectiveTime, extendSec]);

  const activeVoiceCue = voiceCue;
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
      effectiveTime={effectiveTime}
      extendSec={extendSec}
      playbackRate={playbackRate}
      activeCue={activeVoiceCue}
      spokenText={activeSpokenText}
      spokenLang={activeSpokenLang}
      mainVnIndex={voiceCueIndex}
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

  const showSamplePreview = Boolean(previewSampleWhenIdle && !mainVnCue && !mainEnCue);
  const effectiveDisplayVnText =
    settings.subShowVi
      ? mainVnCue?.text || (showSamplePreview ? 'Phụ đề mẫu Đặng Việt Anh' : '')
      : '';
  const showVnLine = Boolean(effectiveDisplayVnText);
  const toLang = settings.subTranslateLang || '';
  const translatedText =
    toLang && mainVnCue ? translationCacheRef.current.get(`${toLang}::${mainVnCue.text}`) || '' : '';
  const isTranslatingLoading = Boolean(settings.subShowEn && toLang && mainVnCue && !translatedText);
  const secondaryText =
    settings.subShowEn && toLang
      ? translatedText || (showSamplePreview ? 'Sample subtitle preview' : '')
      : settings.subShowEn && mainEnCue?.text
        ? mainEnCue.text
        : settings.subShowEn && showSamplePreview
          ? 'Sample subtitle preview'
          : '';
  const showSecondaryLine = Boolean(settings.subShowEn && (secondaryText || isTranslatingLoading));

  const primaryColor = palette.main;
  const secondaryColor = palette.sub;

  const vnBlock = showVnLine && effectiveDisplayVnText ? (
    <View
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (Math.abs(w - vnMeasuredWidth) > 3) setVnMeasuredWidth(w);
      }}
    >
      <OutlinedText
        text={effectiveDisplayVnText}
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
