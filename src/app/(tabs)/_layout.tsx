import { Tabs, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

const TAB_SYMBOLS: Record<string, string> = {
  index: 'house.fill',
  trips: 'airplane',
  explore: 'safari.fill',
  profile: 'person.fill',
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const theme = useTheme();
  const symbol = TAB_SYMBOLS[name] ?? 'questionmark';

  return (
    <SymbolView
      name={symbol as any}
      size={22}
      tintColor={focused ? theme.primary : theme.textSecondary}
      style={{ opacity: focused ? 1 : 0.5 }}
    />
  );
}

function NewTripIcon() {
  const theme = useTheme();
  return (
    <View style={[styles.newTripButton, { backgroundColor: theme.primary }]}>
      <SymbolView name="plus" size={20} tintColor={theme.primaryText} />
    </View>
  );
}

export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.background,
          borderTopColor: theme.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: Platform.OS === 'ios' ? 85 : 65,
          paddingBottom: Platform.OS === 'ios' ? insets.bottom : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.2,
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
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ focused }) => <TabIcon name="trips" focused={focused} />,
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
            router.push('/add-trip');
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
        name="trip/[id]"
        options={{
          href: null,
        }}
      />
    </Tabs>

    {/* Floating Ask Travonal button */}
    <Pressable
      onPress={() => router.push('/chat')}
      style={({ pressed }) => [
        styles.chatFab,
        {
          bottom: (Platform.OS === 'ios' ? 85 : 65) + 16,
          backgroundColor: theme.primary,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Chat with Travonal"
    >
      <SymbolView name="bubble.left.fill" size={16} tintColor={theme.primaryText} />
      <ThemedText style={[styles.chatFabText, { color: theme.primaryText }]}>Ask Travonal</ThemedText>
    </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  newTripButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -12,
    shadowColor: '#E5E5E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  chatFab: {
    position: 'absolute',
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#E5E5E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
  },
  chatFabText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
