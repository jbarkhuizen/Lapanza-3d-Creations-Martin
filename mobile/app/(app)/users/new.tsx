import { useMutation } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';

import { Card, Label, PrimaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Admin } from '../../../lib/types';

export default function NewUserScreen() {
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const createAdmin = useMutation({
    mutationFn: () => api.post<{ admin: Admin }>('/api/admins', { username: username.trim(), password }),
    onSuccess: () => router.replace('/users'),
    onError: (e) => Alert.alert('Could not create admin', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!username.trim() || !password) {
      Alert.alert('Missing details', 'A username and password are both required.');
      return;
    }
    createAdmin.mutate();
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Admin' }} />

      <Card>
        <Label>Username</Label>
        <TextField placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
        <Label>Password</Label>
        <TextField placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry />
        <Text style={{ color: colors.muted, fontSize: 12 }}>Minimum 8 characters. The new admin has full access, same as any other.</Text>
      </Card>

      <PrimaryButton title="Create admin" onPress={onSubmit} loading={createAdmin.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
});
