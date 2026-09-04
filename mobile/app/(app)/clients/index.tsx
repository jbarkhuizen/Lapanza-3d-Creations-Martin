import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Client } from '../../../lib/types';

export default function ClientsScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Clients' }} />
      <View style={styles.searchBar}>
        <TextField placeholder="Search clients…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<Client>
        queryKey={['clients', search]}
        queryFn={() => api.get<{ clients: Client[] }>('/api/clients', { q: search || undefined }).then((r) => r.clients)}
        keyExtractor={(c) => c.id}
        emptyMessage="No clients found."
        renderItem={(client) => (
          <Pressable
            onPress={() => router.push(`/clients/${client.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{client.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                {client.email || 'No email'}
              </Text>
            </View>
            {client.disabled && <Badge tone="danger">Disabled</Badge>}
            {!client.disabled && client.hasAccount && <Badge tone={client.emailVerified ? 'ok' : 'warn'}>{client.emailVerified ? 'Verified' : 'Unverified'}</Badge>}
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
