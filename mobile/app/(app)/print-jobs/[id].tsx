import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PrintJob, PrintJobStatus } from '../../../lib/types';

const STATUSES: PrintJobStatus[] = ['Estimate', 'Printed'];

export default function PrintJobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [price, setPrice] = useState('');
  const [priceDirty, setPriceDirty] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['print-job', id],
    queryFn: () => api.get<{ printJob: PrintJob }>(`/api/print-jobs/${id}`).then((r) => r.printJob),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['print-job', id] });
    queryClient.invalidateQueries({ queryKey: ['print-jobs'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: PrintJobStatus) => api.patch<{ printJob: PrintJob }>(`/api/print-jobs/${id}`, { status }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not update status', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const priceMutation = useMutation({
    mutationFn: (finalSellingPrice: number) => api.patch<{ printJob: PrintJob }>(`/api/print-jobs/${id}`, { finalSellingPrice }),
    onSuccess: () => {
      invalidate();
      setPriceDirty(false);
    },
    onError: (e) => Alert.alert('Could not save price', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Print job not found.'} onRetry={() => refetch()} />;

  const job = data;
  const priceValue = priceDirty ? price : String(job.finalSellingPrice);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: job.itemName }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={2}>
            {job.itemName}
          </Text>
          <Badge tone={job.status === 'Printed' ? 'ok' : 'warn'}>{job.status}</Badge>
        </View>
        <Label>Quantity</Label>
        <Value>{job.quantity}</Value>
        <Label>Material used</Label>
        <Value>
          {Math.round(job.totalGrams)} g · {job.totalMeters.toFixed(1)} m
        </Value>
      </Card>

      <Card>
        <Label>Filaments</Label>
        {job.filaments.map((f) => (
          <View key={f.id} style={styles.itemRow}>
            <Text style={{ color: colors.ink, flex: 1 }}>{f.grams}g / {f.meters.toFixed(1)}m</Text>
            <Text style={{ color: colors.muted }}>{formatRand(f.cost)}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Label>Cost breakdown</Label>
        <SummaryRow label="Filament" value={formatRand(job.filamentCost)} />
        <SummaryRow label="Power" value={formatRand(job.powerCost)} />
        <SummaryRow label="Labour" value={formatRand(job.labourCost)} />
        <SummaryRow label="Running costs" value={formatRand(job.runningCost)} />
        <View style={[styles.divider, { backgroundColor: colors.line }]} />
        <SummaryRow label="Total cost" value={formatRand(job.totalCost)} bold />
        <SummaryRow label={`Markup (${Math.round(job.markupPct * 100)}%)`} value={formatRand(job.markupAmount)} />
        <SummaryRow label="Minimum selling price" value={formatRand(job.sellingPrice)} bold />
      </Card>

      <Card>
        <Label>Final selling price</Label>
        <TextField
          value={priceValue}
          onChangeText={(v) => {
            setPrice(v);
            setPriceDirty(true);
          }}
          keyboardType="decimal-pad"
        />
        <PrimaryButton
          title="Save price"
          loading={priceMutation.isPending}
          disabled={!priceDirty}
          onPress={() => {
            const n = Number(priceValue);
            if (!Number.isFinite(n) || n <= 0) {
              Alert.alert('Invalid price', 'Enter a selling price greater than 0.');
              return;
            }
            priceMutation.mutate(n);
          }}
        />
      </Card>

      <Card>
        <Label>Status</Label>
        <View style={styles.statusGrid}>
          {STATUSES.map((s) => (
            <SecondaryButton key={s} title={s} disabled={s === job.status || statusMutation.isPending} onPress={() => statusMutation.mutate(s)} />
          ))}
        </View>
      </Card>

      {job.listingItemId && (
        <Card>
          <Label>Listed for sale</Label>
          <Text style={{ color: colors.muted, fontSize: 13 }}>This job has been published to the storefront catalog.</Text>
        </Card>
      )}
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: 18, fontWeight: '700', flex: 1 },
  itemRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  divider: { height: 1, marginVertical: spacing.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
