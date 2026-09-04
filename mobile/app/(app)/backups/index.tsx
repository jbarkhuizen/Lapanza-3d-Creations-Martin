import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Card, PrimaryButton, SecondaryButton } from '../../../components/UI';
import { api, ApiError, getApiBaseUrl } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

type Backup = { filename: string; sizeBytes: number; createdAt: string };

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export default function BackupsScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['backups'] });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ backup: Backup }>('/api/backups'),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Backup failed', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/backups/sync-offsite'),
    onSuccess: () => Alert.alert('Offsite sync', 'Offsite sync completed.'),
    onError: (e) => Alert.alert('Offsite sync failed', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.delete(`/api/backups/${encodeURIComponent(filename)}`),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not delete backup', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onDownload = async (filename: string) => {
    const baseUrl = await getApiBaseUrl();
    Linking.openURL(`${baseUrl}/api/backups/${encodeURIComponent(filename)}/download`);
  };

  const onDelete = (filename: string) => {
    Alert.alert('Delete backup', `Delete ${filename}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(filename) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Backups' }} />
      <EntityList<Backup>
        queryKey={['backups']}
        queryFn={() => api.get<{ backups: Backup[] }>('/api/backups').then((r) => r.backups)}
        keyExtractor={(b) => b.filename}
        emptyMessage="No backups yet."
        header={
          <View style={styles.headerActions}>
            <PrimaryButton title="Trigger backup now" onPress={() => createMutation.mutate()} loading={createMutation.isPending} />
            <SecondaryButton title="Sync offsite now" onPress={() => syncMutation.mutate()} disabled={syncMutation.isPending} />
          </View>
        }
        renderItem={(backup) => (
          <Card>
            <Text style={[styles.filename, { color: colors.ink }]} numberOfLines={1}>
              {backup.filename}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.sizeBytes)}
            </Text>
            <View style={styles.actions}>
              <SecondaryButton title="Download" onPress={() => onDownload(backup.filename)} />
              <SecondaryButton title="Delete" onPress={() => onDelete(backup.filename)} disabled={deleteMutation.isPending} />
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { gap: spacing.sm, marginBottom: spacing.md },
  filename: { fontSize: 14, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
});
