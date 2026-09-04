import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, ErrorState, Label, LoadingState } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { ActiveVisitors, AnalyticsSummary } from '../../../lib/types';

const EVENT_LABELS: Record<string, string> = {
  add_to_cart: 'Add to cart',
  checkout_start: 'Checkout started',
  quote_submit: 'Quote submitted',
  whatsapp_click: 'WhatsApp click',
  payment_complete: 'Payment complete',
};

export default function AnalyticsScreen() {
  const { colors } = useTheme();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => api.get<AnalyticsSummary>('/api/analytics/summary'),
  });

  const active = useQuery({
    queryKey: ['analytics', 'active'],
    queryFn: () => api.get<ActiveVisitors>('/api/analytics/active'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Failed to load analytics.'} onRetry={() => refetch()} />;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Analytics' }} />

      <View style={styles.statGrid}>
        <StatCard label="Total visits" value={String(data.totalVisits)} />
        <StatCard label="Unique visitors" value={String(data.uniqueVisitorsAllTime)} />
        <StatCard label="Today" value={String(data.todayVisits)} />
        <StatCard label="Live now" value={String(active.data?.totalActive ?? '—')} />
      </View>

      <Card>
        <Label>Live visitors</Label>
        {active.isLoading && <Text style={{ color: colors.muted }}>Loading…</Text>}
        {active.data && (
          <>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {active.data.registeredActive} registered · {active.data.anonymousActive} anonymous
            </Text>
            {active.data.activeClients.length === 0 && (
              <Text style={{ color: colors.muted, fontSize: 13 }}>No registered visitors browsing right now.</Text>
            )}
            {active.data.activeClients.map((c) => (
              <View key={c.clientId} style={styles.row}>
                <Text style={{ color: colors.ink, flex: 1 }} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
                  {c.path}
                </Text>
              </View>
            ))}
          </>
        )}
      </Card>

      <Card>
        <Label>Conversion funnel (30 days)</Label>
        {data.events.map((e) => (
          <View key={e.eventType} style={styles.row}>
            <Text style={{ color: colors.ink, flex: 1 }}>{EVENT_LABELS[e.eventType] || e.eventType}</Text>
            <Text style={{ color: colors.muted }}>
              {e.count} ({e.uniqueVisitors} visitors)
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Label>Top pages</Label>
        {data.topPages.length === 0 && <Text style={{ color: colors.muted }}>No page views recorded yet.</Text>}
        {data.topPages.map((p) => (
          <View key={p.path} style={styles.row}>
            <Text style={{ color: colors.ink, flex: 1 }} numberOfLines={1}>
              {p.path}
            </Text>
            <Text style={{ color: colors.muted }}>{p.visits}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.panel, borderColor: colors.line }]}>
      <Text style={[styles.statValue, { color: colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: { flexBasis: '47%', flexGrow: 1, borderRadius: 14, borderWidth: 1, padding: spacing.md, gap: 2 },
  statValue: { fontSize: 24, fontWeight: '700' },
  statLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 4 },
});
