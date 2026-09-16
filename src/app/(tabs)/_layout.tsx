import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from '@/components/themed-text';
import { HouseIcon, PersonIcon, SuitcaseIcon, BoardsIcon } from '@/components/icons';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Shadow, Spacing } from '@/constants/theme';

const TAB_SYMBOLS: Record<string, [string, string]> = {
  chat: ['message', 'message'],
  explore: ['magnifyingglass', 'magnifyingglass'],
};

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
  { key: 'board', Icon: BoardsIcon, label: 'Create a board', desc: 'Organize travel ideas, links & screenshots', route: '/inbox' },
] as const;

export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [showPlusSheet, setShowPlusSheet] = useState(false);

  const tabHeight = Platform.OS === 'ios' ? 88 : 68;

  function handlePlusAction(route: string) {
    setShowPlusSheet(false);
    router.push(route as any);
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
              setShowPlusSheet(true);
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

      {/* Plus button action sheet */}
      <Modal visible={showPlusSheet} transparent animationType="fade" onRequestClose={() => setShowPlusSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowPlusSheet(false)} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + 20 }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="button"
            accessibilityLabel="Action sheet"
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
              onPress={() => setShowPlusSheet(false)}
              style={[styles.sheetCancel, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <ThemedText style={[styles.sheetCancelText, { color: theme.text }]}>Cancel</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: 12,
    paddingHorizontal: Spacing.four,
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
