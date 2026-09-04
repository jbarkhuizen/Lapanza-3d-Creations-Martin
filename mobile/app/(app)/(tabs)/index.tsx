import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Card, ErrorState, LoadingState } from '../../../components/UI';
import { api } from '../../../lib/api';
import { fontFamily, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { DashboardSummary, SalesSummary } from '../../../lib/types';
import { formatRand } from '../../../lib/money';

export default function DashboardScreen() {
  const { colors } = useTheme();

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardSummary>('/api/dashboard'),
  });
  const salesQuery = useQuery({
    queryKey: ['dashboard-sales', '30d'],
    queryFn: () => api.get<SalesSummary>('/api/dashboard/sales', { range: '30d' }),
  });

  const loading = dashboardQuery.isLoading || salesQuery.isLoading;
  const error = dashboardQuery.error || salesQuery.error;

  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error) {
    return (
      <ErrorState
        message={(error as Error).message || 'Failed to load dashboard.'}
        onRetry={() => {
          dashboardQuery.refetch();
          salesQuery.refetch();
        }}
      />
    );
  }

  const sales = salesQuery.data;
  const dash = dashboardQuery.data;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.ink, fontFamily: fontFamily.serif }]}>Dashboard</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>Last 30 days</Text>

        <View style={styles.statGrid}>
          <StatCard label="Revenue" value={formatRand(sales?.revenue)} />
          <StatCard label="Orders" value={String(sales?.orderCount ?? 0)} />
          <StatCard label="Avg. order" value={formatRand(sales?.averageOrderValue)} />
          <StatCard
            label="Pending payment"
            value={String(sales?.pendingPayment?.count ?? 0)}
            tone={sales?.pendingPayment?.count ? colors.warn : undefined}
          />
        </View>

        <Pressable onPress={() => router.push('/orders')}>
          <Card>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>Orders</Text>
            <Text style={[styles.cardBody, { color: colors.muted }]}>View, update status, and manage orders →</Text>
          </Card>
        </Pressable>

        {dash && (
          <Card>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>Catalog</Text>
            <Text style={[styles.cardBody, { color: colors.muted }]}>
              {dash.totals.published} published · {dash.totals.drafts} drafts · {dash.totals.filaments} filaments ·{' '}
              {dash.totals.categories} categories
            </Text>
          </Card>
        )}

        {sales?.topProducts && sales.topProducts.length > 0 && (
          <Card>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>Top products (30d)</Text>
            {sales.topProducts.slice(0, 5).map((p) => (
              <View key={p.productId} style={styles.topProductRow}>
                <Text style={[styles.cardBody, { color: colors.ink, flex: 1 }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={[styles.cardBody, { color: colors.muted }]}>{formatRand(p.revenue)}</Text>
              </View>
            ))}
          </Card>
        )}
      </View>
    </SafeAreaView>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.panel, borderColor: colors.line }]}>
      <Text style={[styles.statValue, { color: tone || colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 28 },
  subtitle: { fontSize: 13, marginTop: -spacing.sm },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: { flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 14, padding: spacing.md, gap: 4 },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardBody: { fontSize: 13 },
  topProductRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
});
