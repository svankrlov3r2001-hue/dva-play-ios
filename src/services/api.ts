import { API_BASE_URL, OTA_MANIFEST_URL } from '../constants/config';
import {
  AuthCookies,
  FilterOption,
  HomeSection,
  MovieDetail,
  MovieItem,
  PopupInfo,
  StreamResolvedData,
  User,
  VersionManifest,
} from '../types/models';
import {
  ProxyPreset,
  ResolvedProxyPresetResponse,
} from './proxyService';

let activeToken: string | null = null;

export function setApiAuthToken(token: string | null): void {
  activeToken = token;
}

export function getApiAuthToken(): string | null {
  return activeToken;
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  customUrl?: string
): Promise<T> {
  const url = customUrl ?? `${API_BASE_URL}/${endpoint}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (activeToken) {
    headers['Authorization'] = `Bearer ${activeToken}`;
    headers['X-DVA-Token'] = activeToken;
  }

  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Phản hồi máy chủ không hợp lệ (${res.status})`);
  }

  if (!res.ok) {
    const errMsg = json?.error || json?.message || `Lỗi máy chủ (${res.status})`;
    const apiErr = new Error(errMsg) as Error & { code?: string; status?: number };
    apiErr.code = json?.code || json?.err;
    apiErr.status = res.status;
    throw apiErr;
  }
  return json as T;
}

export async function loginApi(
  identity: string,
  password: string
): Promise<{ success: boolean; token: string; cookies: AuthCookies; user: User }> {
  return apiRequest('auth.php?action=login', {
    method: 'POST',
    body: JSON.stringify({ identity, password }),
  });
}

export async function checkAuthStatusApi(): Promise<{
  success: boolean;
  authenticated: boolean;
  user: User | null;
}> {
  return apiRequest('auth.php?action=status');
}

export async function logoutApi(): Promise<{ success: boolean }> {
  return apiRequest('auth.php?action=logout', { method: 'POST' });
}

export async function fetchHomeHubApi(
  mode: string = 'home',
  genreId: string = ''
): Promise<{
  success: boolean;
  mode: string;
  genres?: FilterOption[];
  hero: MovieItem[];
  sections: HomeSection[];
}> {
  const params = new URLSearchParams();
  if (mode) params.append('mode', mode);
  if (genreId) params.append('genre_id', genreId);
  return apiRequest(`home_hub.php?${params.toString()}`);
}

export async function deleteWatchedMovieApi(
  videosId: number
): Promise<{ success: boolean; affected_rows: number; message: string }> {
  return apiRequest('home_hub.php?action=delete_watched', {
    method: 'POST',
    body: JSON.stringify({ videos_id: videosId }),
  });
}

export async function fetchMoviesCatalogApi(params: {
  page?: number;
  limit?: number;
  type?: string;
  genre?: string;
  country?: string;
  q?: string;
  sort?: string;
}): Promise<{
  success: boolean;
  page: number;
  total: number;
  total_pages: number;
  data: MovieItem[];
  filters: { genres: FilterOption[]; countries: FilterOption[] };
}> {
  const qs = new URLSearchParams();
  if (params.page) qs.append('page', String(params.page));
  if (params.limit) qs.append('limit', String(params.limit));
  if (params.type) qs.append('type', params.type);
  if (params.genre) qs.append('genre', params.genre);
  if (params.country) qs.append('country', params.country);
  if (params.q) qs.append('q', params.q);
  if (params.sort) qs.append('sort', params.sort);
  return apiRequest(`movies.php?${qs.toString()}`);
}

export async function fetchMovieDetailsApi(
  videosId: number,
  episodeId?: number
): Promise<{
  success: boolean;
  movie: MovieDetail;
  related: MovieItem[];
}> {
  const qs = new URLSearchParams({ id: String(videosId) });
  if (episodeId) qs.append('episode_id', String(episodeId));
  return apiRequest(`movie_details.php?${qs.toString()}`);
}

export async function fetchPopupInfoApi(videosId: number): Promise<PopupInfo> {
  return apiRequest(`movies_popup_receive_information.php?id_movies=${videosId}`);
}

export async function searchSuggestApi(
  q: string
): Promise<{ success: boolean; suggestions: MovieItem[] }> {
  return apiRequest(`user_actions.php?action=search_suggest&q=${encodeURIComponent(q)}`);
}

export async function fetchGenresApi(): Promise<{ success: boolean; genres: FilterOption[] }> {
  return apiRequest('user_actions.php?action=genres');
}

export async function fetchCountriesApi(): Promise<{ success: boolean; countries: FilterOption[] }> {
  return apiRequest('user_actions.php?action=countries');
}

export async function toggleWishlistApi(
  videosId: number
): Promise<{ success: boolean; in_wishlist: boolean }> {
  return apiRequest('user_actions.php?action=toggle_wishlist', {
    method: 'POST',
    body: JSON.stringify({ videos_id: videosId }),
  });
}

export async function fetchNotificationsApi(): Promise<{
  success: boolean;
  notifications: {
    videos_id: number;
    title: string;
    subtitle: string;
    thumbnail_url: string;
  }[];
}> {
  return apiRequest('user_actions.php?action=notifications');
}

export async function fetchLibraryApi(): Promise<{
  success: boolean;
  wishlist: MovieItem[];
  watched: MovieItem[];
}> {
  return apiRequest('user_actions.php?action=library');
}

export async function resolveStreamApi(
  streamCode: string,
  videosId?: number,
  signal?: AbortSignal
): Promise<StreamResolvedData> {
  const qs = new URLSearchParams({ stream_code: streamCode });
  if (videosId) qs.append('videos_id', String(videosId));
  return apiRequest(`stream_resolve.php?${qs.toString()}`, signal ? { signal } : {});
}

export async function saveWatchProgressApi(payload: {
  videos_id: number;
  stream_code: string;
  position_sec: number;
  duration_sec: number;
  episode_number?: number;
  season_id?: string;
  title?: string;
}): Promise<{ success: boolean }> {
  return apiRequest('stream_resolve.php?action=save_progress', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchWatchProgressApi(
  streamCode: string,
  videosId?: number
): Promise<{
  success: boolean;
  stream_code: string;
  resume_seconds: number;
  updated_at: number;
}> {
  const qs = new URLSearchParams({ action: 'get_progress', stream_code: streamCode });
  if (videosId) qs.append('videos_id', String(videosId));
  return apiRequest(`stream_resolve.php?${qs.toString()}`);
}

export async function fetchBatchWatchProgressApi(
  items: { stream_code: string; videos_id?: number }[]
): Promise<{
  success: boolean;
  progress: Record<string, { resume_seconds: number; updated_at: number }>;
}> {
  return apiRequest('stream_resolve.php?action=batch_progress', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export interface QrPendingDevice {
  key: string;
  formatted_key: string;
  device: string;
  ip: string;
  expires_at: string;
}

export async function fetchQrPendingDevicesApi(): Promise<{
  success: boolean;
  devices: QrPendingDevice[];
}> {
  return apiRequest(`auth.php?action=qr_pending_devices&_t=${Date.now()}`);
}

export async function claimQuickLoginQrApi(
  qrLoginKey: string,
  source: 'qr' | 'manual' | 'pending' = 'manual'
): Promise<{
  success: boolean;
  key: string;
  formatted_key: string;
  device: string;
  ip: string;
}> {
  return apiRequest('auth.php?action=qr_scan_claim', {
    method: 'POST',
    body: JSON.stringify({ qr_login_key: qrLoginKey, source }),
  });
}

export async function approveQuickLoginQrApi(
  qrLoginKey: string,
  method: 'biometric' | 'password',
  password?: string
): Promise<{
  success: boolean;
  message: string;
  key: string;
  formatted_key: string;
  device: string;
}> {
  return apiRequest('auth.php?action=qr_approve', {
    method: 'POST',
    body: JSON.stringify({ qr_login_key: qrLoginKey, method, password }),
  });
}

export async function castPairApi(code: string): Promise<any> {
  return apiRequest('cast.php?action=pair', {
    method: 'POST',
    body: JSON.stringify({ code, pair_code: code }),
  });
}

export async function castPushApi(payload: Record<string, any>): Promise<any> {
  return apiRequest('cast.php?action=push', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function castStatusApi(senderToken: string): Promise<any> {
  return apiRequest('cast.php?action=status', {
    method: 'POST',
    body: JSON.stringify({ sender_token: senderToken }),
  });
}

export async function castStopApi(senderToken: string): Promise<any> {
  return apiRequest('cast.php?action=stop', {
    method: 'POST',
    body: JSON.stringify({ sender_token: senderToken }),
  });
}

export async function checkOtaUpdateApi(): Promise<VersionManifest> {
  return apiRequest<VersionManifest>('', {}, `${OTA_MANIFEST_URL}?t=${Date.now()}`);
}

export interface DirectInstallStatusResponse {
  success: boolean;
  signed_ipa_ready: boolean;
  versionName: string;
  versionCode: number;
  signed_bundle_id: string;
  file_size: number;
}

export interface DirectInstallUrlResponse {
  success: boolean;
  itms_url: string;
  manifest_url: string;
  versionName: string;
  versionCode: number;
  file_size: number;
  bundle_id: string;
}

export async function fetchDirectInstallStatusApi(): Promise<DirectInstallStatusResponse> {
  return apiRequest<DirectInstallStatusResponse>(`itms_install.php?action=status&_t=${Date.now()}`);
}

export async function fetchDirectInstallUrlApi(): Promise<DirectInstallUrlResponse> {
  return apiRequest<DirectInstallUrlResponse>(`itms_install.php?action=get_install_url&_t=${Date.now()}`);
}

export async function fetchProxyPresetsApi(): Promise<{
  success: boolean;
  presets: ProxyPreset[];
}> {
  return apiRequest(`proxy.php?action=presets&_t=${Date.now()}`);
}

export async function resolveProxyPresetApi(
  presetId: string
): Promise<ResolvedProxyPresetResponse> {
  return apiRequest(`proxy.php?action=resolve_preset&_t=${Date.now()}`, {
    method: 'POST',
    body: JSON.stringify({ preset_id: presetId }),
  });
}

export async function initQrLoginSessionApi(device = 'DVA Play iPhone'): Promise<{
  success: boolean;
  key: string;
  formatted_key: string;
  qr_url: string;
  expires_in: number;
}> {
  return apiRequest(`auth.php?action=qr_session_init&_t=${Date.now()}`, {
    method: 'POST',
    body: JSON.stringify({ device }),
  });
}

export async function pollQrLoginSessionApi(qrLoginKey: string): Promise<{
  success: boolean;
  state: 'waiting' | 'claimed' | 'approved' | 'expired';
  expires_in?: number;
  name?: string;
  avatar_url?: string;
  token?: string;
  cookies?: AuthCookies;
  user?: User;
}> {
  return apiRequest(`auth.php?action=qr_session_poll&_t=${Date.now()}`, {
    method: 'POST',
    body: JSON.stringify({ qr_login_key: qrLoginKey }),
  });
}

export async function cancelQrLoginSessionApi(qrLoginKey: string): Promise<{ success: boolean }> {
  return apiRequest('auth.php?action=qr_session_cancel', {
    method: 'POST',
    body: JSON.stringify({ qr_login_key: qrLoginKey }),
  });
}

export interface PasskeyCredentialInfo {
  id: number;
  device_name: string;
  created_at: string;
  last_used_at: string;
}

export async function fetchPasskeyStatusApi(): Promise<{
  success: boolean;
  linked: boolean;
  count: number;
  credentials: PasskeyCredentialInfo[];
}> {
  return apiRequest(`auth.php?action=passkey_status&_t=${Date.now()}`);
}

export async function requestPasskeyLinkTicketApi(): Promise<{
  success: boolean;
  ticket: string;
  url: string;
}> {
  return apiRequest(`auth.php?action=passkey_ticket&_t=${Date.now()}`, {
    method: 'POST',
    body: '{}',
  });
}

export async function unlinkPasskeyApi(id?: number): Promise<{
  success: boolean;
  linked: boolean;
  count: number;
}> {
  return apiRequest('auth.php?action=passkey_unlink', {
    method: 'POST',
    body: JSON.stringify(id ? { id } : { all: true }),
  });
}

export async function exchangePasskeyCodeApi(code: string): Promise<{
  success: boolean;
  token: string;
  cookies: AuthCookies;
  user: User;
}> {
  return apiRequest(`auth.php?action=passkey_exchange&_t=${Date.now()}`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}
