import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { Alert, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, Card, Label, SecondaryButton, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { useTheme } from '../../../lib/theme-context';
import { NewsletterCampaign, NewsletterCampaignStatus } from '../../../lib/types';

const STATUS_TONE: Record<NewsletterCampaignStatus, 'ok' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  draft: 'muted',
  approved: 'brand',
  sending: 'warn',
  partial: 'warn',
  sent: 'ok',
};

// Campaigns are always composed on the desktop admin (subject + HTML body,
// recipient selection) -- that composer isn't reimplemented here. This
// screen only reads existing campaigns and drives the two no-body state
// transitions the desktop also exposes as one-tap actions: approve a draft,
// then send an approved/partial one.
export default function NewsletterScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['newsletter-campaigns'] });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch<{ campaign: NewsletterCampaign }>(`/api/newsletter-campaigns/${id}/approve`),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not approve', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.post<{ campaign: NewsletterCampaign }>(`/api/newsletter-campaigns/${id}/send`),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not send', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Newsletter' }} />
      <EntityList<NewsletterCampaign>
        queryKey={['newsletter-campaigns']}
        queryFn={() => api.get<{ campaigns: NewsletterCampaign[] }>('/api/newsletter-campaigns').then((r) => r.campaigns)}
        keyExtractor={(c) => c.id}
        emptyMessage="No newsletter campaigns yet — compose one on the desktop admin."
        renderItem={(campaign) => (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700', flex: 1 }} numberOfLines={2}>
                {campaign.subject}
              </Text>
              <Badge tone={STATUS_TONE[campaign.status] || 'muted'}>{campaign.status}</Badge>
            </View>
            <Label>Recipients</Label>
            <Value>
              {campaign.sentCount + campaign.failedCount > 0
                ? `${campaign.sentCount} sent, ${campaign.failedCount} failed of ${campaign.selectedCount}`
                : `${campaign.selectedCount} selected`}
            </Value>
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              Created {new Date(campaign.createdAt).toLocaleString()}
              {campaign.sentAt ? ` · Sent ${new Date(campaign.sentAt).toLocaleString()}` : ''}
            </Text>
            {campaign.status === 'draft' && (
              <SecondaryButton
                title="Approve"
                onPress={() => approveMutation.mutate(campaign.id)}
                disabled={approveMutation.isPending}
              />
            )}
            {(campaign.status === 'approved' || campaign.status === 'partial') && (
              <SecondaryButton
                title={campaign.status === 'partial' ? 'Retry send' : 'Send now'}
                onPress={() =>
                  Alert.alert('Send campaign', `Send "${campaign.subject}" to ${campaign.selectedCount} recipient(s)?`, [
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
