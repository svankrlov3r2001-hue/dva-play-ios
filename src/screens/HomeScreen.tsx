import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassSurface } from '../components/GlassSurface';
import { Hero3DCarousel } from '../components/Hero3DCarousel';
import {
  AnimeHeroSection,
  CountryHubBoxSection,
  TopicGridSection,
} from '../components/HomeHubSections';
import { SkeletonCrossfade } from '../components/SkeletonCrossfade';
import { HomeHubSkeleton } from '../components/SkeletonLoaders';
import { MovieCard } from '../components/MovieCard';
import { COLORS } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import {
  deleteWatchedMovieApi,
  fetchHomeHubApi,
  fetchNotificationsApi,
  toggleWishlistApi,
} from '../services/api';
import { FilterOption, HomeSection, MovieItem } from '../types/models';

const HEADER_TABS = [
  { key: 'home', label: 'Trang chủ' },
  { key: 'genres', label: 'Thể loại' },
  { key: 'tvseries', label: 'Phim Bộ' },
  { key: 'movie', label: 'Phim lẻ' },
  { key: 'tvshow', label: 'TV Show' },
  { key: 'anime', label: 'Anime' },
  { key: 'kids', label: 'Thiếu nhi' },
];

const PLACEHOLDER_HEIGHT_BY_LAYOUT: Record<HomeSection['layout'], number> = {
  topics: 100,
  watched: 216,
  landscape: 192,
  theatrical: 200,
  top10: 328,
  vertical: 268,
  anime_hero: 440,
  country_hub: 700,
};

function SectionPlaceholderBlock({ layout }: { layout: HomeSection['layout'] }) {
  const height = PLACEHOLDER_HEIGHT_BY_LAYOUT[layout] ?? 240;
  return (
    <View style={[styles.sectionPlaceholder, { height }]}>
      <View style={styles.sectionPlaceholderCard} />
      <View style={styles.sectionPlaceholderCard} />
    </View>
  );
}

function SectionRevealFade({
  immediate = false,
  children,
}: {
  immediate?: boolean;
  children: React.ReactNode;
}) {
  const opacity = useRef(new Animated.Value(immediate ? 1 : 0.2)).current;

  useEffect(() => {
    if (immediate) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [immediate, opacity]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

interface HomeScreenProps {
  onOpenPreview: (item: MovieItem) => void;
  onOpenDetail: (videosId: number) => void;
  onPlayDirect: (item: MovieItem) => void;
  onOpenCast: () => void;
  onOpenAccount: () => void;
  onNavigateExplore?: () => void;
}

export function HomeScreen({
  onOpenPreview,
  onOpenDetail,
  onPlayDirect,
  onOpenCast,
  onOpenAccount,
  onNavigateExplore,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [mode, setMode] = useState('home');
  const [selectedGenreId, setSelectedGenreId] = useState('');
  const [selectedGenreName, setSelectedGenreName] = useState('');
  const [genresList, setGenresList] = useState<FilterOption[]>([]);
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [heroList, setHeroList] = useState<MovieItem[]>([]);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [revealedSectionIds, setRevealedSectionIds] = useState<Record<string, boolean>>({});
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    { videos_id: number; title: string; subtitle: string; thumbnail_url: string }[]
  >([]);

  const scrollViewRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionOffsetsRef = useRef<Record<string, number>>({});
  const sectionsRef = useRef<HomeSection[]>([]);
  sectionsRef.current = sections;
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const revealRafRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);

  const revealVisibleSections = useCallback((scrollY: number, viewportH: number) => {
    if (viewportH <= 0) return;
    const thresholdY = scrollY + viewportH + 180;
    const list = sectionsRef.current;
    if (!list || list.length === 0) return;

    setRevealedSectionIds((prev) => {
      let changed = false;
      let next: Record<string, boolean> | null = null;
      for (const sec of list) {
        if (prev[sec.id]) continue;
        const y = sectionOffsetsRef.current[sec.id];
        if (typeof y === 'number' && y <= thresholdY) {
          if (!next) next = { ...prev };
          next[sec.id] = true;
          changed = true;
        }
      }
      return changed && next ? next : prev;
    });
  }, []);

  const scheduleRevealCheck = useCallback(() => {
    if (revealRafRef.current !== null) return;
    revealRafRef.current = requestAnimationFrame(() => {
      revealRafRef.current = null;
      revealVisibleSections(scrollYRef.current, viewportHeightRef.current);
    });
  }, [revealVisibleSections]);

  useEffect(() => {
    return () => {
      if (revealRafRef.current !== null) {
        cancelAnimationFrame(revealRafRef.current);
        revealRafRef.current = null;
      }
    };
  }, []);

  const loadData = useCallback(
    async (targetMode: string, genreId: string = '', isRefresh = false) => {
      const reqId = ++requestSeqRef.current;
      const startedAt = Date.now();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const res = await fetchHomeHubApi(targetMode, genreId);
        if (reqId !== requestSeqRef.current) return;
        const nextSections = res.sections || [];
        sectionOffsetsRef.current = {};
        scrollYRef.current = 0;
        const initialRevealed: Record<string, boolean> = {};
        if (nextSections[0]?.id) {
          initialRevealed[nextSections[0].id] = true;
        }
        setRevealedSectionIds(initialRevealed);
        setHeroList(res.hero || []);
        setSections(nextSections);
        if (res.genres && res.genres.length > 0) {
          setGenresList(res.genres);
        }
      } catch (err: any) {
        if (reqId !== requestSeqRef.current) return;
        if (!isRefresh) {
          Alert.alert('Lỗi kết nối', err?.message || 'Không thể tải trang chủ.');
        }
      } finally {
        if (reqId !== requestSeqRef.current) return;
        if (isRefresh) {
          setRefreshing(false);
          setLoading(false);
        } else {
          const remaining = Math.max(0, 380 - (Date.now() - startedAt));
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
    []
  );

  const handleSelectCategory = useCallback(
    (nextMode: string, nextGenreId = '', nextGenreName = '') => {
      const changed = nextMode !== mode || nextGenreId !== selectedGenreId;
      setGenreSheetOpen(false);
      if (changed) {
        setLoading(true);
      }
      setSelectedGenreId(nextGenreId);
      setSelectedGenreName(nextGenreName);
      setMode(nextMode);
      scrollViewRef.current?.scrollTo({ y: 0, animated: !changed });
    },
    [mode, selectedGenreId]
  );

  useEffect(() => {
    if (loading && !refreshing) {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [loading, refreshing]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatar_url]);

  useEffect(() => {
    loadData(mode, selectedGenreId);
  }, [mode, selectedGenreId, loadData]);

  const handleToggleWishlist = async (item: MovieItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await toggleWishlistApi(item.videos_id);
      setHeroList((prev) =>
        prev.map((h) =>
          h.videos_id === item.videos_id ? { ...h, in_wishlist: res.in_wishlist } : h
        )
      );
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items: sec.items.map((m) =>
            m.videos_id === item.videos_id ? { ...m, in_wishlist: res.in_wishlist } : m
          ),
        }))
      );
    } catch {}
  };

  const handleRemoveWatched = (item: MovieItem) => {
    Alert.alert(
      'Xóa khỏi Đang xem?',
      `Bạn muốn ẩn "${item.title_primary || item.title}" khỏi danh sách Đang xem?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteWatchedMovieApi(item.videos_id);
              setSections((prev) =>
                prev
                  .map((s) =>
                    s.id === 'watched'
                      ? { ...s, items: s.items.filter((i) => i.videos_id !== item.videos_id) }
                      : s
                  )
                  .filter((s) => s.items.length > 0 || s.layout === 'topics' || s.layout === 'country_hub')
              );
            } catch {}
          },
        },
      ]
    );
  };

  const openNotifications = async () => {
    Haptics.selectionAsync();
    setNotifOpen(true);
    try {
      const res = await fetchNotificationsApi();
      setNotifications(res.notifications || []);
    } catch {}
  };

  const scrollToSectionId = (targetId: string) => {
    setRevealedSectionIds((prev) => (prev[targetId] ? prev : { ...prev, [targetId]: true }));
    const y = sectionOffsetsRef.current[targetId];
    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, y - (insets.top + 104)),
        animated: true,
      });
    }
  };

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const h = e.nativeEvent.layoutMeasurement?.height;
      scrollYRef.current = y;
      if (typeof h === 'number' && h > 0) {
        viewportHeightRef.current = h;
      }
      revealVisibleSections(y, viewportHeightRef.current);
    },
    [revealVisibleSections]
  );

  return (
    <View style={styles.container}>
      {/* Floating Apple Glass Header matching dva_play/templates/header.php */}
      <View style={[styles.floatingHeader, { top: insets.top + 8 }]}>
        <GlassSurface intensity={64} radius={26} style={styles.headerCapsule}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                Haptics.selectionAsync();
                handleSelectCategory('home', '', '');
              }}
              style={styles.brandGroup}
            >
              <Image
                source={require('../../assets/splash-logo.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Text style={styles.brandText}>Đặng Việt Anh</Text>
            </TouchableOpacity>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.iconCircle}
                onPress={() => {
                  Haptics.selectionAsync();
                  onOpenCast();
                }}
              >
                <Ionicons name="tv-outline" size={18} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconCircle} onPress={openNotifications}>
                <Ionicons name="notifications-outline" size={18} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.avatarCircleBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  onOpenAccount();
                }}
              >
                {user?.avatar_url && !avatarFailed ? (
                  <Image
                    source={{ uri: user.avatar_url }}
                    style={styles.avatarCircleImg}
                    resizeMode="cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <Ionicons name="person" size={17} color="#FFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </GlassSurface>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.modeChipsRow}
        >
          {HEADER_TABS.map((tab) => {
            const isGenreBtn = tab.key === 'genres';
            const active = isGenreBtn
              ? Boolean(selectedGenreId)
              : !selectedGenreId && mode === tab.key;
            const label = isGenreBtn && selectedGenreName ? selectedGenreName : tab.label;

            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.82}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (isGenreBtn) {
                    setGenreSheetOpen(true);
                  } else {
                    handleSelectCategory(tab.key, '', '');
                  }
                }}
              >
                <GlassSurface
                  intensity={active ? 72 : 48}
                  radius={20}
                  style={[styles.modeChip, active && styles.modeChipActive]}
                >
                  <View style={styles.modeChipInner}>
                    <Text style={[styles.modeChipText, active && styles.modeChipTextActive]}>
                      {label}
                    </Text>
                    {isGenreBtn ? (
                      <Ionicons
                        name="chevron-down"
                        size={12}
                        color={active ? '#FFF' : COLORS.textSecondary}
                      />
                    ) : null}
                  </View>
                </GlassSurface>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <SkeletonCrossfade
        loading={loading && !refreshing}
        backgroundColor="transparent"
        skeleton={<HomeHubSkeleton topInset={insets.top} active={loading && !refreshing} />}
      >
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 115 }}
          scrollEventThrottle={32}
          onScroll={handleScroll}
          onLayout={(e) => {
            viewportHeightRef.current = e.nativeEvent.layout.height;
            scheduleRevealCheck();
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(mode, selectedGenreId, true)}
              tintColor={COLORS.accent}
              progressViewOffset={insets.top + 96}
            />
          }
        >
          {/* 3D Perspective Hero Carousel matching dva_play/index.php */}
          {heroList.length > 0 ? (
            <>
              <Hero3DCarousel
                items={heroList}
                topInset={insets.top}
                onPlay={onPlayDirect}
                onToggleWishlist={handleToggleWishlist}
                onOpenDetail={onOpenDetail}
              />
              <LinearGradient
                colors={[COLORS.bg, 'rgba(7,9,15,0.68)', 'rgba(7,9,15,0)']}
                locations={[0, 0.42, 1]}
                style={styles.heroBottomBridge}
                pointerEvents="none"
              />
            </>
          ) : (
            <View style={{ height: insets.top + 112 }} />
          )}

          {/* Full Home Hub Sections with viewport progressive rendering */}
          {sections.map((section, idx) => {
            const isRevealed = idx === 0 || Boolean(revealedSectionIds[section.id]);
            const isWideLayout =
              section.layout === 'watched' ||
              section.layout === 'landscape' ||
              section.layout === 'theatrical';

            return (
              <View
                key={section.id}
                style={[
                  styles.sectionBlock,
                  idx === 0 && heroList.length > 0 && styles.firstSectionBlock,
                ]}
                onLayout={(e) => {
                  sectionOffsetsRef.current[section.id] = e.nativeEvent.layout.y;
                  scheduleRevealCheck();
                }}
              >
                {section.title ? (
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                  </View>
                ) : null}

                {!isRevealed ? (
                  <SectionPlaceholderBlock layout={section.layout} />
                ) : (
                  <SectionRevealFade immediate={idx === 0}>
                    {section.layout === 'topics' && section.topics ? (
                      <TopicGridSection
                        topics={section.topics}
                        onSelectTopic={scrollToSectionId}
                      />
                    ) : section.layout === 'anime_hero' ? (
                      <AnimeHeroSection
                        items={section.items}
                        onPlay={onPlayDirect}
                        onToggleWishlist={handleToggleWishlist}
                        onOpenDetail={(m) => onOpenPreview(m)}
                      />
                    ) : section.layout === 'country_hub' && section.hub_rows ? (
                      <CountryHubBoxSection
                        rows={section.hub_rows}
                        onPressMovie={onOpenPreview}
                        onPressMore={() => {
                          if (onNavigateExplore) onNavigateExplore();
                        }}
                      />
                    ) : (
                      <FlatList
                        data={section.items}
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.carouselPad}
                        initialNumToRender={isWideLayout ? 2 : 3}
                        maxToRenderPerBatch={2}
                        windowSize={3}
                        removeClippedSubviews
                        keyExtractor={(item) => `${section.id}_${item.videos_id}`}
                        renderItem={({ item }) => (
                          <MovieCard
                            item={item}
                            layout={section.layout as any}
                            onPress={onOpenPreview}
                            onRemoveWatched={
                              section.layout === 'watched' ? handleRemoveWatched : undefined
                            }
                          />
                        )}
                      />
                    )}
                  </SectionRevealFade>
                )}
              </View>
            );
          })}
        </ScrollView>
      </SkeletonCrossfade>

      {/* Thể loại Filter In-Tree Overlay matching header dropdown */}
      {genreSheetOpen ? (
        <View style={styles.inTreeOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setGenreSheetOpen(false)}
          />
          <GlassSurface
            intensity={75}
            radius={30}
            style={[styles.genreCard, { marginTop: insets.top + 96 }]}
          >
            <View style={styles.notifHead}>
              <Text style={styles.notifTitle}>Chọn Thể loại</Text>
              <TouchableOpacity onPress={() => setGenreSheetOpen(false)}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <View style={styles.genreGrid}>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync();
                    handleSelectCategory('home', '', '');
                  }}
                  style={[styles.genreItem, !selectedGenreId && styles.genreItemActive]}
                >
                  <Text
                    style={[
                      styles.genreItemText,
                      !selectedGenreId && styles.genreItemTextActive,
                    ]}
                  >
                    Tất cả thể loại
                  </Text>
                </TouchableOpacity>
                {genresList.map((g) => {
                  const isSel = selectedGenreId === String(g.id);
                  return (
                    <TouchableOpacity
                      key={g.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        handleSelectCategory('home', String(g.id), g.name);
                      }}
                      style={[styles.genreItem, isSel && styles.genreItemActive]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.genreItemText, isSel && styles.genreItemTextActive]}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </GlassSurface>
        </View>
      ) : null}

      {/* Notifications Popover In-Tree Overlay */}
      {notifOpen ? (
        <View style={styles.inTreeOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setNotifOpen(false)}
          />
          <GlassSurface
            intensity={70}
            radius={28}
            style={[styles.notifCard, { marginTop: insets.top + 66 }]}
          >
            <View style={styles.notifHead}>
              <Text style={styles.notifTitle}>Phim mới cập nhật</Text>
              <TouchableOpacity onPress={() => setNotifOpen(false)}>
                <Ionicons name="close" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 340 }}>
              {notifications.length === 0 ? (
                <Text style={styles.notifEmpty}>Đang tải thông báo...</Text>
              ) : (
                notifications.map((n) => (
                  <TouchableOpacity
                    key={n.videos_id}
                    style={styles.notifRow}
                    onPress={() => {
                      setNotifOpen(false);
                      onOpenDetail(n.videos_id);
                    }}
                  >
                    <Image
                      source={{ uri: n.thumbnail_url }}
                      style={styles.notifThumb}
                      resizeMode="cover"
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifItemTitle} numberOfLines={1}>
                        {n.title}
                      </Text>
                      <Text style={styles.notifItemSub} numberOfLines={1}>
                        {n.subtitle}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={COLORS.muted} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </GlassSurface>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  floatingHeader: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 50,
  },
  headerCapsule: {
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerLogo: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  brandText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarCircleImg: {
    width: '100%',
    height: '100%',
  },
  modeChipsRow: {
    paddingTop: 10,
    gap: 8,
  },
  modeChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  modeChipActive: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(229, 9, 20, 0.24)',
  },
  modeChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  modeChipText: {
    color: COLORS.textSecondary,
    fontSize: 12.5,
    fontWeight: '600',
  },
  modeChipTextActive: {
    color: '#FFF',
    fontWeight: '700',
  },
  centerLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderLabel: {
    color: COLORS.muted,
    marginTop: 12,
    fontSize: 13.5,
  },
  heroBottomBridge: {
    height: 64,
    marginBottom: -64,
  },
  sectionBlock: {
    marginTop: 22,
  },
  firstSectionBlock: {
    marginTop: 8,
  },
  sectionHeaderRow: {
    paddingHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  carouselPad: {
    paddingHorizontal: 16,
  },
  sectionPlaceholder: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 12,
    overflow: 'hidden',
  },
  sectionPlaceholderCard: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  inTreeOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingHorizontal: 16,
    zIndex: 80,
  },
  genreCard: {
    padding: 18,
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreItem: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  genreItemActive: {
    backgroundColor: 'rgba(229, 9, 20, 0.35)',
    borderColor: COLORS.accent,
  },
  genreItemText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  genreItemTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  notifCard: {
    padding: 16,
  },
  notifHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  notifTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  notifEmpty: {
    color: COLORS.muted,
    textAlign: 'center',
    paddingVertical: 20,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  notifThumb: {
    width: 44,
    height: 60,
    borderRadius: 10,
    backgroundColor: COLORS.cardPlaceholder,
  },
  notifItemTitle: {
    color: '#FFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  notifItemSub: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 2,
  },
});
