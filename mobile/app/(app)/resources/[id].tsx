import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Resource } from '../../../lib/types';

export default function ResourceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['resource', id],
    queryFn: () => api.get<{ resource: Resource }>(`/api/resources/${id}`).then((r) => r.resource),
  });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [printSettings, setPrintSettings] = useState('');
  const [filamentType, setFilamentType] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!data) return;
    setTitle(data.title);
    setDescription(data.description);
    setPrintSettings(data.printSettings);
    setFilamentType(data.filamentType);
    setDimensions(data.dimensions);
    setActive(data.active);
  }, [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['resource', id] });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: Partial<Resource>) => api.put<{ resource: Resource }>(`/api/resources/${id}`, body),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/resources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Resource not found.'} onRetry={() => refetch()} />;

  const onSave = () =>
    saveMutation.mutate({ title, description, printSettings, filamentType, dimensions, active });

  const onDelete = () =>
    Alert.alert('Delete resource', `Delete "${data.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: data.title || 'Resource' }} />

      <Card>
        <View style={styles.headerRow}>
          <Label>Status</Label>
          <Badge tone={data.active ? 'ok' : 'muted'}>{data.active ? 'Active' : 'Inactive'}</Badge>
        </View>
        <TextField label="Title" value={title} onChangeText={setTitle} />
        <TextField label="Description" value={description} onChangeText={setDescription} multiline numberOfLines={3} />
      </Card>

      <Card>
        <TextField label="Print settings" value={printSettings} onChangeText={setPrintSettings} multiline numberOfLines={2} />
        <TextField label="Filament type" value={filamentType} onChangeText={setFilamentType} />
        <TextField label="Dimensions" value={dimensions} onChangeText={setDimensions} />
        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Active (visible in the public gallery)</Text>
          <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.brand }} />
        </View>
      </Card>

      {(data.filePath || data.imagePath) && (
        <Card>
          <Label>Uploaded files</Label>
          {data.fileOriginalName ? <Text style={{ color: colors.muted }}>File: {data.fileOriginalName}</Text> : null}
          {data.imageOriginalName ? <Text style={{ color: colors.muted }}>Image: {data.imageOriginalName}</Text> : null}
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Uploading/replacing files isn&apos;t supported from the mobile app yet — use the desktop admin.
          </Text>
        </Card>
      )}

      <PrimaryButton title="Save changes" onPress={onSave} loading={saveMutation.isPending} />
      <SecondaryButton title="Delete resource" onPress={onDelete} disabled={deleteMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
});
