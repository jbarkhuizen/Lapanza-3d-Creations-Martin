import { Stack, router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge } from '../../../components/UI';
import { api } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { DesignRequest, DesignRequestStatus } from '../../../lib/types';

const STATUS_TONE: Record<DesignRequestStatus, 'ok' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  new: 'warn',
  quoted: 'brand',
  in_progress: 'brand',
  finalized: 'ok',
};

export default function DesignRequestsScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Design Requests' }} />
      <EntityList<DesignRequest>
        queryKey={['design-requests']}
        queryFn={() => api.get<{ designRequests: DesignRequest[] }>('/api/design-requests').then((r) => r.designRequests)}
        keyExtractor={(r) => r.id}
        emptyMessage="No design requests yet."
        renderItem={(request) => (
          <Pressable
            onPress={() => router.push(`/design-requests/${request.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{request.name}</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={2}>
                {request.description}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              {!!request.quoteAmount && <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>{formatRand(request.quoteAmount)}</Text>}
              <Badge tone={STATUS_TONE[request.status] || 'muted'}>{request.status.replace('_', ' ')}</Badge>
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
});
