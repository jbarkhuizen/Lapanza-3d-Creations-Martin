import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Testimonial } from '../../../lib/types';

export default function TestimonialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['testimonial', id],
    queryFn: () => api.get<{ testimonial: Testimonial }>(`/api/testimonials/${id}`).then((r) => r.testimonial),
  });

  const [customerName, setCustomerName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [quote, setQuote] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentNote, setConsentNote] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');

  useEffect(() => {
    if (!data) return;
    setCustomerName(data.customerName);
    setDisplayName(data.displayName);
    setQuote(data.quote);
    setConsentGiven(data.consentGiven);
    setConsentNote(data.consentNote || '');
    setLinkUrl(data.linkUrl || '');
    setLinkLabel(data.linkLabel || '');
  }, [data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['testimonial', id] });
    queryClient.invalidateQueries({ queryKey: ['testimonials'] });
  };

  const saveMutation = useMutation({
    mutationFn: (body: Partial<Testimonial>) => api.put<{ testimonial: Testimonial }>(`/api/testimonials/${id}`, body),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  // consentGiven is enforced server-side too (assertPublishAllowed in
  // server/testimonials.js) -- a publish attempt without it comes back as a
  // 400 with a clear message, surfaced via the same onError.
  const statusMutation = useMutation({
    mutationFn: (status: 'draft' | 'published') => api.put<{ testimonial: Testimonial }>(`/api/testimonials/${id}`, { status }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not change status', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/testimonials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['testimonials'] });
      router.back();
    },
    onError: (e) => Alert.alert('Could not delete', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Testimonial not found.'} onRetry={() => refetch()} />;

  const onSave = () =>
    saveMutation.mutate({ customerName, displayName, quote, consentGiven, consentNote, linkUrl, linkLabel });

  const onDelete = () =>
    Alert.alert('Delete testimonial', `Delete this testimonial from ${data.displayName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: data.displayName || 'Testimonial' }} />

      <Card>
        <View style={styles.headerRow}>
          <Label>Status</Label>
          <Badge tone={data.status === 'published' ? 'ok' : 'warn'}>{data.status}</Badge>
        </View>
        <SecondaryButton
          title={data.status === 'published' ? 'Unpublish' : 'Publish'}
          onPress={() => statusMutation.mutate(data.status === 'published' ? 'draft' : 'published')}
          disabled={statusMutation.isPending}
        />
      </Card>

      <Card>
        <TextField label="Display name (shown publicly)" value={displayName} onChangeText={setDisplayName} />
        <TextField label="Customer name (admin-only record)" value={customerName} onChangeText={setCustomerName} />
        <TextField label="Quote" value={quote} onChangeText={setQuote} multiline numberOfLines={4} />
      </Card>

      <Card>
        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Consent given</Text>
          <Switch value={consentGiven} onValueChange={setConsentGiven} trackColor={{ true: colors.brand }} />
        </View>
        <TextField label="Consent note" value={consentNote} onChangeText={setConsentNote} multiline numberOfLines={2} />
      </Card>

      <Card>
        <TextField label="Link URL (optional)" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" />
        <TextField label="Link label (optional)" value={linkLabel} onChangeText={setLinkLabel} />
      </Card>

      <PrimaryButton title="Save changes" onPress={onSave} loading={saveMutation.isPending} />
      <SecondaryButton title="Delete testimonial" onPress={onDelete} disabled={deleteMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
