import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

interface HomeScreenProps {
  onOpenPreview: (item: MovieItem) => void;
  onOpenDetail: (videosId: number) => void;
  onPlayDirect: (item: MovieItem) => void;
  onOpenCast: () => void;
  onNavigateExplore?: () => void;
}

export function HomeScreen({
  onOpenPreview,
  onOpenDetail,
  onPlayDirect,
  onOpenCast,
  onNavigateExplore,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState('home');
  const [selectedGenreId, setSelectedGenreId] = useState('');
  const [selectedGenreName, setSelectedGenreName] = useState('');
  const [genresList, setGenresList] = useState<FilterOption[]>([]);
  const [genreSheetOpen, setGenreSheetOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [heroList, setHeroList] = useState<MovieItem[]>([]);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<
    { videos_id: number; title: string; subtitle: string; thumbnail_url: string }[]
  >([]);

  const scrollViewRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionOffsetsRef = useRef<Record<string, number>>({});

  const loadData = useCallback(
    async (targetMode: string, genreId: string = '', isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const res = await fetchHomeHubApi(targetMode, genreId);
        setHeroList(res.hero || []);
        setSections(res.sections || []);
        if (res.genres && res.genres.length > 0) {
          setGenresList(res.genres);
        }
      } catch (err: any) {
        if (!isRefresh) {
          Alert.alert('Lỗi kết nối', err?.message || 'Không thể tải trang chủ.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (loading && !refreshing) {
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [loading, refreshing]);

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
    const y = sectionOffsetsRef.current[targetId];
    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, y - (insets.top + 104)),
        animated: true,
      });
    }
  };

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
                setMode('home');
                setSelectedGenreId('');
                setSelectedGenreName('');
                scrollViewRef.current?.scrollTo({ y: 0, animated: true });
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
                    setSelectedGenreId('');
                    setSelectedGenreName('');
                    setMode(tab.key);
                    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
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
        skeleton={<HomeHubSkeleton topInset={insets.top} />}
      >
        <ScrollView
          ref={scrollViewRef}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 115 }}
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
            <Hero3DCarousel
              items={heroList}
              topInset={insets.top}
              onPlay={onPlayDirect}
              onToggleWishlist={handleToggleWishlist}
              onOpenDetail={onOpenDetail}
            />
          ) : (
            <View style={{ height: insets.top + 112 }} />
          )}

          {/* Full Home Hub Sections matching dva_play/templates/home_hub.php */}
          {sections.map((section) => (
            <View
              key={section.id}
              style={styles.sectionBlock}
              onLayout={(e) => {
                sectionOffsetsRef.current[section.id] = e.nativeEvent.layout.y;
              }}
            >
              {section.title ? (
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                </View>
              ) : null}

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
            </View>
          ))}
        </ScrollView>
      </SkeletonCrossfade>

      {/* Thể loại Filter Modal Sheet matching header dropdown */}
      <Modal
        visible={genreSheetOpen}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
        onRequestClose={() => setGenreSheetOpen(false)}
      >
        <Pressable style={styles.notifBackdrop} onPress={() => setGenreSheetOpen(false)}>
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
                    setSelectedGenreId('');
                    setSelectedGenreName('');
                    setMode('home');
                    setGenreSheetOpen(false);
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
                        setSelectedGenreId(String(g.id));
                        setSelectedGenreName(g.name);
                        setMode('home');
                        setGenreSheetOpen(false);
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
        </Pressable>
      </Modal>

      {/* Notifications Popover Modal */}
      <Modal
        visible={notifOpen}
        transparent
        animationType="fade"
        supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
        onRequestClose={() => setNotifOpen(false)}
      >
        <Pressable style={styles.notifBackdrop} onPress={() => setNotifOpen(false)}>
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
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
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
  sectionBlock: {
    marginTop: 22,
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
  notifBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingHorizontal: 16,
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
