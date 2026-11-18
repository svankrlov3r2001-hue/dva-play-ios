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
    throw new Error(errMsg);
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
  videosId?: number
): Promise<StreamResolvedData> {
  const qs = new URLSearchParams({ stream_code: streamCode });
  if (videosId) qs.append('videos_id', String(videosId));
  return apiRequest(`stream_resolve.php?${qs.toString()}`);
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

export async function castPairApi(pairCode: string): Promise<any> {
  return apiRequest('cast.php?action=pair', {
    method: 'POST',
    body: JSON.stringify({ pair_code: pairCode }),
  });
}

export async function castPushApi(payload: Record<string, any>): Promise<any> {
  return apiRequest('cast.php?action=push', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function castStatusApi(roomId: string): Promise<any> {
  return apiRequest('cast.php?action=status', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  });
}

export async function castStopApi(roomId: string): Promise<any> {
  return apiRequest('cast.php?action=stop', {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  });
}

export async function checkOtaUpdateApi(): Promise<VersionManifest> {
  return apiRequest<VersionManifest>('', {}, `${OTA_MANIFEST_URL}?t=${Date.now()}`);
}
