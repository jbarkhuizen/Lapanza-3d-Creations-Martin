import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PotentialMarketContact, PotentialMarketStatus } from '../../../lib/types';

const STATUSES: PotentialMarketStatus[] = ['Initial Load', 'Active', 'Inactive', 'Opt Out'];

export default function PotentialMarketDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['potential-market-contact', id],
    queryFn: () => api.get<{ contact: PotentialMarketContact }>(`/api/potential-market/${id}`).then((r) => r.contact),
  });

  const [name, setName] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [status, setStatus] = useState<PotentialMarketStatus>('Initial Load');

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setSurname(data.surname);
    setEmail(data.email);
    setMobileNumber(data.mobileNumber);
    setStatus(data.status);
  }, [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['potential-market-contact', id] });
    queryClient.invalidateQueries({ queryKey: ['potential-market'] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => api.put<{ contact: PotentialMarketContact }>(`/api/potential-market/${id}`, body),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/potential-market/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['potential-market'] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Contact not found.'} onRetry={() => refetch()} />;

  const onSave = () => {
    if (!name.trim() || !surname.trim()) {
      Alert.alert('Name and surname required', 'Both fields are required.');
      return;
    }
    saveMutation.mutate({ name: name.trim(), surname: surname.trim(), email, mobileNumber, status });
  };

  const onDelete = () =>
    Alert.alert('Delete contact', `Delete "${data.name} ${data.surname}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `${data.name} ${data.surname}` }} />

      <Card>
        <TextField label="Name" value={name} onChangeText={setName} />
        <TextField label="Surname" value={surname} onChangeText={setSurname} />
        <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <TextField label="Mobile number" value={mobileNumber} onChangeText={setMobileNumber} keyboardType="phone-pad" />
      </Card>

      <Card>
        <Label>Status</Label>
        <View style={styles.choiceRow}>
          {STATUSES.map((s) => (
            <SecondaryButton key={s} title={s} onPress={() => setStatus(s)} disabled={status === s} />
          ))}
        </View>
      </Card>

      <PrimaryButton title="Save changes" onPress={onSave} loading={saveMutation.isPending} />
      <SecondaryButton title="Delete contact" onPress={onDelete} disabled={deleteMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
