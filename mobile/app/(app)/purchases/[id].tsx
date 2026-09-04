import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, SecondaryButton, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Purchase } from '../../../lib/types';

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => api.get<{ purchase: Purchase }>(`/api/purchases/${id}`).then((r) => r.purchase),
  });

  const statusMutation = useMutation({
    mutationFn: (status: Purchase['status']) => api.put<{ purchase: Purchase }>(`/api/purchases/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase', id] });
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
    },
    onError: (e) => Alert.alert('Could not update', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Purchase not found.'} onRetry={() => refetch()} />;

  const purchase = data;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: purchase.supplier }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.supplier, { color: colors.ink }]}>{purchase.supplier}</Text>
          <Badge tone={purchase.status === 'paid' ? 'ok' : 'warn'}>{purchase.status}</Badge>
        </View>
        <Label>Goods</Label>
        <Value>{purchase.goods || '—'}</Value>
      </Card>

      <Card>
        <Label>Total value</Label>
        <Value>{formatRand(purchase.totalValue)}</Value>
        <Label>Payment type</Label>
        <Value>{purchase.paymentType || '—'}</Value>
        <Label>Purchase date</Label>
        <Value>{new Date(purchase.purchaseDate).toLocaleDateString()}</Value>
      </Card>

      <Card>
        <Label>Status</Label>
        <SecondaryButton
          title={purchase.status === 'paid' ? 'Mark outstanding' : 'Mark paid'}
          onPress={() => statusMutation.mutate(purchase.status === 'paid' ? 'outstanding' : 'paid')}
          disabled={statusMutation.isPending}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  supplier: { fontSize: 18, fontWeight: '700' },
});
