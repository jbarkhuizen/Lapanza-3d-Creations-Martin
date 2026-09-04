import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { InventoryItem, ReorderItem } from '../../../lib/types';

type StockRow = InventoryItem & { lowStock: boolean; soldLast30Days?: number };

export default function StockScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const adjustMutation = useMutation({
    mutationFn: ({ item, delta }: { item: StockRow; delta: number }) => {
      const stockQty = Math.max(0, item.stockQty + delta);
      return api.put<{ results: Array<{ id: string; ok: boolean; error?: string }> }>('/api/inventory', {
        updates: [{ id: item.id, kind: item.kind, parentId: item.parentId, stockQty, expectedStockQty: item.stockQty }],
      });
    },
    onSuccess: (res) => {
      const result = res.results[0];
      if (!result?.ok) Alert.alert('Could not update stock', result?.error || 'Unknown error');
      queryClient.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => Alert.alert('Could not update stock', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Stock Management' }} />
      <View style={styles.searchBar}>
        <TextField placeholder="Search stock…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<StockRow>
        queryKey={['stock', 'inventory', search]}
        queryFn={async () => {
          const [invRes, reorderRes] = await Promise.all([
            api.get<{ items: InventoryItem[] }>('/api/inventory'),
            api.get<{ items: ReorderItem[]; threshold: number }>('/api/reorder-report'),
          ]);
          const reorderMap = new Map(reorderRes.items.map((i) => [i.id, i.soldLast30Days]));
          const q = search.trim().toLowerCase();
          return invRes.items
            .filter((item) => !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.category.toLowerCase().includes(q))
            .map((item) => ({ ...item, lowStock: reorderMap.has(item.id), soldLast30Days: reorderMap.get(item.id) }));
        }}
        keyExtractor={(item) => item.id}
        emptyMessage="No stock items found."
        renderItem={(item) => (
          <View style={[styles.row, { backgroundColor: colors.panel, borderColor: colors.line }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                {item.category} {item.sku ? `· ${item.sku}` : ''}
              </Text>
              <View style={styles.badgeRow}>
                {item.lowStock && (
                  <Badge tone={item.stockQty <= 0 ? 'danger' : 'warn'}>{item.stockQty <= 0 ? 'Out of stock' : 'Reorder'}</Badge>
                )}
                {item.soldLast30Days !== undefined && (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{item.soldLast30Days} sold / 30d</Text>
                )}
                {item.percentLeft != null && (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>{Math.round(item.percentLeft * 100)}% left</Text>
                )}
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{formatRand(item.price)}</Text>
              <View style={styles.stepper}>
                <Pressable
                  onPress={() => adjustMutation.mutate({ item, delta: -1 })}
                  disabled={adjustMutation.isPending || item.stockQty <= 0}
                  style={({ pressed }) => [styles.stepperBtn, { borderColor: colors.line, opacity: item.stockQty <= 0 ? 0.4 : pressed ? 0.6 : 1 }]}
                >
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>−</Text>
                </Pressable>
                <Text style={[styles.qty, { color: colors.ink }]}>{item.stockQty}</Text>
                <Pressable
                  onPress={() => adjustMutation.mutate({ item, delta: 1 })}
                  disabled={adjustMutation.isPending}
                  style={({ pressed }) => [styles.stepperBtn, { borderColor: colors.line, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>+</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  qty: { fontSize: 15, fontWeight: '700', minWidth: 24, textAlign: 'center' },
});
