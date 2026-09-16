import { useRouter } from 'expo-router';
import { ActivityIndicator, Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useToast } from '@/context/toast';
import { useSubscription } from '@/context/subscription';
import {
  SubscriptionProduct,
  SubscriptionStatus,
  loadSubscriptionProducts,
  openSubscriptionManagement,
  purchaseSubscription,
  restorePurchases,
  verifyEntitlement,
} from '@/services/subscription';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SLIDE_PADDING = 24;

// ─── Slide 1: Features ─────────────────────────────────────────────────────

const FEATURES = [
  { icon: 'sparkles', title: '3 AI trip plans / month', desc: 'Full AI-powered itineraries, regenerated fresh every month' },
  { icon: 'bubble.left.and.bubble.right', title: '50 AI messages / month', desc: 'Chat with your AI travel assistant to refine any plan' },
  { icon: 'wand.and.stars', title: 'AI trip editing', desc: 'Restructure your itinerary with a single instruction' },
  { icon: 'chart.bar', title: 'Trip analysis', desc: 'Deep AI review of pacing, balance, and logistics' },
  { icon: 'square.and.arrow.down', title: '10 imports / month', desc: 'Import places from links, text, and screenshots' },
  { icon: 'magnifyingglass', title: 'Natural language search', desc: 'Find activities by describing what you want' },
  { icon: 'brain', title: 'Smart fixes', desc: 'Auto-resolve schedule conflicts with one tap' },
];

function FeaturesSlide({ theme }: { theme: any }) {
  return (
    <View style={slideStyles.slideContainer}>
      <ThemedText style={slideStyles.slideTitle}>Everything you get</ThemedText>
      <View style={slideStyles.featureList}>
        {FEATURES.map((f, i) => (
          <View key={i} style={slideStyles.featureRow}>
            <View style={[slideStyles.featureIcon, { backgroundColor: theme.primaryMuted }]}>
              <SymbolView name={f.icon as any} size={16} tintColor={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={slideStyles.featureTitle}>{f.title}</ThemedText>
              <ThemedText style={[slideStyles.featureDesc, { color: theme.textSecondary }]}>{f.desc}</ThemedText>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Slide 2: Free vs Plus ──────────────────────────────────────────────────

const COMPARISON = [
  { label: 'AI trip plans', free: '2 lifetime', plus: '3 / month' },
  { label: 'AI messages', free: '10 / month', plus: '50 / month' },
  { label: 'Imports', free: '5 lifetime', plus: '10 / month' },
  { label: 'AI editing', free: '\u2014', plus: '\u2713' },
  { label: 'Trip analysis', free: '\u2014', plus: '\u2713' },
  { label: 'Smart fixes', free: '\u2014', plus: '\u2713' },
  { label: 'Natural search', free: '\u2014', plus: '\u2713' },
];

function ComparisonSlide({ theme }: { theme: any }) {
  return (
    <View style={slideStyles.slideContainer}>
      <ThemedText style={slideStyles.slideTitle}>Free vs Travonal+</ThemedText>
      <View style={[slideStyles.comparisonCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        {/* Header */}
        <View style={[slideStyles.comparisonHeader, { borderBottomColor: theme.border }]}>
          <ThemedText style={[slideStyles.comparisonHeaderLabel, { flex: 2 }]}> </ThemedText>
          <ThemedText style={[slideStyles.comparisonHeaderLabel, { color: theme.textSecondary }]}>Free</ThemedText>
          <ThemedText style={[slideStyles.comparisonHeaderLabel, { color: theme.primary, fontWeight: '800' }]}>Plus</ThemedText>
        </View>
        {COMPARISON.map((row, i) => (
          <View key={i} style={[slideStyles.comparisonRow, i < COMPARISON.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>
            <ThemedText style={slideStyles.comparisonLabel}>{row.label}</ThemedText>
            <ThemedText style={[slideStyles.comparisonValue, { color: theme.textSecondary }]}>{row.free}</ThemedText>
            <ThemedText style={[slideStyles.comparisonValue, { color: theme.primary, fontWeight: '700' }]}>{row.plus}</ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}


// ─── Usage row (for subscribed view) ────────────────────────────────────────

function UsageRow({ label, used, total, theme }: { label: string; used: number; total: number; theme: any }) {
  const remaining = Math.max(0, total - used);
  const pct = total > 0 ? used / total : 0;
  return (
    <View style={styles.usageRow}>
      <View style={styles.usageLabel}>
        <ThemedText style={{ fontSize: 13, fontWeight: '500' }}>{label}</ThemedText>
        <ThemedText style={{ fontSize: 12, color: theme.textSecondary }}>
          {remaining} of {total} remaining
        </ThemedText>
      </View>
      <View style={[styles.usageBar, { backgroundColor: theme.border }]}>
        <View style={[styles.usageBarFill, { width: `${Math.min(100, pct * 100)}%`, backgroundColor: pct > 0.8 ? '#EF4444' : theme.primary }]} />
      </View>
    </View>
  );
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function TravonalPlusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { isPlus, usage, refresh: refreshSubscription } = useSubscription();

  const [status, setStatus] = useState<SubscriptionStatus>('loading');
  const [products, setProducts] = useState<SubscriptionProduct[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const pagerRef = useRef<ScrollView>(null);

  useEffect(() => {
    async function init() {
      setStatus('loading');
      try {
        const subscribed = await verifyEntitlement();
        setIsSubscribed(subscribed);
        const loaded = await loadSubscriptionProducts();
        if (loaded === null || loaded.length === 0) {
          setStatus('unavailable');
        } else {
          setProducts(loaded);
          setStatus('available');
        }
      } catch {
        setStatus('error');
      }
    }
    init();
  }, []);

  async function handleSubscribe() {
    if (status !== 'available') return;
    setPurchasing(true);
    try {
      const result = await purchaseSubscription(selectedPlan);
      if (!result.error) {
        setIsSubscribed(true);
        await refreshSubscription();
        showToast('Welcome to Travonal+!');
      } else {
        showToast(result.error ?? 'Purchase failed. Please try again.');
      }
    } catch {
      showToast('Purchase failed. Please try again.');
    } finally {
      setPurchasing(false);
    }
  }

  async function handleRestore() {
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.isSubscribed) {
        setIsSubscribed(true);
        await refreshSubscription();
        showToast('Subscription restored!');
      } else {
        showToast(result.error ?? 'No active subscription found.');
      }
    } catch {
      showToast('Restore failed. Please try again.');
    } finally {
      setRestoring(false);
    }
  }

  const selectedProduct = products.find((p) => p.planId === selectedPlan);
  const annualProduct = products.find((p) => p.planId === 'annual');
  const monthlyProduct = products.find((p) => p.planId === 'monthly');

  return (
    <ThemedView style={styles.container}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.closeBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <SymbolView name={"xmark" as any} size={16} tintColor={theme.textSecondary} />
        </Pressable>
      </View>

      {/* ── Hero branding ── */}
      <Animated.View entering={FadeIn.duration(400)} style={styles.hero}>
        <ThemedText style={styles.logo}>Travonal+</ThemedText>
        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          Your trips, taken to the next level
        </ThemedText>
      </Animated.View>

      {/* ── Slide dots ── */}
      <View style={styles.dotRow}>
        {[0, 1].map((i) => (
          <Pressable
            key={i}
            onPress={() => {
              setActiveSlide(i);
              pagerRef.current?.scrollTo({ x: i * SCREEN_WIDTH, animated: true });
            }}
            hitSlop={8}
          >
            <View style={[styles.dot, i === activeSlide && styles.dotActive, { backgroundColor: i === activeSlide ? theme.primary : theme.border }]} />
          </Pressable>
        ))}
      </View>

      {/* ── Swipeable content slides ── */}
      <View style={styles.pagerContainer}>
        <ScrollView
          ref={pagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onMomentumScrollEnd={(e) => {
            setActiveSlide(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
          }}
          style={styles.pager}
        >
          <View style={{ width: SCREEN_WIDTH, paddingHorizontal: SLIDE_PADDING }}>
            <FeaturesSlide theme={theme} />
          </View>
          <View style={{ width: SCREEN_WIDTH, paddingHorizontal: SLIDE_PADDING }}>
            <ComparisonSlide theme={theme} />
          </View>
        </ScrollView>
      </View>

      {/* ── Fixed bottom: pricing + CTA ── */}
      <Animated.View
        entering={FadeInUp.delay(200).duration(400)}
        style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) + 8, backgroundColor: theme.background, borderTopColor: theme.border }]}
      >
        {status === 'loading' && (
          <View style={styles.loadingSection}>
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        )}

        {/* Subscribed state */}
        {status !== 'loading' && isSubscribed && (
          <View style={styles.subscribedBottom}>
            <View style={[styles.subscribedBadge, { backgroundColor: theme.primaryMuted }]}>
              <SymbolView name={"checkmark.circle.fill" as any} size={16} tintColor="#22C55E" />
              <ThemedText style={{ fontSize: 14, fontWeight: '700' }}>You{'\u2019'}re subscribed</ThemedText>
            </View>
            {usage && (
              <View style={styles.usageSummary}>
                <UsageRow label="AI plans" used={usage.generations_used} total={usage.limits.generations ?? 3} theme={theme} />
                <UsageRow label="Messages" used={usage.assistance_used} total={usage.limits.assistance ?? 50} theme={theme} />
                <UsageRow label="Imports" used={usage.imports_used} total={usage.limits.imports ?? 10} theme={theme} />
              </View>
            )}
            <Pressable onPress={openSubscriptionManagement} style={styles.manageBtn} accessibilityRole="button">
              <ThemedText style={[styles.manageBtnText, { color: theme.primary }]}>Manage subscription</ThemedText>
            </Pressable>
          </View>
        )}

        {/* Purchase flow */}
        {status !== 'loading' && !isSubscribed && (
          <>
            {/* Plan toggle */}
            <View style={styles.planToggle}>
                <Pressable
                  onPress={() => setSelectedPlan('monthly')}
                  style={[
                    styles.planOption,
                    {
                      backgroundColor: selectedPlan === 'monthly' ? theme.backgroundElement : 'transparent',
                      borderColor: selectedPlan === 'monthly' ? theme.primary : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <ThemedText style={styles.planOptionLabel}>Monthly</ThemedText>
                  <ThemedText style={styles.planOptionPrice}>
                    {monthlyProduct?.displayPrice ?? '$4.99'}<ThemedText style={[styles.planOptionPeriod, { color: theme.textSecondary }]}> /mo</ThemedText>
                  </ThemedText>
                </Pressable>

                <Pressable
                  onPress={() => setSelectedPlan('annual')}
                  style={[
                    styles.planOption,
                    {
                      backgroundColor: selectedPlan === 'annual' ? theme.backgroundElement : 'transparent',
                      borderColor: selectedPlan === 'annual' ? theme.primary : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <View style={[styles.saveBadge, { backgroundColor: theme.primary }]}>
                    <ThemedText style={[styles.saveBadgeText, { color: theme.primaryText }]}>Save 33%</ThemedText>
                  </View>
                  <ThemedText style={styles.planOptionLabel}>Yearly</ThemedText>
                  <ThemedText style={styles.planOptionPrice}>
                    {annualProduct?.displayPrice ?? '$39.99'}<ThemedText style={[styles.planOptionPeriod, { color: theme.textSecondary }]}> /yr</ThemedText>
                  </ThemedText>
                </Pressable>
              </View>

            {/* CTA */}
            <Pressable
              onPress={handleSubscribe}
              disabled={purchasing || status !== 'available'}
              style={({ pressed }) => [
                styles.ctaButton,
                {
                  backgroundColor: theme.primary,
                  opacity: (purchasing || status !== 'available') ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Continue"
            >
              <ThemedText style={[styles.ctaText, { color: theme.primaryText }]}>
                {purchasing ? 'Processing...' : status !== 'available' ? 'Not yet available' : 'Continue'}
              </ThemedText>
            </Pressable>

            {/* Restore + legal */}
            <View style={styles.bottomLinks}>
              <Pressable onPress={handleRestore} disabled={restoring} accessibilityRole="button">
                <ThemedText style={[styles.bottomLinkText, { color: theme.textSecondary }]}>
                  {restoring ? 'Restoring...' : 'Restore Purchases'}
                </ThemedText>
              </Pressable>
              <ThemedText style={[styles.bottomLinkDot, { color: theme.border }]}>{'\u00B7'}</ThemedText>
              <ThemedText style={[styles.bottomLinkText, { color: theme.textSecondary }]}>Terms</ThemedText>
              <ThemedText style={[styles.bottomLinkDot, { color: theme.border }]}>{'\u00B7'}</ThemedText>
              <ThemedText style={[styles.bottomLinkText, { color: theme.textSecondary }]}>Privacy</ThemedText>
            </View>
          </>
        )}
      </Animated.View>
    </ThemedView>
  );
}

// ─── Slide styles ───────────────────────────────────────────────────────────

const slideStyles = StyleSheet.create({
  slideContainer: { gap: 16, paddingTop: 4 },
  slideTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },

  // Features
  featureList: { gap: 0 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  featureIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 14, fontWeight: '700' },
  featureDesc: { fontSize: 12, marginTop: 1, lineHeight: 17 },

  // Comparison
  comparisonCard: { borderRadius: Radius.md, borderWidth: 1, overflow: 'hidden' },
  comparisonHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1 },
  comparisonHeaderLabel: { flex: 1, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14 },
  comparisonLabel: { flex: 2, fontSize: 13, fontWeight: '500' },
  comparisonValue: { flex: 1, fontSize: 12, textAlign: 'center' },

});

// ─── Main styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.four,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Hero
  hero: { alignItems: 'center', paddingTop: 12, paddingBottom: 14, overflow: 'visible' },
  logo: { fontSize: 28, fontWeight: '800', letterSpacing: -0.8, lineHeight: 34 },
  subtitle: { fontSize: 14, marginTop: 6 },

  // Dots
  dotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingBottom: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotActive: { width: 20, borderRadius: 3 },

  // Pager
  pagerContainer: { flex: 1 },
  pager: { flex: 1 },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 10,
  },

  // Loading
  loadingSection: { alignItems: 'center', paddingVertical: 20 },

  // Subscribed
  subscribedBottom: { gap: 12, alignItems: 'center' },
  subscribedBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.md },
  usageSummary: { gap: 8, width: '100%' },
  usageRow: { gap: 3 },
  usageLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  usageBar: { height: 5, borderRadius: 2.5, overflow: 'hidden' },
  usageBarFill: { height: '100%', borderRadius: 2.5 },
  manageBtn: { paddingVertical: 6 },
  manageBtnText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  // Plan toggle
  planToggle: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  planOption: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 2,
    position: 'relative',
    overflow: 'hidden',
  },
  planOptionLabel: { fontSize: 13, fontWeight: '600' },
  planOptionPrice: { fontSize: 18, fontWeight: '800' },
  planOptionPeriod: { fontSize: 13, fontWeight: '400' },
  saveBadge: {
    position: 'absolute',
    top: -1,
    right: -1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderBottomLeftRadius: 8,
    borderTopRightRadius: Radius.md,
  },
  saveBadgeText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.3 },

  // CTA
  ctaButton: {
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  ctaText: { fontSize: 16, fontWeight: '700' },

  // Bottom links
  bottomLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 4 },
  bottomLinkText: { fontSize: 12 },
  bottomLinkDot: { fontSize: 12 },
});
