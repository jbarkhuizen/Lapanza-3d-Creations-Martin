import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { InHouseFilament } from '../../../lib/types';

export default function FilamentScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'In-House Filament' }} />
      <View style={styles.searchBar}>
        <TextField placeholder="Search filament…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<InHouseFilament>
        queryKey={['filament', search]}
        queryFn={async () => {
          const { filaments } = await api.get<{ filaments: InHouseFilament[] }>('/api/in-house-filament');
          const q = search.trim().toLowerCase();
          return filaments.filter(
            (f) => !q || f.brand.toLowerCase().includes(q) || f.filamentType.toLowerCase().includes(q) || f.colorName.toLowerCase().includes(q),
          );
        }}
        keyExtractor={(f) => f.id}
        emptyMessage="No in-house filament found."
        renderItem={(f) => (
          <Pressable
            onPress={() => router.push(`/filament/${f.id}`)}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
                {f.filamentType} — {f.colorName}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                {f.brand} · {f.rollsAvailable} roll{f.rollsAvailable === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>
                {f.percentLeft != null ? `${Math.round(f.percentLeft * 100)}% left` : '—'}
              </Text>
              {f.archived && <Badge tone="muted">Archived</Badge>}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700' },
});
