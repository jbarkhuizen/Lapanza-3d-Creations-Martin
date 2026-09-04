import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, TextField } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Product } from '../../../lib/types';

export default function ProductsScreen() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Products',
          headerRight: () => (
            <Pressable onPress={() => router.push('/products/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <View style={styles.searchBar}>
        <TextField placeholder="Search products, SKUs…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      <EntityList<Product>
        queryKey={['products', search]}
        queryFn={() => api.get<{ products: Product[] }>('/api/products', { q: search || undefined }).then((r) => r.products)}
        keyExtractor={(p) => p.id}
        emptyMessage="No products found."
        renderItem={(product) => (
          <Pressable
            onPress={() => router.push(`/products/${product.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{product.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                {(product.items || []).length} item{(product.items || []).length === 1 ? '' : 's'}
              </Text>
            </View>
            <Badge tone={product.status === 'published' ? 'ok' : 'muted'}>{product.status}</Badge>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700' },
});
