import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { TravelProfile } from '@/context/profile';

// ── Scale bar (visual line indicator) ──

const PACE_IDX: Record<string, number> = { relaxed: 0, moderate: 1, active: 2 };
const FLEX_IDX: Record<string, number> = { planned: 0, some: 1, freeflow: 2 };
const BUDGET_IDX: Record<string, number> = { budget: 0, moderate: 1, premium: 2 };

function ScaleBar({
  label,
  left,
  right,
  value,
  theme,
}: {
  label: string;
  left: string;
  right: string;
  value: number; // 0-2
  theme: ReturnType<typeof useTheme>;
}) {
  const pct = Math.max(10, (value / 2) * 100);
  const isLeft = value === 0;
  const isRight = value === 2;

  return (
    <View style={styles.scaleRow}>
      <View style={styles.scaleLabelRow}>
        <ThemedText style={[styles.scaleLabel, { color: theme.text }]}>{label}</ThemedText>
      </View>
      <View style={[styles.track, { backgroundColor: theme.border }]}>
        <View style={[styles.fill, { backgroundColor: theme.textSecondary, width: `${pct}%` }]} />
      </View>
      <View style={styles.scaleEndRow}>
        <ThemedText style={[styles.scaleEnd, isLeft ? { color: theme.text, fontWeight: '700' } : { color: theme.textSecondary }]}>{left}</ThemedText>
        <ThemedText style={[styles.scaleEnd, isRight ? { color: theme.text, fontWeight: '700' } : { color: theme.textSecondary }]}>{right}</ThemedText>
      </View>
    </View>
  );
}

/** Strip leading emoji and whitespace from a label */
function stripEmoji(str: string): string {
  return str.replace(/^[\p{Emoji}\p{Emoji_Component}\uFE0F\u200D\s]+/u, '').trim();
}

export function TravelStyleCard({
  profile,
  onPress,
  onReset,
  showHeader = true,
  compact = false,
}: {
  profile: TravelProfile;
  onPress?: () => void;
  onReset?: () => void;
  showHeader?: boolean;
  compact?: boolean;
}) {
  const theme = useTheme();

  // Filter out "Nothing in particular" entries
  const dietary = profile.dietaryRestrictions.filter((d) => !d.includes('Nothing'));
  const mobility = profile.mobilityNeeds.filter((m) => !m.includes('Nothing'));

  const content = (
    <>
      {showHeader && (
        <ThemedText style={[styles.eyebrow, { color: theme.text }]}>
          Your preferences
        </ThemedText>
      )}

      {/* Scale bars */}
      {!compact && (
        <View style={styles.scales}>
          <ScaleBar label="Pace" left="Relaxed" right="Active" value={PACE_IDX[profile.pace] ?? 1} theme={theme} />
          <ScaleBar label="Flexibility" left="Planned" right="Spontaneous" value={FLEX_IDX[profile.flexibility] ?? 1} theme={theme} />
          {profile.budget != null && (
            <ScaleBar label="Budget" left="Budget" right="Premium" value={BUDGET_IDX[profile.budget] ?? 1} theme={theme} />
          )}
        </View>
      )}

      {/* All chips in one flow when compact */}
      {compact ? (
        <View style={styles.chips}>
          {profile.interests.map((i) => (
            <View key={i} style={[styles.chip, { borderColor: theme.border }]}>
              <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>{stripEmoji(i)}</ThemedText>
            </View>
          ))}
          {dietary.map((d) => (
            <View key={d} style={[styles.chip, { borderColor: theme.border }]}>
              <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>{stripEmoji(d)}</ThemedText>
            </View>
          ))}
          {mobility.map((m) => (
            <View key={m} style={[styles.chip, { borderColor: theme.border }]}>
              <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>{stripEmoji(m)}</ThemedText>
            </View>
          ))}
        </View>
      ) : (
        <>
          {/* Interests */}
          {profile.interests.length > 0 && (
            <View style={styles.section}>
              <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>Interests</ThemedText>
              <View style={styles.chips}>
                {profile.interests.map((i) => (
                  <View key={i} style={[styles.chip, { borderColor: theme.border }]}>
                    <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>{stripEmoji(i)}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Dietary */}
          {dietary.length > 0 && (
            <View style={styles.section}>
              <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>Dietary</ThemedText>
              <View style={styles.chips}>
                {dietary.map((d) => (
                  <View key={d} style={[styles.chip, { borderColor: theme.border }]}>
                    <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>{stripEmoji(d)}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Accessibility */}
          {mobility.length > 0 && (
            <View style={styles.section}>
              <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>Accessibility</ThemedText>
              <View style={styles.chips}>
                {mobility.map((m) => (
                  <View key={m} style={[styles.chip, { borderColor: theme.border }]}>
                    <ThemedText style={[styles.chipText, { color: theme.textSecondary }]}>{stripEmoji(m)}</ThemedText>
                  </View>
                ))}
              </View>
            </View>
          )}

        </>
      )}

      {(onPress || onReset) && (
        <View style={styles.actions}>
          {onPress && (
            <Pressable
              onPress={onPress}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Edit preferences"
            >
              <ThemedText style={[styles.actionBtnText, { color: theme.textSecondary }]}>Edit preferences {'\u203A'}</ThemedText>
            </Pressable>
          )}
          {onReset && (
            <Pressable
              onPress={onReset}
              style={styles.actionBtn}
              accessibilityRole="button"
              accessibilityLabel="Reset preferences"
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <ThemedText style={[styles.actionBtnText, { color: '#DC2626' }]}>Reset</ThemedText>
                <SymbolView name={"xmark" as any} size={12} tintColor="#DC2626" />
              </View>
            </Pressable>
          )}
        </View>
      )}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.card, { opacity: pressed ? 0.7 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="Edit your travel preferences"
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: 4,
    gap: 6,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Scales
  scales: {
    gap: 14,
  },
  scaleRow: {
    gap: 5,
  },
  scaleLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scaleLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
  scaleEndRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scaleEnd: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Sections (interests, dietary, accessibility)
  section: {
    gap: 6,
    marginTop: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionBtn: {
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '500',
  },
});
