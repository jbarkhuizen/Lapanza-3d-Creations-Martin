import { Stack, router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PromoCode } from '../../../lib/types';

function describe(promo: PromoCode): string {
  const discount = promo.kind === 'percent' ? `${promo.value}% off` : `R${promo.value} off`;
  return promo.minSubtotal > 0 ? `${discount} · min R${promo.minSubtotal}` : discount;
}

function isExpired(promo: PromoCode): boolean {
  return !!promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now();
}

export default function PromoCodesScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Promo Codes',
          headerRight: () => (
            <Pressable onPress={() => router.push('/promo-codes/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <EntityList<PromoCode>
        queryKey={['promo-codes']}
        queryFn={() => api.get<{ promoCodes: PromoCode[] }>('/api/promo-codes').then((r) => r.promoCodes)}
        keyExtractor={(p) => p.id}
        emptyMessage="No promo codes yet."
        renderItem={(promo) => (
          <Pressable
            onPress={() => router.push(`/promo-codes/${promo.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.code, { color: colors.ink }]}>{promo.code}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{describe(promo)}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                Used {promo.usedCount}{promo.maxUses != null ? ` / ${promo.maxUses}` : ''}
              </Text>
            </View>
            {isExpired(promo) ? (
              <Badge tone="danger">Expired</Badge>
            ) : (
              <Badge tone={promo.active ? 'ok' : 'muted'}>{promo.active ? 'Active' : 'Inactive'}</Badge>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  code: { fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
