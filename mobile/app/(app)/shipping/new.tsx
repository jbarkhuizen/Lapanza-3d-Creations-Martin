import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Label, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { ShippingOption, ShippingOptionType } from '../../../lib/types';

const TYPES: { value: ShippingOptionType; label: string }[] = [
  { value: 'auto_weight', label: 'Weight bracket' },
  { value: 'fixed', label: 'Fixed price (e.g. PUDO / local)' },
];

export default function NewShippingOptionScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [optionType, setOptionType] = useState<ShippingOptionType>('auto_weight');
  const [minWeight, setMinWeight] = useState('0');
  const [maxWeight, setMaxWeight] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api.post<{ shippingOption: ShippingOption }>('/api/shipping-options', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shipping-options'] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not create shipping option', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the shipping option a name.');
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      optionType,
      minWeight: optionType === 'auto_weight' ? Number(minWeight) || 0 : undefined,
      maxWeight: optionType === 'auto_weight' && maxWeight.trim() ? Number(maxWeight) : null,
      price: Number(price) || 0,
      category: category.trim(),
    });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Shipping Option' }} />

      <Card>
        <Label>Type</Label>
        <View style={styles.choiceRow}>
          {TYPES.map((t) => (
            <SecondaryButton key={t.value} title={t.label} onPress={() => setOptionType(t.value)} disabled={optionType === t.value} />
          ))}
        </View>
      </Card>

      <Card>
        <TextField label="Name" placeholder="e.g. Standard courier" value={name} onChangeText={setName} />
        <TextField label="Price (R)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
        {optionType === 'auto_weight' ? (
          <>
            <TextField label="Min weight (g)" value={minWeight} onChangeText={setMinWeight} keyboardType="number-pad" />
            <TextField label="Max weight (g, blank = no limit)" value={maxWeight} onChangeText={setMaxWeight} keyboardType="number-pad" />
          </>
        ) : (
          <TextField label="Category (optional, e.g. PUDO)" value={category} onChangeText={setCategory} />
        )}
      </Card>

      <PrimaryButton title="Create shipping option" onPress={onSubmit} loading={createMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
