import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, SecondaryButton, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Client, Order } from '../../../lib/types';

export default function ClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get<{ client: Client; orders: Order[] }>(`/api/clients/${id}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client', id] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const verifyMutation = useMutation({
    mutationFn: () => api.patch<{ client: Client }>(`/api/clients/${id}/verify`),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not verify', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const disableMutation = useMutation({
    mutationFn: (disabled: boolean) => api.patch<{ client: Client }>(`/api/clients/${id}/disabled`, { disabled }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not update', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const passwordResetMutation = useMutation({
    mutationFn: () => api.post(`/api/clients/${id}/send-password-reset`),
    onSuccess: () => Alert.alert('Sent', 'Password reset email sent.'),
    onError: (e) => Alert.alert('Could not send', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Client not found.'} onRetry={() => refetch()} />;

  const { client, orders } = data;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: client.name }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.name, { color: colors.ink }]}>{client.name}</Text>
          {client.disabled ? <Badge tone="danger">Disabled</Badge> : <Badge tone="ok">Active</Badge>}
        </View>
        <Label>Contact</Label>
        <Value>{client.email || 'No email'}</Value>
        {!!client.phone && <Value>{client.phone}</Value>}
        <Label>Client code</Label>
        <Value>{client.clientCode}</Value>
      </Card>

      <Card>
        <Label>Account</Label>
        {client.hasAccount ? (
          <>
            <Badge tone={client.emailVerified ? 'ok' : 'warn'}>{client.emailVerified ? 'Email verified' : 'Email not verified'}</Badge>
            <View style={styles.actions}>
              {!client.emailVerified && <SecondaryButton title="Verify manually" onPress={() => verifyMutation.mutate()} disabled={verifyMutation.isPending} />}
              <SecondaryButton title="Send password reset" onPress={() => passwordResetMutation.mutate()} disabled={passwordResetMutation.isPending} />
              <SecondaryButton
                title={client.disabled ? 'Enable account' : 'Disable account'}
                onPress={() => disableMutation.mutate(!client.disabled)}
                disabled={disableMutation.isPending}
              />
            </View>
          </>
        ) : (
          <Text style={{ color: colors.muted }}>Guest checkout — no registered account.</Text>
        )}
      </Card>

      <Card>
        <Label>Orders ({orders.length})</Label>
        {orders.length === 0 && <Text style={{ color: colors.muted }}>No orders yet.</Text>}
        {orders.map((order) => (
          <Pressable key={order.id} onPress={() => router.push(`/orders/${order.id}`)} style={styles.orderRow}>
            <Text style={{ color: colors.ink, flex: 1 }}>{order.invoiceNumber}</Text>
            <Text style={{ color: colors.muted }}>{formatRand(order.total)}</Text>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '700' },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
});
