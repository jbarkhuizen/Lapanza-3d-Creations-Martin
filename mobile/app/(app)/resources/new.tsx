import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { Card, Label, PrimaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Resource } from '../../../lib/types';

// File/image uploads (STL, images) still need the desktop admin -- this
// form only covers the resource's text metadata, same simplification as
// resources/[id].tsx.
export default function NewResourceScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [printSettings, setPrintSettings] = useState('');
  const [filamentType, setFilamentType] = useState('');
  const [dimensions, setDimensions] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api.post<{ resource: Resource }>('/api/resources', body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      router.replace(`/resources/${res.resource.id}`);
    },
    onError: (e) => Alert.alert('Could not create resource', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Title required', 'Give the resource a title.');
      return;
    }
    createMutation.mutate({ title: title.trim(), description, printSettings, filamentType, dimensions });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Resource' }} />

      <Card>
        <Label>Details</Label>
        <TextField placeholder="Title" value={title} onChangeText={setTitle} />
        <TextField placeholder="Description" value={description} onChangeText={setDescription} multiline numberOfLines={3} />
        <TextField placeholder="Print settings" value={printSettings} onChangeText={setPrintSettings} multiline numberOfLines={2} />
        <TextField placeholder="Filament type" value={filamentType} onChangeText={setFilamentType} />
        <TextField placeholder="Dimensions" value={dimensions} onChangeText={setDimensions} />
      </Card>

      <PrimaryButton title="Create resource" onPress={onSubmit} loading={createMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
});
