import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PotentialMarketContact } from '../../../lib/types';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  'Initial Load': 'muted',
  Active: 'ok',
  Inactive: 'warn',
  'Opt Out': 'danger',
};

// Bulk CSV import (the desktop's primary way of populating this list) is
// deliberately not offered here -- see /api/potential-market/import in
// server/index.js, not a mobile-appropriate workflow.
export default function PotentialMarketScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Potential Market' }} />
      <View style={styles.searchBar}>
        <TextField placeholder="Search name, surname, email…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<PotentialMarketContact>
        queryKey={['potential-market', search]}
        // No server-side search on /api/potential-market -- filter client-side.
        queryFn={() =>
          api.get<{ contacts: PotentialMarketContact[] }>('/api/potential-market').then((r) => {
            const q = search.trim().toLowerCase();
            if (!q) return r.contacts;
            return r.contacts.filter(
              (c) => c.name.toLowerCase().includes(q) || c.surname.toLowerCase().includes(q) || c.email.toLowerCase().includes(q),
            );
          })
        }
        keyExtractor={(c) => c.id}
        emptyMessage="No potential market contacts found."
        renderItem={(contact) => (
          <Pressable
            onPress={() => router.push(`/potential-market/${contact.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>
                {contact.name} {contact.surname}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                {contact.email || contact.mobileNumber || 'No contact details'}
              </Text>
            </View>
            <Badge tone={STATUS_TONE[contact.status] || 'muted'}>{contact.status}</Badge>
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
