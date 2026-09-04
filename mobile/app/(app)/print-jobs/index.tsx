import { Stack, router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge } from '../../../components/UI';
import { api } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PrintJob } from '../../../lib/types';

export default function PrintJobsScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Print Job Costing',
          headerRight: () => (
            <Pressable onPress={() => router.push('/print-jobs/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <EntityList<PrintJob>
        queryKey={['print-jobs']}
        queryFn={() => api.get<{ printJobs: PrintJob[] }>('/api/print-jobs').then((r) => r.printJobs)}
        keyExtractor={(job) => job.id}
        emptyMessage="No print jobs logged yet."
        renderItem={(job) => (
          <Pressable
            onPress={() => router.push(`/print-jobs/${job.id}`)}
            style={({ pressed }) => [styles.row, { backgroundColor: colors.panel, borderColor: colors.line, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
                {job.itemName}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                Qty {job.quantity} · {Math.round(job.totalGrams)}g
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.price, { color: colors.ink }]}>{formatRand(job.finalSellingPrice)}</Text>
              <Badge tone={job.status === 'Printed' ? 'ok' : 'warn'}>{job.status}</Badge>
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
