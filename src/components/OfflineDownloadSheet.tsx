import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppAlert } from './AppAlertModal';
import { BouncyButton } from './BouncyButton';
import { GlassSurface, WaterDropPopupView } from './GlassSurface';
import { COLORS } from '../constants/config';
import { useSettings } from '../context/SettingsContext';
import { fetchMovieDetailsApi } from '../services/api';
import {
  cancelOfflineDownload,
  clearPendingFollowUpDownloads,
  enqueueEpisodeBatch,
  enqueueOfflineDownload,
  formatBytes,
  formatEpisodeDisplayTitle,
  getCurrentAndNextEpisodes,
  loadOfflineDownloads,
  normalizeEpisodeOrder,
  OfflineEnqueueParams,
  pauseOfflineDownload,
  removeOfflineDownload,
  resumeOfflineDownload,
  setPendingFollowUpDownloads,
  subscribeOfflineDownloads,
} from '../services/downloadService';
import { EpisodeItem, OfflineDownloadItem } from '../types/models';

export interface OfflineDownloadSheetProps {
  visible: boolean;
  onClose: () => void;
  videosId: number;
  title: string;
  posterUrl: string;
  thumbnailUrl: string;
  serverMovieTitle?: string;
  currentStreamCode?: string;
  currentEpisodeTitle?: string;
  currentEpisodeId?: number;
  currentServerFileKey?: string;
  episodes?: EpisodeItem[];
}

export function OfflineDownloadSheet({
  visible,
  onClose,
  videosId,
  title,
  posterUrl,
  thumbnailUrl,
  serverMovieTitle,
  currentStreamCode,
  currentEpisodeTitle,
  currentEpisodeId,
  currentServerFileKey,
  episodes: propEpisodes,
}: OfflineDownloadSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const isLandscape = winWidth > winHeight;
  const { settings, updateSetting } = useSettings();

  const [offlineItems, setOfflineItems] = useState<OfflineDownloadItem[]>([]);
  const [fetchedEpisodes, setFetchedEpisodes] = useState<EpisodeItem[]>([]);
  const [resolvedPoster, setResolvedPoster] = useState(posterUrl);
  const [resolvedThumb, setResolvedThumb] = useState(thumbnailUrl);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [submittingBatch, setSubmittingBatch] = useState(false);

  useEffect(() => {
    setResolvedPoster(posterUrl);
    setResolvedThumb(thumbnailUrl);
  }, [posterUrl, thumbnailUrl]);

  useEffect(() => {
    loadOfflineDownloads().then(setOfflineItems).catch(() => {});
    return subscribeOfflineDownloads(setOfflineItems);
  }, []);

  useEffect(() => {
    if (!visible || !videosId) return;
    if (propEpisodes && propEpisodes.length > 0 && posterUrl) return;
    let active = true;
    setLoadingEpisodes(true);
    fetchMovieDetailsApi(videosId)
      .then((res) => {
        if (!active || !res?.movie) return;
        const allEps =
          res.movie.episodes && res.movie.episodes.length > 0
            ? res.movie.episodes
            : res.movie.seasons?.[0]?.episodes || [];
        setFetchedEpisodes(allEps);
        if (!posterUrl && res.movie.poster_url) setResolvedPoster(res.movie.poster_url);
        if (!thumbnailUrl && res.movie.thumbnail_url) setResolvedThumb(res.movie.thumbnail_url);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingEpisodes(false);
      });
    return () => {
      active = false;
    };
  }, [visible, videosId, propEpisodes, posterUrl, thumbnailUrl]);

  const orderedEpisodes = useMemo(() => {
    const src =
      propEpisodes && propEpisodes.length > 0 ? propEpisodes : fetchedEpisodes;
    return normalizeEpisodeOrder(src);
  }, [propEpisodes, fetchedEpisodes]);

  const isSeries = orderedEpisodes.length > 1;
  const targetStreamCode =
    currentStreamCode || orderedEpisodes[0]?.stream_code || '';

  const buildEnqueueReq = (ep?: EpisodeItem): OfflineEnqueueParams => {
    const sc = ep?.stream_code || targetStreamCode;
    const epTitle = formatEpisodeDisplayTitle(ep?.episodes_name || currentEpisodeTitle);
    const isTargetCurrent = Boolean(currentStreamCode && sc === currentStreamCode);
    const derivedKey = isTargetCurrent
      ? currentServerFileKey
      : serverMovieTitle && epTitle
        ? (() => {
            const m = epTitle.match(/0*(\d+)/);
            return m ? `${serverMovieTitle}.Tập.${m[1].padStart(2, '0')}` : undefined;
          })()
        : undefined;
    return {
      videos_id: videosId,
      episode_id: ep?.episodes_id ?? (isTargetCurrent ? currentEpisodeId || 0 : 0),
      stream_code: sc,
      title,
      episode_title: epTitle,
      server_movie_title: serverMovieTitle,
      server_file_key: derivedKey,
      poster_url: resolvedPoster || resolvedThumb,
      thumbnail_url: resolvedThumb || resolvedPoster,
      preferred_format: settings.offlineDownloadFormat,
      concurrency: settings.offlineDownloadConcurrency,
    };
  };

  const findItemForEpisode = (sc: string) =>
    offlineItems.find(
      (i) => i.videos_id === videosId && i.stream_code === sc
    ) || null;

  const currentDownloadItem = targetStreamCode
    ? findItemForEpisode(targetStreamCode)
    : null;

  const isCurrentCompleted = currentDownloadItem?.status === 'completed';
  const isCurrentActive =
    currentDownloadItem?.status === 'downloading' ||
    currentDownloadItem?.status === 'preparing' ||
    currentDownloadItem?.status === 'queued';

  const nextTargets = useMemo(() => {
    if (!isSeries || !targetStreamCode) return [];
    return getCurrentAndNextEpisodes(
      orderedEpisodes,
      targetStreamCode,
      settings.autoDownloadNextCount
    );
  }, [isSeries, orderedEpisodes, targetStreamCode, settings.autoDownloadNextCount]);

  const pendingNextEpisodes = useMemo(() => {
    if (!isSeries || !targetStreamCode || (settings.autoDownloadNextCount || 0) <= 0) return [];
    return nextTargets.filter((ep) => {
      if (ep.stream_code === targetStreamCode) return false;
      const ex = offlineItems.find(
        (i) => i.videos_id === videosId && i.stream_code === ep.stream_code
      );
      return !ex || ex.status === 'failed' || ex.status === 'paused';
    });
  }, [isSeries, targetStreamCode, settings.autoDownloadNextCount, nextTargets, offlineItems, videosId]);

  const handleDownloadNextPendingOnly = async () => {
    if (!isCurrentCompleted || pendingNextEpisodes.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmittingBatch(true);
    try {
      await enqueueEpisodeBatch(pendingNextEpisodes.map((ep) => buildEnqueueReq(ep)));
    } catch (e: any) {
      showAppAlert('Lỗi tải ngoại tuyến', e?.message || 'Không thể đưa vào hàng chờ.');
    } finally {
      setSubmittingBatch(false);
    }
  };

  const handleDownloadCurrentAndNext = async (includeNext: boolean) => {
    if (!targetStreamCode) {
      showAppAlert('Thông báo', 'Không tìm thấy nguồn phát cho mục này.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmittingBatch(true);
    try {
      const curEp = orderedEpisodes.find((e) => e.stream_code === targetStreamCode);
      const curItem = await enqueueOfflineDownload(buildEnqueueReq(curEp));
      if (includeNext && isSeries && settings.autoDownloadNextCount > 0) {
        const targets = getCurrentAndNextEpisodes(
          orderedEpisodes,
          targetStreamCode,
          settings.autoDownloadNextCount
        );
        const nextOnlyReqs = targets
          .filter((ep) => ep.stream_code !== targetStreamCode)
          .map((ep) => buildEnqueueReq(ep));
        if (nextOnlyReqs.length > 0) {
          await setPendingFollowUpDownloads(curItem.id, nextOnlyReqs);
        }
      } else {
        clearPendingFollowUpDownloads(curItem.id);
      }
    } catch (e: any) {
      showAppAlert('Lỗi tải ngoại tuyến', e?.message || 'Không thể đưa vào hàng chờ.');
    } finally {
      setSubmittingBatch(false);
    }
  };

  const adjustNextCount = (delta: number) => {
    Haptics.selectionAsync();
    const next = Math.max(0, Math.min(20, (settings.autoDownloadNextCount || 0) + delta));
    if (next === 0 && currentDownloadItem?.id) {
      clearPendingFollowUpDownloads(currentDownloadItem.id);
    }
    updateSetting('autoDownloadNextCount', next);
  };

  const handleEpisodePress = async (ep: EpisodeItem) => {
    Haptics.selectionAsync();
    const existing = findItemForEpisode(ep.stream_code);
    if (!existing) {
      await enqueueOfflineDownload(buildEnqueueReq(ep));
      return;
    }
    if (existing.status === 'downloading' || existing.status === 'preparing') {
      await pauseOfflineDownload(existing.id);
    } else if (existing.status === 'paused' || existing.status === 'failed') {
      await resumeOfflineDownload(existing.id);
    } else if (existing.status === 'queued') {
      await cancelOfflineDownload(existing.id);
    } else if (existing.status === 'completed') {
      showAppAlert('Đã tải ngoại tuyến', `Xóa "${ep.episodes_name}" khỏi máy?`, [
        { text: 'Giữ lại', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: () => removeOfflineDownload(existing.id),
        },
      ]);
    }
  };

  const renderStatusPill = (item: OfflineDownloadItem | null) => {
    if (!item) return null;
    if (item.status === 'completed') {
      return (
        <View style={styles.statusBannerOk}>
          <Ionicons name="checkmark-circle" size={16} color="#30D158" />
          <Text style={styles.statusBannerTxt}>
            Đã lưu trên máy • {formatBytes(item.size_bytes)}
          </Text>
          <BouncyButton
            onPress={() =>
              showAppAlert('Xóa tệp ngoại tuyến?', 'Tệp phim này sẽ bị xóa khỏi bộ nhớ máy.', [
                { text: 'Hủy', style: 'cancel' },
                { text: 'Xóa', style: 'destructive', onPress: () => removeOfflineDownload(item.id) },
              ])
            }
          >
            <Ionicons name="trash-outline" size={16} color="#FCA5A5" />
          </BouncyButton>
        </View>
      );
    }
    if (item.status === 'downloading' || item.status === 'preparing' || item.status === 'queued') {
      return (
        <View style={styles.statusBannerDl}>
          <View style={styles.statusBannerTop}>
            <Text style={styles.statusBannerTxt} numberOfLines={1}>
              {item.status_text || `Đang tải ${item.progress}%`}
            </Text>
            <View style={styles.inlineBtns}>
              {item.status === 'downloading' ? (
                <BouncyButton onPress={() => pauseOfflineDownload(item.id)} style={styles.miniIconBtn}>
                  <Ionicons name="pause" size={13} color="#FFF" />
                </BouncyButton>
              ) : null}
              <BouncyButton onPress={() => cancelOfflineDownload(item.id)} style={styles.miniIconBtn}>
                <Ionicons name="close" size={14} color="#FCA5A5" />
              </BouncyButton>
            </View>
          </View>
          <View style={styles.progTrack}>
            <View style={[styles.progFill, { width: `${Math.max(4, item.progress)}%` }]} />
          </View>
        </View>
      );
    }
    return (
      <View style={styles.statusBannerWarn}>
        <Text style={styles.statusBannerTxt} numberOfLines={1}>
          {item.status === 'paused'
            ? `Tạm dừng (${item.progress}%)`
            : item.error_message || 'Tải thất bại'}
        </Text>
        <BouncyButton onPress={() => resumeOfflineDownload(item.id)} style={styles.retryMiniBtn}>
          <Text style={styles.retryMiniTxt}>Tiếp tục</Text>
        </BouncyButton>
        <BouncyButton onPress={() => removeOfflineDownload(item.id)} style={styles.miniIconBtn}>
          <Ionicons name="trash-outline" size={14} color="#FCA5A5" />
        </BouncyButton>
      </View>
    );
  };

  const renderControlsColumn = () => (
    <ScrollView
      style={{ marginHorizontal: -12, marginTop: -6 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingHorizontal: 12, paddingVertical: 6 }}
    >
      {renderStatusPill(currentDownloadItem)}

      {/* Primary Action Buttons */}
      {!isCurrentCompleted && !isCurrentActive ? (
        <View style={{ gap: 7 }}>
          <BouncyButton
            bounciness="gentle"
            activeOpacity={0.85}
            disabled={submittingBatch}
            style={styles.primaryBtn}
            onPress={() => handleDownloadCurrentAndNext(true)}
          >
            {submittingBatch ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="cloud-download-outline" size={18} color="#FFF" />
            )}
            <Text style={styles.primaryBtnTxt} numberOfLines={1}>
              {isSeries && settings.autoDownloadNextCount > 0
                ? `Tải tập hiện tại + ${Math.max(0, nextTargets.length - 1)} tập tiếp theo`
                : isSeries
                  ? 'Tải tập hiện tại về máy'
                  : 'Tải phim này về máy'}
            </Text>
          </BouncyButton>

          {isSeries && settings.autoDownloadNextCount > 0 ? (
            <BouncyButton
              bounciness="gentle"
              activeOpacity={0.8}
              disabled={submittingBatch}
              style={styles.secondaryBtn}
              onPress={() => handleDownloadCurrentAndNext(false)}
            >
              <Text style={styles.secondaryBtnTxt}>Chỉ tải tập hiện tại</Text>
            </BouncyButton>
          ) : null}
        </View>
      ) : isCurrentCompleted && isSeries && settings.autoDownloadNextCount > 0 && pendingNextEpisodes.length > 0 ? (
        <View style={{ gap: 7 }}>
          <BouncyButton
            bounciness="gentle"
            activeOpacity={0.85}
            disabled={submittingBatch}
            style={styles.primaryBtn}
            onPress={handleDownloadNextPendingOnly}
          >
            {submittingBatch ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="cloud-download-outline" size={18} color="#FFF" />
            )}
            <Text style={styles.primaryBtnTxt} numberOfLines={1}>
              {`Tải ${pendingNextEpisodes.length} tập tiếp theo về máy`}
            </Text>
          </BouncyButton>
        </View>
      ) : null}

      {/* Auto-download & priority toggles */}
      <View style={styles.glassGroup}>
        <View style={styles.settingRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.settingTitle}>Tự động tải tập đang xem</Text>
            <Text style={styles.settingSub}>Tải ngầm tập hiện tại khi mở trình phát</Text>
          </View>
          <Switch
            value={settings.autoDownloadCurrentOnWatch}
            onValueChange={(v) => {
              Haptics.selectionAsync();
              updateSetting('autoDownloadCurrentOnWatch', v);
            }}
            trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
            thumbColor="#FFF"
          />
        </View>

        <View style={styles.rowDivider} />

        <View style={styles.settingRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.settingTitle}>Tải thêm tập tiếp theo khi xem</Text>
            <Text style={styles.settingSub}>
              {settings.autoDownloadNextCount > 0
                ? isCurrentCompleted
                  ? `Tự động xếp hàng ${settings.autoDownloadNextCount} tập kế tiếp`
                  : `Chỉ tự động tải ${settings.autoDownloadNextCount} tập kế tiếp sau khi tập đang xem tải xong`
                : 'Đang tắt tự động tải tập tiếp theo'}
            </Text>
          </View>
          <View style={styles.stepper}>
            <BouncyButton style={styles.stepBtn} onPress={() => adjustNextCount(-1)}>
              <Ionicons name="remove" size={15} color="#FFF" />
            </BouncyButton>
            <Text style={styles.stepValue}>{settings.autoDownloadNextCount}</Text>
            <BouncyButton style={styles.stepBtn} onPress={() => adjustNextCount(1)}>
              <Ionicons name="add" size={15} color="#FFF" />
            </BouncyButton>
          </View>
        </View>

        <View style={styles.presetRow}>
          {[0, 1, 2, 3, 5, 10].map((cnt) => {
            const active = settings.autoDownloadNextCount === cnt;
            return (
              <BouncyButton
                key={cnt}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (cnt === 0 && currentDownloadItem?.id) {
                    clearPendingFollowUpDownloads(currentDownloadItem.id);
                  }
                  updateSetting('autoDownloadNextCount', cnt);
                }}
              >
                <Text style={[styles.presetTxt, active && styles.presetTxtActive]}>
                  {cnt === 0 ? 'Tắt' : `+${cnt} tập`}
                </Text>
              </BouncyButton>
            );
          })}
        </View>

        <View style={styles.rowDivider} />

        <View style={styles.settingRow}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.settingTitle}>Ưu tiên phát từ máy khi có mạng</Text>
            <Text style={styles.settingSub}>Tự dùng dữ liệu phim đã lưu để phát tức thì</Text>
          </View>
          <Switch
            value={settings.preferOfflineWhenOnline}
            onValueChange={(v) => {
              Haptics.selectionAsync();
              updateSetting('preferOfflineWhenOnline', v);
            }}
            trackColor={{ false: 'rgba(255,255,255,0.2)', true: COLORS.accent }}
            thumbColor="#FFF"
          />
        </View>
      </View>
    </ScrollView>
  );

  const renderEpisodesColumn = () => (
    <View style={styles.epColumn}>
      <Text style={styles.colHeading}>
        {isSeries ? `Chọn tập để tải (${orderedEpisodes.length})` : 'Trạng thái phim'}
      </Text>
      {loadingEpisodes && orderedEpisodes.length === 0 ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color="#FFF" />
        </View>
      ) : orderedEpisodes.length > 0 ? (
        <ScrollView
          style={{ marginHorizontal: -12 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}
        >
          {orderedEpisodes.map((ep) => {
            const item = findItemForEpisode(ep.stream_code);
            const isCur = ep.stream_code === targetStreamCode;
            const iconName: keyof typeof Ionicons.glyphMap =
              item?.status === 'completed'
                ? 'checkmark-circle'
                : item?.status === 'downloading' || item?.status === 'preparing'
                  ? 'pause-circle-outline'
                  : item?.status === 'queued'
                    ? 'time-outline'
                    : item?.status === 'paused' || item?.status === 'failed'
                      ? 'refresh-circle-outline'
                      : 'cloud-download-outline';
            const iconColor =
              item?.status === 'completed'
                ? '#30D158'
                : item?.status === 'downloading' || item?.status === 'preparing'
                  ? '#5AC8FA'
                  : item?.status === 'failed'
                    ? '#FCA5A5'
                    : 'rgba(255,255,255,0.85)';

            return (
              <BouncyButton
                key={`${ep.episodes_id}_${ep.stream_code}`}
                bounciness="gentle"
                activeOpacity={0.8}
                style={[styles.epRow, isCur && styles.epRowCurrent]}
                onPress={() => handleEpisodePress(ep)}
              >
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.epName} numberOfLines={1}>
                    {formatEpisodeDisplayTitle(ep.episodes_name) || ep.episodes_name}
                    {isCur ? ' • Đang chọn' : ''}
                  </Text>
                  {item ? (
                    <Text style={styles.epMeta} numberOfLines={1}>
                      {item.status === 'completed'
                        ? formatBytes(item.size_bytes)
                        : item.status_text || `${item.progress}%`}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name={iconName} size={20} color={iconColor} />
              </BouncyButton>
            );
          })}
        </ScrollView>
      ) : (
        <View style={styles.centerBox}>
          <Text style={styles.emptyEpTxt}>
            Bấm nút tải bên {isLandscape ? 'trái' : 'trên'} để lưu phim xem ngoại tuyến.
          </Text>
        </View>
      )}
    </View>
  );

  if (!visible) return null;

  const cardWidth = isLandscape
    ? Math.min(740, winWidth - Math.max(40, insets.left + insets.right + 20))
    : Math.min(460, winWidth - 24);
  const cardHeight = isLandscape ? Math.min(354, winHeight - 20) : Math.min(winHeight * 0.84, 660);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <WaterDropPopupView visible={visible} from="center">
          <GlassSurface
            variant="liquid"
            radius={40}
            intensity={34}
            style={[
              styles.cardWrap,
              {
                width: cardWidth,
                height: cardHeight,
              },
            ]}
          >
            <View style={styles.cardInner}>
              <View style={styles.header}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    Tải &amp; Xem Ngoại Tuyến
                  </Text>
                  <Text style={styles.headerSub} numberOfLines={1}>
                    {title}
                    {formatEpisodeDisplayTitle(currentEpisodeTitle)
                      ? ` • ${formatEpisodeDisplayTitle(currentEpisodeTitle)}`
                      : ''}
                  </Text>
                  <Text style={styles.bgDownloadHint} numberOfLines={1}>
                    Hỗ trợ tải ngầm ngay cả khi thoát ra màn hình chính hoặc khóa máy
                  </Text>
                </View>
                <BouncyButton style={styles.closeBtn} onPress={onClose}>
                  <Ionicons name="close" size={22} color="#FFF" />
                </BouncyButton>
              </View>

              {isLandscape ? (
                <View style={styles.landscapeCols}>
                  <View style={styles.landscapeColLeft}>{renderControlsColumn()}</View>
                  <View style={styles.landscapeColRight}>{renderEpisodesColumn()}</View>
                </View>
              ) : (
                <ScrollView
                  style={{ marginHorizontal: -12 }}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    gap: 14,
                    paddingHorizontal: 12,
                    paddingTop: 6,
                    paddingBottom: Math.max(12, insets.bottom),
                  }}
                >
                  {renderControlsColumn()}
                  {renderEpisodesColumn()}
                </ScrollView>
              )}
            </View>
          </GlassSurface>
        </WaterDropPopupView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.26)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrap: {
    borderRadius: 40,
  },
  cardInner: {
    flex: 1,
    paddingHorizontal: 26,
    paddingVertical: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    marginTop: 2,
  },
  bgDownloadHint: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  landscapeCols: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  landscapeColLeft: {
    flex: 1.15,
  },
  landscapeColRight: {
    flex: 0.85,
  },
  colHeading: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 8,
  },
  epColumn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 26,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
  },
  primaryBtnTxt: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  secondaryBtn: {
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryBtnTxt: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  glassGroup: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 26,
    paddingHorizontal: 15,
    paddingVertical: 13,
    gap: 9,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingTitle: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  settingSub: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 1,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  stepBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
    minWidth: 20,
    textAlign: 'center',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  formatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  formatChips: {
    flexDirection: 'row',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  presetChipActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.85)',
  },
  presetTxt: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  presetTxtActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  statusBannerOk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(48, 209, 88, 0.16)',
  },
  statusBannerDl: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(10, 132, 255, 0.18)',
    gap: 6,
  },
  statusBannerWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(251, 191, 36, 0.16)',
  },
  statusBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusBannerTxt: {
    flex: 1,
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '600',
  },
  inlineBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryMiniBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.accent,
  },
  retryMiniTxt: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  progTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  progFill: {
    height: '100%',
    backgroundColor: '#5AC8FA',
  },
  epRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  epRowCurrent: {
    backgroundColor: 'rgba(229, 9, 20, 0.2)',
  },
  epName: {
    color: '#FFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  epMeta: {
    color: COLORS.muted,
    fontSize: 10.5,
    marginTop: 1,
  },
  centerBox: {
    flex: 1,
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyEpTxt: {
    color: COLORS.muted,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
});
