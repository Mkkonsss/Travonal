import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { TravelProfile } from '@/context/profile';

const PACE_INDEX: Record<string, number> = { relaxed: 0, moderate: 1, active: 2 };
const BUDGET_INDEX: Record<string, number> = { budget: 0, moderate: 1, premium: 2 };

function ScaleIndicator({
  title,
  labels,
  value,
}: {
  title: string;
  labels: string[];
  value: number;
}) {
  const theme = useTheme();
  const maxIdx = labels.length - 1;
  const fillPercent = maxIdx === 0 ? 100 : Math.max(8, (value / maxIdx) * 100);
  const currentLabel = labels[value] ?? labels[0];

  return (
    <View style={styles.scaleContainer}>
      <View style={styles.scaleTitleRow}>
        <ThemedText style={[styles.scaleTitle, { color: theme.text }]}>{title}</ThemedText>
        <ThemedText style={[styles.scaleValue, { color: theme.primary }]}>{currentLabel}</ThemedText>
      </View>
      <View style={[styles.scaleTrack, { backgroundColor: theme.border }]}>
        <View style={[styles.scaleFill, { backgroundColor: theme.primary, width: `${fillPercent}%` }]} />
      </View>
      <View style={styles.scaleEndLabels}>
        <ThemedText style={[styles.scaleEndLabel, { color: theme.textSecondary }]}>
          {labels[0]}
        </ThemedText>
        <ThemedText style={[styles.scaleEndLabel, { color: theme.textSecondary }]}>
          {labels[maxIdx]}
        </ThemedText>
      </View>
    </View>
  );
}

export function TravelStyleCard({
  profile,
  onPress,
  showHeader = true,
}: {
  profile: TravelProfile;
  onPress?: () => void;
  showHeader?: boolean;
}) {
  const theme = useTheme();

  const content = (
    <>
      {showHeader && (
        <View style={styles.cardHeader}>
          <ThemedText type="eyebrow" style={{ color: theme.textSecondary }}>
            Your travel style
          </ThemedText>
          {onPress && (
            <ThemedText style={[styles.editHint, { color: theme.primary }]}>Edit</ThemedText>
          )}
        </View>
      )}

      <ScaleIndicator
        title="Pace"
        labels={['Relaxed', 'Moderate', 'Active']}
        value={PACE_INDEX[profile.pace] ?? 1}
      />
      <ScaleIndicator
        title="Budget"
        labels={['Budget', 'Moderate', 'Premium']}
        value={BUDGET_INDEX[profile.budget] ?? 1}
      />

      {profile.interests.length > 0 && (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            Interests
          </ThemedText>
          <View style={styles.chips}>
            {profile.interests.map((interest) => (
              <View key={interest} style={[styles.chip, { backgroundColor: theme.primaryMuted }]}>
                <ThemedText style={[styles.chipText, { color: theme.primary }]}>
                  {interest}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      )}

      {profile.dietaryRestrictions.length > 0 && (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            Dietary
          </ThemedText>
          <ThemedText style={{ color: theme.text, fontSize: 14 }}>
            {profile.dietaryRestrictions.join(', ')}
          </ThemedText>
        </View>
      )}

      {profile.mobilityNeeds.length > 0 && (
        <View style={styles.section}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            Accessibility
          </ThemedText>
          <ThemedText style={{ color: theme.text, fontSize: 14 }}>
            {profile.mobilityNeeds.join(', ')}
          </ThemedText>
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="View your travel profile"
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editHint: { fontSize: 13, fontWeight: '600' },

  // Scale
  scaleContainer: { gap: 6 },
  scaleTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scaleTitle: { fontSize: 13, fontWeight: '600' },
  scaleValue: { fontSize: 13, fontWeight: '700' },
  scaleTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  scaleFill: {
    height: 6,
    borderRadius: 3,
  },
  scaleEndLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scaleEndLabel: { fontSize: 11, fontWeight: '500' },

  // Sections
  section: { gap: 4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  chipText: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
});
