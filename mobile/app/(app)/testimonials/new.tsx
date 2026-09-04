import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Label, PrimaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Testimonial } from '../../../lib/types';

export default function NewTestimonialScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [quote, setQuote] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentNote, setConsentNote] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api.post<{ testimonial: Testimonial }>('/api/testimonials', body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['testimonials'] });
      router.replace(`/testimonials/${res.testimonial.id}`);
    },
    onError: (e) => Alert.alert('Could not create testimonial', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!quote.trim()) {
      Alert.alert('Quote required', 'Enter what the customer said.');
      return;
    }
    // Always created as a draft -- publishing (and its consent requirement)
    // happens as a separate step on the detail screen.
    createMutation.mutate({ customerName: customerName.trim(), displayName: displayName.trim(), quote: quote.trim(), consentGiven, consentNote, status: 'draft' });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Testimonial' }} />

      <Card>
        <Label>Details</Label>
        <TextField placeholder="Customer name" value={customerName} onChangeText={setCustomerName} />
        <TextField placeholder="Display name (public, defaults to customer name)" value={displayName} onChangeText={setDisplayName} />
        <TextField placeholder="Quote" value={quote} onChangeText={setQuote} multiline numberOfLines={4} />
      </Card>

      <Card>
        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Consent given</Text>
          <Switch value={consentGiven} onValueChange={setConsentGiven} trackColor={{ true: colors.brand }} />
        </View>
        <TextField placeholder="Consent note (optional)" value={consentNote} onChangeText={setConsentNote} multiline numberOfLines={2} />
      </Card>

      <PrimaryButton title="Create testimonial" onPress={onSubmit} loading={createMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
