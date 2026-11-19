import React, { useEffect, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/config';
import { CountryHubRow, MovieItem, TopicItem } from '../types/models';
import { LazyImage } from './LazyImage';
import { MovieCard } from './MovieCard';

const TOPIC_GRADIENTS: Record<TopicItem['theme'], [string, string]> = {
  blue: ['rgba(59, 130, 246, 0.28)', 'rgba(20, 20, 20, 0.48)'],
  orange: ['rgba(217, 119, 87, 0.28)', 'rgba(20, 20, 20, 0.48)'],
  green: ['rgba(16, 185, 129, 0.26)', 'rgba(20, 20, 20, 0.48)'],
  red: ['rgba(229, 9, 20, 0.34)', 'rgba(20, 20, 20, 0.48)'],
  pink: ['rgba(229, 9, 20, 0.30)', 'rgba(213, 0, 85, 0.26)'],
  purple: ['rgba(168, 85, 247, 0.28)', 'rgba(20, 20, 20, 0.48)'],
  cyan: ['rgba(6, 182, 212, 0.26)', 'rgba(20, 20, 20, 0.48)'],
  dark: ['rgba(255, 255, 255, 0.12)', 'rgba(20, 20, 20, 0.48)'],
};

export function TopicGridSection({
  topics,
  onSelectTopic,
}: {
  topics: TopicItem[];
  onSelectTopic: (targetSection: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.topicsScroll}
    >
      {topics.map((topic) => (
        <TouchableOpacity
          key={topic.id}
          activeOpacity={0.86}
          onPress={() => {
            Haptics.selectionAsync();
            onSelectTopic(topic.target_section);
          }}
          style={styles.topicCardWrap}
        >
          <BlurView intensity={42} tint="dark" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={TOPIC_GRADIENTS[topic.theme] || TOPIC_GRADIENTS.dark}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.topicInner}
          >
            <Text style={styles.topicTitle} numberOfLines={1}>
              {topic.title}
            </Text>
            <Text style={styles.topicSub} numberOfLines={1}>
              {topic.subtitle}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

/**
 * Anime / Action Liquid Glass Hero Card (`anime-hero-card`) with interactive
 * portrait thumbnail strip matching dva_play/assets/css/dva-play.css.
 */
export function AnimeHeroSection({
  items,
  onPlay,
  onToggleWishlist,
  onOpenDetail,
}: {
  items: MovieItem[];
  onPlay: (item: MovieItem) => void;
  onToggleWishlist: (item: MovieItem) => void;
  onOpenDetail: (item: MovieItem) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    setSelectedIdx(0);
  }, [items]);

  if (items.length === 0) return null;
  const active = items[selectedIdx] || items[0];

  return (
    <View style={styles.animeWrapper}>
      <View style={styles.animeCard}>
        <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFill} />
        <LazyImage
          uri={active.poster_url || active.thumbnail_url}
          style={styles.animeBgImg}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['rgba(14,10,14,0.88)', 'rgba(12,10,14,0.68)', 'rgba(10,10,14,0.28)']}
          start={{ x: 0, y: 0.4 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(7,9,15,0.05)', 'rgba(7,9,15,0.86)']}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.animeContent}>
          <Text style={styles.animeTitle} numberOfLines={2}>
            {active.title_primary || active.title}
          </Text>
          {active.subtitle ? (
            <Text style={styles.animeSubtitle} numberOfLines={1}>
              {active.subtitle}
            </Text>
          ) : null}

          <View style={styles.animeBadges}>
            <LinearGradient
              colors={['#e50914', '#d50055']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.badgeFhd}
            >
              <Text style={styles.badgeFhdText}>{active.video_quality || 'FHD'}</Text>
            </LinearGradient>
            {active.year ? (
              <View style={styles.badgeOutline}>
                <Text style={styles.badgeOutlineText}>{active.year}</Text>
              </View>
            ) : null}
            {active.episode_badge ? (
              <View style={styles.badgeOutline}>
                <Text style={styles.badgeOutlineText}>{active.episode_badge}</Text>
              </View>
            ) : null}
          </View>

          {active.genres && active.genres.length > 0 ? (
            <View style={styles.animeTags}>
              {active.genres.slice(0, 3).map((g) => (
                <View key={g} style={styles.tagPill}>
                  <Text style={styles.tagText}>{g}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {active.description ? (
            <Text style={styles.animeDesc} numberOfLines={3}>
              {active.description}
            </Text>
          ) : null}

          <View style={styles.animeActions}>
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onPlay(active);
              }}
              style={styles.animePlayBtnWrap}
            >
              <LinearGradient
                colors={['#e50914', '#d50055']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.animePlayBtn}
              >
                <Ionicons name="play" size={20} color="#FFF" style={{ marginLeft: 2 }} />
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.animeActionGroup}>
              <TouchableOpacity
                onPress={() => onToggleWishlist(active)}
                style={styles.groupBtn}
              >
                <Ionicons
                  name={active.in_wishlist ? 'heart' : 'heart-outline'}
                  size={19}
                  color={active.in_wishlist ? '#ff4b5c' : '#FFF'}
                />
              </TouchableOpacity>
              <View style={styles.groupDivider} />
              <TouchableOpacity
                onPress={() => onOpenDetail(active)}
                style={styles.groupBtn}
              >
                <Ionicons name="information-circle-outline" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Overlapping portrait thumbnail selector strip (`anime-thumbnail-strip`) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbStrip}
      >
        {items.map((item, idx) => {
          const isSelected = idx === selectedIdx;
          return (
            <TouchableOpacity
              key={item.videos_id}
              activeOpacity={0.85}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedIdx(idx);
              }}
              style={[styles.thumbItem, isSelected && styles.thumbItemActive]}
            >
              <LazyImage
                uri={item.thumbnail_url || item.poster_url}
                style={styles.thumbImg}
                resizeMode="cover"
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const HUB_TITLE_COLORS: Record<CountryHubRow['gradient'], string> = {
  purple: '#e879f9',
  orange: '#fb923c',
  cyan: '#38bdf8',
  pink: '#ff4b5c',
};

/**
 * 3-row Apple Liquid Glass curated hub (`country-hub-box`).
 */
export function CountryHubBoxSection({
  rows,
  onPressMovie,
  onPressMore,
}: {
  rows: CountryHubRow[];
  onPressMovie: (item: MovieItem) => void;
  onPressMore: (rowId: string) => void;
}) {
  return (
    <View style={styles.hubOuter}>
      <View style={styles.hubBox}>
        <BlurView intensity={45} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.hubTint} />

        {rows.map((row, rowIdx) => (
          <View
            key={row.id}
            style={[styles.hubRow, rowIdx === rows.length - 1 && styles.hubRowLast]}
          >
            <View style={styles.hubRowHeader}>
              <Text
                style={[
                  styles.hubTitle,
                  { color: HUB_TITLE_COLORS[row.gradient] || '#FFF' },
                ]}
              >
                {row.title.replace(/\n/g, ' ')}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync();
                  onPressMore(row.id);
                }}
              >
                <Text style={styles.hubMore}>Xem thêm ›</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={row.items}
              horizontal
              showsHorizontalScrollIndicator={false}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
              removeClippedSubviews
              keyExtractor={(m) => `${row.id}_${m.videos_id}`}
              renderItem={({ item }) => (
                <MovieCard item={item} layout="landscape" width={226} onPress={onPressMovie} />
              )}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topicsScroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  topicCardWrap: {
    width: 148,
    height: 92,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  topicInner: {
    flex: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  topicTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  topicSub: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontWeight: '500',
  },
  animeWrapper: {
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  animeCard: {
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    minHeight: 332,
    position: 'relative',
    backgroundColor: '#0E121D',
  },
  animeBgImg: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    opacity: 0.78,
  },
  animeContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 24,
    justifyContent: 'center',
  },
  animeTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  animeSubtitle: {
    color: '#ff4b5c',
    fontSize: 13.5,
    fontWeight: '600',
    marginTop: 4,
  },
  animeBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  badgeFhd: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeFhdText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  badgeOutline: {
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
    backgroundColor: 'rgba(20, 20, 20, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  badgeOutlineText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  animeTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  tagPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  tagText: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '600',
  },
  animeDesc: {
    color: '#d1d5db',
    fontSize: 12.5,
    lineHeight: 19,
    marginTop: 11,
  },
  animeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 16,
  },
  animePlayBtnWrap: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  animePlayBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  animeActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    borderRadius: 999,
    backgroundColor: 'rgba(20, 20, 20, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  groupBtn: {
    height: '100%',
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupDivider: {
    width: 1,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  thumbStrip: {
    paddingTop: 12,
    paddingHorizontal: 4,
    gap: 10,
  },
  thumbItem: {
    width: 58,
    height: 84,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    opacity: 0.72,
  },
  thumbItemActive: {
    borderColor: '#FFFFFF',
    borderWidth: 2.2,
    opacity: 1,
    transform: [{ scale: 1.05 }],
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  hubOuter: {
    paddingHorizontal: 16,
  },
  hubBox: {
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  hubTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(20, 20, 20, 0.34)',
  },
  hubRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 16,
    marginBottom: 16,
  },
  hubRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
    marginBottom: 0,
  },
  hubRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  hubTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  hubMore: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
});
