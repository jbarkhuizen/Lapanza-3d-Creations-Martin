import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { navGroups } from '../../../lib/nav-sections';
import { useAuth } from '../../../lib/auth-context';

export default function MenuScreen() {
  const { colors } = useTheme();
  const { username, signOut } = useAuth();

  const sections = navGroups.map((g) => ({ title: g.title, data: g.items }));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.route}
        contentContainerStyle={{ padding: spacing.lg }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.ink }]}>Menu</Text>
            {username && <Text style={[styles.headerSubtitle, { color: colors.muted }]}>Signed in as {username}</Text>}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: colors.muted, backgroundColor: colors.bg }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(item.route as any)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name={item.icon as any} size={20} color={colors.brand} />
            <Text style={[styles.rowText, { color: colors.ink }]}>{item.title}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.xs }} />}
        SectionSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListFooterComponent={
          <Pressable onPress={() => signOut()} style={styles.signOut}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={[styles.signOutText, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { marginBottom: spacing.md },
  headerTitle: { fontSize: 26, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  sectionHeader: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowText: { flex: 1, fontSize: 15, fontWeight: '500' },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, justifyContent: 'center', paddingVertical: spacing.xl },
  signOutText: { fontSize: 15, fontWeight: '600' },
});
