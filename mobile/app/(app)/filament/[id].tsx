import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { InHouseFilament, InventoryItem } from '../../../lib/types';

export default function FilamentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['filament', id],
    queryFn: () => api.get<{ filament: InHouseFilament }>(`/api/in-house-filament/${id}`).then((r) => r.filament),
  });

  const rollPicker = useQuery({
    queryKey: ['filament-roll-picker'],
    queryFn: () =>
      api.get<{ items: InventoryItem[] }>('/api/inventory').then((r) => r.items.filter((i) => i.kind === 'filament' && i.stockQty > 0)),
    enabled: picking,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['filament', id] });
    queryClient.invalidateQueries({ queryKey: ['filament'] });
    queryClient.invalidateQueries({ queryKey: ['stock'] });
  };

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => api.patch<{ filament: InHouseFilament }>(`/api/in-house-filament/${id}/archive`, { archived }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not update', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  // The transfer moves one physical roll from a Stock Management filament
  // item (filament_colours row) onto this in-house roll count -- see
  // transferStockRoll in server/in-house-filament.js.
  const transferMutation = useMutation({
    mutationFn: (stockItemId: string) => api.post<{ filament: InHouseFilament }>(`/api/in-house-filament/${id}/transfer-roll`, { stockItemId }),
    onSuccess: () => {
      invalidate();
      setPicking(false);
    },
    onError: (e) => Alert.alert('Could not transfer roll', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Filament not found.'} onRetry={() => refetch()} />;

  const filament = data;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `${filament.filamentType} — ${filament.colorName}` }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.name, { color: colors.ink }]}>
            {filament.filamentType} — {filament.colorName}
          </Text>
          {filament.archived && <Badge tone="muted">Archived</Badge>}
        </View>
        <Label>Brand</Label>
        <Value>{filament.brand}</Value>
      </Card>

      <Card>
        <Label>Rolls available</Label>
        <Value>{filament.rollsAvailable}</Value>
        <Label>Remaining</Label>
        <Value>
          {Math.round(filament.remainingG)} g · {filament.remainingM.toFixed(1)} m
          {filament.percentLeft != null ? ` (${Math.round(filament.percentLeft * 100)}%)` : ''}
        </Value>
        <Label>Used so far</Label>
        <Value>
          {Math.round(filament.usedG)} g · {filament.usedM.toFixed(1)} m
        </Value>
      </Card>

      <Card>
        <Label>Per roll</Label>
        <Value>
          {filament.weightG} g · {filament.rollLengthM} m
        </Value>
        <Label>Cost per roll</Label>
        <Value>{formatRand(filament.costPerRollRand)}</Value>
        <Label>Cost per gram</Label>
        <Value>{formatRand(filament.costPerG)}</Value>
      </Card>

      <Card>
        <Label>Transfer a roll from Stock Management</Label>
        {!picking ? (
          <SecondaryButton title="Choose a stock item to transfer" onPress={() => setPicking(true)} />
        ) : rollPicker.isLoading ? (
          <LoadingState label="Loading stock…" />
        ) : rollPicker.data && rollPicker.data.length > 0 ? (
          <View style={{ gap: spacing.xs }}>
            {rollPicker.data.map((item) => (
              <SecondaryButton
                key={item.id}
                title={`${item.name} (${item.stockQty} in stock)`}
                onPress={() => transferMutation.mutate(item.id)}
                disabled={transferMutation.isPending}
              />
            ))}
            <SecondaryButton title="Cancel" onPress={() => setPicking(false)} />
          </View>
        ) : (
          <>
            <Text style={{ color: colors.muted }}>No filament rolls with stock available.</Text>
            <SecondaryButton title="Cancel" onPress={() => setPicking(false)} />
          </>
        )}
      </Card>

      <PrimaryButton
        title={filament.archived ? 'Unarchive' : 'Archive'}
        onPress={() => archiveMutation.mutate(!filament.archived)}
        loading={archiveMutation.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '700', flexShrink: 1 },
});
