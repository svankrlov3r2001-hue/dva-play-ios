import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BouncyButton } from '../components/BouncyButton';
import { GlassSurface } from '../components/GlassSurface';
import { MovieCard } from '../components/MovieCard';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { ExploreGridSkeleton } from '../components/SkeletonLoaders';
import { COLORS } from '../constants/config';
import { fetchMoviesCatalogApi } from '../services/api';
import { FilterOption, MovieItem } from '../types/models';

const TYPE_OPTIONS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'movie', label: 'Phim lẻ' },
  { key: 'tvseries', label: 'Phim Bộ' },
  { key: 'tvshow', label: 'TV Show' },
  { key: 'anime', label: 'Anime' },
  { key: 'kids', label: 'Thiếu nhi' },
];

const SORT_OPTIONS = [
  { key: 'latest', label: 'Mới cập nhật' },
  { key: 'views', label: 'Xem nhiều' },
  { key: 'imdb', label: 'IMDb cao' },
  { key: 'year', label: 'Năm mới' },
  { key: 'random', label: 'Ngẫu nhiên' },
];

interface ExploreScreenProps {
  onOpenPreview: (item: MovieItem) => void;
}

export function ExploreScreen({ onOpenPreview }: ExploreScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const portraitWidth = Math.min(winWidth, winHeight);
  const portraitHeight = Math.max(winWidth, winHeight);
  const gridCardWidth = Math.floor((portraitWidth - 32 - 20) / 3);

  const [type, setType] = useState('all');
  const [genre, setGenre] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('latest');

  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [draftType, setDraftType] = useState('all');
  const [draftGenre, setDraftGenre] = useState('');
  const [draftCountry, setDraftCountry] = useState('');
  const [draftSort, setDraftSort] = useState('latest');
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const [genres, setGenres] = useState<FilterOption[]>([]);
  const [countries, setCountries] = useState<FilterOption[]>([]);
  const [items, setItems] = useState<MovieItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeqRef = useRef(0);

  const loadCatalog = useCallback(
    async (targetPage: number, append: boolean) => {
      const reqId = append ? requestSeqRef.current : ++requestSeqRef.current;
      const startedAt = Date.now();
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
        if (reqId !== requestSeqRef.current) return;
        if (res.filters?.genres?.length) setGenres(res.filters.genres);
        if (res.filters?.countries?.length) setCountries(res.filters.countries);
        setTotalPages(res.total_pages || 1);
        setPage(targetPage);
        setItems((prev) => (append ? [...prev, ...(res.data || [])] : res.data || []));
      } catch {
      } finally {
        if (reqId !== requestSeqRef.current) return;
        if (append) {
          setLoadingMore(false);
        } else {
          const remaining = Math.max(0, 340 - (Date.now() - startedAt));
          if (remaining > 0) {
            await new Promise((resolve) => setTimeout(resolve, remaining));
          }
          if (reqId !== requestSeqRef.current) return;
          requestAnimationFrame(() => {
            if (reqId === requestSeqRef.current) {
              setLoading(false);
            }
          });
        }
      }
    },
    [type, genre, country, sort]
  );

  useEffect(() => {
    loadCatalog(1, false);
  }, [loadCatalog]);

  useEffect(() => {
    if (filterSheetOpen) {
      sheetAnim.setValue(0);
      Animated.timing(sheetAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      sheetAnim.stopAnimation();
      sheetAnim.setValue(0);
    }
  }, [filterSheetOpen, sheetAnim]);

  const handleLoadMore = () => {
    if (!loading && !loadingMore && page < totalPages) {
      loadCatalog(page + 1, true);
    }
  };

  const openFilterSheet = () => {
    Haptics.selectionAsync();
    setDraftType(type);
    setDraftGenre(genre);
    setDraftCountry(country);
    setDraftSort(sort);
    setFilterSheetOpen(true);
  };

  const resetDraftFilters = () => {
    Haptics.selectionAsync();
    setDraftType('all');
    setDraftGenre('');
    setDraftCountry('');
    setDraftSort('latest');
  };

  const applyDraftFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const changed =
      draftType !== type ||
      draftGenre !== genre ||
      draftCountry !== country ||
      draftSort !== sort;
    setFilterSheetOpen(false);
    if (changed) {
      setLoading(true);
      setType(draftType);
      setGenre(draftGenre);
      setCountry(draftCountry);
      setSort(draftSort);
    }
  };

  const clearAllActiveFilters = () => {
    Haptics.selectionAsync();
    if (type !== 'all' || genre !== '' || country !== '' || sort !== 'latest') {
      setLoading(true);
      setType('all');
      setGenre('');
      setCountry('');
      setSort('latest');
    }
  };

  const activeFilterCount =
    (type !== 'all' ? 1 : 0) +
    (genre !== '' ? 1 : 0) +
    (country !== '' ? 1 : 0) +
    (sort !== 'latest' ? 1 : 0);

  const activeSummaryTags = useMemo(() => {
    const tags: string[] = [];
    if (type !== 'all') {
      const t = TYPE_OPTIONS.find((o) => o.key === type);
      if (t) tags.push(t.label);
    }
    if (genre !== '') {
      const g = genres.find((o) => String(o.id) === genre);
      if (g) tags.push(g.name);
    }
    if (country !== '') {
      const c = countries.find((o) => String(o.id) === country);
      if (c) tags.push(c.name);
    }
    if (sort !== 'latest') {
      const s = SORT_OPTIONS.find((o) => o.key === sort);
      if (s) tags.push(s.label);
    }
    return tags;
  }, [type, genre, country, sort, genres, countries]);

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [260, 0],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>Khám phá kho phim</Text>

        <BouncyButton
          activeOpacity={0.82}
          onPress={openFilterSheet}
          style={styles.filterBtnWrap}
        >
          <GlassSurface
            intensity={28}
            radius={21}
            style={[styles.filterCircleBtn, activeFilterCount > 0 && styles.filterCircleBtnActive]}
          >
            <Ionicons name="options-outline" size={20} color="#FFF" />
          </GlassSurface>
          {activeFilterCount > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </BouncyButton>
      </View>

      {activeSummaryTags.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.activeTagsRow}
          style={styles.activeTagsScroll}
        >
          {activeSummaryTags.map((lbl) => (
            <View key={lbl} style={styles.activeTagPill}>
              <Text style={styles.activeTagText}>{lbl}</Text>
            </View>
          ))}
          <BouncyButton onPress={clearAllActiveFilters} style={styles.clearFilterPill}>
            <Ionicons name="close" size={13} color="#FCA5A5" />
            <Text style={styles.clearFilterText}>Xóa lọc</Text>
          </BouncyButton>
        </ScrollView>
      ) : null}

      <SkeletonCrossfade
        loading={loading}
        backgroundColor="transparent"
        skeleton={<ExploreGridSkeleton cardWidth={gridCardWidth} active={loading} />}
      >
        <FlatList
          key="explore-catalog-grid"
          data={items}
          numColumns={3}
          initialNumToRender={9}
          maxToRenderPerBatch={6}
          windowSize={5}
          removeClippedSubviews
          keyExtractor={(item, idx) => `explore_${item.videos_id}_${idx}`}
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
              <MovieCard item={item} layout="grid" width={gridCardWidth} onPress={onOpenPreview} />
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

      {filterSheetOpen ? (
        <Animated.View style={[styles.sheetOverlay, { opacity: sheetAnim }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setFilterSheetOpen(false)}
          />
          <Animated.View
            style={[
              styles.sheetPositioner,
              { transform: [{ translateY: sheetTranslateY }] },
            ]}
          >
            <GlassSurface
              intensity={34}
              radius={32}
              style={[
                styles.sheetCard,
                {
                  maxHeight: Math.round(portraitHeight * 0.78),
                  paddingBottom: Math.max(20, insets.bottom + 12),
                },
              ]}
            >
              <View style={styles.handleBar} />
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Bộ lọc &amp; Sắp xếp</Text>
                <BouncyButton
                  style={styles.sheetCloseBtn}
                  onPress={() => setFilterSheetOpen(false)}
                >
                  <Ionicons name="close" size={19} color="#FFF" />
                </BouncyButton>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
              >
                <Text style={styles.groupHeading}>Định dạng phim</Text>
                <View style={styles.chipWrap}>
                  {TYPE_OPTIONS.map((opt) => {
                    const active = draftType === opt.key;
                    return (
                      <BouncyButton
                        key={opt.key}
                        style={[styles.sheetChip, active && styles.sheetChipActive]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setDraftType(opt.key);
                        }}
                      >
                        <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>
                          {opt.label}
                        </Text>
                      </BouncyButton>
                    );
                  })}
                </View>

                <Text style={styles.groupHeading}>Sắp xếp theo</Text>
                <View style={styles.chipWrap}>
                  {SORT_OPTIONS.map((s) => {
                    const active = draftSort === s.key;
                    return (
                      <BouncyButton
                        key={s.key}
                        style={[styles.sheetChip, active && styles.sheetChipActive]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setDraftSort(s.key);
                        }}
                      >
                        <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>
                          {s.label}
                        </Text>
                      </BouncyButton>
                    );
                  })}
                </View>

                <Text style={styles.groupHeading}>Thể loại</Text>
                <View style={styles.chipWrap}>
                  <BouncyButton
                    style={[styles.sheetChip, draftGenre === '' && styles.sheetChipActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setDraftGenre('');
                    }}
                  >
                    <Text
                      style={[styles.sheetChipText, draftGenre === '' && styles.sheetChipTextActive]}
                    >
                      Mọi thể loại
                    </Text>
                  </BouncyButton>
                  {genres.map((g) => {
                    const gid = String(g.id);
                    const active = draftGenre === gid;
                    return (
                      <BouncyButton
                        key={gid}
                        style={[styles.sheetChip, active && styles.sheetChipActive]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setDraftGenre(active ? '' : gid);
                        }}
                      >
                        <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>
                          {g.name}
                        </Text>
                      </BouncyButton>
                    );
                  })}
                </View>

                <Text style={styles.groupHeading}>Quốc gia</Text>
                <View style={styles.chipWrap}>
                  <BouncyButton
                    style={[styles.sheetChip, draftCountry === '' && styles.sheetChipActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setDraftCountry('');
                    }}
                  >
                    <Text
                      style={[
                        styles.sheetChipText,
                        draftCountry === '' && styles.sheetChipTextActive,
                      ]}
                    >
                      Mọi quốc gia
                    </Text>
                  </BouncyButton>
                  {countries.map((c) => {
                    const cid = String(c.id);
                    const active = draftCountry === cid;
                    return (
                      <BouncyButton
                        key={cid}
                        style={[styles.sheetChip, active && styles.sheetChipActive]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setDraftCountry(active ? '' : cid);
                        }}
                      >
                        <Text style={[styles.sheetChipText, active && styles.sheetChipTextActive]}>
                          {c.name}
                        </Text>
                      </BouncyButton>
                    );
                  })}
                </View>
              </ScrollView>

              <View style={styles.sheetFooter}>
                <BouncyButton
                  activeOpacity={0.82}
                  style={styles.resetBtn}
                  onPress={resetDraftFilters}
                >
                  <Text style={styles.resetBtnText}>Đặt lại</Text>
                </BouncyButton>
                <BouncyButton
                  bounciness="gentle"
                  activeOpacity={0.88}
                  style={styles.applyWrap}
                  onPress={applyDraftFilters}
                >
                  <LinearGradient
                    colors={['#e50914', '#d50055']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.applyGrad}
                  >
                    <Text style={styles.applyText}>Áp dụng bộ lọc</Text>
                  </LinearGradient>
                </BouncyButton>
              </View>
            </GlassSurface>
          </Animated.View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  headerTitle: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
  },
  filterBtnWrap: {
    position: 'relative',
  },
  filterCircleBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCircleBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(229, 9, 20, 0.22)',
  },
  filterBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: COLORS.accent,
    borderWidth: 1.5,
    borderColor: '#07090F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '800',
  },
  activeTagsScroll: {
    maxHeight: 34,
    marginBottom: 4,
  },
  activeTagsRow: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  activeTagPill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(229, 9, 20, 0.20)',
    borderWidth: 1,
    borderColor: 'rgba(229, 9, 20, 0.5)',
  },
  activeTagText: {
    color: '#FFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  clearFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  clearFilterText: {
    color: '#FCA5A5',
    fontSize: 11.5,
    fontWeight: '600',
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
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 350,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    justifyContent: 'flex-end',
  },
  sheetPositioner: {
    width: '100%',
  },
  sheetCard: {
    paddingTop: 10,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  handleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.28)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
  },
  sheetCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    paddingBottom: 14,
  },
  groupHeading: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  sheetChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  sheetChipActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.34)',
    borderColor: COLORS.accent,
  },
  sheetChipText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  sheetChipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  resetBtn: {
    paddingHorizontal: 20,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  applyWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  applyGrad: {
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyText: {
    color: '#FFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
});
