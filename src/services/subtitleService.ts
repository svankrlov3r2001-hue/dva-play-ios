import * as FileSystem from 'expo-file-system/legacy';
import {
  OfflineDownloadItem,
  StreamSubtitle,
  SubtitleAiVoiceMode,
  SubtitleColorOption,
  SubtitleFontOption,
  SubtitleOutlineOption,
} from '../types/models';

export interface ParsedVttCue {
  start: number;
  end: number;
  text: string;
  isTop: boolean;
  linePercent: number | null;
}

export const PRE_TRANSLATE_COUNT = 20;

export const SUBTITLE_FONT_OPTIONS: {
  value: SubtitleFontOption;
  label: string;
  iosFontFamily?: string;
}[] = [
  { value: 'Arial,Helvetica,sans-serif', label: 'Ahri (Mặc định)', iosFontFamily: 'Arial' },
  { value: 'Noto Sans', label: 'Noto Sans', iosFontFamily: 'Helvetica Neue' },
  { value: 'Roboto', label: 'Roboto', iosFontFamily: 'Helvetica Neue' },
  { value: 'Inter', label: 'Inter', iosFontFamily: 'Avenir Next' },
  { value: 'Literata', label: 'Literata (Serif)', iosFontFamily: 'Georgia' },
];

export const SUBTITLE_COLOR_PALETTE: Record<
  SubtitleColorOption,
  { label: string; main: string; sub: string }
> = {
  white: { label: 'Trắng', main: '#FFFFFF', sub: '#FFFFFFD0' },
  beige: { label: 'Kem (Be)', main: '#F5F5DC', sub: '#F5F5DCD0' },
  lightblue: { label: 'Xanh nhạt', main: '#4ECDF7', sub: '#4ECDF7D0' },
  red: { label: 'Đỏ', main: '#FF3B30', sub: '#FF3B30D0' },
  yellow: { label: 'Vàng', main: '#FFD60A', sub: '#FFD60AD0' },
  pink: { label: 'Hồng', main: '#FF80ED', sub: '#FF80EDD0' },
};

export const SUBTITLE_OUTLINE_OPTIONS: {
  value: SubtitleOutlineOption;
  label: string;
}[] = [
  { value: 'uniform2', label: 'Đồng nhất 2' },
  { value: 'uniform', label: 'Đồng nhất' },
  { value: 'shadow', label: 'Đổ bóng' },
  { value: 'raise', label: 'Nâng lên' },
  { value: 'lower', label: 'Nén xuống' },
  { value: 'none', label: 'Không viền' },
];

export const AI_VOICE_OPTIONS: {
  value: SubtitleAiVoiceMode | 'none';
  label: string;
  subtitle: string;
}[] = [
  { value: 'none', label: 'Tắt thuyết minh', subtitle: 'Chỉ hiển thị phụ đề chữ' },
  {
    value: 'adaptive',
    label: 'Tùy biến tự động',
    subtitle: 'Luân phiên Hoài My • Nam Minh • Chị Google mỗi 10 phút',
  },
  { value: 'hoaimy', label: 'Hoài My', subtitle: 'Giọng đọc nữ tự nhiên' },
  { value: 'namminh', label: 'Nam Minh', subtitle: 'Giọng đọc nam truyền cảm' },
  { value: 'google', label: 'Chị Google', subtitle: 'Giọng đọc tiêu chuẩn rõ nét' },
];

export const TRANSLATE_LANGUAGES: { code: string; name: string }[] = [
  { code: 'af', name: 'Tiếng Afrikaans' },
  { code: 'sq', name: 'Tiếng Albania' },
  { code: 'am', name: 'Tiếng Amharic' },
  { code: 'ar', name: 'Tiếng Ả Rập' },
  { code: 'hy', name: 'Tiếng Armenia' },
  { code: 'az', name: 'Tiếng Azerbaijan' },
  { code: 'eu', name: 'Tiếng Basque' },
  { code: 'be', name: 'Tiếng Belarus' },
  { code: 'bn', name: 'Tiếng Bengal' },
  { code: 'bs', name: 'Tiếng Bosnia' },
  { code: 'bg', name: 'Tiếng Bulgaria' },
  { code: 'ca', name: 'Tiếng Catalan' },
  { code: 'ceb', name: 'Tiếng Cebuano' },
  { code: 'zh-CN', name: 'Tiếng Trung (Giản thể)' },
  { code: 'zh-TW', name: 'Tiếng Trung (Phồn thể)' },
  { code: 'co', name: 'Tiếng Corsica' },
  { code: 'hr', name: 'Tiếng Croatia' },
  { code: 'cs', name: 'Tiếng Séc' },
  { code: 'da', name: 'Tiếng Đan Mạch' },
  { code: 'nl', name: 'Tiếng Hà Lan' },
  { code: 'en', name: 'Tiếng Anh' },
  { code: 'eo', name: 'Tiếng Esperanto' },
  { code: 'et', name: 'Tiếng Estonia' },
  { code: 'fi', name: 'Tiếng Phần Lan' },
  { code: 'fr', name: 'Tiếng Pháp' },
  { code: 'fy', name: 'Tiếng Frisia' },
  { code: 'gl', name: 'Tiếng Galicia' },
  { code: 'ka', name: 'Tiếng Gruzia' },
  { code: 'de', name: 'Tiếng Đức' },
  { code: 'el', name: 'Tiếng Hy Lạp' },
  { code: 'gu', name: 'Tiếng Gujarat' },
  { code: 'ht', name: 'Tiếng Creole Haiti' },
  { code: 'ha', name: 'Tiếng Hausa' },
  { code: 'haw', name: 'Tiếng Hawaii' },
  { code: 'he', name: 'Tiếng Do Thái' },
  { code: 'hi', name: 'Tiếng Hindi' },
  { code: 'hmn', name: 'Tiếng Hmong' },
  { code: 'hu', name: 'Tiếng Hungary' },
  { code: 'is', name: 'Tiếng Iceland' },
  { code: 'ig', name: 'Tiếng Igbo' },
  { code: 'id', name: 'Tiếng Indonesia' },
  { code: 'ga', name: 'Tiếng Ireland' },
  { code: 'it', name: 'Tiếng Ý' },
  { code: 'ja', name: 'Tiếng Nhật' },
  { code: 'jw', name: 'Tiếng Java' },
  { code: 'kn', name: 'Tiếng Kannada' },
  { code: 'kk', name: 'Tiếng Kazakh' },
  { code: 'km', name: 'Tiếng Khmer' },
  { code: 'ko', name: 'Tiếng Hàn' },
  { code: 'ku', name: 'Tiếng Kurd' },
  { code: 'ky', name: 'Tiếng Kyrgyz' },
  { code: 'lo', name: 'Tiếng Lào' },
  { code: 'la', name: 'Tiếng Latinh' },
  { code: 'lv', name: 'Tiếng Latvia' },
  { code: 'lt', name: 'Tiếng Litva' },
  { code: 'lb', name: 'Tiếng Luxembourg' },
  { code: 'mk', name: 'Tiếng Macedonia' },
  { code: 'mg', name: 'Tiếng Malagasy' },
  { code: 'ms', name: 'Tiếng Mã Lai' },
  { code: 'ml', name: 'Tiếng Malayalam' },
  { code: 'mt', name: 'Tiếng Malta' },
  { code: 'mi', name: 'Tiếng Maori' },
  { code: 'mr', name: 'Tiếng Marathi' },
  { code: 'mn', name: 'Tiếng Mông Cổ' },
  { code: 'my', name: 'Tiếng Myanmar' },
  { code: 'ne', name: 'Tiếng Nepal' },
  { code: 'no', name: 'Tiếng Na Uy' },
  { code: 'ny', name: 'Tiếng Nyanja' },
  { code: 'or', name: 'Tiếng Odia' },
  { code: 'ps', name: 'Tiếng Pashto' },
  { code: 'fa', name: 'Tiếng Ba Tư' },
  { code: 'pl', name: 'Tiếng Ba Lan' },
  { code: 'pt', name: 'Tiếng Bồ Đào Nha' },
  { code: 'pa', name: 'Tiếng Punjab' },
  { code: 'ro', name: 'Tiếng Rumani' },
  { code: 'ru', name: 'Tiếng Nga' },
  { code: 'sm', name: 'Tiếng Samoa' },
  { code: 'gd', name: 'Tiếng Gaelic Scotland' },
  { code: 'sr', name: 'Tiếng Serbia' },
  { code: 'st', name: 'Tiếng Sesotho' },
  { code: 'sn', name: 'Tiếng Shona' },
  { code: 'sd', name: 'Tiếng Sindhi' },
  { code: 'si', name: 'Tiếng Sinhala' },
  { code: 'sk', name: 'Tiếng Slovak' },
  { code: 'sl', name: 'Tiếng Slovenia' },
  { code: 'so', name: 'Tiếng Somali' },
  { code: 'es', name: 'Tiếng Tây Ban Nha' },
  { code: 'su', name: 'Tiếng Sunda' },
  { code: 'sw', name: 'Tiếng Swahili' },
  { code: 'sv', name: 'Tiếng Thụy Điển' },
  { code: 'tl', name: 'Tiếng Tagalog' },
  { code: 'tg', name: 'Tiếng Tajik' },
  { code: 'ta', name: 'Tiếng Tamil' },
  { code: 'tt', name: 'Tiếng Tatar' },
  { code: 'te', name: 'Tiếng Telugu' },
  { code: 'th', name: 'Tiếng Thái' },
  { code: 'tr', name: 'Tiếng Thổ Nhĩ Kỳ' },
  { code: 'tk', name: 'Tiếng Turkmen' },
  { code: 'uk', name: 'Tiếng Ukraina' },
  { code: 'ur', name: 'Tiếng Urdu' },
  { code: 'ug', name: 'Tiếng Uyghur' },
  { code: 'uz', name: 'Tiếng Uzbek' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'cy', name: 'Tiếng Wales' },
  { code: 'xh', name: 'Tiếng Xhosa' },
  { code: 'yi', name: 'Tiếng Yiddish' },
  { code: 'yo', name: 'Tiếng Yoruba' },
  { code: 'zu', name: 'Tiếng Zulu' },
];

export function encodeSubtitlePathUrl(rawUrl: string): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (!/[^\x20-\x7E]/.test(clean) && !clean.includes(' ')) {
    return clean;
  }
  const sslPrefix = 'ssl=';
  const sslIdx = clean.indexOf(sslPrefix);
  if (sslIdx >= 0) {
    const beforeSsl = clean.slice(0, sslIdx + sslPrefix.length);
    const afterSsl = clean.slice(sslIdx + sslPrefix.length);
    const ampIdx = afterSsl.indexOf('&');
    const rawPath = ampIdx >= 0 ? afterSsl.slice(0, ampIdx) : afterSsl;
    const suffix = ampIdx >= 0 ? afterSsl.slice(ampIdx) : '';
    const encodedPath = rawPath
      .split('/')
      .map((seg) => {
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join('/');
    return `${beforeSsl}${encodedPath}${suffix}`;
  }
  try {
    return encodeURI(clean);
  } catch {
    return clean;
  }
}

export function buildSubtitleUrls(serverFileKey?: string): { vnUrl: string; enUrl: string } {
  const cleanKey = String(serverFileKey || '').replace(/\.(mp4|m3u8)$/i, '').trim();
  if (!cleanKey) return { vnUrl: '', enUrl: '' };
  const theloai =
    cleanKey.includes('.Tập.') || /[.\s]T[ậâa]p/i.test(cleanKey) ? 'Phim.Bộ' : 'Phim.Lẻ';
  const baseCode = cleanKey.split(/[.\s]T[ậâa]p/i)[0] || cleanKey.replace(/\.Tập\..*$/, '');
  return {
    vnUrl: encodeSubtitlePathUrl(
      `https://sub.dangvietanh.com/dashboard?ssl=${theloai}/${baseCode}/Subtitle/VN/${cleanKey}.vtt&dtpd=0&vtpd=80&vtpdtt=0`
    ),
    enUrl: encodeSubtitlePathUrl(
      `https://sub.dangvietanh.com/dashboard?ssl=${theloai}/${baseCode}/Subtitle/EN/${cleanKey}.vtt&dtpd=0&vtpd=80&vtpdtt=0`
    ),
  };
}

function parseTimestamp(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const mFull = clean.match(/(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (mFull) {
    return (
      parseInt(mFull[1], 10) * 3600 +
      parseInt(mFull[2], 10) * 60 +
      parseFloat(mFull[3])
    );
  }
  const mShort = clean.match(/(\d{1,2}):(\d{2}(?:\.\d+)?)/);
  if (mShort) {
    return parseInt(mShort[1], 10) * 60 + parseFloat(mShort[2]);
  }
  return 0;
}

export function splitSubtitleText(text: string, maxLength = 43): string {
  if (!text || text.length <= maxLength) return text;
  const words = text.split(' ');
  if (words.length <= 1) return text;
  const halfLength = text.length / 2;
  let currentLength = 0;
  let bestSplitIndex = -1;
  let minDiff = Infinity;

  for (let i = 0; i < words.length - 1; i++) {
    currentLength += words[i].length + 1;
    let diff = Math.abs(currentLength - halfLength);
    if (/[.,!?]$/.test(words[i])) {
      diff -= 15;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bestSplitIndex = i;
    }
  }

  if (bestSplitIndex !== -1) {
    return `${words.slice(0, bestSplitIndex + 1).join(' ')}\n${words
      .slice(bestSplitIndex + 1)
      .join(' ')}`;
  }
  return text;
}

export function parseVttCues(vttText: string): ParsedVttCue[] {
  if (!vttText) return [];
  const lines = vttText.replace(/WEBVTT/gi, '').replace(/\r/g, '').split('\n');
  const cues: ParsedVttCue[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = (lines[i] || '').trim();
    if (!line || line.startsWith('NOTE')) {
      i++;
      continue;
    }
    const timeMatch = line.match(
      /(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)/
    );
    if (timeMatch) {
      const lineMatch = line.match(/line:(\d+)/);
      const linePercent = lineMatch ? parseInt(lineMatch[1], 10) : null;
      const isTopLine = line.includes('line:2%');
      i++;
      const buf: string[] = [];
      while (i < lines.length && lines[i] && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        const cleaned = lines[i].replace(/<[^>]*>/g, '').trim();
        if (cleaned) buf.push(cleaned);
        i++;
      }
      const rawJoined = buf.join('\n');
      if (rawJoined) {
        const isTopText = rawJoined.includes('♪') || rawJoined.includes('=');
        const formatted = rawJoined
          .split('\n')
          .map((l) => splitSubtitleText(l, 43))
          .join('\n');
        const start = parseTimestamp(timeMatch[1]);
        const end = parseTimestamp(timeMatch[2]);
        if (end > start) {
          cues.push({
            start,
            end,
            text: formatted,
            isTop: isTopLine || isTopText,
            linePercent,
          });
        }
      }
    } else {
      i++;
    }
  }

  return cues.sort((a, b) => a.start - b.start);
}

async function fetchTextSafe(url: string, bustCache = false): Promise<string> {
  if (!url) return '';
  try {
    let targetUrl = url;
    if (bustCache && /^https?:\/\//i.test(url)) {
      const sep = url.includes('?') ? '&' : '?';
      targetUrl = `${url}${sep}_r=${Date.now()}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(targetUrl, {
        signal: controller.signal,
        ...(bustCache ? { cache: 'no-store' as RequestCache } : {}),
      });
      if (!res.ok) return '';
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return '';
  }
}

export async function loadDualSubtitles(opts: {
  serverFileKey?: string;
  resolvedSubtitles?: StreamSubtitle[];
  offlineItem?: OfflineDownloadItem | null;
  bustCache?: boolean;
}): Promise<{ vnCues: ParsedVttCue[]; enCues: ParsedVttCue[]; vnUrl: string; enUrl: string }> {
  const { serverFileKey, resolvedSubtitles = [], offlineItem, bustCache = false } = opts;
  const constructed = buildSubtitleUrls(serverFileKey);
  const resolvedVn = resolvedSubtitles.find((s) => s.lang === 'vi')?.url || '';
  const resolvedEn = resolvedSubtitles.find((s) => s.lang === 'en')?.url || '';

  const vnUrl = constructed.vnUrl || resolvedVn || resolvedSubtitles[0]?.url || '';
  const enUrl = constructed.enUrl || resolvedEn || '';

  // Prefer local offline VTT files when available (unless explicitly busting remote cache if offline file missing)
  if (offlineItem?.subtitles && offlineItem.subtitles.length > 0) {
    const localVn = offlineItem.subtitles.find((s) => s.lang === 'vi') || offlineItem.subtitles[0];
    const localEn = offlineItem.subtitles.find((s) => s.lang === 'en');
    const [vnTxt, enTxt] = await Promise.all([
      localVn ? FileSystem.readAsStringAsync(localVn.local_uri).catch(() => '') : Promise.resolve(''),
      localEn ? FileSystem.readAsStringAsync(localEn.local_uri).catch(() => '') : Promise.resolve(''),
    ]);
    if (vnTxt || enTxt) {
      return {
        vnCues: parseVttCues(vnTxt),
        enCues: parseVttCues(enTxt),
        vnUrl,
        enUrl,
      };
    }
  }

  const [vnRaw, enRaw] = await Promise.all([
    fetchTextSafe(vnUrl, bustCache),
    fetchTextSafe(enUrl, bustCache),
  ]);
  return {
    vnCues: parseVttCues(vnRaw),
    enCues: parseVttCues(enRaw),
    vnUrl,
    enUrl,
  };
}

/**
 * Computes auto subtitle font step (1..20, default 18) & bottom position (-10..40%, default 12%).
 */
export function computeAutoSubtitleLayout(
  viewportHeight: number,
  subHighRaw?: string
): { fontStep: number; positionPct: number } {
  void viewportHeight;
  const rawStr = String(subHighRaw ?? '').trim();
  const vitriNum = rawStr !== '' ? parseInt(rawStr, 10) : NaN;
  const offset = !isNaN(vitriNum) ? Math.floor((90 - vitriNum) / 2) : null;

  const fontStep = Math.max(1, Math.min(20, 18));
  const posPct = Math.max(-10, Math.min(40, offset !== null ? 12 + offset : 12));

  return { fontStep, positionPct: posPct };
}

export async function translateTextViaApi(text: string, toLang: string): Promise<string | null> {
  if (!text || !toLang) return null;
  try {
    const apiUrl = `https://api.datpmt.com/api/v2/dictionary/translate?string=${encodeURIComponent(
      text
    )}&from_lang=vi&to_lang=${encodeURIComponent(toLang)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(apiUrl, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data === 'string' && data.trim() ? data : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

export function getAdaptiveVoiceForTime(
  mode: SubtitleAiVoiceMode,
  timeSec: number
): 'hoaimy' | 'namminh' | 'google' {
  if (mode !== 'adaptive') {
    return mode;
  }
  const cycleIndex = Math.floor(Math.max(0, timeSec) / 600) % 3;
  if (cycleIndex === 0) return 'hoaimy';
  if (cycleIndex === 1) return 'namminh';
  return 'google';
}

export function estimateNaturalTtsDurationSec(cleanText: string): number {
  const normalized = String(cleanText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 0.75;
  const words = normalized.split(' ').filter(Boolean).length;
  const chars = normalized.length;
  const punctuationPauses = (normalized.match(/[,;:.!?…]/g) || []).length;
  const byWords = words * 0.285;
  const byChars = chars / 14.5;
  return Math.max(
    0.75,
    Math.max(byWords, byChars) * 0.92 + Math.min(punctuationPauses, 4) * 0.14 + 0.25
  );
}

export function findNextSpeakableCue(
  cues: ParsedVttCue[],
  currentIndex: number
): ParsedVttCue | null {
  if (!Array.isArray(cues) || currentIndex < 0) return null;
  for (let i = currentIndex + 1; i < cues.length; i++) {
    const c = cues[i];
    if (c && !c.isTop && c.text.trim() && !c.text.includes('♪')) {
      return c;
    }
  }
  return null;
}

export function computeCueSpeechWindowSec(opts: {
  cueStart: number;
  cueEnd: number;
  extendSec?: number;
  nextCueStart?: number | null;
  videoPlaybackRate?: number;
}): number {
  const cueDur = Math.max(0.4, opts.cueEnd + (opts.extendSec || 0) - opts.cueStart);
  const maxBorrowSec = 1.8;
  const breathMarginSec = 0.12;
  let usableVideoSec: number;
  if (typeof opts.nextCueStart === 'number' && opts.nextCueStart > opts.cueStart) {
    const roomToNext = Math.max(0.4, opts.nextCueStart - opts.cueStart - breathMarginSec);
    usableVideoSec = Math.min(cueDur + maxBorrowSec, Math.max(cueDur * 0.85, roomToNext));
  } else {
    usableVideoSec = cueDur + maxBorrowSec;
  }
  const videoRate = Math.max(0.5, Math.min(2.0, opts.videoPlaybackRate || 1.0));
  return usableVideoSec / videoRate;
}

export function calculateTtsSpeed(
  cleanText: string,
  speechWindowSec: number,
  effectiveVoice: 'hoaimy' | 'namminh' | 'google'
): number {
  if (!cleanText || speechWindowSec <= 0) return 1;

  // Google voice returns clean native high-bitrate MP3 only at speed=1;
  // gentle speed matching is performed locally via AVPlayer preservesPitch=true.
  if (effectiveVoice === 'google') {
    return 1;
  }

  const safeWindow = Math.max(1.4, speechWindowSec);
  const estDur = estimateNaturalTtsDurationSec(cleanText);
  const requiredSpeed = estDur / safeWindow;

  if (cleanText.trim().length <= 18) {
    return requiredSpeed > 1.22 ? 1.1 : 1;
  }

  if (requiredSpeed <= 1.06) return 1;
  if (requiredSpeed <= 1.18) return 1.1;
  if (requiredSpeed <= 1.32) return 1.2;
  return 1.25;
}

export function computeLocalTtsPlaybackRate(opts: {
  actualAudioDurSec: number;
  availableWallSec: number;
  effectiveVoice: 'hoaimy' | 'namminh' | 'google';
  serverSpeed: number;
  videoPlaybackRate?: number;
}): number {
  void opts.serverSpeed;
  const speechDur = Math.max(0.45, opts.actualAudioDurSec - 0.16);
  const safeWindow = Math.max(1.3, opts.availableWallSec);
  if (speechDur <= safeWindow) return 1;

  const rawRatio = speechDur / safeWindow;
  const videoRate = Math.max(0.5, Math.min(2.0, opts.videoPlaybackRate || 1.0));
  const videoScale = videoRate > 1.05 ? Math.min(1.18, 1 + (videoRate - 1) * 0.45) : 1;
  const baseMax = opts.effectiveVoice === 'google' ? 1.35 : 1.2;
  const hardCeiling = opts.effectiveVoice === 'google' ? 1.5 : 1.35;
  const maxLocal = Math.min(hardCeiling, baseMax * videoScale);

  return Math.round(Math.max(1, Math.min(maxLocal, rawRatio)) * 100) / 100;
}

export function buildTtsProxyUrl(
  text: string,
  lang: string,
  speed: number,
  voiceGd: 'hoaimy' | 'namminh' | 'google'
): string {
  return `https://handle.dangvietanh.com/tts_proxy?text=${encodeURIComponent(
    text
  )}&tl=${encodeURIComponent(lang || 'vi')}&speed=${speed}&voice_gd=${encodeURIComponent(
    voiceGd
  )}`;
}
