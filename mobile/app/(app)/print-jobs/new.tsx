import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Card, Label, LoadingState, PrimaryButton, SecondaryButton, TextField } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { formatRand } from '../../../lib/money';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';
import { InHouseFilament, PrintJob, PrintJobCostPreview, PrintJobStatus } from '../../../lib/types';

const MAX_SLOTS = 4;

type Slot = { inHouseFilamentId: string; label: string; grams: string; meters: string };

const emptySlot = (): Slot => ({ inHouseFilamentId: '', label: '', grams: '', meters: '' });

// Costing form for logging a print job -- mirrors the fields
// computeJobCost/resolveSlots in server/print-jobs.js read from req.body.
// markupPct here is entered as a whole percentage (e.g. 20) and converted to
// the fraction (0.20) the server expects; left blank it's omitted so the
// server falls back to the site's default markup (settings.markupPct).
export default function NewPrintJobScreen() {
  const { colors } = useTheme();
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [slots, setSlots] = useState<Slot[]>([emptySlot()]);
  const [printTimeMinutes, setPrintTimeMinutes] = useState('');
  const [designHours, setDesignHours] = useState('');
  const [setupHours, setSetupHours] = useState('');
  const [postProcessingHours, setPostProcessingHours] = useState('');
  const [markupPct, setMarkupPct] = useState('');
  const [finalSellingPrice, setFinalSellingPrice] = useState('');
  const [status, setStatus] = useState<PrintJobStatus>('Printed');
  const [preview, setPreview] = useState<PrintJobCostPreview | null>(null);

  const filamentsQuery = useQuery({
    queryKey: ['print-jobs', 'filament-options'],
    queryFn: () => api.get<{ filaments: InHouseFilament[] }>('/api/in-house-filament').then((r) => r.filaments.filter((f) => !f.archived)),
  });

  const updateSlot = (index: number, patch: Partial<Slot>) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const buildBody = () => ({
    itemName: itemName.trim(),
    quantity: Math.max(1, Number(quantity) || 1),
    filaments: slots
      .filter((s) => s.inHouseFilamentId)
      .map((s) => ({ inHouseFilamentId: s.inHouseFilamentId, grams: Number(s.grams) || 0, meters: Number(s.meters) || 0 })),
    printTimeMinutes: Number(printTimeMinutes) || 0,
    designHours: Number(designHours) || 0,
    setupHours: Number(setupHours) || 0,
    postProcessingHours: Number(postProcessingHours) || 0,
    markupPct: markupPct.trim() ? Number(markupPct) / 100 : undefined,
    finalSellingPrice: finalSellingPrice.trim() ? Number(finalSellingPrice) : undefined,
    status,
  });

  const validate = (): string | null => {
    if (!itemName.trim()) return 'Item name is required.';
    if (!slots.some((s) => s.inHouseFilamentId)) return 'Pick at least one filament.';
    return null;
  };

  const validateMutation = useMutation({
    mutationFn: () => api.post<{ preview: PrintJobCostPreview }>('/api/print-jobs/validate', buildBody()).then((r) => r.preview),
    onSuccess: setPreview,
    onError: (e) => Alert.alert('Could not validate', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<{ printJob: PrintJob }>('/api/print-jobs', buildBody()),
    onSuccess: (res) => router.replace(`/print-jobs/${res.printJob.id}`),
    onError: (e) => Alert.alert('Could not log job', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const onValidate = () => {
    const err = validate();
    if (err) return Alert.alert('Check the form', err);
    validateMutation.mutate();
  };

  const onSubmit = () => {
    const err = validate();
    if (err) return Alert.alert('Check the form', err);
    createMutation.mutate();
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New Print Job' }} />

      <Card>
        <Label>Item name</Label>
        <TextField value={itemName} onChangeText={setItemName} placeholder="e.g. Articulated dragon" />
        <Label>Quantity</Label>
        <TextField value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
      </Card>

      <Card>
        <Label>Filaments used</Label>
        {slots.map((slot, i) => (
          <View key={i} style={styles.slot}>
            {slot.inHouseFilamentId ? (
              <View style={styles.slotChosen}>
                <Text style={{ color: colors.ink, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {slot.label}
                </Text>
                <SecondaryButton title="Change" onPress={() => updateSlot(i, { inHouseFilamentId: '', label: '' })} />
              </View>
            ) : filamentsQuery.isLoading ? (
              <LoadingState label="Loading filaments…" />
            ) : (
              <View style={{ gap: spacing.xs }}>
                {(filamentsQuery.data || []).map((f) => (
                  <SecondaryButton
                    key={f.id}
                    title={`${f.brand} — ${f.filamentType} — ${f.colorName}`}
                    onPress={() => updateSlot(i, { inHouseFilamentId: f.id, label: `${f.filamentType} — ${f.colorName}` })}
                  />
                ))}
              </View>
            )}
            {slot.inHouseFilamentId && (
              <View style={styles.lineRow}>
                <TextField placeholder="Grams" value={slot.grams} onChangeText={(v) => updateSlot(i, { grams: v })} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
                <TextField placeholder="Meters" value={slot.meters} onChangeText={(v) => updateSlot(i, { meters: v })} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
                {slots.length > 1 && <SecondaryButton title="Remove" onPress={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))} />}
              </View>
            )}
          </View>
        ))}
        {slots.length < MAX_SLOTS && <SecondaryButton title="+ Add filament" onPress={() => setSlots((prev) => [...prev, emptySlot()])} />}
      </Card>

      <Card>
        <Label>Print time (minutes, per copy)</Label>
        <TextField value={printTimeMinutes} onChangeText={setPrintTimeMinutes} keyboardType="decimal-pad" />
        <Label>Design hours (one-off)</Label>
        <TextField value={designHours} onChangeText={setDesignHours} keyboardType="decimal-pad" />
        <Label>Setup hours (one-off)</Label>
        <TextField value={setupHours} onChangeText={setSetupHours} keyboardType="decimal-pad" />
        <Label>Post-processing hours (per copy)</Label>
        <TextField value={postProcessingHours} onChangeText={setPostProcessingHours} keyboardType="decimal-pad" />
      </Card>

      <Card>
        <Label>Markup % (optional — leave blank for the site default)</Label>
        <TextField value={markupPct} onChangeText={setMarkupPct} placeholder="e.g. 20" keyboardType="decimal-pad" />
        <Label>Final selling price (optional — defaults to the computed minimum)</Label>
        <TextField value={finalSellingPrice} onChangeText={setFinalSellingPrice} keyboardType="decimal-pad" />
        <Label>Status</Label>
        <View style={styles.statusGrid}>
          {(['Estimate', 'Printed'] as PrintJobStatus[]).map((s) => (
            <SecondaryButton key={s} title={s} onPress={() => setStatus(s)} disabled={status === s} />
          ))}
        </View>
      </Card>

      <SecondaryButton title="Validate" onPress={onValidate} disabled={validateMutation.isPending} />

      {preview && (
        <Card>
          <Label>Cost preview</Label>
          <SummaryRow label="Filament" value={formatRand(preview.filamentCost)} />
          <SummaryRow label="Power" value={formatRand(preview.powerCost)} />
          <SummaryRow label="Labour" value={formatRand(preview.labourCost)} />
          <SummaryRow label="Running costs" value={formatRand(preview.runningCost)} />
          <SummaryRow label="Total cost" value={formatRand(preview.totalCost)} bold />
          <SummaryRow label={`Markup (${Math.round(preview.markupPct * 100)}%)`} value={formatRand(preview.markupAmount)} />
          <SummaryRow label="Minimum selling price" value={formatRand(preview.sellingPrice)} bold />
          {preview.stockWarnings.length > 0 && (
            <View style={{ gap: spacing.xs, marginTop: spacing.xs }}>
              {preview.stockWarnings.map((w) => (
                <Badge key={w.inHouseFilamentId} tone="warn">
                  {w.name}: needs {w.requestedG}g, only {Math.round(w.remainingG)}g left
                </Badge>
              ))}
            </View>
          )}
        </Card>
      )}

      <PrimaryButton title="Log job" onPress={onSubmit} loading={createMutation.isPending} />
    </ScrollView>
  );
}

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={styles.summaryRow}>
      <Text style={{ color: colors.muted, fontSize: bold ? 15 : 13, fontWeight: bold ? '700' : '400' }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: bold ? 15 : 13, fontWeight: bold ? '700' : '400' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  slot: { gap: spacing.xs, paddingBottom: spacing.sm },
  slotChosen: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
});
