export interface User {
  user_id: number;
  name: string;
  username: string;
  email: string;
  role: string;
  CTV: string | number | null;
  avatar_url: string;
}

export interface AuthCookies {
  _userid: string;
  email_key: string;
  email_val: string;
  pass_key: string;
  pass_val: string;
}

export interface MovieItem {
  videos_id: number;
  title: string;
  title_primary?: string;
  subtitle?: string;
  slug?: string;
  description?: string;
  year?: string;
  runtime?: string;
  video_quality?: string;
  imdb_rating?: string;
  is_tvseries: number;
  episode_badge?: string;
  season_label?: string;
  genres?: string[];
  countries?: string[];
  poster_url: string;
  thumb_url?: string;
  thumbnail_url: string;
  in_wishlist?: boolean;
  stream_code?: string;
  rank?: number;
  progress_percent?: number;
  viewed_rate?: string;
  time_remaining?: string;
  viewed_info?: string;
  resume_seconds?: number;
  total_view?: number;
  total_rating?: number;
}

export type HomeSectionLayout =
  | 'watched'
  | 'top10'
  | 'landscape'
  | 'vertical'
  | 'theatrical'
  | 'anime_hero'
  | 'topics'
  | 'country_hub';

export interface TopicItem {
  id: string;
  title: string;
  subtitle: string;
  theme: 'blue' | 'orange' | 'green' | 'red' | 'pink' | 'purple' | 'cyan' | 'dark';
  target_section: string;
}

export interface CountryHubRow {
  id: string;
  title: string;
  gradient: 'purple' | 'orange' | 'cyan' | 'pink';
  items: MovieItem[];
}

export interface HomeSection {
  id: string;
  title: string;
  layout: HomeSectionLayout;
  items: MovieItem[];
  topics?: TopicItem[];
  hub_rows?: CountryHubRow[];
}

export interface FilterOption {
  id: number;
  name: string;
  slug: string;
}

export interface EpisodeItem {
  episodes_id: number;
  seasons_id: number;
  episodes_name: string;
  stream_code: string;
  player_url: string;
  full_url: string;
  order: number;
}

export interface SeasonItem {
  seasons_id: number;
  seasons_name: string;
  order: number;
  episodes: EpisodeItem[];
}

export interface SourceItem {
  video_file_id: number;
  stream_key: string;
  label: string;
  file_source: string;
  stream_code: string;
  player_url: string;
  full_url: string;
}

export interface StarItem {
  id: number;
  name: string;
  slug: string;
  star_type: string;
  image_url: string;
}

export interface WatchHistory {
  viewed_rate: string;
  progress_percent: number;
  time_remaining: string;
  viewed_information: string;
  resume_seconds: number;
  last_stream_code: string;
  last_episode_id: number;
}

export interface MovieDetail {
  videos_id: number;
  code: string;
  stream_code: string;
  title: string;
  slug: string;
  description: string;
  release: string;
  year: string;
  runtime: string;
  video_quality: string;
  imdb_rating: string;
  is_tvseries: number;
  total_rating: number;
  total_view: number;
  poster_url: string;
  thumbnail_url: string;
  genres: FilterOption[];
  countries: FilterOption[];
  director_list: StarItem[];
  writer_list: StarItem[];
  star_list: StarItem[];
  in_wishlist: boolean;
  watch_history: WatchHistory;
  episodes: EpisodeItem[];
  seasons: SeasonItem[];
  sources: SourceItem[];
}

export interface PopupInfo {
  messager: string;
  videos_id: number;
  title: string;
  title_dot: string;
  description: string;
  image_poster_image: string;
  image_video_thumb: string;
  image_name: string;
  imdb_rating: string;
  runtime: string;
  release: string;
  video_quality: string;
  is_tvseries: number;
  in_wishlist: boolean;
  videos_se: number | string;
  episode_id: number;
  movies_url_getlink: string;
  viewed_rate: string;
  time_remaining: string;
  viewed_information: string;
  url_trailer_hls: string;
  url_trailer_stream: string;
  url_trailer_fallback: string;
}

export interface StreamQuality {
  label: string;
  url: string;
  type: 'hls' | 'mp4';
}

export interface StreamSubtitle {
  label: string;
  url: string;
  lang: string;
}

export interface StreamMovieContext {
  videos_id: number;
  title: string;
  slug?: string;
  description?: string;
  year?: string;
  runtime?: string;
  video_quality?: string;
  imdb_rating?: string;
  is_tvseries?: number;
  poster_url?: string;
  thumbnail_url?: string;
  in_wishlist?: boolean;
}

export interface StreamMemberInfo {
  user_id: number;
  name: string;
  avatar_url?: string;
  points: number;
  rank: string;
  is_vip: boolean;
  days_left: number;
  join_date?: string;
  expiry_date?: string;
}

export interface StreamResolvedData {
  success: boolean;
  stream_code: string;
  server_movie_title?: string;
  server_tap_phim?: string;
  server_file_key?: string;
  title?: string;
  episode_title?: string;
  can_play_native: boolean;
  primary_url: string;
  stream_type: 'hls' | 'mp4' | 'webview';
  download_mp4_url: string;
  qualities: StreamQuality[];
  subtitles: StreamSubtitle[];
  skip_intro_sec: number;
  end_credits_sec: number;
  next_episode_slug: string;
  resume_seconds: number;
  webview_url: string;
  movie?: StreamMovieContext | null;
  sources?: SourceItem[];
  seasons?: SeasonItem[];
  episodes?: EpisodeItem[];
  next_episode?: (EpisodeItem & { index?: number }) | null;
  member?: StreamMemberInfo | null;
}

export interface OfflineSubtitleTrack {
  lang: string;
  label: string;
  local_uri: string;
  relative_path: string;
}

export type OfflineDownloadStatus =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed';

export interface OfflineDownloadItem {
  id: string;
  videos_id: number;
  episode_id: number;
  episode_number?: number;
  stream_code: string;
  title: string;
  episode_title?: string;
  server_movie_title?: string;
  server_file_key?: string;
  media_format?: 'hls' | 'mp4';
  preferred_format?: 'auto' | 'hls' | 'mp4';
  poster_url: string;
  thumbnail_url: string;
  local_poster_uri?: string;
  local_uri: string;
  local_dir?: string;
  relative_entry?: string;
  remote_url: string;
  subtitles?: OfflineSubtitleTrack[];
  duration_sec?: number;
  skip_intro_sec?: number;
  end_credits_sec?: number;
  resume_sec?: number;
  resume_updated_at?: number;
  resume_sync_pending?: boolean;
  total_segments?: number;
  completed_segments?: number;
  size_bytes: number;
  progress: number;
  status: OfflineDownloadStatus;
  status_text?: string;
  error_message?: string;
  created_at: string;
  updated_at?: string;
}

export interface AppSettings {
  preferredQuality: 'auto' | '1080p' | '720p' | '360p';
  autoPlayNext: boolean;
  autoSkipIntro: boolean;
  pipEnabled: boolean;
  faceIdEnabled: boolean;
  wifiOnlyDownload: boolean;
  subtitleEnabled: boolean;
  subtitleFontSize: number;
  subtitleBottomOffset: number;
  subtitleBgOpacity: number;
  highContrastMode: boolean;
  videoFillMode: 'contain' | 'cover';
  autoDownloadCurrentOnWatch: boolean;
  autoDownloadNextCount: number;
  preferOfflineWhenOnline: boolean;
  offlineDownloadFormat: 'auto' | 'hls' | 'mp4';
  offlineDownloadConcurrency: number;
}

export interface VersionHistoryEntry {
  versionCode: number;
  versionName: string;
  date: string;
  title: string;
  changes: string[];
}

export interface VersionManifest {
  versionCode: number;
  versionName: string;
  releaseDate: string;
  ipaUrl?: string;
  portalUrl?: string;
  changelog: string;
  history: VersionHistoryEntry[];
}
