import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
} from '@/services/subscription';

/**
 * Travonal Plus paywall screen.
 *
 * App-side state and UI are complete. The following external steps are required
 * before in-app purchase flows can go live:
 *   1. Create subscription products in App Store Connect (iOS) and/or
 *      Google Play Console (Android) with your chosen product IDs.
 *   2. Install expo-iap (or react-native-purchases / RevenueCat)
 *      and wire up purchaseSubscription / restorePurchases in src/services/subscription.ts.
 *   3. Add entitlement checking from your chosen IAP provider and surface
 *      isSubscribed=true when verified.
 *
 * Until those products exist, the purchase CTA shows a "not yet available" message.
 */

const FEATURES = [
  {
    icon: '\u2728',
    title: 'Unlimited AI plans',
    desc: 'Generate and refine as many itineraries as you want',
    free: false,
  },
  {
    icon: '\u{1F30D}',
    title: 'Multi-city trips',
    desc: 'Plan trips across multiple destinations seamlessly',
    free: false,
  },
  {
    icon: '\u{1F4F1}',
    title: 'Offline access',
    desc: 'Download itineraries for use without internet',
    free: false,
  },
  {
    icon: '\u{1F9E0}',
    title: 'Advanced personalization',
    desc: 'Deeper AI learning from your preferences and feedback',
    free: false,
  },
  {
    icon: '\u{1F4CD}',
    title: 'Live recommendations',
    desc: 'Real-time suggestions based on your location and conditions',
    free: false,
  },
  {
    icon: '\u{1F465}',
    title: 'Trip collaboration',
    desc: 'Invite travel companions to view and plan together.',
    free: false,
  },
];

export default function TravonalPlusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { showToast } = useToast();
  const { isPlus, refresh: refreshSubscription } = useSubscription();

  const [status, setStatus] = useState<SubscriptionStatus>('loading');
  const [products, setProducts] = useState<SubscriptionProduct[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual');
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    async function init() {
      setStatus('loading');
      try {
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
        await refreshSubscription();
        showToast('Welcome to Travonal Plus!');
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

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <ThemedText style={{ color: theme.primary, fontSize: 16 }}>Close</ThemedText>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <ThemedText style={styles.logo}>Travonal Plus</ThemedText>

        <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
          Unlock the full power of AI-powered travel planning
        </ThemedText>

        {/* Loading state */}
        {status === 'loading' && (
          <View style={styles.loadingSection}>
            <ActivityIndicator size="large" color={theme.primary} />
            <ThemedText style={[{ color: theme.textSecondary, marginTop: 12, textAlign: 'center' }]}>
              Loading subscription options...
            </ThemedText>
          </View>
        )}

        {/* Subscribed state */}
        {status !== 'loading' && isPlus && (
          <View style={[styles.currentPlanCard, { backgroundColor: theme.primaryMuted, borderColor: theme.primary }]}>
            <ThemedText style={[styles.currentPlanLabel, { color: theme.primary }]}>
              {'\u2713'} You{'\u2019'}re subscribed to Travonal Plus
            </ThemedText>
            <Pressable
              onPress={openSubscriptionManagement}
              style={styles.manageLinkBtn}
              accessibilityRole="button"
              accessibilityLabel="Manage subscription"
            >
              <ThemedText style={[styles.manageLinkText, { color: theme.primary }]}>
                Manage subscription
              </ThemedText>
            </Pressable>
          </View>
        )}

        {/* Available: show real product pricing from StoreKit */}
        {status === 'available' && !isPlus && (
          <>
            <View style={styles.plansRow}>
              {products.map((product) => (
                <Pressable
                  key={product.planId}
                  onPress={() => setSelectedPlan(product.planId)}
                  style={({ pressed }) => [
                    styles.planCard,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: product.planId === 'annual' ? theme.primary : theme.border,
                      borderWidth: product.planId === 'annual' ? 2 : 1,
                      opacity: pressed ? 0.9 : 1,
                    },
                    selectedPlan === product.planId && { borderColor: theme.primary, borderWidth: 2 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Subscribe ${product.title}`}
                >
                  {product.planId === 'annual' && (
                    <View style={[styles.bestValueBadge, { backgroundColor: theme.primary }]}>
                      <ThemedText style={[styles.bestValueText, { color: theme.primaryText }]}>
                        Best Value
                      </ThemedText>
                    </View>
                  )}
                  <ThemedText style={styles.planLabel}>{product.title}</ThemedText>
                  <View style={styles.planPriceRow}>
                    <ThemedText style={styles.planPrice}>{product.displayPrice}</ThemedText>
                    <ThemedText style={[styles.planPeriod, { color: theme.textSecondary }]}>
                      /{product.period}
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={handleSubscribe}
              disabled={purchasing}
              style={({ pressed }) => [
                styles.ctaButton,
                { backgroundColor: theme.primary, opacity: pressed || purchasing ? 0.8 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Start Travonal Plus"
            >
              <ThemedText style={[styles.ctaButtonText, { color: theme.primaryText }]}>
                {purchasing ? 'Processing...' : 'Start Travonal Plus'}
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={handleRestore}
              disabled={restoring}
              style={styles.restoreBtn}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
            >
              <ThemedText style={[styles.restoreText, { color: theme.textSecondary }]}>
                {restoring ? 'Restoring...' : 'Restore Purchases'}
              </ThemedText>
            </Pressable>
          </>
        )}

        {/* Unavailable: products not found in App Store */}
        {(status === 'unavailable' || status === 'error') && !isPlus && (
          <>
            <View style={[styles.unavailableCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
              <ThemedText style={[styles.unavailableText, { color: theme.textSecondary }]}>
                Travonal Plus subscriptions are not yet available in your region or this version. Please check back soon.
              </ThemedText>
            </View>

            <Pressable
              onPress={handleRestore}
              disabled={restoring}
              style={styles.restoreBtn}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
            >
              <ThemedText style={[styles.restoreText, { color: theme.textSecondary }]}>
                {restoring ? 'Restoring...' : 'Restore Purchases'}
              </ThemedText>
            </Pressable>
          </>
        )}

        {/* Feature list */}
        {status !== 'loading' && (
          <>
            <ThemedText style={[styles.featuresHeader, { color: theme.textSecondary }]}>
              What{'\u2019'}s included
            </ThemedText>
            <View style={styles.featureList}>
              {FEATURES.map((f, i) => (
                <View key={i} style={[styles.featureRow, { borderBottomColor: theme.border }]}>
                  <ThemedText style={styles.featureIcon}>{f.icon}</ThemedText>
                  <View style={styles.featureText}>
                    <ThemedText style={styles.featureTitle}>{f.title}</ThemedText>
                    <ThemedText style={[styles.featureDesc, { color: theme.textSecondary }]}>
                      {f.desc}
                    </ThemedText>
                  </View>
                </View>
              ))}
            </View>

            {/* Legal disclosures */}
            <ThemedText style={[styles.legal, { color: theme.textSecondary }]}>
              {'\u2022'} Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period.
              {'\n\u2022'} Payment is charged to your Apple ID / Google Play account at confirmation of purchase.
              {'\n\u2022'} Manage or cancel your subscription in your account settings.
              {'\n\u2022'} Prices shown are in your local currency as determined by the App Store / Google Play.
            </ThemedText>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.four,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { minWidth: 60, alignItems: 'flex-end' },
  scrollContent: { padding: Spacing.four },

  logo: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginTop: 24, marginBottom: 8 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 28 },

  // Loading
  loadingSection: { alignItems: 'center', paddingVertical: 32 },

  // Current plan
  currentPlanCard: {
    borderRadius: Radius.md,
    borderWidth: 1.5,
    padding: 18,
    alignItems: 'center',
    gap: 10,
    marginBottom: 24,
  },
  currentPlanLabel: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  manageLinkBtn: { paddingVertical: 4 },
  manageLinkText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },

  // Unavailable card
  unavailableCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  unavailableText: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },

  // Plans
  plansRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  planCard: {
    flex: 1,
    borderRadius: Radius.md,
    padding: 14,
    gap: 4,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  bestValueBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 3,
    alignItems: 'center',
  },
  bestValueText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  planLabel: { fontSize: 14, fontWeight: '600', marginTop: 18 },
  planPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  planPrice: { fontSize: 24, fontWeight: '800' },
  planPeriod: { fontSize: 13 },

  ctaButton: {
    borderRadius: Radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  ctaButtonText: { fontSize: 16, fontWeight: '700' },

  restoreBtn: { alignItems: 'center', paddingVertical: 8, marginBottom: 24 },
  restoreText: { fontSize: 14 },

  // Feature list
  featuresHeader: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 8,
  },
  featureList: { gap: 0, marginBottom: 24 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  featureIcon: { fontSize: 24, width: 32, textAlign: 'center' },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '600' },
  featureDesc: { fontSize: 13, marginTop: 2 },

  // Legal
  legal: {
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
