import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/config';
import { MovieItem } from '../types/models';
import { LazyImage } from './LazyImage';

interface MovieCardProps {
  item: MovieItem;
  layout?: 'vertical' | 'landscape' | 'top10' | 'watched' | 'theatrical' | 'grid';
  width?: number;
  fullWidth?: boolean;
  onPress: (item: MovieItem) => void;
  onRemoveWatched?: (item: MovieItem) => void;
}

function WatchProgressBar({ percent }: { percent: number }) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  if (pct <= 0) return null;
  return (
    <View style={styles.progressTrack}>
      <LinearGradient
        colors={['#e50914', '#d50055']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.progressFill, { width: `${pct}%` }]}
      />
    </View>
  );
}

export function MovieCard({
  item,
  layout = 'vertical',
  width,
  fullWidth = false,
  onPress,
  onRemoveWatched,
}: MovieCardProps) {
  const rawTitle = String(item.title || '');
  const titlePrimary = item.title_primary || rawTitle.split(' - ')[0] || rawTitle;
  const titleSecondary = item.subtitle || rawTitle.split(' - ')[1] || '';
  const watchedPct = Math.max(0, Math.min(100, item.progress_percent || 0));

  if (layout === 'watched') {
    const cardW = width || 268;
    const pct = Math.max(0, Math.min(100, item.progress_percent || 0));
    const subParts = [
      item.is_tvseries === 1 ? 'Phim bộ' : 'Phim lẻ',
      item.genres && item.genres[0] ? item.genres[0] : '',
      item.viewed_info || '',
    ].filter(Boolean);

    return (
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => onPress(item)}
        style={[styles.watchedCard, fullWidth && { marginRight: 0 }, { width: cardW }]}
      >
        <View style={styles.landscapeImageWrap}>
          <LazyImage
            uri={item.poster_url || item.thumbnail_url}
            style={styles.fillImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.82)']}
            style={styles.bottomScrim}
          />
          {item.time_remaining ? (
            <View style={styles.remainPill}>
              <Text style={styles.remainPillText} numberOfLines={1}>
                {item.time_remaining}
              </Text>
            </View>
          ) : null}
          <View style={styles.progressTrack}>
            <LinearGradient
              colors={['#e50914', '#d50055']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.progressFill, { width: `${pct}%` }]}
            />
          </View>
        </View>

        <View style={styles.watchedFooter}>
          <LazyImage
            uri={item.thumbnail_url || item.poster_url}
            style={styles.watchedMiniThumb}
            resizeMode="cover"
          />
          <View style={styles.watchedMeta}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {titlePrimary}
            </Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              {subParts.join(' • ')}
            </Text>
          </View>
          {onRemoveWatched ? (
            <TouchableOpacity
              onPress={() => onRemoveWatched(item)}
              hitSlop={10}
              style={styles.optionsDotsBtn}
            >
              <Ionicons name="ellipsis-vertical" size={16} color={COLORS.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  if (layout === 'theatrical') {
    const cardW = width || 312;
    return (
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => onPress(item)}
        style={[styles.theatricalCard, { width: cardW }]}
      >
        <View style={styles.theatricalHeroBox}>
          <LazyImage
            uri={item.poster_url || item.thumbnail_url}
            style={styles.fillImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['rgba(7,9,15,0)', 'rgba(0,0,0,0.86)']}
            locations={[0.32, 1]}
            style={StyleSheet.absoluteFill}
          />

          <View style={styles.theatricalBottom}>
            <View style={styles.theatricalThumbWrap}>
              <LazyImage
                uri={item.thumbnail_url || item.poster_url}
                style={styles.fillImage}
                resizeMode="cover"
              />
            </View>

            <View style={styles.theatricalBadge}>
              <Text style={styles.theatricalBadgeTxt}>P.ĐỀ</Text>
            </View>

            <View style={styles.theatricalTextCol}>
              <Text style={styles.theatricalTitleVi} numberOfLines={1}>
                {titlePrimary}
              </Text>
              {titleSecondary ? (
                <Text style={styles.theatricalTitleEn} numberOfLines={1}>
                  {titleSecondary}
                </Text>
              ) : null}
              <View style={styles.theatricalMetaRow}>
                <View style={styles.ratingOutlinePill}>
                  <Text style={styles.ratingOutlineTxt}>T16</Text>
                </View>
                {item.year ? (
                  <Text style={styles.theatricalMetaTxt}>{item.year}</Text>
                ) : null}
                {item.runtime ? (
                  <Text style={styles.theatricalMetaTxt}>• {item.runtime}</Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  if (layout === 'landscape') {
    const cardW = width || 242;
    return (
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => onPress(item)}
        style={[styles.landscapeCard, { width: cardW }]}
      >
        <View style={styles.landscapeImageWrap}>
          <LazyImage
            uri={item.poster_url || item.thumbnail_url}
            style={styles.fillImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.82)']}
            style={styles.bottomScrim}
          />
          <View style={[styles.floatingSplitBadgesLeft, watchedPct > 0 && { bottom: 12 }]}>
            <View style={styles.splitSubHalf}>
              <Text style={styles.splitPillText}>P.Đề</Text>
            </View>
            <LinearGradient
              colors={['#e50914', '#d50055']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.splitEpHalf}
            >
              <Text style={styles.splitPillText}>{item.episode_badge || 'HD'}</Text>
            </LinearGradient>
          </View>
          <WatchProgressBar percent={watchedPct} />
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {titlePrimary}
        </Text>
        <Text style={styles.cardSub} numberOfLines={1}>
          {titleSecondary || (item.genres && item.genres[0]) || ''}
        </Text>
      </TouchableOpacity>
    );
  }

  if (layout === 'top10') {
    const cardW = width || 176;
    const isTv = item.is_tvseries === 1;
    const metaParts = isTv
      ? ['T16', item.season_label || 'Phần 1', item.episode_badge || 'Tập 1']
      : ['T16', item.year || '2026', item.runtime || item.video_quality || 'FHD'];

    return (
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => onPress(item)}
        style={[styles.top10Card, { width: cardW }]}
      >
        <View style={[styles.top10PosterWrap, { height: cardW * 1.48 }]}>
          <LazyImage
            uri={item.thumbnail_url || item.poster_url}
            style={styles.fillImage}
            resizeMode="cover"
          />
          <WatchProgressBar percent={watchedPct} />
        </View>
        <View style={styles.top10BottomInfo}>
          <Text style={styles.top10RankNumber}>{item.rank ?? 1}</Text>
          <View style={styles.top10InfoCol}>
            <Text style={styles.top10TitlePrimary} numberOfLines={1}>
              {titlePrimary}
            </Text>
            {titleSecondary ? (
              <Text style={styles.top10TitleSecondary} numberOfLines={1}>
                {titleSecondary}
              </Text>
            ) : null}
            <Text style={styles.top10Meta} numberOfLines={1}>
              {metaParts.filter(Boolean).join(' • ')}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const cardW = width || 148;
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={() => onPress(item)}
      style={[
        styles.verticalCard,
        (layout === 'grid' || fullWidth) && styles.gridCardReset,
        { width: cardW },
      ]}
    >
      <View style={[styles.verticalImageWrap, { height: cardW * 1.48 }]}>
        <LazyImage
          uri={item.thumbnail_url || item.poster_url}
          style={styles.fillImage}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['transparent', 'rgba(7,9,15,0.72)']}
          style={styles.bottomScrim}
        />
        <View style={[styles.floatingSplitBadgesCenter, watchedPct > 0 && { bottom: 12 }]}>
          <View style={styles.splitSubHalf}>
            <Text style={styles.splitPillText}>P.Đề</Text>
          </View>
          <LinearGradient
            colors={['#e50914', '#d50055']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.splitEpHalf}
          >
            <Text style={styles.splitPillText}>{item.episode_badge || item.video_quality || 'HD'}</Text>
          </LinearGradient>
        </View>
        <WatchProgressBar percent={watchedPct} />
      </View>
      <Text style={[styles.cardTitle, layout !== 'grid' && { textAlign: 'center' }]} numberOfLines={1}>
        {titlePrimary}
      </Text>
      {titleSecondary ? (
        <Text style={[styles.cardSub, layout !== 'grid' && { textAlign: 'center' }]} numberOfLines={1}>
          {titleSecondary}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  verticalCard: {
    marginRight: 12,
  },
  gridCardReset: {
    marginRight: 0,
  },
  verticalImageWrap: {
    width: '100%',
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.cardPlaceholder,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    position: 'relative',
    marginBottom: 8,
  },
  landscapeCard: {
    marginRight: 14,
  },
  watchedCard: {
    marginRight: 14,
  },
  landscapeImageWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: COLORS.cardPlaceholder,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    position: 'relative',
    marginBottom: 9,
  },
  fillImage: {
    width: '100%',
    height: '100%',
  },
  bottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '48%',
  },
  floatingSplitBadgesLeft: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
  },
  floatingSplitBadgesCenter: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
  },
  splitSubHalf: {
    backgroundColor: 'rgba(20, 20, 20, 0.78)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  splitEpHalf: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  splitPillText: {
    color: '#FFFFFF',
    fontSize: 10.5,
    fontWeight: '700',
  },
  remainPill: {
    position: 'absolute',
    left: 10,
    bottom: 11,
    backgroundColor: 'rgba(20, 20, 20, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 11,
  },
  remainPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressFill: {
    height: '100%',
  },
  watchedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 2,
  },
  watchedMiniThumb: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: COLORS.cardPlaceholder,
  },
  watchedMeta: {
    flex: 1,
  },
  optionsDotsBtn: {
    padding: 6,
    borderRadius: 16,
  },
  /* Top 10 ranking matching #dva-home-hub .top10-list-item */
  top10Card: {
    marginRight: 14,
  },
  top10PosterWrap: {
    width: '100%',
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: COLORS.cardPlaceholder,
    marginBottom: 8,
  },
  top10BottomInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  top10RankNumber: {
    fontSize: 38,
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#FF3648',
    width: 38,
    textAlign: 'center',
    marginRight: 6,
    textShadowColor: 'rgba(229, 9, 20, 0.45)',
    textShadowRadius: 8,
    textShadowOffset: { width: 0, height: 2 },
  },
  top10InfoCol: {
    flex: 1,
  },
  top10TitlePrimary: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  top10TitleSecondary: {
    color: 'rgba(203, 213, 225, 0.72)',
    fontSize: 11.5,
    marginTop: 1,
  },
  top10Meta: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 11,
    marginTop: 3,
  },
  /* Theatrical 16:9 + overlapping thumb matching .theatrical-card */
  theatricalCard: {
    marginRight: 14,
  },
  theatricalHeroBox: {
    width: '100%',
    aspectRatio: 16 / 9.8,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: COLORS.cardPlaceholder,
    position: 'relative',
  },
  theatricalBottom: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  theatricalThumbWrap: {
    width: 64,
    aspectRatio: 2 / 3,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    backgroundColor: '#0E121D',
  },
  theatricalBadge: {
    position: 'absolute',
    left: 8,
    bottom: 72,
    backgroundColor: 'rgba(20, 20, 20, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  theatricalBadgeTxt: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '700',
  },
  theatricalTextCol: {
    flex: 1,
    paddingLeft: 12,
    justifyContent: 'flex-end',
  },
  theatricalTitleVi: {
    color: '#F6F6F7',
    fontSize: 14.5,
    fontWeight: '700',
    marginBottom: 2,
  },
  theatricalTitleEn: {
    color: '#9EA6AD',
    fontSize: 12,
    marginBottom: 6,
  },
  theatricalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingOutlinePill: {
    borderWidth: 1,
    borderColor: 'rgba(158, 166, 173, 0.55)',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 5,
  },
  ratingOutlineTxt: {
    color: '#CBD5E1',
    fontSize: 10.5,
    fontWeight: '600',
  },
  theatricalMetaTxt: {
    color: '#9EA6AD',
    fontSize: 11.5,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 13.5,
    fontWeight: '700',
  },
  cardSub: {
    color: COLORS.muted,
    fontSize: 11.5,
    marginTop: 2,
  },
});
