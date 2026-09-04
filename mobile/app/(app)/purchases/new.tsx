import { useMutation } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Card, Label, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Purchase, PurchaseStatus } from '../../../lib/types';

export default function NewPurchaseScreen() {
  const { colors } = useTheme();
  const [supplier, setSupplier] = useState('');
  const [goods, setGoods] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [status, setStatus] = useState<PurchaseStatus>('outstanding');

  const createPurchase = useMutation({
    mutationFn: (body: unknown) => api.post<{ purchase: Purchase }>('/api/purchases', body),
    onSuccess: (res) => router.replace(`/purchases/${res.purchase.id}`),
    onError: (e) => Alert.alert('Could not save purchase', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onSubmit = () => {
    if (!supplier.trim()) {
      Alert.alert('Supplier required', 'Enter who this purchase was from.');
      return;
    }
    createPurchase.mutate({
      supplier: supplier.trim(),
      goods: goods.trim(),
      totalValue: Number(totalValue) || 0,
      paymentType: paymentType.trim(),
      status,
    });
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Purchase' }} />

      <Card>
        <Label>Supplier</Label>
        <TextField value={supplier} onChangeText={setSupplier} placeholder="e.g. Creality" />
        <Label>Goods</Label>
        <TextField value={goods} onChangeText={setGoods} placeholder="What was bought" />
        <Label>Total value</Label>
        <TextField value={totalValue} onChangeText={setTotalValue} keyboardType="decimal-pad" placeholder="0" />
        <Label>Payment type</Label>
        <TextField value={paymentType} onChangeText={setPaymentType} placeholder="e.g. Card, EFT" />
      </Card>

      <Card>
        <Label>Status</Label>
        <View style={styles.choiceRow}>
          <SecondaryButton title="Outstanding" onPress={() => setStatus('outstanding')} disabled={status === 'outstanding'} />
          <SecondaryButton title="Paid" onPress={() => setStatus('paid')} disabled={status === 'paid'} />
        </View>
      </Card>

      <PrimaryButton title="Save purchase" onPress={onSubmit} loading={createPurchase.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
