import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Card, Label, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { Client, Order } from '../../../lib/types';

type Line = { description: string; unitPrice: string; quantity: string };

const PAYMENT_METHODS = [
  { value: 'cash_on_collection', label: 'Cash' },
  { value: 'manual_eft', label: 'EFT' },
  { value: 'payfast_card', label: 'Payfast card' },
  { value: 'payfast_eft', label: 'Payfast EFT' },
];

const SHIPPING_METHODS = [
  { value: 'collect', label: 'Collect' },
  { value: 'own_courier', label: 'Own courier' },
  { value: 'courier', label: 'Courier' },
];

// Manual order entry for walk-in / phone / WhatsApp sales — mirrors
// createManualOrder in server/orders.js. This is a fast, free-text-line
// version of the desktop New Order form: it does not include the desktop's
// full product-catalog picker (that needs /api/products + /api/filaments
// search UI, a larger follow-up), so line items here are always
// description + price rather than looked-up catalog SKUs.
export default function NewOrderScreen() {
  const { colors } = useTheme();
  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInEmail, setWalkInEmail] = useState('');
  const [walkInPhone, setWalkInPhone] = useState('');
  const [lines, setLines] = useState<Line[]>([{ description: '', unitPrice: '', quantity: '1' }]);
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0].value);
  const [shippingMethod, setShippingMethod] = useState(SHIPPING_METHODS[0].value);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  const clientSearch = useQuery({
    queryKey: ['client-search', clientQuery],
    queryFn: () => api.get<{ clients: Client[] }>('/api/clients', { q: clientQuery }).then((r) => r.clients),
    enabled: clientQuery.trim().length > 1 && !selectedClient,
  });

  const createOrder = useMutation({
    mutationFn: (body: unknown) => api.post<{ order: Order }>('/api/orders', body),
    onSuccess: (res) => {
      router.replace(`/orders/${res.order.id}`);
    },
    onError: (e) => Alert.alert('Could not create order', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const updateLine = (index: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const onSubmit = () => {
    const items = lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        unitPrice: Number(l.unitPrice) || 0,
        quantity: Math.max(1, Number(l.quantity) || 1),
      }));
    if (items.length === 0) {
      Alert.alert('Add at least one item', 'Every order needs at least one line item.');
      return;
    }
    if (!selectedClient && !walkInName.trim()) {
      Alert.alert('Client required', 'Pick an existing client or enter a name for a walk-in client.');
      return;
    }

    const body: Record<string, unknown> = {
      items,
      paymentMethod,
      shippingMethod,
      alreadyPaid,
    };
    if (selectedClient) {
      body.clientId = selectedClient.id;
    } else {
      body.client = { name: walkInName.trim(), email: walkInEmail.trim() || undefined, phone: walkInPhone.trim() || undefined };
    }
    createOrder.mutate(body);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Order' }} />

      <Card>
        <Label>Client</Label>
        {selectedClient ? (
          <View style={styles.selectedClient}>
            <Text style={{ color: colors.ink, fontWeight: '600' }}>{selectedClient.name}</Text>
            <SecondaryButton title="Change" onPress={() => setSelectedClient(null)} />
          </View>
        ) : (
          <>
            <TextField placeholder="Search existing clients…" value={clientQuery} onChangeText={setClientQuery} autoCapitalize="none" />
            {clientSearch.data && clientSearch.data.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                {clientSearch.data.slice(0, 5).map((c) => (
                  <SecondaryButton key={c.id} title={`${c.name} (${c.email || 'no email'})`} onPress={() => setSelectedClient(c)} />
                ))}
              </View>
            )}
            <Text style={{ color: colors.muted, fontSize: 12 }}>Or enter a new walk-in client:</Text>
            <TextField placeholder="Name" value={walkInName} onChangeText={setWalkInName} />
            <TextField placeholder="Email (optional)" value={walkInEmail} onChangeText={setWalkInEmail} autoCapitalize="none" keyboardType="email-address" />
            <TextField placeholder="Phone (optional)" value={walkInPhone} onChangeText={setWalkInPhone} keyboardType="phone-pad" />
          </>
        )}
      </Card>

      <Card>
        <Label>Line items</Label>
        {lines.map((line, i) => (
          <View key={i} style={styles.lineRow}>
            <TextField placeholder="Description" value={line.description} onChangeText={(v) => updateLine(i, { description: v })} containerStyle={{ flex: 2 }} />
            <TextField placeholder="Price" value={line.unitPrice} onChangeText={(v) => updateLine(i, { unitPrice: v })} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
            <TextField placeholder="Qty" value={line.quantity} onChangeText={(v) => updateLine(i, { quantity: v })} keyboardType="number-pad" containerStyle={{ flex: 1 }} />
          </View>
        ))}
        <SecondaryButton title="+ Add line" onPress={() => setLines((prev) => [...prev, { description: '', unitPrice: '', quantity: '1' }])} />
      </Card>

      <Card>
        <Label>Payment method</Label>
        <View style={styles.choiceRow}>
          {PAYMENT_METHODS.map((m) => (
            <SecondaryButton key={m.value} title={m.label} onPress={() => setPaymentMethod(m.value)} disabled={paymentMethod === m.value} />
          ))}
        </View>
        <Label>Shipping method</Label>
        <View style={styles.choiceRow}>
          {SHIPPING_METHODS.map((m) => (
            <SecondaryButton key={m.value} title={m.label} onPress={() => setShippingMethod(m.value)} disabled={shippingMethod === m.value} />
          ))}
        </View>
        <View style={styles.switchRow}>
          <Text style={{ color: colors.ink }}>Already paid</Text>
          <Switch value={alreadyPaid} onValueChange={setAlreadyPaid} trackColor={{ true: colors.brand }} />
        </View>
      </Card>

      <PrimaryButton title="Create order" onPress={onSubmit} loading={createOrder.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  selectedClient: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineRow: { flexDirection: 'row', gap: spacing.sm },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xs },
});
