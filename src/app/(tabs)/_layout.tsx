import { Tabs, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Animated, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { HouseIcon, PersonIcon, SuitcaseIcon, BoardsIcon, BookingsIcon } from '@/components/icons';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Shadow, Spacing } from '@/constants/theme';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const theme = useTheme();
  const color = focused ? theme.primary : theme.textSecondary;

  if (name === 'index') {
    return <HouseIcon size={24} color={color} />;
  }

  if (name === 'profile') {
    return <PersonIcon size={24} color={color} />;
  }

  if (name === 'chat') {
    return <SymbolView name="message" size={24} tintColor={color} weight="medium" />;
  }

  if (name === 'explore') {
    return <SymbolView name="magnifyingglass" size={24} tintColor={color} weight="regular" />;
  }

  return <SymbolView name="questionmark" size={24} tintColor={color} />;
}

function NewTripIcon() {
  return (
    <View style={styles.newTripButton}>
      <SymbolView name="plus" size={20} tintColor="#ffffff" />
    </View>
  );
}

const PLUS_ACTIONS = [
  { key: 'trip', Icon: SuitcaseIcon, label: 'Plan a new trip', desc: 'Start planning your next adventure', route: '/add-trip' },
  { key: 'board', Icon: BoardsIcon, label: 'Create a board', desc: 'Save and organize your travel inspiration', route: '/inbox' },
  { key: 'bookings', Icon: BookingsIcon, label: 'My Bookings', desc: 'View and manage your trip bookings', route: '/bookings' },
] as const;

export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: screenHeight } = useWindowDimensions();
  const [sheetVisible, setSheetVisible] = useState(false);

  // Animation values
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(new Animated.Value(screenHeight)).current;

  const tabHeight = Platform.OS === 'ios' ? 88 : 68;

  function openSheet() {
    setSheetVisible(true);
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(sheetTranslateY, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  }

  function closeSheet(onDone?: () => void) {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(sheetTranslateY, { toValue: screenHeight, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setSheetVisible(false);
      onDone?.();
    });
  }

  function handlePlusAction(route: string) {
    // Close the sheet and navigate only after the animation completes —
    // everything stays in the same UIWindow so there's no Modal/push conflict.
    closeSheet(() => router.push(route as any));
  }

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.background,
            borderTopWidth: 0,
            shadowColor: theme.shadow,
            shadowOffset: { width: 0, height: -3 },
            shadowOpacity: 0.08,
            shadowRadius: 12,
            elevation: 16,
            height: tabHeight,
            paddingBottom: Platform.OS === 'ios' ? insets.bottom : 10,
            paddingTop: 10,
          },
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textSecondary,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            letterSpacing: 0.2,
            fontFamily: 'ui-rounded',
          },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: 'Chat',
            tabBarIcon: ({ focused }) => <TabIcon name="chat" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="plan"
          options={{
            title: '',
            tabBarIcon: () => <NewTripIcon />,
            tabBarLabel: () => null,
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              openSheet();
            },
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: 'Explore',
            tabBarIcon: ({ focused }) => <TabIcon name="explore" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
          }}
        />
        <Tabs.Screen
          name="trips"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="trip/[id]"
          options={{
            href: null,
          }}
        />
      </Tabs>

      {/* Plus button action sheet — rendered in-tree (same UIWindow) to avoid
          iOS Modal UIWindow / navigation push timing conflicts */}
      {sheetVisible && (
        <>
          <Animated.View style={[styles.sheetBackdrop, { opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => closeSheet()} accessibilityRole="button" accessibilityLabel="Dismiss" />
          </Animated.View>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 },
              { transform: [{ translateY: sheetTranslateY }] },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
            <ThemedText type="subtitle" style={styles.sheetTitle}>What would you like to do?</ThemedText>

            {PLUS_ACTIONS.map((action, i) => (
              <View key={action.key}>
                {i > 0 && <View style={[styles.sheetSeparator, { backgroundColor: theme.border }]} />}
                <Pressable
                  onPress={() => handlePlusAction(action.route)}
                  style={({ pressed }) => [styles.sheetAction, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <View style={[styles.sheetActionIcon, { backgroundColor: theme.primaryMuted }]}>
                    <action.Icon size={20} color={theme.primary} />
                  </View>
                  <View style={styles.sheetActionText}>
                    <ThemedText style={styles.sheetActionLabel}>{action.label}</ThemedText>
                    <ThemedText type="small" style={{ color: theme.textSecondary }}>{action.desc}</ThemedText>
                  </View>
                </Pressable>
              </View>
            ))}

            <Pressable
              onPress={() => closeSheet()}
              style={[styles.sheetCancel, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <ThemedText style={[styles.sheetCancelText, { color: theme.text }]}>Cancel</ThemedText>
            </Pressable>
          </Animated.View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  newTripButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.sheet,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    marginTop: -6,
    ...Shadow.strong,
    shadowColor: '#000000',
  },
  // Action sheet
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 100,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Spacing.four,
    zIndex: 101,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    textAlign: 'center',
    marginBottom: 20,
  },
  sheetSeparator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 14,
  },
  sheetActionIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetActionText: {
    flex: 1,
    gap: 2,
  },
  sheetActionLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  sheetCancel: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  sheetCancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
