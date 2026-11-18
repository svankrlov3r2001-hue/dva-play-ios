import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, RADII } from '../constants/config';
import { fetchPopupInfoApi, toggleWishlistApi } from '../services/api';
import { PopupInfo } from '../types/models';
import { GlassSurface } from './GlassSurface';
import { SkeletonCrossfade } from './SkeletonCrossfade';
import { PreviewSheetSkeleton } from './SkeletonLoaders';

interface PreviewSheetModalProps {
  visible: boolean;
  videosId: number | null;
  obscuredByPlayer?: boolean;
  onClose: () => void;
  onPlay: (params: { videosId: number; streamCode: string; episodeId?: number; title: string }) => void;
  onOpenDetail: (videosId: number) => void;
}

export function PreviewSheetModal({
  visible,
  videosId,
  obscuredByPlayer = false,
  onClose,
  onPlay,
  onOpenDetail,
}: PreviewSheetModalProps) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<PopupInfo | null>(null);
  const [inWishlist, setInWishlist] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [trailerActive, setTrailerActive] = useState(false);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    player.muted = isMuted;
  }, [isMuted, player]);

  useEffect(() => {
    if (!visible || !videosId) {
      setTrailerActive(false);
      try {
        player.pause();
      } catch {}
      return;
    }

    let cancelled = false;
    setLoading(true);
    setInfo(null);
    setTrailerActive(false);
    setIsMuted(true);

    (async () => {
      try {
        const res = await fetchPopupInfoApi(videosId);
        if (cancelled) return;
        setInfo(res);
        setInWishlist(Boolean(res.in_wishlist));

        // Probe HLS trailer gently; fallback to direct stream/fallback MP4
        let chosenTrailer = res.url_trailer_fallback;
        let isHls = false;
        try {
          const chk = await fetch('https://dangvietanh.io.vn/check_file_trailer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: res.title_dot }),
          });
          if (chk.ok) {
            const cJson = await chk.json();
            if (cJson && (cJson.exists || cJson.status === 'ok' || cJson.url)) {
              chosenTrailer = res.url_trailer_hls || res.url_trailer_stream;
              isHls = true;
            }
          }
        } catch {}

        if (!cancelled && chosenTrailer) {
          await player.replaceAsync({
            uri: chosenTrailer,
            contentType: isHls ? 'hls' : 'progressive',
          });
          if (!cancelled) {
            player.muted = true;
            player.play();
            setTrailerActive(true);
          }
        }
      } catch {
        // Keep image backdrop cleanly
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        player.pause();
      } catch {}
    };
  }, [visible, videosId, player]);

  const handleToggleWishlist = async () => {
    if (!videosId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await toggleWishlistApi(videosId);
      setInWishlist(res.in_wishlist);
    } catch {}
  };

  const progressPct = parseInt(String(info?.viewed_rate || '0').replace('%', ''), 10) || 0;
  const imdbVal = parseFloat(String(info?.imdb_rating || '0')) || 0;
  const starCount = Math.max(0, Math.min(5, Math.round(imdbVal / 2)));

  return (
    <Modal
      visible={visible && !obscuredByPlayer}
      transparent
      animationType={obscuredByPlayer ? 'none' : 'slide'}
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <GlassSurface
          intensity={65}
          radius={34}
          style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 14) }]}
        >
          <View style={styles.handleBar} />

          {/* Backdrop / Live Trailer Header */}
          <View style={styles.mediaBox}>
            {info?.image_poster_image ? (
              <Image
                source={{ uri: info.image_poster_image }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
              />
            ) : null}

            {trailerActive ? (
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                nativeControls={false}
              />
            ) : null}

            <LinearGradient
              colors={['rgba(7,9,15,0.12)', 'rgba(7,9,15,0.6)', '#0B0F19']}
              style={StyleSheet.absoluteFill}
            />

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color="#FFF" />
            </TouchableOpacity>

            {trailerActive ? (
              <TouchableOpacity
                style={styles.muteBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  setIsMuted((m) => !m);
                }}
              >
                <Ionicons
                  name={isMuted ? 'volume-mute' : 'volume-high'}
                  size={18}
                  color="#FFF"
                />
              </TouchableOpacity>
            ) : null}
          </View>

          <SkeletonCrossfade
            loading={loading}
            intrinsicHeight
            backgroundColor="transparent"
            skeleton={<PreviewSheetSkeleton />}
          >
            {info ? (
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
            >
              {info.image_name && info.image_name !== 'false' ? (
                <Image
                  source={{ uri: info.image_name }}
                  style={styles.logoTitleImg}
                  resizeMode="contain"
                />
              ) : (
                <Text style={styles.titleText}>{info.title}</Text>
              )}

              <View style={styles.metaRow}>
                <View style={styles.starsRow}>
                  {[0, 1, 2, 3, 4].map((idx) => (
                    <Ionicons
                      key={idx}
                      name={idx < starCount ? 'star' : 'star-outline'}
                      size={15}
                      color={COLORS.accentGold}
                    />
                  ))}
                  {imdbVal > 0 ? (
                    <Text style={styles.imdbText}>{imdbVal.toFixed(1)}</Text>
                  ) : null}
                </View>
                {info.release ? (
                  <Text style={styles.metaText}>{info.release.slice(0, 4)}</Text>
                ) : null}
                {info.runtime ? <Text style={styles.metaText}>{info.runtime}</Text> : null}
                <View style={styles.qualityPill}>
                  <Text style={styles.qualityText}>{info.video_quality || 'HD'}</Text>
                </View>
              </View>

              {progressPct > 0 || info.time_remaining ? (
                <View style={styles.progressSection}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressLabel}>Tiến độ xem</Text>
                    <Text style={styles.progressRemain}>
                      {info.time_remaining || `${progressPct}%`}
                    </Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
                  </View>
                </View>
              ) : null}

              <Text style={styles.descText} numberOfLines={4}>
                {info.description || 'Thưởng thức nội dung chất lượng cao trên Đặng Việt Anh.'}
              </Text>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  activeOpacity={0.88}
                  style={styles.playBtn}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onClose();
                    onPlay({
                      videosId: info.videos_id,
                      streamCode: info.movies_url_getlink,
                      episodeId: info.episode_id,
                      title: info.title,
                    });
                  }}
                >
                  <Ionicons name="play" size={20} color="#FFF" />
                  <Text style={styles.playBtnText}>
                    {info.viewed_information || 'Xem ngay'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.iconActionBtn}
                  onPress={handleToggleWishlist}
                >
                  <Ionicons
                    name={inWishlist ? 'bookmark' : 'bookmark-outline'}
                    size={20}
                    color={inWishlist ? COLORS.accent : '#FFF'}
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.detailBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    onClose();
                    onOpenDetail(info.videos_id);
                  }}
                >
                  <Ionicons name="information-circle-outline" size={20} color="#FFF" />
                  <Text style={styles.detailBtnText}>Chi tiết</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
            ) : null}
          </SkeletonCrossfade>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '84%',
    backgroundColor: 'rgba(11, 15, 25, 0.92)',
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  handleBar: {
    alignSelf: 'center',
    width: 42,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginTop: 10,
    marginBottom: 8,
    zIndex: 10,
  },
  mediaBox: {
    width: '100%',
    height: 215,
    backgroundColor: '#0A0D16',
    position: 'relative',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muteBtn: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderBox: {
    paddingVertical: 46,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 13,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  logoTitleImg: {
    width: 210,
    height: 54,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  titleText: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  imdbText: {
    color: COLORS.accentGold,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  metaText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  qualityPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  qualityText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  progressSection: {
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  progressLabel: {
    color: COLORS.muted,
    fontSize: 12,
  },
  progressRemain: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBarBg: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
  },
  descText: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
  iconActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBtn: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  detailBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
