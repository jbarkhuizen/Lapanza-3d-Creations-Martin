import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { ShippingOption } from '../../../lib/types';

export default function ShippingOptionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['shipping-option', id],
    queryFn: () => api.get<{ shippingOptions: ShippingOption[] }>('/api/shipping-options').then((r) => r.shippingOptions.find((o) => o.id === id) ?? null),
  });

  const [name, setName] = useState('');
  const [minWeight, setMinWeight] = useState('0');
  const [maxWeight, setMaxWeight] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setMinWeight(String(data.minWeight));
    setMaxWeight(data.maxWeight != null ? String(data.maxWeight) : '');
    setPrice(String(data.price));
    setCategory(data.category || '');
    setActive(data.active);
  }, [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shipping-option', id] });
    queryClient.invalidateQueries({ queryKey: ['shipping-options'] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => api.put<{ shippingOption: ShippingOption }>(`/api/shipping-options/${id}`, body),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/shipping-options/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-options'] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Shipping option not found.'} onRetry={() => refetch()} />;

  const onSave = () =>
    saveMutation.mutate({
      name,
      minWeight: data.optionType === 'auto_weight' ? Number(minWeight) || 0 : undefined,
      maxWeight: data.optionType === 'auto_weight' && maxWeight.trim() ? Number(maxWeight) : null,
      price: Number(price) || 0,
      category,
      active,
    });

  const onDelete = () =>
    Alert.alert('Delete shipping option', `Delete "${data.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: data.name || 'Shipping Option' }} />

      <Card>
        <View style={styles.headerRow}>
          <Label>{data.optionType === 'fixed' ? 'Fixed price' : 'Weight bracket'}</Label>
          <Badge tone={data.active ? 'ok' : 'muted'}>{data.active ? 'Active' : 'Inactive'}</Badge>
        </View>
        <TextField label="Name" value={name} onChangeText={setName} />
        <TextField label="Price (R)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        {data.optionType === 'auto_weight' ? (
          <>
            <TextField label="Min weight (g)" value={minWeight} onChangeText={setMinWeight} keyboardType="number-pad" />
            <TextField label="Max weight (g, blank = no limit)" value={maxWeight} onChangeText={setMaxWeight} keyboardType="number-pad" />
          </>
        ) : (
          <TextField label="Category" value={category} onChangeText={setCategory} />
        )}
        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Active</Text>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brand }} />
        </View>
      </Card>

      <PrimaryButton title="Save changes" onPress={onSave} loading={saveMutation.isPending} />
      <SecondaryButton title="Delete shipping option" onPress={onDelete} disabled={deleteMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
});
