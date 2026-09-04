import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, SecondaryButton } from '../../../components/UI';
import { api } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Purchase, PurchaseStatus } from '../../../lib/types';

const FILTERS: Array<{ label: string; value: PurchaseStatus | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'Outstanding', value: 'outstanding' },
  { label: 'Paid', value: 'paid' },
];

export default function PurchasesScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<PurchaseStatus | undefined>(undefined);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Purchase History',
          headerRight: () => (
            <Pressable onPress={() => router.push('/purchases/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.filterBar}>
        {FILTERS.map((f) => (
          <SecondaryButton key={f.label} title={f.label} onPress={() => setStatus(f.value)} disabled={status === f.value} />
        ))}
      </View>
      <EntityList<Purchase>
        queryKey={['purchases', status]}
        queryFn={() => api.get<{ purchases: Purchase[] }>('/api/purchases', { status }).then((r) => r.purchases)}
        keyExtractor={(p) => p.id}
        emptyMessage="No purchases recorded."
        renderItem={(purchase) => (
          <Pressable
            onPress={() => router.push(`/purchases/${purchase.id}`)}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.supplier, { color: colors.ink }]} numberOfLines={1}>
                {purchase.supplier}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                {purchase.goods || 'No description'}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(purchase.purchaseDate).toLocaleDateString()}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.value, { color: colors.ink }]}>{formatRand(purchase.totalValue)}</Text>
              <Badge tone={purchase.status === 'paid' ? 'ok' : 'warn'}>{purchase.status}</Badge>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  supplier: { fontSize: 15, fontWeight: '700' },
  value: { fontSize: 15, fontWeight: '700' },
});
