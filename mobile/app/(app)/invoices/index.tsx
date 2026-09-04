import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Order, OrderStatus } from '../../../lib/types';

const STATUS_TONE: Record<OrderStatus, 'ok' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  pending_payment: 'warn',
  paid: 'brand',
  shipped: 'brand',
  completed: 'ok',
  cancelled: 'danger',
};

// Invoice History has no endpoint or data of its own -- it's the same
// orders table as Orders (admin/admin.js's renderInvoiceHistory comment:
// "there is no separate invoices table; one order = one invoice, always").
// Tapping a row goes to the existing order detail screen rather than
// duplicating it here.
export default function InvoicesScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Invoice History' }} />
      <View style={styles.searchBar}>
        <TextField placeholder="Search invoice #, clients…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<Order>
        queryKey={['invoices', search]}
        queryFn={() => api.get<{ orders: Order[] }>('/api/orders', { q: search || undefined }).then((r) => r.orders)}
        keyExtractor={(o) => o.id}
        emptyMessage="No invoices found."
        renderItem={(order) => (
          <Pressable
            onPress={() => router.push(`/orders/${order.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.invoice, { color: colors.ink }]}>{order.invoiceNumber || order.id.slice(0, 8)}</Text>
              <Text style={[styles.clientName, { color: colors.muted }]} numberOfLines={1}>
                {order.client?.name || 'Unknown client'} · {new Date(order.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.total, { color: colors.ink }]}>{formatRand(order.total)}</Text>
              <Badge tone={STATUS_TONE[order.status] || 'muted'}>{order.status.replace('_', ' ')}</Badge>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
  },
  invoice: { fontSize: 15, fontWeight: '700' },
  clientName: { fontSize: 13 },
  total: { fontSize: 15, fontWeight: '700' },
});
