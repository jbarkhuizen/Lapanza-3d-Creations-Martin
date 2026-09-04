import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { DesignRequest, DesignRequestStatus } from '../../../lib/types';

const STATUSES: DesignRequestStatus[] = ['new', 'quoted', 'in_progress', 'finalized'];

export default function DesignRequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [quoteAmount, setQuoteAmount] = useState('');
  const [quoteTerms, setQuoteTerms] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['design-request', id],
    queryFn: () => api.get<{ designRequest: DesignRequest }>(`/api/design-requests/${id}`).then((r) => r.designRequest),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['design-request', id] });
    queryClient.invalidateQueries({ queryKey: ['design-requests'] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: DesignRequestStatus) => api.patch<{ designRequest: DesignRequest }>(`/api/design-requests/${id}`, { status }),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not update status', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const notesMutation = useMutation({
    mutationFn: (adminNotes: string) => api.patch<{ designRequest: DesignRequest }>(`/api/design-requests/${id}`, { adminNotes }),
    onSuccess: () => {
      invalidate();
      setNotesDirty(false);
    },
    onError: (e) => Alert.alert('Could not save notes', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const quoteMutation = useMutation({
    mutationFn: () => api.put<{ request: DesignRequest }>(`/api/design-requests/${id}/quote`, { amount: Number(quoteAmount), terms: quoteTerms }),
    onSuccess: () => {
      invalidate();
      setQuoteAmount('');
      setQuoteTerms('');
    },
    onError: (e) => Alert.alert('Could not send quote', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Design request not found.'} onRetry={() => refetch()} />;

  const request = data;
  const notesValue = notesDirty ? notes : request.adminNotes || '';

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: request.name }} />

      <Card>
        <View style={styles.headerRow}>
          <Text style={[styles.name, { color: colors.ink }]}>{request.name}</Text>
          <Badge tone={request.status === 'finalized' ? 'ok' : 'brand'}>{request.status.replace('_', ' ')}</Badge>
        </View>
        <Label>Contact</Label>
        <Value>{request.email}</Value>
        <Value>{request.phone}</Value>
        <Label>Service</Label>
        <Value>{request.serviceType === 'design_for_me' ? 'Design for me' : 'Print my model'}</Value>
        <Label>Description</Label>
        <Text style={{ color: colors.ink }}>{request.description}</Text>
        {!!request.dimensions && (
          <>
            <Label>Dimensions</Label>
            <Value>{request.dimensions}</Value>
          </>
        )}
        <Label>Quantity</Label>
        <Value>{request.quantity}</Value>
        {!!request.materialPref && (
          <>
            <Label>Material preference</Label>
            <Value>{request.materialPref}</Value>
          </>
        )}
        {!!request.colourPref && (
          <>
            <Label>Colour preference</Label>
            <Value>{request.colourPref}</Value>
          </>
        )}
        {!!request.budgetNote && (
          <>
            <Label>Budget note</Label>
            <Value>{request.budgetNote}</Value>
          </>
        )}
      </Card>

      {request.files.length > 0 && (
        <Card>
          <Label>Attached files</Label>
          {request.files.map((f) => (
            <Text key={f.id} style={{ color: colors.ink, fontSize: 13 }} numberOfLines={1}>
              {f.kind === 'image' ? '🖼 ' : '📎 '}
              {f.originalName}
            </Text>
          ))}
        </Card>
      )}

      <Card>
        <Label>Update status</Label>
        <View style={styles.statusGrid}>
          {STATUSES.map((s) => (
            <SecondaryButton
              key={s}
              title={s.replace('_', ' ')}
              disabled={s === request.status || statusMutation.isPending}
              onPress={() => statusMutation.mutate(s)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <Label>Admin notes</Label>
        <TextField
          value={notesValue}
          onChangeText={(v) => { setNotes(v); setNotesDirty(true); }}
          multiline
          numberOfLines={3}
          placeholder="Internal notes…"
        />
        <PrimaryButton title="Save notes" loading={notesMutation.isPending} disabled={!notesDirty} onPress={() => notesMutation.mutate(notesValue)} />
      </Card>

      <Card>
        <Label>Quote</Label>
        {request.quoteStatus === 'accepted' ? (
          <>
            <Text style={{ color: colors.ink }}>{formatRand(request.quoteAmount)} quote accepted ({request.quoteDepositPct}% deposit).</Text>
            <Badge tone="ok">{request.quoteStage === 'order_paid' ? 'Order paid' : 'Order placed'}</Badge>
          </>
        ) : (
          <>
            {request.quoteStatus === 'quoted' && (
              <Text style={{ color: colors.muted, fontSize: 13 }}>
                Currently quoted at {formatRand(request.quoteAmount)}. Sending a new quote below replaces it.
              </Text>
            )}
            <TextField placeholder="Amount (R)" value={quoteAmount} onChangeText={setQuoteAmount} keyboardType="decimal-pad" />
            <TextField placeholder="Terms (optional)" value={quoteTerms} onChangeText={setQuoteTerms} multiline numberOfLines={2} />
            <PrimaryButton
              title="Send quote"
              loading={quoteMutation.isPending}
              disabled={!quoteAmount}
              onPress={() => quoteMutation.mutate()}
            />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '700' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
