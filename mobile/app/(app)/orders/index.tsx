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

export default function OrdersScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Orders',
          headerRight: () => (
            <Pressable onPress={() => router.push('/orders/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.searchBar}>
        <TextField placeholder="Search orders, clients, invoice #…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<Order>
        queryKey={['orders', search]}
        queryFn={() => api.get<{ orders: Order[] }>('/api/orders', { q: search || undefined }).then((r) => r.orders)}
        keyExtractor={(o) => o.id}
        emptyMessage="No orders found."
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
                {order.client?.name || 'Unknown client'}
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
