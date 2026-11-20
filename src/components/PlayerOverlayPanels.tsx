import React, { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { GlassSurface } from './GlassSurface';
import { COLORS, RADII } from '../constants/config';
import {
  AppSettings,
  EpisodeItem,
  OfflineDownloadItem,
  SeasonItem,
  SourceItem,
  StreamQuality,
  StreamResolvedData,
  User,
} from '../types/models';

export type PlayerPanelType =
  | 'servers'
  | 'episodes'
  | 'subtitles'
  | 'settings'
  | 'speed'
  | 'info'
  | 'more'
  | null;

interface PlayerOverlayPanelsProps {
  activePanel: PlayerPanelType;
  onClose: () => void;
  onSwitchPanel: (panel: PlayerPanelType) => void;
  title: string;
  episodeTitle?: string;
  currentStreamCode: string;
  resolved: StreamResolvedData | null;
  activeQuality: StreamQuality | null;
  onSelectQuality: (q: StreamQuality) => void;
  onSelectSourceServer: (src: SourceItem) => void;
  episodes: EpisodeItem[];
  seasons: SeasonItem[];
  onSelectEpisode: (ep: EpisodeItem, idx: number) => void;
  activeSubIndex: number;
  onSelectSubtitleIndex: (idx: number) => void;
  playbackRate: number;
  onSelectRate: (rate: number) => void;
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => void;
  sleepMinutesLeft: number | null;
  onSelectSleepTimer: (mins: number | null) => void;
  inWishlist: boolean;
  onToggleWishlist: () => void;
  offlineItem: OfflineDownloadItem | null;
  onDownloadOffline: () => void;
  onOpenWebPlayer: () => void;
  onOpenCast?: () => void;
  user: User | null;
}

const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const FONT_SIZE_OPTIONS = [
  { label: 'Nhỏ', value: 14 },
  { label: 'Vừa', value: 17 },
  { label: 'Lớn', value: 21 },
  { label: 'Rất lớn', value: 25 },
];
const SUB_POS_OPTIONS = [
  { label: 'Thấp', value: 24 },
  { label: 'Vừa', value: 42 },
  { label: 'Cao', value: 74 },
];
const SUB_BG_OPTIONS = [
  { label: 'Trong suốt', value: 0 },
  { label: 'Mờ nhẹ', value: 0.48 },
  { label: 'Nền đậm', value: 0.78 },
];
const SLEEP_OPTIONS = [
  { label: 'Tắt', value: null },
  { label: '15p', value: 15 },
  { label: '30p', value: 30 },
  { label: '45p', value: 45 },
  { label: '60p', value: 60 },
];

const PANEL_TITLES: Record<Exclude<PlayerPanelType, null>, string> = {
  servers: 'Máy chủ & Nguồn phát',
  episodes: 'Danh sách tập phim',
  subtitles: 'Mở & Cài đặt phụ đề',
  settings: 'Cài đặt trình phát',
  speed: 'Tốc độ phát',
  info: 'Thông tin phim & Thành viên',
  more: 'Tùy chọn khác',
};

function OptionRow({
  icon,
  label,
  badge,
  selected,
  accentBadge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  badge?: string;
  selected?: boolean;
  accentBadge?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      style={[styles.optionRow, selected && styles.optionRowSelected]}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
    >
      <View style={styles.optionLeft}>
        <Ionicons name={icon} size={22} color={selected ? COLORS.accent : '#FFF'} />
        <Text style={styles.optionLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {badge ? (
        <View style={[styles.badgePill, accentBadge && styles.badgePillAccent]}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : selected ? (
        <Ionicons name="checkmark-circle" size={22} color={COLORS.accent} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
      )}
    </TouchableOpacity>
  );
}

function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleLeft}>
        <Ionicons name={icon} size={22} color={value ? COLORS.accent : '#FFF'} />
        <View style={{ flex: 1 }}>
          <Text style={styles.optionLabel}>{title}</Text>
          {subtitle ? <Text style={styles.optionSub}>{subtitle}</Text> : null}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.selectionAsync();
          onChange(v);
        }}
        trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
        thumbColor="#FFF"
      />
    </View>
  );
}

export function PlayerOverlayPanels({
  activePanel,
  onClose,
  onSwitchPanel,
  title,
  episodeTitle,
  currentStreamCode,
  resolved,
  activeQuality,
  onSelectQuality,
  onSelectSourceServer,
  episodes,
  seasons,
  onSelectEpisode,
  activeSubIndex,
  onSelectSubtitleIndex,
  playbackRate,
  onSelectRate,
  settings,
  onUpdateSetting,
  sleepMinutesLeft,
  onSelectSleepTimer,
  inWishlist,
  onToggleWishlist,
  offlineItem,
  onDownloadOffline,
  onOpenWebPlayer,
  onOpenCast,
  user,
}: PlayerOverlayPanelsProps) {
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | null>(null);
  const [infoTab, setInfoTab] = useState<'movie' | 'member'>('movie');

  const seasonList = useMemo(() => {
    if (seasons.length > 0) return seasons;
    if (episodes.length > 0) {
      return [{ seasons_id: 0, seasons_name: 'Danh sách tập', order: 1, episodes }];
    }
    return [];
  }, [seasons, episodes]);

  const activeSeason = useMemo(() => {
    if (seasonList.length === 0) return null;
    if (selectedSeasonId !== null) {
      return seasonList.find((s) => s.seasons_id === selectedSeasonId) || seasonList[0];
    }
    const matching = seasonList.find((s) =>
      s.episodes.some((ep) => ep.stream_code === currentStreamCode)
    );
    return matching || seasonList[0];
  }, [seasonList, selectedSeasonId, currentStreamCode]);

  if (!activePanel) return null;

  const isWide = activePanel === 'episodes' || activePanel === 'info';
  const movieCtx = resolved?.movie;
  const member = resolved?.member;
  const displayName = member?.name || user?.name || user?.username || 'Thành viên';
  const avatarUri = member?.avatar_url || user?.avatar_url;
  const vipDaysPct = member?.days_left ? Math.min(100, Math.round((member.days_left / 365) * 100)) : 0;

  return (
    <View style={styles.overlayWrap} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <GlassSurface variant="liquid" intensity={82} radius={40} style={[styles.panelCard, isWide && styles.panelCardWide]}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{PANEL_TITLES[activePanel]}</Text>
          <TouchableOpacity style={styles.closeIconBtn} onPress={onClose}>
            <Ionicons name="close" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.panelBody} contentContainerStyle={{ gap: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          {activePanel === 'servers' ? (
            <>
              <Text style={styles.sectionHeading}>Chất lượng / Luồng trực tiếp</Text>
              {resolved?.qualities?.length ? (
                resolved.qualities.map((q) => (
                  <OptionRow
                    key={`${q.label}-${q.url}`}
                    icon="flash-outline"
                    label={`${q.label} (${q.type.toUpperCase()})`}
                    selected={activeQuality?.url === q.url}
                    onPress={() => {
                      onSelectQuality(q);
                      onClose();
                    }}
                  />
                ))
              ) : (
                <Text style={styles.emptyText}>Nguồn hiện tại phát qua Web Player.</Text>
              )}

              {resolved?.sources && resolved.sources.length > 1 ? (
                <>
                  <Text style={styles.sectionHeading}>Máy chủ phim khác</Text>
                  {resolved.sources.map((src) => (
                    <OptionRow
                      key={src.video_file_id}
                      icon="server-outline"
                      label={src.label || 'Server dự phòng'}
                      selected={src.stream_code === currentStreamCode}
                      onPress={() => {
                        onSelectSourceServer(src);
                        onClose();
                      }}
                    />
                  ))}
                </>
              ) : null}

              <Text style={styles.sectionHeading}>Máy chủ dự phòng chuyên sâu</Text>
              <OptionRow
                icon="globe-outline"
                label="Mở Web Player (Phiên 11 / 36 / 40 / 99)"
                badge="Web"
                accentBadge
                onPress={() => {
                  onClose();
                  onOpenWebPlayer();
                }}
              />
            </>
          ) : null}

          {activePanel === 'episodes' ? (
            <>
              {seasonList.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {seasonList.map((s) => {
                    const active = activeSeason?.seasons_id === s.seasons_id;
                    return (
                      <TouchableOpacity
                        key={s.seasons_id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setSelectedSeasonId(s.seasons_id)}
                      >
                        <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>
                          {s.seasons_name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              ) : null}
              <View style={styles.epGrid}>
                {(activeSeason?.episodes || episodes).map((ep) => {
                  const globalIdx = episodes.findIndex((x) => x.episodes_id === ep.episodes_id);
                  const isCurrent = ep.stream_code === currentStreamCode;
                  return (
                    <TouchableOpacity
                      key={ep.episodes_id}
                      style={[styles.epTile, isCurrent && styles.epTileActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        onSelectEpisode(ep, globalIdx >= 0 ? globalIdx : 0);
                        onClose();
                      }}
                    >
                      <Text style={styles.epTileTxt} numberOfLines={1}>
                        {ep.episodes_name}
                      </Text>
                      {isCurrent ? <View style={styles.playingDot} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          {activePanel === 'subtitles' ? (
            <>
              <ToggleRow
                icon="text-outline"
                title="Hiển thị phụ đề"
                subtitle={resolved?.subtitles?.length ? `${resolved.subtitles.length} bản phụ đề khả dụng` : 'Chưa có track phụ đề rời'}
                value={settings.subtitleEnabled}
                onChange={(v) => onUpdateSetting('subtitleEnabled', v)}
              />

              {resolved?.subtitles && resolved.subtitles.length > 0 ? (
                <>
                  <Text style={styles.sectionHeading}>Chọn ngôn ngữ phụ đề</Text>
                  {resolved.subtitles.map((sub, idx) => (
                    <OptionRow
                      key={`${sub.lang}-${idx}`}
                      icon="chatbox-ellipses-outline"
                      label={sub.label}
                      selected={activeSubIndex === idx && settings.subtitleEnabled}
                      onPress={() => {
                        onUpdateSetting('subtitleEnabled', true);
                        onSelectSubtitleIndex(idx);
                      }}
                    />
                  ))}
                </>
              ) : null}

              <Text style={styles.sectionHeading}>Cỡ chữ</Text>
              <View style={styles.chipRow}>
                {FONT_SIZE_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, settings.subtitleFontSize === opt.value && styles.chipActive]}
                    onPress={() => onUpdateSetting('subtitleFontSize', opt.value)}
                  >
                    <Text style={styles.chipTxt}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionHeading}>Vị trí & Nền phụ đề</Text>
              <View style={styles.chipRow}>
                {SUB_POS_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.chip, settings.subtitleBottomOffset === opt.value && styles.chipActive]}
                    onPress={() => onUpdateSetting('subtitleBottomOffset', opt.value)}
                  >
                    <Text style={styles.chipTxt}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
                {SUB_BG_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={`bg-${opt.value}`}
                    style={[styles.chip, settings.subtitleBgOpacity === opt.value && styles.chipActive]}
                    onPress={() => onUpdateSetting('subtitleBgOpacity', opt.value)}
                  >
                    <Text style={styles.chipTxt}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.subPreviewBox}>
                <Text
                  style={[
                    styles.subPreviewTxt,
                    {
                      fontSize: settings.subtitleFontSize,
                      backgroundColor: `rgba(0,0,0,${settings.subtitleBgOpacity})`,
                    },
                  ]}
                >
                  Xem trước phụ đề Đặng Việt Anh
                </Text>
              </View>
            </>
          ) : null}

          {activePanel === 'settings' ? (
            <>
              <ToggleRow
                icon="play-skip-forward-outline"
                title="Tự động chuyển tập"
                subtitle="Kết hợp chuyển cảnh 2 layer mượt khi hết tập"
                value={settings.autoPlayNext}
                onChange={(v) => onUpdateSetting('autoPlayNext', v)}
              />
              <ToggleRow
                icon="flash-outline"
                title="Tự động bỏ qua giới thiệu"
                value={settings.autoSkipIntro}
                onChange={(v) => onUpdateSetting('autoSkipIntro', v)}
              />
              <ToggleRow
                icon="contrast-outline"
                title="Tăng độ tương phản"
                subtitle="Tăng chiều sâu khung hình và làm nét nhân vật"
                value={settings.highContrastMode}
                onChange={(v) => onUpdateSetting('highContrastMode', v)}
              />
              <ToggleRow
                icon="scan-outline"
                title="Tràn viền màn hình"
                subtitle={settings.videoFillMode === 'cover' ? 'Đang phủ toàn khung hình' : 'Đang giữ đúng tỷ lệ gốc'}
                value={settings.videoFillMode === 'cover'}
                onChange={(v) => onUpdateSetting('videoFillMode', v ? 'cover' : 'contain')}
              />
              <ToggleRow
                icon="albums-outline"
                title="Hình trong hình (PiP)"
                value={settings.pipEnabled}
                onChange={(v) => onUpdateSetting('pipEnabled', v)}
              />
              <Text style={styles.sectionHeading}>
                Hẹn giờ tắt phim{sleepMinutesLeft !== null ? ` (Còn ${sleepMinutesLeft} phút)` : ''}
              </Text>
              <View style={styles.chipRow}>
                {SLEEP_OPTIONS.map((opt) => {
                  const isSel = opt.value === null ? sleepMinutesLeft === null : sleepMinutesLeft !== null && Math.abs(sleepMinutesLeft - opt.value) <= 1;
                  return (
                    <TouchableOpacity
                      key={String(opt.value)}
                      style={[styles.chip, isSel && styles.chipActive]}
                      onPress={() => onSelectSleepTimer(opt.value)}
                    >
                      <Text style={styles.chipTxt}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}

          {activePanel === 'speed' ? (
            <>
              {SPEED_OPTIONS.map((rate) => (
                <OptionRow
                  key={rate}
                  icon="speedometer-outline"
                  label={`${rate.toFixed(rate % 1 === 0 ? 1 : 2).replace(/\.00$/, '.0')}x`}
                  selected={Math.abs(playbackRate - rate) < 0.01}
                  onPress={() => {
                    onSelectRate(rate);
                    onClose();
                  }}
                />
              ))}
            </>
          ) : null}

          {activePanel === 'info' ? (
            <>
              <View style={styles.chipRow}>
                <TouchableOpacity
                  style={[styles.chip, infoTab === 'movie' && styles.chipActive]}
                  onPress={() => setInfoTab('movie')}
                >
                  <Text style={styles.chipTxt}>Thông tin phim</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.chip, infoTab === 'member' && styles.chipActive]}
                  onPress={() => setInfoTab('member')}
                >
                  <Text style={styles.chipTxt}>Hồ sơ thành viên</Text>
                </TouchableOpacity>
              </View>

              {infoTab === 'movie' ? (
                <View style={styles.infoCard}>
                  <View style={styles.infoTop}>
                    {movieCtx?.poster_url ? (
                      <Image source={{ uri: movieCtx.poster_url }} style={styles.infoPoster} />
                    ) : null}
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.infoTitle}>{movieCtx?.title || title}</Text>
                      {episodeTitle ? <Text style={styles.optionSub}>{episodeTitle}</Text> : null}
                      <View style={styles.metaBadges}>
                        {movieCtx?.year ? <Text style={styles.metaChip}>{movieCtx.year}</Text> : null}
                        {movieCtx?.video_quality ? <Text style={styles.metaChip}>{movieCtx.video_quality}</Text> : null}
                        {movieCtx?.imdb_rating ? <Text style={styles.metaChip}>IMDb {movieCtx.imdb_rating}</Text> : null}
                      </View>
                    </View>
                  </View>
                  {movieCtx?.description ? (
                    <Text style={styles.infoDesc} numberOfLines={4}>
                      {movieCtx.description}
                    </Text>
                  ) : null}
                  <OptionRow
                    icon={inWishlist ? 'bookmark' : 'bookmark-outline'}
                    label={inWishlist ? 'Đã lưu trong Danh sách của tôi' : 'Lưu vào Danh sách của tôi'}
                    selected={inWishlist}
                    onPress={onToggleWishlist}
                  />
                </View>
              ) : (
                <View style={styles.infoCard}>
                  <View style={styles.memberHead}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.memberAvatar} />
                    ) : (
                      <View style={[styles.memberAvatar, styles.avatarPlaceholder]}>
                        <Ionicons name="person" size={24} color="#FFF" />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.infoTitle}>{displayName}</Text>
                      <View style={styles.metaBadges}>
                        <Text style={[styles.metaChip, { backgroundColor: 'rgba(229,9,20,0.32)' }]}>
                          {member?.rank || 'Thành viên'}
                        </Text>
                        <Text style={styles.metaChip}>
                          {member ? `${member.points.toLocaleString('vi-VN')} điểm` : user?.role || 'DVA Play'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {member ? (
                    <>
                      <View style={styles.memberStatsRow}>
                        <View style={styles.statBox}>
                          <Text style={styles.statVal}>{member.is_vip ? `${member.days_left} ngày` : 'Miễn phí'}</Text>
                          <Text style={styles.statLabel}>Gói thành viên</Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text style={styles.statVal}>{member.join_date || '--'}</Text>
                          <Text style={styles.statLabel}>Ngày đăng ký</Text>
                        </View>
                        <View style={styles.statBox}>
                          <Text style={styles.statVal}>{member.expiry_date || '--'}</Text>
                          <Text style={styles.statLabel}>Ngày hết hạn</Text>
                        </View>
                      </View>
                      <View style={styles.vipTrack}>
                        <View style={[styles.vipFill, { width: `${vipDaysPct}%` }]} />
                      </View>
                    </>
                  ) : null}
                </View>
              )}
            </>
          ) : null}

          {activePanel === 'more' ? (
            <>
              <OptionRow
                icon={offlineItem?.status === 'completed' ? 'checkmark-circle' : 'cloud-download-outline'}
                label={
                  offlineItem?.status === 'completed'
                    ? 'Đã tải phim offline'
                    : offlineItem?.status === 'downloading'
                      ? `Đang tải offline (${offlineItem.progress}%)...`
                      : 'Tải phim xuống xem offline'
                }
                badge={offlineItem?.status === 'downloading' ? `${offlineItem.progress}%` : undefined}
                accentBadge
                onPress={onDownloadOffline}
              />
              <OptionRow
                icon="information-circle-outline"
                label="Thông tin phim & Hồ sơ thành viên"
                onPress={() => onSwitchPanel('info')}
              />
              {onOpenCast ? (
                <OptionRow
                  icon="tv-outline"
                  label="Chiếu lên TV (DVA Cast QR)"
                  onPress={() => {
                    onClose();
                    onOpenCast();
                  }}
                />
              ) : null}
              <Text style={styles.sectionHeading}>Tính năng cộng đồng qua Web Player</Text>
              <OptionRow
                icon="people-outline"
                label="Xem chung / Chat AI / Khoảnh khắc"
                badge="Web Player"
                onPress={() => {
                  onClose();
                  onOpenWebPlayer();
                }}
              />
            </>
          ) : null}
        </ScrollView>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  panelCard: {
    width: '66%',
    maxWidth: 480,
    maxHeight: '88%',
    paddingHorizontal: 26,
    paddingVertical: 22,
  },
  panelCardWide: {
    width: '80%',
    maxWidth: 600,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  panelTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
  closeIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelBody: {
    maxHeight: 280,
  },
  sectionHeading: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
    marginBottom: 2,
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    paddingVertical: 6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  optionRowSelected: {
    backgroundColor: 'rgba(229,9,20,0.82)',
  },
  optionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  optionLabel: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  optionSub: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: 1,
  },
  badgePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  badgePillAccent: {
    backgroundColor: COLORS.accent,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  chipActive: {
    backgroundColor: 'rgba(229,9,20,0.85)',
  },
  chipTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  chipTxtActive: {
    color: '#FFF',
  },
  epGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  epTile: {
    minWidth: 108,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  epTileActive: {
    backgroundColor: 'rgba(229,9,20,0.82)',
  },
  epTileTxt: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  playingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
  },
  subPreviewBox: {
    marginTop: 4,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  subPreviewTxt: {
    color: '#FFF',
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  infoCard: {
    gap: 10,
    marginTop: 4,
  },
  infoTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  infoPoster: {
    width: 58,
    height: 82,
    borderRadius: 10,
    backgroundColor: COLORS.cardPlaceholder,
  },
  infoTitle: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  metaBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  metaChip: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '700',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  infoDesc: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    lineHeight: 18,
  },
  memberHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: COLORS.cardPlaceholder,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    padding: 10,
    borderRadius: RADII.sm,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  statVal: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
  statLabel: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  vipTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  vipFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
});
