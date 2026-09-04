import { Stack } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EntityList } from '../../../components/EntityList';
import { Badge, Card } from '../../../components/UI';
import { api } from '../../../lib/api';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/theme-context';

// Mirrors rowToEntry() in server/audit-log.js.
type AuditEntry = {
  id: string;
  eventType: string;
  adminId: string | null;
  username: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: string;
  createdAt: string;
};

// No offset/cursor on the server (server/audit-log.js caps at 1000) -- a
// generous single page is the whole story here, not the first of many.
const LOG_LIMIT = 100;

const EVENT_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'brand' | 'muted'> = {
  login_failure: 'danger',
  client_login_failure: 'danger',
  unauthorized_access: 'danger',
  rate_limit_exceeded: 'danger',
  backup_failure: 'danger',
  payment_failure: 'danger',
  checkout_error: 'danger',
  email_failure: 'warn',
  admin_deleted: 'warn',
  password_reset: 'warn',
  login_success: 'ok',
  catalog_published: 'ok',
};

export default function AuditLogScreen() {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Audit Logs' }} />
      <EntityList<AuditEntry>
        queryKey={['audit-log', LOG_LIMIT]}
        queryFn={() => api.get<{ entries: AuditEntry[] }>('/api/audit-log', { limit: LOG_LIMIT }).then((r) => r.entries)}
        keyExtractor={(e) => e.id}
        emptyMessage="No audit events recorded yet."
        renderItem={(entry) => (
          <Card>
            <View style={styles.headerRow}>
              <Badge tone={EVENT_TONE[entry.eventType] || 'muted'}>{entry.eventType.replace(/_/g, ' ')}</Badge>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(entry.createdAt).toLocaleString()}</Text>
            </View>
            {!!entry.username && <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 13 }}>{entry.username}</Text>}
            {!!entry.detail && <Text style={{ color: colors.muted, fontSize: 13 }}>{entry.detail}</Text>}
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
});
