import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Product, ProductItem } from '../../../lib/types';

const STATUSES = ['draft', 'published'];

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [featured, setFeatured] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: () => api.get<{ product: Product }>(`/api/products/${id}`).then((r) => r.product),
  });

  // Seed the edit form from the fetched record — only once per fetch, so a
  // background refetch (e.g. after saving an item) doesn't clobber text the
  // admin is mid-typing in the category fields above.
  useEffect(() => {
    if (data && !dirty) {
      setName(data.name);
      setDescription(data.description || '');
      setSeoTitle(data.seoTitle || '');
      setSeoDescription(data.seoDescription || '');
      setStatus(data.status || 'draft');
      setFeatured(Boolean(data.featured));
    }
  }, [data, dirty]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['product', id] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.put<{ product: Product }>(`/api/products/${id}`, { name, description, seoTitle, seoDescription, status, featured }),
    onSuccess: () => {
      invalidate();
      setDirty(false);
    },
    onError: (e) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Product not found.'} onRetry={() => refetch()} />;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: data.name }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.name, { color: colors.ink }]}>{data.name}</Text>
          <Badge tone={data.status === 'published' ? 'ok' : 'muted'}>{data.status}</Badge>
        </View>
        <Label>Slug</Label>
        <Value>{data.slug}</Value>
      </Card>

      <Card>
        <Label>Name</Label>
        <TextField value={name} onChangeText={(v) => { setName(v); setDirty(true); }} />
        <Label>Description</Label>
        <TextField value={description} onChangeText={(v) => { setDescription(v); setDirty(true); }} multiline numberOfLines={3} />
        <Label>SEO title</Label>
        <TextField value={seoTitle} onChangeText={(v) => { setSeoTitle(v); setDirty(true); }} />
        <Label>SEO description</Label>
        <TextField value={seoDescription} onChangeText={(v) => { setSeoDescription(v); setDirty(true); }} multiline numberOfLines={2} />

        <Label>Status</Label>
        <View style={styles.choiceRow}>
          {STATUSES.map((s) => (
            <SecondaryButton key={s} title={s} disabled={status === s} onPress={() => { setStatus(s); setDirty(true); }} />
          ))}
        </View>

        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Featured</Text>
          <Switch
            value={featured}
            onValueChange={(v) => { setFeatured(v); setDirty(true); }}
            trackColor={{ true: colors.brand }}
          />
        </View>

        <PrimaryButton title="Save changes" loading={saveMutation.isPending} disabled={!dirty} onPress={() => saveMutation.mutate()} />
      </Card>

      <Card>
        <Label>Items ({(data.items || []).length})</Label>
        {(data.items || []).length === 0 && <Text style={{ color: colors.muted }}>No items in this category yet.</Text>}
        {(data.items || []).map((item) => (
          <ItemRow key={item.id} productId={data.id} item={item} onSaved={invalidate} />
        ))}
      </Card>
    </ScrollView>
  );
}

function ItemRow({ productId, item, onSaved }: { productId: string; item: ProductItem; onSaved: () => void }) {
  const { colors } = useTheme();
  const [price, setPrice] = useState(String(item.price ?? ''));
  const [stockQty, setStockQty] = useState(String(item.stockQty ?? 0));
  const [dirty, setDirty] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.put<{ item: ProductItem }>(`/api/products/${productId}/items/${item.id}`, {
        price,
        stockQty: Number(stockQty) || 0,
      }),
    onSuccess: () => {
      onSaved();
      setDirty(false);
    },
    onError: (e) => Alert.alert('Could not save item', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  return (
    <View style={[styles.itemRow, { borderColor: colors.line }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.ink, fontWeight: '600' }} numberOfLines={1}>
          {item.name}
        </Text>
        {!!item.sku && (
          <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
            SKU {item.sku}
          </Text>
        )}
      </View>
      <TextField
        value={price}
        onChangeText={(v) => { setPrice(v); setDirty(true); }}
        keyboardType="decimal-pad"
        containerStyle={{ width: 80 }}
        placeholder="Price"
      />
      <TextField
        value={stockQty}
        onChangeText={(v) => { setStockQty(v); setDirty(true); }}
        keyboardType="number-pad"
        containerStyle={{ width: 60 }}
        placeholder="Qty"
      />
      <SecondaryButton title="Save" onPress={() => mutation.mutate()} disabled={!dirty || mutation.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '700' },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.xs },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1 },
});
