import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MovieCard } from '../components/MovieCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { ExploreGridSkeleton } from '../components/SkeletonLoaders';
import { COLORS } from '../constants/config';
import { fetchMoviesCatalogApi } from '../services/api';
import { FilterOption, MovieItem } from '../types/models';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_CARD_WIDTH = Math.floor((SCREEN_WIDTH - 32 - 20) / 3);

const TYPE_OPTIONS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'movie', label: 'Phim lẻ' },
  { key: 'tvseries', label: 'Phim Bộ' },
  { key: 'tvshow', label: 'TV Show' },
  { key: 'anime', label: 'Anime' },
  { key: 'kids', label: 'Thiếu nhi' },
];

const SORT_OPTIONS = [
  { key: 'latest', label: 'Mới nhất' },
  { key: 'views', label: 'Xem nhiều' },
  { key: 'imdb', label: 'IMDb cao' },
  { key: 'year', label: 'Năm mới' },
];

interface ExploreScreenProps {
  onOpenPreview: (item: MovieItem) => void;
}

export function ExploreScreen({ onOpenPreview }: ExploreScreenProps) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState('all');
  const [genre, setGenre] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('latest');
  const [genres, setGenres] = useState<FilterOption[]>([]);
  const [countries, setCountries] = useState<FilterOption[]>([]);
  const [items, setItems] = useState<MovieItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadCatalog = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await fetchMoviesCatalogApi({
          page: targetPage,
          limit: 24,
          type,
          genre,
          country,
          sort,
        });
        if (res.filters?.genres?.length) setGenres(res.filters.genres);
        if (res.filters?.countries?.length) setCountries(res.filters.countries);
        setTotalPages(res.total_pages || 1);
        setPage(targetPage);
        setItems((prev) => (append ? [...prev, ...(res.data || [])] : res.data || []));
      } catch {
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [type, genre, country, sort]
  );

  useEffect(() => {
    loadCatalog(1, false);
  }, [loadCatalog]);

  const handleLoadMore = () => {
    if (!loading && !loadingMore && page < totalPages) {
      loadCatalog(page + 1, true);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.headerTitle}>Khám phá kho phim</Text>

      {/* Filter Rows */}
      <View style={styles.filtersWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {TYPE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.chip, type === opt.key && styles.chipActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setType(opt.key);
              }}
            >
              <Text style={[styles.chipText, type === opt.key && styles.chipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chipSub, genre === '' && styles.chipSubActive]}
            onPress={() => setGenre('')}
          >
            <Text style={[styles.chipSubText, genre === '' && styles.chipTextActive]}>
              Mọi thể loại
            </Text>
          </TouchableOpacity>
          {genres.map((g) => (
            <TouchableOpacity
              key={g.id}
              style={[styles.chipSub, genre === String(g.id) && styles.chipSubActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setGenre(genre === String(g.id) ? '' : String(g.id));
              }}
            >
              <Text style={[styles.chipSubText, genre === String(g.id) && styles.chipTextActive]}>
                {g.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chipSub, country === '' && styles.chipSubActive]}
            onPress={() => setCountry('')}
          >
            <Text style={[styles.chipSubText, country === '' && styles.chipTextActive]}>
              Mọi quốc gia
            </Text>
          </TouchableOpacity>
          {countries.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.chipSub, country === String(c.id) && styles.chipSubActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setCountry(country === String(c.id) ? '' : String(c.id));
              }}
            >
              <Text style={[styles.chipSubText, country === String(c.id) && styles.chipTextActive]}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {SORT_OPTIONS.map((s) => (
            <TouchableOpacity
              key={s.key}
              style={[styles.sortPill, sort === s.key && styles.sortPillActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setSort(s.key);
              }}
            >
              <Text style={[styles.sortText, sort === s.key && styles.chipTextActive]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <SkeletonCrossfade
        loading={loading}
        skeleton={<ExploreGridSkeleton cardWidth={GRID_CARD_WIDTH} />}
      >
        <FlatList
          data={items}
          numColumns={3}
          keyExtractor={(item) => String(item.videos_id)}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: insets.bottom + 110,
          }}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          renderItem={({ item }) => (
            <View style={{ marginBottom: 16 }}>
              <MovieCard item={item} layout="vertical" width={GRID_CARD_WIDTH} onPress={onOpenPreview} />
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Không tìm thấy phim phù hợp bộ lọc.</Text>
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={COLORS.accent} style={{ marginVertical: 14 }} /> : undefined
          }
        />
      </SkeletonCrossfade>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  filtersWrap: {
    gap: 8,
    paddingBottom: 6,
  },
  chipRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  chipActive: {
    backgroundColor: COLORS.accent,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  chipSub: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipSubActive: {
    backgroundColor: 'rgba(229,9,20,0.28)',
    borderColor: COLORS.accent,
  },
  chipSubText: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  sortPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  sortPillActive: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  sortText: {
    color: COLORS.muted,
    fontSize: 11.5,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridRow: {
    justifyContent: 'flex-start',
    gap: 10,
  },
  emptyText: {
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 48,
    fontSize: 14,
  },
});
