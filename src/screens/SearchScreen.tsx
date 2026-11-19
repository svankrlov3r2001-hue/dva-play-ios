import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../components/GlassSurface';
import { LazyImage } from '../components/LazyImage';
import { MovieCard } from '../components/MovieCard';
import { ExploreGridSkeleton } from '../components/SkeletonLoaders';
import { COLORS, RADII } from '../constants/config';
import { fetchMoviesCatalogApi, searchSuggestApi } from '../services/api';
import { MovieItem } from '../types/models';

const QUICK_TAGS = ['Hành động', 'Anime', 'Hàn Quốc', 'Kinh dị', 'Marvel', 'Viễn tưởng'];

interface SearchScreenProps {
  onOpenPreview: (item: MovieItem) => void;
  onOpenDetail: (videosId: number) => void;
}

export function SearchScreen({ onOpenPreview, onOpenDetail }: SearchScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const gridCardWidth = Math.floor((portraitWidth - 32 - 20) / 3);

  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<MovieItem[]>([]);
  const [results, setResults] = useState<MovieItem[]>([]);
  const [recommended, setRecommended] = useState<MovieItem[]>([]);
  const [loadingRecommended, setLoadingRecommended] = useState(true);
  const [searching, setSearching] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const recSeqRef = useRef(0);

  const loadRecommended = useCallback(async () => {
    const seq = ++recSeqRef.current;
    setLoadingRecommended(true);
    try {
      const res = await fetchMoviesCatalogApi({
        page: 1,
        limit: 12,
        sort: 'random',
      });
      if (seq === recSeqRef.current) {
        setRecommended(res.data || []);
      }
    } catch {
    } finally {
      if (seq === recSeqRef.current) {
        setLoadingRecommended(false);
      }
    }
  }, []);

  useEffect(() => {
    loadRecommended();
  }, [loadRecommended]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      if (q.length === 0) {
        setResults([]);
        setSubmitted(false);
      }
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await searchSuggestApi(q);
        setSuggestions(res.suggestions || []);
      } catch {}
    }, 260);

    return () => clearTimeout(timer);
  }, [query]);

  const runFullSearch = async (keyword?: string) => {
    const q = (keyword ?? query).trim();
    if (!q) return;
    Keyboard.dismiss();
    if (keyword) setQuery(keyword);
    setSubmitted(true);
    setSearching(true);
    try {
      const res = await fetchMoviesCatalogApi({ q, limit: 36, page: 1 });
      setResults(res.data || []);
    } catch {
    } finally {
      setSearching(false);
    }
  };

  const showIdleRecommendations = !submitted && query.trim().length < 2;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title}>Tìm kiếm</Text>

      <View style={styles.searchBoxWrap}>
        <GlassSurface intensity={55} radius={RADII.md} style={styles.searchBar}>
          <Ionicons name="search" size={19} color={COLORS.muted} />
          <TextInput
            style={styles.input}
            placeholder="Nhập tên phim, diễn viên, từ khóa..."
            placeholderTextColor={COLORS.muted}
            value={query}
            onChangeText={(txt) => {
              setQuery(txt);
              setSubmitted(false);
            }}
            returnKeyType="search"
            onSubmitEditing={() => runFullSearch()}
          />
          {query.length > 0 ? (
            <TouchableOpacity
              onPress={() => {
                setQuery('');
                setSuggestions([]);
                setResults([]);
                setSubmitted(false);
              }}
            >
              <Ionicons name="close-circle" size={19} color={COLORS.muted} />
            </TouchableOpacity>
          ) : null}
        </GlassSurface>
      </View>

      {searching ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.accent} />
        </View>
      ) : submitted ? (
        <FlatList
          key="search-results-grid"
          data={results}
          numColumns={3}
          initialNumToRender={9}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews
          keyExtractor={(item, idx) => `res_${item.videos_id}_${idx}`}
          columnWrapperStyle={styles.gridRowPadded}
          contentContainerStyle={{
            paddingTop: 12,
            paddingBottom: insets.bottom + 110,
          }}
          renderItem={({ item }) => (
            <View style={{ marginBottom: 16 }}>
              <MovieCard item={item} layout="grid" width={gridCardWidth} onPress={onOpenPreview} />
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Không tìm thấy kết quả cho "{query}".</Text>
          }
        />
      ) : showIdleRecommendations ? (
        <FlatList
          key="search-recommended-grid"
          data={recommended}
          numColumns={3}
          initialNumToRender={9}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item, idx) => `rec_${item.videos_id}_${idx}`}
          columnWrapperStyle={styles.gridRowPadded}
          contentContainerStyle={{
            paddingBottom: insets.bottom + 110,
          }}
          ListHeaderComponent={
            <View style={styles.quickSection}>
              <Text style={styles.subTitle}>Từ khóa gợi ý</Text>
              <View style={styles.tagWrap}>
                {QUICK_TAGS.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={styles.tagChip}
                    onPress={() => {
                      Haptics.selectionAsync();
                      runFullSearch(tag);
                    }}
                  >
                    <Ionicons name="trending-up" size={14} color={COLORS.accent} />
                    <Text style={styles.tagText}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.recHeaderRow}>
                <View style={styles.recTitleLeft}>
                  <Ionicons name="sparkles" size={16} color={COLORS.accent} />
                  <Text style={styles.recHeading}>Đề xuất cho bạn</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={styles.refreshRecBtn}
                  onPress={() => {
                    Haptics.selectionAsync();
                    loadRecommended();
                  }}
                >
                  <Ionicons name="shuffle-outline" size={15} color={COLORS.textSecondary} />
                  <Text style={styles.refreshRecText}>Đổi gợi ý</Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ marginBottom: 16 }}>
              <MovieCard item={item} layout="grid" width={gridCardWidth} onPress={onOpenPreview} />
            </View>
          )}
          ListEmptyComponent={
            loadingRecommended ? (
              <ExploreGridSkeleton cardWidth={gridCardWidth} active={loadingRecommended} />
            ) : (
              <Text style={styles.emptyText}>Chưa tải được danh sách đề xuất.</Text>
            )
          }
        />
      ) : (
        <FlatList
          key="search-suggestions-list"
          data={suggestions}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item, idx) => `sug_${item.videos_id}_${idx}`}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: insets.bottom + 110,
          }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.suggestRow}
              onPress={() => onOpenDetail(item.videos_id)}
            >
              <LazyImage
                uri={item.thumbnail_url || item.poster_url}
                style={styles.suggestThumb}
                resizeMode="cover"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.suggestTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.suggestMeta}>
                  {item.is_tvseries === 1 ? 'Phim Bộ' : 'Phim lẻ'}
                  {item.year ? ` • ${item.year}` : ''}
                  {item.video_quality ? ` • ${item.video_quality}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchBoxWrap: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 48,
  },
  input: {
    flex: 1,
    color: '#FFF',
    fontSize: 15,
  },
  quickSection: {
    paddingHorizontal: 16,
    marginTop: 12,
  },
  subTitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tagText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  recHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 12,
  },
  recTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  recHeading: {
    color: '#FFF',
    fontSize: 16.5,
    fontWeight: '800',
  },
  refreshRecBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  refreshRecText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridRowPadded: {
    paddingHorizontal: 16,
    justifyContent: 'flex-start',
    gap: 10,
  },
  emptyText: {
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 48,
    paddingHorizontal: 24,
    fontSize: 14,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  suggestThumb: {
    width: 48,
    height: 68,
    borderRadius: 10,
    backgroundColor: COLORS.cardPlaceholder,
  },
  suggestTitle: {
    color: '#FFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  suggestMeta: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 3,
  },
});
