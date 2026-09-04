import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Resource } from '../../../lib/types';

export default function ResourcesScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: '3D Resources',
          headerRight: () => (
            <Pressable onPress={() => router.push('/resources/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.searchBar}>
        <TextField placeholder="Search resources…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<Resource>
        queryKey={['resources', search]}
        // No server-side search on /api/resources -- filter client-side
        // against the full list instead.
        queryFn={() =>
          api.get<{ resources: Resource[] }>('/api/resources').then((r) => {
            const q = search.trim().toLowerCase();
            return q ? r.resources.filter((res) => res.title.toLowerCase().includes(q)) : r.resources;
          })
        }
        keyExtractor={(r) => r.id}
        emptyMessage="No resources found."
        renderItem={(resource) => (
          <Pressable
            onPress={() => router.push(`/resources/${resource.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.title, { color: colors.ink }]}>{resource.title}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                {resource.filamentType || resource.dimensions || 'No details'}
              </Text>
            </View>
            <Badge tone={resource.active ? 'ok' : 'muted'}>{resource.active ? 'Active' : 'Inactive'}</Badge>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  title: { fontSize: 15, fontWeight: '700' },
});
