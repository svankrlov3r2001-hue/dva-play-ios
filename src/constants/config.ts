export const API_BASE_URL = 'https://dangvietanh.com/dva_ios/api';
export const SITE_BASE_URL = 'https://dangvietanh.com';
export const PORTAL_URL = 'https://dangvietanh.com/tai-ung-dung.html';
export const OTA_MANIFEST_URL = 'https://dangvietanh.com/dva_ios/app-version.json';
export const EXPO_UPDATES_URL = 'https://dangvietanh.com/dva_ios/api/updates.php';

export const APP_NAME = 'Đặng Việt Anh';
export const APP_BUNDLE_ID = 'com.dangvietanh.dvaplay';
export const APP_VERSION = '1.0.39';
export const APP_VERSION_CODE = 40;
export const APP_RUNTIME_VERSION = '1.0.0';
export const APP_RELEASE_DATE = '25/11/2026';

export const MAX_AUTO_DOWNLOAD_NEXT_COUNT = 5;

// Minimum startup connection splash duration matching dva-play/src/main/splashManager.js
export const SPLASH_MIN_DURATION_MS = 3000;
export const SPLASH_AUTO_RETRY_MS = 4000;

export const GLASS_SHADOW = '0px 20px 50px 0px rgba(0, 0, 0, 0.5)';

export const COLORS = {
  bg: '#07090F',
  bgElevated: '#0E121D',
  glass: 'rgba(18, 20, 28, 0.34)',
  glassLight: 'rgba(255, 255, 255, 0.08)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  accent: '#E50914',
  accentPink: '#D50055',
  accentGold: '#FBBF24',
  text: '#F8FAFC',
  textSecondary: '#CBD5E1',
  muted: '#94A3B8',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  cardPlaceholder: '#141926',
} as const;

export const RADII = {
  sm: 14,
  md: 20,
  lg: 24,
  xl: 32,
  pill: 999,
} as const;
