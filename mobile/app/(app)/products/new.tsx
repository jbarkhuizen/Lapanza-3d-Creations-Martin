import { useMutation } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Label, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Product } from '../../../lib/types';

const STATUSES = ['draft', 'published'];

// New category product. Items (the sellable SKUs inside a category) are
// added afterwards on the detail screen's per-item routes -- there's no
// value in a multi-item builder on first create.
export default function NewProductScreen() {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');

  const createProduct = useMutation({
    mutationFn: () => api.post<{ product: Product }>('/api/products', { name, description, status }),
    onSuccess: (res) => router.replace(`/products/${res.product.id}`),
    onError: (e) => Alert.alert('Could not create product', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give the product category a name.');
      return;
    }
    createProduct.mutate();
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Product' }} />

      <Card>
        <Label>Name</Label>
        <TextField placeholder="e.g. GWM Parts" value={name} onChangeText={setName} />
        <Label>Description</Label>
        <TextField placeholder="Optional description" value={description} onChangeText={setDescription} multiline numberOfLines={3} />
        <Label>Status</Label>
        <View style={styles.choiceRow}>
          {STATUSES.map((s) => (
            <SecondaryButton key={s} title={s} onPress={() => setStatus(s)} disabled={status === s} />
          ))}
        </View>
      </Card>

      <PrimaryButton title="Create product" onPress={onSubmit} loading={createProduct.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
