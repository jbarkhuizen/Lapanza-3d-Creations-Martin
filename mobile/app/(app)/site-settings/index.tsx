import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, ErrorState, Label, LoadingState, PrimaryButton, SecondaryButton, TextField, Value } from '../../../components/UI';
import { api, ApiError } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

// The GET /api/settings response is the full admin settings object
// (server/settings.js's getSettings(), merged over server/settings-
// defaults.js) -- dozens of keys, several of them nested lists/objects
// (homeTiles, volumeDiscounts, emailTemplates, the configurable
// {id,name,active} lists, ...). Typed loosely on purpose: this screen only
// hand-picks a handful of plain scalar fields to edit and renders
// everything else read-only by shape, not by an exhaustive field list.
type SiteSettings = Record<string, unknown>;

type FieldType = 'text' | 'numeric';
type FieldConfig = { key: string; label: string; type: FieldType; placeholder?: string };

const BUSINESS_FIELDS: FieldConfig[] = [
  { key: 'siteName', label: 'Site name', type: 'text' },
  { key: 'tagline', label: 'Tagline', type: 'text' },
  { key: 'phoneDisplay', label: 'Phone (display)', type: 'text' },
  { key: 'phoneTel', label: 'Phone (tel link)', type: 'text' },
  { key: 'email', label: 'Email', type: 'text' },
  { key: 'hours', label: 'Hours', type: 'text' },
  { key: 'whatsapp', label: 'WhatsApp link', type: 'text' },
];

const OPERATIONAL_FIELDS: FieldConfig[] = [
  { key: 'invoiceNumberSeed', label: 'Invoice number seed', type: 'numeric' },
  { key: 'lowStockThreshold', label: 'Low stock threshold', type: 'numeric' },
  { key: 'printLeadTimeDays', label: 'Print lead time (days)', type: 'numeric' },
  { key: 'filamentDispatchDays', label: 'Filament dispatch (days)', type: 'numeric' },
  { key: 'designFileRetentionMonths', label: 'Design file retention (months)', type: 'numeric' },
];

const EDITABLE_FIELDS: FieldConfig[] = [...BUSINESS_FIELDS, ...OPERATIONAL_FIELDS];
const EDITABLE_KEYS = new Set(EDITABLE_FIELDS.map((f) => f.key));

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function summarizeComplex(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`;
  return formatScalar(value);
}

export default function SiteSettingsScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['site-settings'],
    queryFn: () => api.get<{ settings: SiteSettings }>('/api/settings'),
  });

  useEffect(() => {
    if (data?.settings && !initialized) {
      const next: Record<string, string> = {};
      EDITABLE_FIELDS.forEach((f) => {
        const v = data.settings[f.key];
        next[f.key] = v === null || v === undefined ? '' : String(v);
      });
      setForm(next);
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.put<{ settings: SiteSettings; publishWarning?: string }>('/api/settings', patch),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['site-settings'] });
      if (res.publishWarning) Alert.alert('Saved, with a warning', res.publishWarning);
    },
    onError: (e) => Alert.alert('Could not save settings', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  const publishMutation = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string; skippedCategories: string[] }>('/api/publish'),
    onSuccess: (res) => Alert.alert(res.ok ? 'Published' : 'Publish', res.message),
    onError: (e) => Alert.alert('Publish failed', e instanceof ApiError ? e.message : 'Unknown error'),
  });

  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState message={(error as Error)?.message || 'Could not load settings.'} onRetry={() => refetch()} />;

  const settings = data.settings;

  const onSave = () => {
    // PUT /api/settings only reads its own allowlisted keys off the body
    // (server/index.js), so sending the rest of `settings` back verbatim
    // alongside the edited scalars is a no-op for anything this screen
    // doesn't touch, not a risk of clobbering it.
    const patch: Record<string, unknown> = { ...settings };
    EDITABLE_FIELDS.forEach((f) => {
      const raw = form[f.key] ?? '';
      if (f.type === 'numeric') {
        const n = Number(raw);
        patch[f.key] = Number.isFinite(n) ? n : settings[f.key];
      } else {
        patch[f.key] = raw;
      }
    });
    saveMutation.mutate(patch);
  };

  const onPublish = () => {
    Alert.alert('Publish to site', 'This regenerates every page and republishes the live static site. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Publish', onPress: () => publishMutation.mutate() },
    ]);
  };

  const scalarEntries = Object.entries(settings).filter(([k, v]) => !EDITABLE_KEYS.has(k) && (v === null || typeof v !== 'object'));
  const complexEntries = Object.entries(settings).filter(([k, v]) => !EDITABLE_KEYS.has(k) && v !== null && typeof v === 'object');

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Site Settings' }} />

      <Card>
        <Label>Business info</Label>
        {BUSINESS_FIELDS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            value={form[f.key] ?? ''}
            onChangeText={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
            autoCapitalize="none"
          />
        ))}
      </Card>

      <Card>
        <Label>Operational</Label>
        {OPERATIONAL_FIELDS.map((f) => (
          <TextField
            key={f.key}
            label={f.label}
            value={form[f.key] ?? ''}
            onChangeText={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
            keyboardType="numeric"
          />
        ))}
      </Card>

      <PrimaryButton title="Save settings" onPress={onSave} loading={saveMutation.isPending} />

      <Card>
        <Label>More settings (read-only)</Label>
        {scalarEntries.map(([key, value]) => (
          <View key={key} style={styles.readonlyRow}>
            <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>{humanizeKey(key)}</Text>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
              {formatScalar(value)}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Label>Advanced settings (read-only)</Label>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          Structured fields (lists, price tiers, email templates, ...) — edit these from the desktop admin portal.
        </Text>
        {complexEntries.map(([key, value]) => (
          <View key={key} style={styles.readonlyRow}>
            <Text style={{ color: colors.muted, fontSize: 13, flex: 1 }}>{humanizeKey(key)}</Text>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '600' }}>{summarizeComplex(value)}</Text>
          </View>
        ))}
      </Card>

      <Card>
        <Label>Publish</Label>
        <Value>Regenerate every site page and push the current catalog and settings live.</Value>
        <SecondaryButton title="Publish to site" onPress={onPublish} disabled={publishMutation.isPending} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  readonlyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingVertical: 2 },
});
