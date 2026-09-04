import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { Alert, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, Card, ErrorState, Label, LoadingState, SecondaryButton, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { useTheme } from '../../../lib/theme-context';
import { WhatsAppCampaign, WhatsAppCampaignStatus } from '../../../lib/types';

const STATUS_TONE: Record<WhatsAppCampaignStatus, 'ok' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  draft: 'muted',
  approved: 'brand',
  sent: 'ok',
};

// Campaigns are composed on the desktop admin (template name + up to 4
// placeholder params, no HTML) -- this screen only reads status and drives
// the same two no-body transitions the desktop uses: approve, then send.
export default function WhatsAppScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const configured = useQuery({
    queryKey: ['whatsapp-configured'],
    queryFn: () => api.get<{ campaigns: WhatsAppCampaign[]; configured: boolean }>('/api/whatsapp-campaigns').then((r) => r.configured),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['whatsapp-campaigns'] });
    queryClient.invalidateQueries({ queryKey: ['whatsapp-configured'] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch<{ campaign: WhatsAppCampaign }>(`/api/whatsapp-campaigns/${id}/approve`),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not approve', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post<{ campaign: WhatsAppCampaign }>(`/api/whatsapp-campaigns/${id}/send`),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not send', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (configured.isError) {
    return <ErrorState message={(configured.error as Error)?.message || 'Failed to load.'} onRetry={() => configured.refetch()} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'WhatsApp Updates' }} />
      {configured.data === false && (
        <View style={{ padding: 16 }}>
          <Text style={{ color: colors.warn, fontSize: 13 }}>
            WhatsApp isn&apos;t configured on the server yet — sends will fail until Meta credentials are set up.
          </Text>
        </View>
      )}
      <EntityList<WhatsAppCampaign>
        queryKey={['whatsapp-campaigns']}
        queryFn={() => api.get<{ campaigns: WhatsAppCampaign[] }>('/api/whatsapp-campaigns').then((r) => r.campaigns)}
        keyExtractor={(c) => c.id}
        emptyMessage="No WhatsApp campaigns yet — compose one on the desktop admin."
        renderItem={(campaign) => (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700', flex: 1 }} numberOfLines={2}>
                {campaign.templateName}
              </Text>
              <Badge tone={STATUS_TONE[campaign.status] || 'muted'}>{campaign.status}</Badge>
            </View>
            {campaign.templateParams.length > 0 && (
              <>
                <Label>Params</Label>
                <Value>{campaign.templateParams.join(', ')}</Value>
              </>
            )}
            {(campaign.sentCount > 0 || campaign.failedCount > 0) && (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {campaign.sentCount} sent, {campaign.failedCount} failed
              </Text>
            )}
            <Text style={{ color: colors.muted, fontSize: 12 }}>Created {new Date(campaign.createdAt).toLocaleString()}</Text>
            {campaign.status === 'draft' && (
              <SecondaryButton title="Approve" onPress={() => approveMutation.mutate(campaign.id)} disabled={approveMutation.isPending} />
            )}
            {campaign.status === 'approved' && (
              <SecondaryButton
                title="Send now"
                onPress={() =>
                  Alert.alert('Send campaign', `Send WhatsApp template "${campaign.templateName}" to all opted-in clients?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Send', onPress: () => sendMutation.mutate(campaign.id) },
                  ])
                }
                disabled={sendMutation.isPending}
              />
            )}
          </Card>
        )}
      />
    </View>
  );
}
