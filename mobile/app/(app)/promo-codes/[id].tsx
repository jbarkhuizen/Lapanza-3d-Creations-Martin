import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, TextField, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PromoCode } from '../../../lib/types';

export default function PromoCodeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['promo-code', id],
    queryFn: () => api.get<{ promoCodes: PromoCode[] }>('/api/promo-codes').then((r) => r.promoCodes.find((p) => p.id === id) ?? null),
  });

  const [value, setValue] = useState('');
  const [minSubtotal, setMinSubtotal] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!data) return;
    setValue(String(data.value));
    setMinSubtotal(String(data.minSubtotal));
    setMaxUses(data.maxUses != null ? String(data.maxUses) : '');
    setExpiresAt(data.expiresAt ? data.expiresAt.slice(0, 10) : '');
    setActive(data.active);
  }, [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['promo-code', id] });
    queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => api.put<{ promo: PromoCode }>(`/api/promo-codes/${id}`, body),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Promo code not found.'} onRetry={() => refetch()} />;

  const onSave = () =>
    saveMutation.mutate({
      value: Number(value) || 0,
      minSubtotal: Number(minSubtotal) || 0,
      maxUses: maxUses.trim() ? Number(maxUses) : null,
      expiresAt: expiresAt.trim() ? new Date(expiresAt.trim()).toISOString() : null,
      active,
    });

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: data.code }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.code, { color: colors.ink }]}>{data.code}</Text>
          <Badge tone={active ? 'ok' : 'muted'}>{active ? 'Active' : 'Inactive'}</Badge>
        </View>
        <Label>Type</Label>
        <Value>{data.kind === 'percent' ? 'Percent off' : 'Rand off'}</Value>
        <Label>Redemptions</Label>
        <Value>{data.usedCount}{data.maxUses != null ? ` / ${data.maxUses}` : ' (unlimited)'}</Value>
      </Card>

      <Card>
        <TextField label={data.kind === 'percent' ? 'Percent (e.g. 10)' : 'Amount (R)'} value={value} onChangeText={setValue} keyboardType="decimal-pad" />
        <TextField label="Minimum order subtotal (R)" value={minSubtotal} onChangeText={setMinSubtotal} keyboardType="decimal-pad" />
        <TextField label="Max uses (blank = unlimited)" value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" />
        <TextField label="Expires (YYYY-MM-DD, blank = never)" value={expiresAt} onChangeText={setExpiresAt} autoCapitalize="none" />
        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Active</Text>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brand }} />
        </View>
      </Card>

      <PrimaryButton title="Save changes" onPress={onSave} loading={saveMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  code: { fontSize: 18, fontWeight: '700', letterSpacing: 0.5 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
});
