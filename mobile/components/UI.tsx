import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';

import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/theme-context';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.brand} />
      <Text style={[styles.mutedText, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.centered, { gap: spacing.sm }]}>
      <Text style={[styles.mutedText, { color: colors.danger, textAlign: 'center' }]}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={[styles.smallButton, { borderColor: colors.brand }]}>
          <Text style={{ color: colors.brand, fontWeight: '600' }}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.centered}>
      <Text style={[styles.mutedText, { color: colors.muted }]}>{message}</Text>
    </View>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.panel, borderColor: colors.line, shadowColor: colors.ink },
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.sectionTitle, { color: colors.ink }]}>{children}</Text>;
}

export function Label({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.label, { color: colors.muted }]}>{children}</Text>;
}

export function Value({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <Text style={[styles.value, { color: colors.ink }]}>{children}</Text>;
}

type BadgeTone = 'ok' | 'warn' | 'danger' | 'brand' | 'muted';

export function Badge({ children, tone = 'muted' }: { children: React.ReactNode; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const toneColor =
    tone === 'ok' ? colors.ok : tone === 'warn' ? colors.warn : tone === 'danger' ? colors.danger : tone === 'brand' ? colors.brand : colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: `${toneColor}22`, borderColor: `${toneColor}55` }]}>
      <Text style={[styles.badgeText, { color: toneColor }]}>{children}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.brand, opacity: disabled || loading ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.secondaryButton,
        { borderColor: colors.line, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.secondaryButtonText, { color: colors.ink }]}>{title}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; containerStyle?: object }) {
  const { colors } = useTheme();
  return (
    <View style={[{ gap: spacing.xs }, containerStyle]}>
      {label && <Label>{label}</Label>}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          { backgroundColor: colors.bgElevated, borderColor: colors.line, color: colors.ink },
        ]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  mutedText: { fontSize: 14 },
  smallButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius, borderWidth: 1 },
  card: {
    borderRadius: radius,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 1,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  value: { fontSize: 16, fontWeight: '500' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  primaryButton: { paddingVertical: spacing.md, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButton: { paddingVertical: spacing.md, borderRadius: radius, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  secondaryButtonText: { fontWeight: '600', fontSize: 15 },
  input: { borderWidth: 1, borderRadius: radius, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 15 },
});
