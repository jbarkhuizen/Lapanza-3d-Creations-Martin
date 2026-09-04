import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Order, OrderStatus } from '../../../lib/types';

const STATUSES: OrderStatus[] = ['pending_payment', 'paid', 'shipped', 'completed', 'cancelled'];

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [tracking, setTracking] = useState('');
  const [trackingDirty, setTrackingDirty] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<{ order: Order }>(`/api/orders/${id}`).then((r) => r.order),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['order', id] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: OrderStatus) => api.put<{ order: Order }>(`/api/orders/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not update status', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const trackingMutation = useMutation({
    mutationFn: (trackingNumber: string) => api.put<{ order: Order }>(`/api/orders/${id}/tracking`, { trackingNumber }),
    onSuccess: () => {
      invalidate();
      setTrackingDirty(false);
    },
    onError: (e) => Alert.alert('Could not save tracking number', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const collectedMutation = useMutation({
    mutationFn: (collected: boolean) => api.patch<{ order: Order }>(`/api/orders/${id}/collected`, { collected }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not update', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Order not found.'} onRetry={() => refetch()} />;

  const order = data;
  const trackingValue = trackingDirty ? tracking : order.trackingNumber || '';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: order.invoiceNumber || 'Order' }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.invoice, { color: colors.ink }]}>{order.invoiceNumber}</Text>
          <Badge tone={order.status === 'cancelled' ? 'danger' : order.status === 'completed' ? 'ok' : 'brand'}>
            {order.status.replace('_', ' ')}
          </Badge>
        </View>
        <Label>Client</Label>
        <Value>{order.client?.name || 'Unknown'}</Value>
        {order.client?.email ? <Text style={{ color: colors.muted, fontSize: 13 }}>{order.client.email}</Text> : null}
      </Card>

      <Card>
        <Label>Items</Label>
        {(order.items || []).map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={{ color: colors.ink, flex: 1 }} numberOfLines={2}>
              {item.quantity}× {item.productName}
            </Text>
            <Text style={{ color: colors.muted }}>{formatRand(item.price * item.quantity)}</Text>
          </View>
        ))}
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <SummaryRow label="Subtotal" value={formatRand(order.subtotal)} />
        {order.discountAmount > 0 && <SummaryRow label={`Discount (${order.discountPct}%)`} value={`-${formatRand(order.discountAmount)}`} />}
        {order.promoDiscountAmount > 0 && <SummaryRow label={`Promo (${order.promoCode})`} value={`-${formatRand(order.promoDiscountAmount)}`} />}
        <SummaryRow label="Shipping" value={formatRand(order.shippingPrice)} />
        <SummaryRow label="Total" value={formatRand(order.total)} bold />
      </Card>

      <Card>
        <Label>Update status</Label>
        <View style={styles.statusGrid}>
          {STATUSES.map((s) => (
            <SecondaryButton
              key={s}
              title={s.replace('_', ' ')}
              disabled={s === order.status || statusMutation.isPending}
              onPress={() =>
                Alert.alert('Confirm', `Set order status to "${s.replace('_', ' ')}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Confirm', onPress: () => statusMutation.mutate(s) },
                ])
              }
            />
          ))}
        </View>
      </Card>

      <Card>
        <Label>Tracking number</Label>
        <TextField
          value={trackingValue}
          onChangeText={(v) => {
            setTracking(v);
            setTrackingDirty(true);
          }}
          placeholder="e.g. CO123456789ZA"
          autoCapitalize="characters"
        />
        <PrimaryButton
          title="Save tracking number"
          loading={trackingMutation.isPending}
          disabled={!trackingDirty}
          onPress={() => trackingMutation.mutate(trackingValue)}
        />
      </Card>

      <Card>
        <View style={styles.headerRow}>
          <Label>Collected</Label>
          <SecondaryButton
            title={order.collectedAt ? 'Mark NOT collected' : 'Mark collected'}
            onPress={() => collectedMutation.mutate(!order.collectedAt)}
            disabled={collectedMutation.isPending}
          />
        </View>
        {order.collectedAt && <Text style={{ color: colors.muted, fontSize: 12 }}>Collected {new Date(order.collectedAt).toLocaleString()}</Text>}
      </Card>
    </ScrollView>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={{ color: colors.muted, fontSize: bold ? 15 : 13, fontWeight: bold ? '700' : '400' }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: bold ? 15 : 13, fontWeight: bold ? '700' : '400' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  invoice: { fontSize: 18, fontWeight: '700' },
  itemRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  divider: { height: 1, marginVertical: spacing.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
