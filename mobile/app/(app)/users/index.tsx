import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { SecondaryButton } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Admin } from '../../../lib/types';

// Admin/back-office accounts (server/admins.js) -- not customers, which is
// the existing Clients section. There is no role field on this record;
// every admin account has the same access.
export default function UsersScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admins/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admins'] }),
    onError: (e) => Alert.alert('Could not remove admin', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const confirmDelete = (admin: Admin) => {
    Alert.alert('Remove admin', `Remove "${admin.username}"? They will be signed out everywhere.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteMutation.mutate(admin.id) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          title: 'Registered Users',
          headerRight: () => (
            <Pressable onPress={() => router.push('/users/new')} hitSlop={8}>
              <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 15 }}>+ New</Text>
            </Pressable>
          ),
        }}
      />
      <EntityList<Admin>
        queryKey={['admins']}
        queryFn={() => api.get<{ admins: Admin[] }>('/api/admins').then((r) => r.admins)}
        keyExtractor={(a) => a.id}
        emptyMessage="No admin accounts found."
        renderItem={(admin) => (
          <View style={[styles.row, { backgroundColor: colors.panel, borderColor: colors.line }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{admin.username}</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Added {new Date(admin.created_at).toLocaleDateString()}</Text>
            </View>
            <SecondaryButton title="Remove" onPress={() => confirmDelete(admin)} disabled={deleteMutation.isPending} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: 14, borderWidth: 1, gap: spacing.sm },
  name: { fontSize: 15, fontWeight: '700' },
});
