import { Stack, router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge } from '../../../components/UI';
import { api } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { ShippingOption } from '../../../lib/types';

export default function ShippingOptionsScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Shipping Options',
          headerRight: () => (
            <Pressable onPress={() => router.push('/shipping/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <EntityList<ShippingOption>
        queryKey={['shipping-options']}
        queryFn={() => api.get<{ shippingOptions: ShippingOption[] }>('/api/shipping-options').then((r) => r.shippingOptions)}
        keyExtractor={(o) => o.id}
        emptyMessage="No shipping options yet."
        renderItem={(option) => (
          <Pressable
            onPress={() => router.push(`/shipping/${option.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{option.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                {option.optionType === 'fixed'
                  ? option.category || 'Fixed price'
                  : `${option.minWeight}g – ${option.maxWeight ?? '∞'}g`}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.price, { color: colors.ink }]}>{formatRand(option.price)}</Text>
              <Badge tone={option.active ? 'ok' : 'muted'}>{option.active ? 'Active' : 'Inactive'}</Badge>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700' },
  price: { fontSize: 15, fontWeight: '700' },
});
