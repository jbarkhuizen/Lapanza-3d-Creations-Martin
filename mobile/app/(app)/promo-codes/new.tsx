import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Label, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { PromoCode, PromoKind } from '../../../lib/types';

const KINDS: { value: PromoKind; label: string }[] = [
  { value: 'percent', label: 'Percent off' },
  { value: 'fixed', label: 'Rand off' },
];

export default function NewPromoCodeScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<PromoKind>('percent');
  const [value, setValue] = useState('');
  const [minSubtotal, setMinSubtotal] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const createMutation = useMutation({
    mutationFn: (body: unknown) => api.post<{ promo: PromoCode }>('/api/promo-codes', body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['promo-codes'] });
      router.replace(`/promo-codes/${res.promo.id}`);
    },
    onError: (e) => Alert.alert('Could not create promo code', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!code.trim()) {
      Alert.alert('Code required', 'Enter a promo code.');
      return;
    }
    if (!value.trim() || Number(value) <= 0) {
      Alert.alert('Value required', 'Enter a discount value greater than 0.');
      return;
    }
    createMutation.mutate({
      code: code.trim().toUpperCase(),
      kind,
      value: Number(value),
      minSubtotal: minSubtotal.trim() ? Number(minSubtotal) : 0,
      maxUses: maxUses.trim() ? Number(maxUses) : null,
      expiresAt: expiresAt.trim() ? new Date(expiresAt.trim()).toISOString() : null,
    });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Promo Code' }} />

      <Card>
        <TextField label="Code" placeholder="e.g. SUMMER10" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Label>Discount type</Label>
        <View style={styles.choiceRow}>
          {KINDS.map((k) => (
            <SecondaryButton key={k.value} title={k.label} onPress={() => setKind(k.value)} disabled={kind === k.value} />
          ))}
        </View>
        <TextField label={kind === 'percent' ? 'Percent (e.g. 10)' : 'Amount (R)'} value={value} onChangeText={setValue} keyboardType="decimal-pad" />
      </Card>

      <Card>
        <TextField label="Minimum order subtotal (R, optional)" value={minSubtotal} onChangeText={setMinSubtotal} keyboardType="decimal-pad" />
        <TextField label="Max uses (optional, blank = unlimited)" value={maxUses} onChangeText={setMaxUses} keyboardType="number-pad" />
        <TextField label="Expires (YYYY-MM-DD, optional)" value={expiresAt} onChangeText={setExpiresAt} autoCapitalize="none" />
      </Card>

      <PrimaryButton title="Create promo code" onPress={onSubmit} loading={createMutation.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
