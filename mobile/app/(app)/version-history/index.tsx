import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Card, Label, Value } from '../../../components/UI';
import { api } from '../../../lib/api';
import { useTheme } from '../../../lib/theme-context';

// Raw version_history row shape (server/version-history.js) -- snake_case,
// unlike the camelCase objects most other endpoints hand back.
type Version = {
  id: string;
  version_number: number;
  version_label: string;
  description: string;
  deployed_date: string;
  deployed_by: string;
  created_at: string;
};

export default function VersionHistoryScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Version History' }} />
      <EntityList<Version>
        queryKey={['version-history']}
        queryFn={() => api.get<{ versions: Version[] }>('/api/version-history').then((r) => r.versions)}
        keyExtractor={(v) => v.id}
        emptyMessage="No versions recorded yet."
        renderItem={(version) => (
          <Card>
            <View style={styles.headerRow}>
              <Text style={[styles.label, { color: colors.ink }]}>V{version.version_label}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(version.deployed_date).toLocaleString()}</Text>
            </View>
            {!!version.description && <Value>{version.description}</Value>}
            <Label>Deployed by</Label>
            <Text style={{ color: colors.muted, fontSize: 13 }}>{version.deployed_by}</Text>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 16, fontWeight: '700' },
});
